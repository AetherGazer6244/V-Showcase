/* ============================================================
 * 站点偏好设置 — localStorage 驱动的访客设置
 * ------------------------------------------------------------
 * 职责:
 *   - settings 模块级单例(所有视图共享同一份,同 lbState 模式)
 *   - load/save + 逐字段校验(clamp):非法字段回退默认,合法字段保留
 *   - initSettings(): main.ts 挂载前调用一次,把设置应用到 <html>
 *       --card-w   → .card flex-basis(styles/wall.css 已有 var 回退)
 *       data-anim  → 关动画(或动效总开关关闭)时置 'off'(CSS 暂停 .row-track)
 *       data-motion→ 动效总开关总闸(overrides.css 全局缩短过渡)
 *       data-theme → 'dark' | 'light'(auto 解析后写入,缺省 = light)
 *       --post-*   → 博客/关于正文阅读偏好(字号/行距/阅读宽度)
 *
 * 注意:
 *   - theme 支持 'auto'(跟随系统);applySettings 解析为具体值写 dataset,
 *     防闪烁内联脚本(各入口 HTML)用同一套解析逻辑,缺省明亮。
 *   - setThemeWithReveal:手动切换主题时从「按钮中心」圆形扩散(见文件末尾)。
 *   - screensaver 子对象由 screensaver.ts / ScreensaverOverlay.vue 消费。
 * ============================================================ */
import { ref, watch, watchEffect, nextTick } from 'vue';
import { debounce } from '@/shared/utils';
import { CONFIG } from './config';

export type ThemeName = 'dark' | 'light' | 'auto';
export type ResolvedTheme = 'dark' | 'light';
export type ScreensaverOrder = 'random' | 'seq';
export type ReadingFont = 'sm' | 'md' | 'lg';
export type ReadingLine = 'tight' | 'normal' | 'loose';
export type ReadingWidth = 'narrow' | 'medium' | 'wide';

/** 屏保子设置(闲置自动进入 / 换图间隔 / 顺序 / Ken Burns 动效) */
export interface ScreenSaverPrefs {
  /** 闲置自动进入的分钟数(0 = 关闭,默认) */
  idleMin: number;
  /** 换图间隔秒 */
  intervalSec: number;
  /** 播放顺序(random 洗牌 / seq 顺序循环) */
  order: ScreensaverOrder;
  /** Ken Burns 缓慢缩放动效 */
  kenBurns: boolean;
}

/** 阅读偏好(博客 / 关于页正文排版,localStorage 持久化) */
export interface ReadingPrefs {
  /** 正文字号档位 */
  fontSize: ReadingFont;
  /** 行距档位 */
  lineHeight: ReadingLine;
  /** 阅读宽度档位 */
  width: ReadingWidth;
}

/** 设置页分段按钮候选与展示文案 */
export const READING_FONT_CHOICES = ['sm', 'md', 'lg'] as const;
export const READING_LINE_CHOICES = ['tight', 'normal', 'loose'] as const;
export const READING_WIDTH_CHOICES = ['narrow', 'medium', 'wide'] as const;
export const READING_FONT_LABEL: Record<ReadingFont, string> = { sm: '小', md: '中', lg: '大' };
export const READING_LINE_LABEL: Record<ReadingLine, string> = { tight: '紧凑', normal: '标准', loose: '宽松' };
export const READING_WIDTH_LABEL: Record<ReadingWidth, string> = { narrow: '窄', medium: '中', wide: '宽' };

/** 档位 → CSS 值(post.css / about 正文消费) */
const READING_FS_PX: Record<ReadingFont, string> = { sm: '15px', md: '16.5px', lg: '18px' };
const READING_LH: Record<ReadingLine, string> = { tight: '1.6', normal: '1.8', loose: '2.05' };
const READING_MEASURE: Record<ReadingWidth, string> = { narrow: '42rem', medium: '52rem', wide: '64rem' };

/** 各主题的 <meta name="theme-color"> 值(浏览器地址栏配色;auto 解析后取对应档) */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: '#16181d',
  light: '#fdfdfd',
};

export interface SiteSettings {
  /** 主题(light 明亮默认 / dark 深色 / auto 跟随系统) */
  theme: ThemeName;
  /** 动效总开关:关 = 墙面滚动/轮换/屏保自动进入/Ken Burns/过渡全部静止 */
  motion: boolean;
  /** 阅读偏好(博客/关于正文) */
  reading: ReadingPrefs;
  /** 图片墙行数(1–6) */
  rows: number;
  /** 卡片宽度 px(180–560) */
  cardWidth: number;
  /** 滚动速度倍率(0.25–3),1 = 默认 */
  speed: number;
  /** 滚动动画开关 */
  animate: boolean;
  /** 图片墙内容自动轮换开关(定时换掉一批图 + 重排) */
  autoRotate: boolean;
  /** 轮换间隔秒(15–180) */
  rotateSec: number;
  /** 屏保模式子设置 */
  screensaver: ScreenSaverPrefs;
}

const LS_KEY = 'vshowcase.settings';

export const ROWS_RANGE = { min: 1, max: 6 } as const;
export const WIDTH_RANGE = { min: 180, max: 560 } as const;
export const SPEED_RANGE = { min: 0.25, max: 3 } as const;
export const SAVER_IDLE_RANGE = { min: 0, max: 30 } as const;
export const SAVER_INTERVAL_RANGE = { min: 3, max: 120 } as const;
export const ROTATE_RANGE = { min: 15, max: 180 } as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 宽松转数字:NaN/Infinity/非数字 → fallback */
function toNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 屏保默认值:idleMin 0 = 闲置自动进入关闭 */
export function defaultSaver(): ScreenSaverPrefs {
  return { idleMin: 0, intervalSec: 10, order: 'random', kenBurns: true };
}

/** 阅读偏好默认值 */
export function defaultReading(): ReadingPrefs {
  return { fontSize: 'md', lineHeight: 'normal', width: 'medium' };
}

/** 默认值:theme 明亮(简洁明亮定位),motion 总闸开,其余出厂值 */
export function defaultSettings(): SiteSettings {
  return {
    theme: 'light',
    motion: true,
    reading: defaultReading(),
    rows: clamp(Math.round(toNum(CONFIG.rows, 3)), ROWS_RANGE.min, ROWS_RANGE.max),
    cardWidth: clamp(Math.round(toNum(CONFIG.cardWidth, 300)), WIDTH_RANGE.min, WIDTH_RANGE.max),
    speed: 1,
    animate: true,
    autoRotate: true,
    rotateSec: 45,
    screensaver: defaultSaver(),
  };
}

/** 读取并校验屏保子对象;非对象整体回默认,合法字段保留 */
function loadSaver(raw: unknown): ScreenSaverPrefs {
  const def = defaultSaver();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
  const o = raw as Record<string, unknown>;
  return {
    idleMin: clamp(Math.round(toNum(o.idleMin, def.idleMin)), SAVER_IDLE_RANGE.min, SAVER_IDLE_RANGE.max),
    intervalSec: clamp(Math.round(toNum(o.intervalSec, def.intervalSec)), SAVER_INTERVAL_RANGE.min, SAVER_INTERVAL_RANGE.max),
    order: o.order === 'seq' ? 'seq' : 'random',
    kenBurns: typeof o.kenBurns === 'boolean' ? o.kenBurns : def.kenBurns,
  };
}

/** 读取并校验阅读偏好子对象;档位非法逐字段回默认 */
function loadReading(raw: unknown): ReadingPrefs {
  const def = defaultReading();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
  const o = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, choices: readonly T[], fallback: T): T =>
    choices.includes(v as T) ? (v as T) : fallback;
  return {
    fontSize: pick(o.fontSize, READING_FONT_CHOICES, def.fontSize),
    lineHeight: pick(o.lineHeight, READING_LINE_CHOICES, def.lineHeight),
    width: pick(o.width, READING_WIDTH_CHOICES, def.width),
  };
}

/** 解析 auto 主题 → 具体值;无 matchMedia 环境(测试/老浏览器)回明亮 */
export function resolveTheme(t: ThemeName): ResolvedTheme {
  if (t === 'dark') return 'dark';
  if (t !== 'auto') return 'light';
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 读取并校验 localStorage;逐字段 clamp,只丢弃非法字段 */
export function loadSettings(): SiteSettings {
  const def = defaultSettings();
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return def;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
  const o = raw as Record<string, unknown>;
  return {
    theme: o.theme === 'dark' || o.theme === 'light' || o.theme === 'auto' ? o.theme : def.theme,
    motion: typeof o.motion === 'boolean' ? o.motion : def.motion,
    reading: loadReading(o.reading),
    rows: clamp(Math.round(toNum(o.rows, def.rows)), ROWS_RANGE.min, ROWS_RANGE.max),
    cardWidth: clamp(Math.round(toNum(o.cardWidth, def.cardWidth)), WIDTH_RANGE.min, WIDTH_RANGE.max),
    speed: clamp(toNum(o.speed, def.speed), SPEED_RANGE.min, SPEED_RANGE.max),
    animate: typeof o.animate === 'boolean' ? o.animate : def.animate,
    autoRotate: typeof o.autoRotate === 'boolean' ? o.autoRotate : def.autoRotate,
    rotateSec: clamp(Math.round(toNum(o.rotateSec, def.rotateSec)), ROTATE_RANGE.min, ROTATE_RANGE.max),
    screensaver: loadSaver(o.screensaver),
  };
}

export function saveSettings(s: SiteSettings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等写入失败静默忽略 */
  }
}

/* ---- 模块级单例 + 自动持久化 ---- */
const state = { settings: ref<SiteSettings>(loadSettings()) };

/** 持久化防抖 250ms:设置页拖动滑杆时每个 input 事件都会深改一次 settings,
 *  不防抖就是每秒几十次 JSON.stringify + localStorage 写(同步 IO,主线程卡顿)。
 *  防抖后停手 250ms 才写一次。 */
const saveSettingsSoon = debounce(saveSettings, 250);

watch(state.settings, (s) => saveSettingsSoon(s), { deep: true });

/** 立即落盘防抖中的保存。
 *  页面隐藏/关闭时 Web 存储不保证等得到 250ms 定时器,需要抢在前面 flush。 */
export function flushSettingsSave(): void {
  saveSettingsSoon.flush();
}

if (typeof window !== 'undefined') {
  // pagehide:移动端直接杀进程/切走时可能收不到;visibilitychange:hidden
  // 是最后可靠时机(iOS Safari 上 tab 切后台只发这个)。两处都幂等 flush。
  window.addEventListener('pagehide', flushSettingsSave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushSettingsSave();
  });
}

export function useSettings() {
  return { settings: state.settings };
}

/** 恢复出厂默认(立即生效并持久化) */
export function resetSettings(): void {
  state.settings.value = defaultSettings();
}

/** 把设置写到 <html>(幂等,可在测试中直接调用) */
export function applySettings(s: SiteSettings): void {
  const el = document.documentElement;
  const theme = resolveTheme(s.theme);
  el.dataset.theme = theme;
  el.style.setProperty('--card-w', s.cardWidth + 'px');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme]);

  // 动效总开关:off 时墙动画(沿用 data-anim 通道)与全局过渡(data-motion)一并静止
  if (s.motion) delete el.dataset.motion;
  else el.dataset.motion = 'off';
  if (s.animate && s.motion) delete el.dataset.anim;
  else el.dataset.anim = 'off';

  // 阅读偏好 → 博客/关于正文 CSS 变量
  el.style.setProperty('--post-fs', READING_FS_PX[s.reading.fontSize]);
  el.style.setProperty('--post-lh', READING_LH[s.reading.lineHeight]);
  el.style.setProperty('--post-measure', READING_MEASURE[s.reading.width]);
}

/** main.ts 挂载前调用一次:应用当前值 + 后续变化实时应用 + 系统主题变化跟随 */
export function initSettings(): void {
  applySettings(state.settings.value);
  watchEffect(() => applySettings(state.settings.value));
  // auto 主题:OS 切深浅色时实时跟随(无 matchMedia 环境静默跳过)
  if (typeof window.matchMedia === 'function') {
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => applySettings(state.settings.value);
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
      else mq.addListener?.(onChange);
    } catch {
      /* 极老环境无 media query 支持,auto 静止为初始解析值 */
    }
  }
}

/* ============================================================
 * 主题切换动画 —「按钮中心圆形向外扩散」
 * ------------------------------------------------------------
 * 实现:原生 View Transitions API。切换瞬间浏览器给新旧状态各拍
 * 一张快照,新快照用 clip-path: circle() 从点击处(圆心)裁剪并放大,
 * 旧快照垫在底下不动 → 观感就是新主题从按钮中心一圈圈铺开。
 * 圆心/半径以 --theme-reveal-* 写在 <html> 上,动画由 CSS 消费。
 *
 * 降级(一律即时切换,绝不报错):
 *   - 浏览器无 startViewTransition(旧版 Firefox / 部分 WebView)
 *   - 目标主题解析后与当前相同(如深色下点「跟随系统」)
 *   - 动效总开关关闭 / 系统 prefers-reduced-motion
 * ============================================================ */

/** 圆形扩散用到的 CSS 变量(写在 <html> 上,供 ::view-transition-* 消费) */
const REVEAL_VARS = ['--theme-reveal-x', '--theme-reveal-y', '--theme-reveal-r'] as const;

/** 正在进行的切换动画(连续点击时先掐掉旧的,避免两条过渡叠加) */
let activeReveal: ViewTransition | null = null;

/** 系统是否要求减少动态效果(与 fireflies.ts 同口径) */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 写入主题(内存 + <html>);动画回调里也用它,保证快照拿到新主题 */
function applyTheme(theme: ThemeName): void {
  const s = state.settings.value;
  if (s.theme !== theme) state.settings.value = { ...s, theme };
  applySettings(state.settings.value);
}

/** 清理圆形扩散的 CSS 变量 */
function clearRevealVars(): void {
  const root = document.documentElement;
  for (const v of REVEAL_VARS) root.style.removeProperty(v);
}

/**
 * 切换主题:新主题以「按钮中心圆」向外扩散。
 * @param theme  目标主题(light / dark / auto)
 * @param origin 触发元素(取其矩形中心为圆心;缺省 = 视口中心)
 */
export function setThemeWithReveal(theme: ThemeName, origin?: Element | null): void {
  const cur = state.settings.value;
  /* 解析后主题没变 → 没必要播动画(点了等于没点),只写设置 */
  const sameResolved = resolveTheme(cur.theme) === resolveTheme(theme);
  const canAnimate =
    !sameResolved &&
    cur.motion &&
    !prefersReducedMotion() &&
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function';

  if (!canAnimate) {
    applyTheme(theme);
    return;
  }

  /* 圆心 = 元素矩形中心;半径 = 到视口最远角(保证铺满整屏) */
  const rect = origin?.getBoundingClientRect?.();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hasRect = !!rect && (rect.width > 0 || rect.height > 0);
  const x = hasRect ? rect.left + rect.width / 2 : vw / 2;
  const y = hasRect ? rect.top + rect.height / 2 : vh / 2;
  const r = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y)) + 1;

  const root = document.documentElement;
  root.style.setProperty('--theme-reveal-x', x + 'px');
  root.style.setProperty('--theme-reveal-y', y + 'px');
  root.style.setProperty('--theme-reveal-r', r + 'px');

  /* 连续点击:掐掉上一次的动画(其 finished 回调不会清掉本次的变量) */
  try {
    activeReveal?.skipTransition();
  } catch {
    /* 上一次已结束,忽略 */
  }

  let vt: ViewTransition;
  try {
    vt = document.startViewTransition(() => {
      applyTheme(theme);
      /* 等 Vue 刷完(主题卡选中态等 DOM 变化)再让浏览器拍新快照 */
      return nextTick();
    });
  } catch {
    /* API 存在但调用失败(极端环境)→ 退回即时切换 */
    applyTheme(theme);
    clearRevealVars();
    return;
  }

  activeReveal = vt;
  const done = () => {
    if (activeReveal === vt) {
      activeReveal = null;
      clearRevealVars();
    }
  };
  /* 动画被打断时 finished 会 reject,两种结局都要收尾 */
  vt.finished.then(done, done);
}
