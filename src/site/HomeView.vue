<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick } from 'vue';
import { loadImages } from '@/shared/apiClient';
import { shuffle, debounce } from '@/shared/utils';
import type { Image } from '@/shared/types';
import { useSettings } from './settings';
import { useFocal, useOrientation, useLightbox, lightboxIsOpen } from './composables';
import { isScreensaverActive } from './screensaver';
import { createImgFallback } from './imgFallback';
import { windowSize, nextWindow, prefersReducedMotion, STEP_RATIO } from './wallRotate';
import {
  flingVelocity, flingStep, isTap,
  DRAG_SLOP, DOUBLE_TAP_MS, FLING_MIN_V, type MoveSample,
} from './wallTouch';
import {
  copiesForViewport, flowPos, dragPos, flingPos,
  flowDurationSec, periodSpeed,
} from './wallScroll';
import {
  shouldUpgradeHd, needsHdUpgrade, pickHdSrc,
  HD_PRELOAD_TIMEOUT_MS, HD_MAX_UPGRADES,
  type ConnInfo,
} from './wallHd';

/* 组件名固定:App.vue 用 <KeepAlive include="['HomeView']"> 只保活主页 */
defineOptions({ name: 'HomeView' });

/* ============================================================
 * 设计要点
 * ------------------------------------------------------------
 * 黑框修复:副本行必须带真实 src。先只渲染原图序列,等全部
 * @load/@error 后才双份渲染(displayRows)并加 .ready ——
 * 若在首张加载完就克隆,副本多为占位 GIF,永远空白。
 *
 * 内容轮换:墙上只放一个「登台窗口」(windowSize,约池 60% 且
 * 不小于填满一屏);到点整墙按行错峰淡出 → 不可见时替换 → 淡入
 * (.swapping),轨道 DOM 保留、相位连续。下一窗在排计时时就定好
 * 并预热,换班新卡不会来不及淡入。gallery 固定顺序,RowItem.gi
 * 始终指向池下标 → 灯箱 ←/→ 导航始终正确。
 *
 * 轮换守卫:开屏中/后台/拖拽中/已暂停/灯箱/屏保/动画关闭/系统
 * 减少动态效果 时不触发;换班半秒内忽略点击与 resize。
 *
 * 触屏:.row(滚动容器)> .row-track(内容),真滚动(scrollLeft)推进。
 * 按住暂停,拖动/惯性直接改滚动位置;双击持久暂停;单击延迟
 * 280ms 开灯箱(给双击留判定窗)。仅响应 touch 指针,桌面用
 * :hover 暂停(JS 侧 hoverRows)。
 *
 * v2.15 流动方式改为真滚动:旧做法用 transform 把整行当大照片搬,
 * 显卡每帧落在半像素上只能「猜着画」→ 整行发虚(用户反馈滑动模糊)。
 * 真滚动按物理像素对齐,始终清晰。
 *
 * 设置:行数/速度来自 useSettings();改行数从当前窗口重建分桶,
 * 不重新请求,loadedUrls 按 url 键记录故状态保留。
 * ============================================================ */

interface RowItem {
  img: Image;
  /** 在全量池 gallery 中的下标(灯箱 ←/→ 用) */
  gi: number;
}

/** 卡片间横向间距(与 styles/wall.css 的 --row-gap 一致,窗口宽度估算用) */
const ROW_GAP = 16;
/** 换班淡出/淡入时长(与 CSS .row-track transition 一致) */
const FADE_MS = 400;
/** 换班时每行的错峰延迟(形成波浪) */
const ROW_STAGGER_MS = 60;
/** 换班前等待预热就绪的上限(毫秒):正常网速早已命中缓存 → 零等待;
 *  极端慢网最多多等这么久,绝不卡死换班 */
const PREHEAT_GRACE_MS = 800;
/** 开屏进度条最短停留时长:网快/全缓存时避免进度条一闪而过(观感生硬)。
 *  从组件挂载起算,不足此时长的部分在就绪前补等。 */
const MIN_SPLASH_MS = 800;
/** 加载态提交的兜底时限(ms):见 scheduleLoadedFlush 的说明 */
const LOADED_FLUSH_FALLBACK_MS = 100;

const { focalStyle } = useFocal();
const { orientClass } = useOrientation();
const lb = useLightbox();
const { settings } = useSettings();

/** 坏图自愈:缩略图失败后分级重试 → 回退原图直链(imgFallback.ts)。
 *  srcOverrides 键 = img.url,与 loadedUrls 对齐 */
const imgFallback = createImgFallback();
const srcOverrides = imgFallback.overrides;

/** 全量池(顺序固定;整圈走完时重洗一次) */
const gallery = ref<Image[]>([]);
/** 当前登台窗口内的条目(带池下标,Live 重建行的数据源) */
const windowItems = ref<RowItem[]>([]);
const rows = ref<RowItem[][]>([]);
const total = ref(0);
const allLoaded = ref(false);
/** 换班中(整墙淡出,遮蔽内容替换) */
const swapping = ref(false);
/** 开屏遮罩是否仍挂在 DOM 里(淡出结束后才摘掉) */
const splashVisible = ref(true);
/** 开屏遮罩正在淡出 */
const splashFading = ref(false);
/** 揭幕淡出时长(ms),与 CSS .wall-splash 的 0.6s 对齐 */
const SPLASH_FADE_MS = 600;
/** 已就绪(加载成功或失败)的图片,控制淡入(键 = img.url) */
const loadedUrls = ref(new Set<string>());

/* ---- 闲时升级原画(v2.17)----
 * 墙先用 600w 缩略图开屏;就绪后,只对真正出现在屏幕上的卡片,
 * 一张一张在后台预载原图,载好即换(原图进缓存,换 src 不闪)。
 * 省流模式/2G 不升级;失败保持缩略图;单次会话有张数上限。 */
const hdReady = ref(new Set<string>());
/** 已排队/已尝试过的 url(同一张不重复排队) */
const hdTried = new Set<string>();
/** 待升级队列(先进先出) */
let hdQueue: Image[] = [];
/** 正在预载(并发恒为 1,不跟正常浏览抢带宽) */
let hdBusy = false;
/** 已成功升级的张数(会话上限用) */
let hdUpgraded = 0;
/** 可见性观察器:只有真正进入视口的卡片才排队 */
let hdObserver: IntersectionObserver | null = null;

/* ---- 真滚动流动(v2.15)----
 * 每行一个滚动位置 pos ∈ [0, period),period = 一份内容的宽度。
 * pos 直接写进 .row 的 scrollLeft(整数像素),不进 Vue 响应式:
 * 每帧只动 DOM,不做组件重渲。 */
const rowPos: number[] = [];
/** 每行滚动周期(px)缓存:内容/尺寸变了要作废重测 */
const rowPeriods: number[] = [];
/** 鼠标悬停的行(桌面端:hover 暂停流动) */
const hoverRows = new Set<number>();
/** 视口宽(响应式:算每行需要几份内容) */
const viewportW = ref(typeof window !== 'undefined' ? window.innerWidth : 0);
/* ---- 触屏手动状态 ---- */
/** 手指按住中的行(临时暂停) */
const heldRows = ref(new Set<number>());
/** 双击切换的持久暂停行 */
const pausedRows = ref(new Set<number>());

let safetyTimer: ReturnType<typeof setTimeout> | null = null;
/** 开屏遮罩淡出收尾计时器 */
let splashTimer: ReturnType<typeof setTimeout> | null = null;
/** 开屏起点(onMounted 记录),配合 MIN_SPLASH_MS 计算还需补等多久 */
let openedAt = 0;
/** 最短时长补足计时器(非 null = 已决定就绪、正在补等;防双触发源重复排程) */
let pendingReadyTimer: ReturnType<typeof setTimeout> | null = null;

/* 按行数把窗口条目轮转分桶 + 行内打乱(输入已带池下标 gi) */
function buildRows(items: RowItem[], n: number): RowItem[][] {
  const buckets: RowItem[][] = Array.from({ length: n }, () => []);
  items.forEach((it, i) => buckets[i % n].push(it));
  buckets.forEach((b) => shuffle(b));
  return buckets;
}

/* ============================================================
 * 内容轮换:登台窗口 + 每行重排
 * ============================================================ */

/** 当前窗口的池游标(下次从这里滑) */
let cursor = 0;
/** 轮换计时器 */
let rotateTimer: ReturnType<typeof setTimeout> | null = null;
/** 组件已卸载标记(遮蔽在途异步换班) */
let disposed = false;
/** 已发起预加载的 thumb(键 = thumb url,值为该次预热的 Promise)
 *  同一 url 只发一次 new Image,重复调用拿同一个 Promise。 */
const preloadJobs = new Map<string, Promise<void>>();

/** 一次「已排定」的轮换:排计时时就算好窗口与池顺序并预热,
 *  到点直接兑现 → 预热与实际换上的必然是同一批图,新卡不闪。 */
interface RotationPlan {
  /** 本次取出的池下标(读 pool 字段) */
  indices: number[];
  /** 兑现后游标 */
  nextCursor: number;
  /** 兑现时生效的池顺序(重洗时为新数组) */
  pool: Image[];
  /** 本窗缩略图的预热 Promise(排定时收集,换班前据此等缓存就绪) */
  promises: Promise<void>[];
}
let rotationPlan: RotationPlan | null = null;

/** 由排定窗口构造条目(读该排定自带的池顺序,不改动全局 gallery) */
function planItems(plan: RotationPlan): RowItem[] {
  return plan.indices.map((gi) => ({ img: plan.pool[gi], gi }));
}

/** 当前应取窗口张数 */
function currentWindowSize(): number {
  return windowSize(
    gallery.value.length,
    settings.value.rows,
    window.innerWidth,
    settings.value.cardWidth,
    ROW_GAP,
  );
}

/** 推演下一窗(纯读:不改游标、不重洗),整圈走完则产出重洗后的新池 */
function planNext(): RotationPlan | null {
  const n = gallery.value.length;
  if (n === 0) return null;
  const size = currentWindowSize();
  const step = Math.max(1, Math.round(size * STEP_RATIO));
  const res = nextWindow(n, cursor, size, step);
  if (res.wrapped) {
    return {
      indices: Array.from({ length: size }, (_, i) => i),
      nextCursor: step % n,
      pool: shuffle(gallery.value.slice()),
      promises: [],
    };
  }
  return { indices: res.indices, nextCursor: res.nextCursor, pool: gallery.value, promises: [] };
}

/** 兑现排定:换池 / 前进游标 / 返回窗口条目,并作废该排定 */
function commitPlan(plan: RotationPlan): RowItem[] {
  gallery.value = plan.pool;
  cursor = plan.nextCursor;
  rotationPlan = null;
  return planItems(plan);
}

/** 预取(仅暖浏览器缓存,不改 loadedUrls 以免开屏前误判就绪)
 *  返回 Promise:换班前用它确认「这一窗的缩略图已全部进缓存」,
 *  onload / onerror 都 resolve(坏图不能把等待打碎)。 */
function preloadImage(url: string, markKey: string): Promise<void> {
  if (!url) return Promise.resolve();
  const cached = preloadJobs.get(url);
  if (cached) return cached;
  const job = new Promise<void>((resolve) => {
    const im = new Image();
    im.onload = im.onerror = () => {
      preloadJobs.delete(url);
      // 墙已就绪后再预热成功 → 按 markKey(原图 url)登记,换班出新卡时不淡入闪白
      if (allLoaded.value) markLoaded(markKey);
      resolve();
    };
    im.src = url;
  });
  preloadJobs.set(url, job);
  return job;
}

/** 预热下一批要挂上墙的缩略图。只暖 thumb(模板只请求 thumb),
 *  登记键统一用 img.url,与模板 loadedUrls.has(img.url) 对齐。
 *  返回每张的预热 Promise,供换班时聚合等待。 */
function preloadItems(items: RowItem[]): Promise<void>[] {
  return items.map((it) => preloadImage(it.img.thumb, it.img.url));
}

/** 错峰淡出 → 不可见时替换内容 → 淡入(轨道 DOM 保留,滚动相位连续)
 *
 *  plan 非空时,换 DOM 前先等「这一窗缩略图全部进缓存」:
 *  否则慢网下新卡先上墙、图后到 → 用户看到一片空白相框。
 *  正常网速预热早在 rotateSec 秒内完成,此处零等待;慢网最多等 PREHEAT_GRACE_MS。
 *  resize 重排不带 plan(内容本就在缓存)→ 直接换。 */
async function swapTo(items: RowItem[], plan: RotationPlan | null = null): Promise<void> {
  // swapping 兼作互斥标志:上一次换班还在淡出/写回时,定时轮换与
  // resize 重排绝不能并发进 —— 否则两个 windowItems 交错写回,
  // rows 与窗口内容错位,滚动位置映射到错误的图。
  if (disposed || swapping.value || items.length === 0) return;
  swapping.value = true;
  const waitMs = FADE_MS + ROW_STAGGER_MS * Math.max(0, rows.value.length - 1) + 40;
  await new Promise<void>((r) => setTimeout(r, waitMs));
  if (disposed) return;
  if (plan && plan.promises.length) {
    await Promise.race([
      Promise.all(plan.promises),
      new Promise<void>((r) => setTimeout(r, PREHEAT_GRACE_MS)),
    ]);
    if (disposed) return;
  }
  // 换班前记相位:内容换了绝对位置无意义,按相位还原 → 换班不跳
  const phases = capturePhases();
  windowItems.value = items;
  rows.value = buildRows(items, settings.value.rows);
  resetTouchState();
  await nextTick();
  if (disposed) return;
  restorePhases(phases);
  swapping.value = false;
  // 换班期间流动是停的,这里恢复
  startFlow();
  // 换了一批卡片 → 重新观察(新卡进视口才会排队升级原画)
  refreshHdObserver();
}

/** 鼠标是否正悬停在某行上(CSS 已据此暂停滚动,轮换也须让路) */
function isRowHovered(): boolean {
  return rowEls.some((el) => el != null && el.matches(':hover'));
}

/** 是否允许此刻轮换 */
function canRotate(): boolean {
  return settings.value.autoRotate
    && settings.value.animate
    && settings.value.motion
    && !prefersReducedMotion()
    && allLoaded.value
    && !document.hidden
    && viewActive
    && !isRowHovered()
    && !active
    && heldRows.value.size === 0
    && pausedRows.value.size === 0
    && !swapping.value
    && !lightboxIsOpen()
    && !isScreensaverActive();
}

/** 是否可以安排计时(开关/动画/动效总闸/减少动态效果/卸载/已停用) */
function canScheduleRotate(): boolean {
  return settings.value.autoRotate
    && settings.value.animate
    && settings.value.motion
    && !prefersReducedMotion()
    && !disposed
    && viewActive;
}

/** 重新排下一次轮换(同时把这一窗排定下来并预热,保证预热即将来时的内容) */
function scheduleRotate(): void {
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  if (!canScheduleRotate()) { rotationPlan = null; return; }
  rotationPlan = planNext();
  // 排定即预热:把这一窗的缩略图 Promise 收进 plan,到点换班时据此等缓存
  if (rotationPlan) rotationPlan.promises = preloadItems(planItems(rotationPlan));
  rotateTimer = setTimeout(rotateNow, settings.value.rotateSec * 1000);
}

async function rotateNow(): Promise<void> {
  rotateTimer = null;
  if (disposed) return;
  if (!canRotate()) { scheduleRotate(); return; }
  // 优先兑现排定的那一窗(排定时已预热);排定缺失才现场推演
  const plan = rotationPlan ?? planNext();
  if (!plan) { scheduleRotate(); return; }
  // 兑现时带上 plan → swapTo 换 DOM 前等这一窗的缓存就绪(消空白)
  await swapTo(commitPlan(plan), plan);
  if (!disposed) scheduleRotate();
}

function forceReady() {
  // 幂等:已就绪 / 正在补等中,双重触发源(flushLoaded 与 safetyTimer)只吃一次
  if (allLoaded.value || pendingReadyTimer != null) return;
  // 开屏不足最短时长 → 补足后再就绪,进度条不闪现
  const wait = MIN_SPLASH_MS - (performance.now() - openedAt);
  if (wait > 0) {
    pendingReadyTimer = setTimeout(() => {
      pendingReadyTimer = null;
      applyReady();
    }, wait);
    return;
  }
  applyReady();
}

/** 真正切到就绪态(forceReady 的落地步骤) */
function applyReady() {
  if (allLoaded.value) return;
  if (loadedUrls.value.size < total.value) {
    console.warn('[V-Showcase] 加载超时/部分失败,强制启动滚动');
  }
  allLoaded.value = true;
  hideSplash();
  if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
  // 墙就绪后重排一次:此时预热可登记 loadedUrls,换班新卡不淡入闪白
  scheduleRotate();
  // 流动起来(真滚动)
  startFlow();
  // 就绪后再谈升级原画:别跟开屏抢带宽
  refreshHdObserver();
}

/**
 * 收起开屏遮罩:加淡出类,定时后从 DOM 摘掉。
 *
 * ⚠ 刻意不用 Vue <transition>:它的 nextFrame 依赖 requestAnimationFrame,
 *   浏览器挂起 rAF(窗口被遮挡/节能模式)时 leave-from 永远摘不掉,
 *   遮罩会一直不透明地盖住整墙 —— 表现为「墙在动但一片空白」。
 *   类名 + setTimeout 不依赖 rAF,定时器照常触发。
 */
function hideSplash(): void {
  if (!splashVisible.value || splashFading.value) return;
  splashFading.value = true;
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  splashTimer = setTimeout(() => {
    splashTimer = null;
    splashVisible.value = false;
  }, SPLASH_FADE_MS);
}

/** 登记某 url 已就绪(加载成功或失败都算,控制淡入)
 *
 *  ⚠ 加载事件逐张到达,而 HomeView 是单一组件、单一渲染函数(覆盖全部行与卡片):
 *    每张图都直接改响应式 Set 就会整页重渲染一次 —— 60 张 = 60 次,
 *    每次重建全部 vnode(约 240 个)并重算全部样式绑定。
 *    这里攒进非响应式集合,到下一帧(或兜底计时器)一次性提交,60 次降为 1 次。 */
const pendingLoaded = new Set<string>();
let loadedFlushRaf: number | null = null;
/** 兜底计时器句柄(见 scheduleLoadedFlush) */
let loadedFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** 取消在途的 rAF:部分环境没有 cancelAnimationFrame,需存在性判断 */
function cancelLoadedFlushRaf(): void {
  if (loadedFlushRaf == null) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(loadedFlushRaf);
  loadedFlushRaf = null;
}

/** 取消在途的兜底计时器 */
function clearLoadedFlushTimer(): void {
  if (loadedFlushTimer == null) return;
  clearTimeout(loadedFlushTimer);
  loadedFlushTimer = null;
}

/**
 * 排一次「加载态提交」:rAF + setTimeout 双通道,谁先到谁提交并取消另一条。
 *
 * ⚠ 2026-11 线上事故(勿回退成只靠 rAF):
 *   浏览器在窗口被遮挡、节能模式、远程桌面等场景会挂起 rAF,
 *   而 document.visibilityState 仍是 'visible'。此时图片早已下载完成,
 *   但 flushLoaded 永远不跑 → loadedUrls 永不更新 → 卡片一直 opacity:0,
 *   表现为「墙在流动但全是空白卡片」(点开灯箱却能看到图,
 *   因为灯箱读的是原图)。30s 安全计时器只把墙置 ready,救不了空白。
 *   setTimeout 兜底保证「已加载」一定能落地。
 */
function scheduleLoadedFlush(): void {
  if (loadedFlushRaf != null || loadedFlushTimer != null) return;
  if (typeof requestAnimationFrame === 'function') {
    loadedFlushRaf = requestAnimationFrame(() => {
      loadedFlushRaf = null;
      clearLoadedFlushTimer();
      flushLoaded();
    });
  }
  loadedFlushTimer = setTimeout(() => {
    loadedFlushTimer = null;
    cancelLoadedFlushRaf();
    flushLoaded();
  }, LOADED_FLUSH_FALLBACK_MS);
}

function markLoaded(url: string) {
  if (loadedUrls.value.has(url) || pendingLoaded.has(url)) return;
  pendingLoaded.add(url);
  scheduleLoadedFlush();
}

function flushLoaded() {
  if (disposed || pendingLoaded.size === 0) return;
  const next = new Set(loadedUrls.value);
  for (const u of pendingLoaded) next.add(u);
  pendingLoaded.clear();
  loadedUrls.value = next;
  if (total.value > 0 && next.size >= total.value) forceReady();
}

function onImgDone(img: Image) {
  imgFallback.onLoad(img.url); // 若成功,停掉在途的自愈重试
  markLoaded(img.url);
}

/** 缩略图加载失败:计数上仍算「已就绪」,否则墙面会永远卡在加载态;
 *  同时在后台走自愈链(延时重试 → 回退原图直链),成功后 @load 自然补上内容 */
function onImgError(img: Image) {
  onImgDone(img);
  imgFallback.onError(img.url, img.thumb, img.url);
}

/* ============================================================
 * 闲时升级原画(v2.17)
 * ------------------------------------------------------------
 * 判定在 wallHd.ts(纯逻辑,可单测);这里只管 DOM 编排:
 * 观察 → 排队 → 预载 → 换 src。
 * ============================================================ */

/** url → Image(按 url 找回 thumb;图集/焦点查表也按 url 命中) */
const imgByUrl = computed(() => new Map(gallery.value.map((i) => [i.url, i])));

/** 墙容器(模板 ref):观察器只在墙里找卡片 */
const wallEl = ref<HTMLElement | null>(null);

/** 当前网络状况(Chromium/Android 有;其他浏览器 undefined) */
function hdConnection(): ConnInfo | null {
  const nav = navigator as Navigator & { connection?: ConnInfo };
  return nav.connection ?? null;
}

/** 是否允许升级(省流模式/2G → 否) */
function hdAllowed(): boolean {
  return shouldUpgradeHd(hdConnection());
}

/** 现在能不能跑升级(后台/换班/停用/卸载 → 暂停) */
function canHdRun(): boolean {
  return !disposed && viewActive && !document.hidden && !swapping.value;
}

/** 卡片该显示哪张:已升级的原图,否则缩略图(坏图回退地址优先) */
function cardSrc(img: Image): string {
  return pickHdSrc(
    img.url,
    img.thumb,
    hdReady.value.has(img.url),
    srcOverrides.value.get(img.url),
  );
}

/** 预载一张原图:成功 true / 失败或超时 false */
function preloadHd(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const im = new Image();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      im.onload = null;
      im.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), HD_PRELOAD_TIMEOUT_MS);
    im.onload = () => finish(true);
    im.onerror = () => finish(false);
    im.src = url;
  });
}

/** 队列推进:一次只预载一张;失败也继续下一张 */
async function hdPump(): Promise<void> {
  if (hdBusy) return;
  hdBusy = true;
  try {
    while (hdQueue.length > 0) {
      if (!canHdRun()) return;   // 暂停(后台/换班/停用):队列留着,回来再续
      if (hdUpgraded >= HD_MAX_UPGRADES) { hdQueue.length = 0; return; }
      const img = hdQueue.shift();
      if (!img) break;
      const ok = await preloadHd(img.url);
      if (ok && !disposed) {
        hdUpgraded += 1;
        const next = new Set(hdReady.value);
        next.add(img.url);
        hdReady.value = next;
      }
    }
  } finally {
    hdBusy = false;
  }
}

/** 排队一张图(去重 + 值不值得升级 + 网关) */
function hdEnqueue(img: Image): void {
  if (!hdAllowed()) return;
  if (!needsHdUpgrade(img.url, img.thumb)) return;   // 本来就是原图
  if (hdTried.has(img.url)) return;
  hdTried.add(img.url);
  hdQueue.push(img);
  void hdPump();
}

/** 卡片进入视口 → 排队升级 */
function onHdVisible(entries: IntersectionObserverEntry[]): void {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target as HTMLElement;
    const url = el.dataset.hdUrl || '';
    const img = url ? imgByUrl.value.get(url) : undefined;
    if (img) hdEnqueue(img);
  }
}

/** 挂上观察器(墙就绪/换班后重新观察新卡片) */
function setupHdObserver(): void {
  teardownHdObserver();
  if (disposed || !viewActive) return;
  if (!hdAllowed()) return;
  if (typeof IntersectionObserver === 'undefined') return;
  const root = wallEl.value;
  if (!root) return;
  hdObserver = new IntersectionObserver(onHdVisible, { rootMargin: '300px 0px' });
  root.querySelectorAll<HTMLElement>('img[data-hd-url]').forEach((el) => {
    if (el.dataset.hdUrl) hdObserver?.observe(el);
  });
}

function teardownHdObserver(): void {
  if (hdObserver) {
    hdObserver.disconnect();
    hdObserver = null;
  }
}

/** 墙就绪/换班后重新观察(DOM 换了一批卡片) */
function refreshHdObserver(): void {
  void nextTick().then(() => {
    if (disposed || !viewActive) return;
    setupHdObserver();
    void hdPump();
  });
}

/** 每行渲染几份内容(偶数):保证滚动周期覆盖视口,否则回卷点不可达 */
const rowCopies = computed<number[]>(() =>
  rows.value.map((r) => copiesForViewport(r.length, settings.value.cardWidth, viewportW.value)),
);

/** allLoaded 后每行内容渲染成偶数份 → 滚到一个周期处画面与起点一致,无缝回卷 */
const displayRows = computed<RowItem[][]>(() => {
  if (!allLoaded.value) return rows.value;
  return rows.value.map((r, i) => {
    const n = rowCopies.value[i] ?? 2;
    const out: RowItem[] = [];
    for (let c = 0; c < n; c++) for (const it of r) out.push(it);
    return out;
  });
});

function trackStyle(rowIndex: number): Record<string, string> {
  return {
    // 换班时的错峰延迟(波浪);非换班态无 effect
    transitionDelay: (rowIndex * ROW_STAGGER_MS) + 'ms',
  };
}

function openLightbox(gi: number) {
  lb.open(gallery.value.map((i) => ({ url: i.url, name: i.name })), gi);
}

/* ============================================================
 * 真滚动流动(v2.15)
 * ------------------------------------------------------------
 * 每帧把各行的 scrollLeft 往前推一点(整数像素)。
 * 为什么不用 CSS 动画:transform 动画由显卡把整行当一张大照片搬,
 * 每帧落在半像素上只能「猜着画」→ 整行发虚;真滚动按物理像素对齐。
 * ============================================================ */
let flowRaf: number | null = null;
let lastFlowT = 0;

/** 一行是否暂停流动(按住/双击/悬停/惯性进行中) */
function isRowPaused(r: number): boolean {
  if (heldRows.value.has(r)) return true;
  if (pausedRows.value.has(r)) return true;
  if (hoverRows.has(r)) return true;
  if ((flingV[r] ?? 0) !== 0) return true;   // 惯性期间不叠加自动流动
  return false;
}

/** 全局是否允许流动(动画开关/动效总闸/减少动态效果/后台/换班中/已停用) */
function canFlow(): boolean {
  return settings.value.animate
    && settings.value.motion
    && !prefersReducedMotion()
    && !document.hidden
    && allLoaded.value
    && viewActive
    && !swapping.value;
}

/** 启动流动循环(幂等) */
function startFlow(): void {
  if (flowRaf != null) return;
  if (!canFlow()) return;
  lastFlowT = performance.now();
  flowRaf = requestAnimationFrame(flowFrame);
}

/** 停止流动循环 */
function stopFlow(): void {
  if (flowRaf == null) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(flowRaf);
  flowRaf = null;
}

/** 流动主循环:推进各行滚动位置 */
function flowFrame(now: number): void {
  flowRaf = null;
  // 帧间隔上限 1s:浏览器在后台标签页会把 rAF 降频到 ~1 帧/秒,
  // 若按 64ms 封顶,墙会越走越慢(相位落后于真实时间);
  // 放宽到 1s 后每次推进「真实流逝的时间」→ 与旧 CSS 动画一样按墙上时钟走。
  const dt = Math.max(4, Math.min(1000, now - lastFlowT));
  lastFlowT = now;
  // 条件不满足就停摆(不再排下一帧):省电,也避免后台空转
  if (!canFlow()) return;
  for (let r = 0; r < rowEls.length; r++) {
    if (isRowPaused(r)) continue;
    const el = rowEls[r];
    if (!el) continue;
    const period = rowPeriod(r);
    if (period <= 0) continue;
    // 偶数行向左走(内容左移 = scrollLeft 增大),奇数行反向
    const dir = r % 2 === 1 ? -1 : 1;
    const speed = periodSpeed(period, flowDurationSec(r, settings.value.speed));
    const next = flowPos(rowPos[r] ?? 0, period, dir, speed, dt);
    if (next === (rowPos[r] ?? 0)) continue;
    rowPos[r] = next;
    el.scrollLeft = Math.round(next);
  }
  flowRaf = requestAnimationFrame(flowFrame);
}

/** 把某行的滚动位置写进 DOM(整数像素) */
function applyRowPos(r: number, pos: number): void {
  rowPos[r] = pos;
  const el = rowEls[r];
  if (el) el.scrollLeft = Math.round(pos);
}

/** 位置复位:内容/尺寸变了,旧位置无意义,回到起点 */
function resetPositions(): void {
  rowPos.length = 0;
  for (let r = 0; r < rowEls.length; r++) {
    const el = rowEls[r];
    if (el) el.scrollLeft = 0;
  }
}

/** 记录各行相位(位置 / 周期) */
function capturePhases(): number[] {
  return rowEls.map((_, r) => {
    const period = rowPeriod(r);
    return period > 0 ? (rowPos[r] ?? 0) / period : 0;
  });
}

/** 按相位还原位置:内容换了,绝对位置无意义,相位才是连续的
 *  (换班不跳:旧实现靠 CSS 动画相位连续,这里用比例还原等价) */
function restorePhases(phases: number[]): void {
  for (let r = 0; r < rowEls.length; r++) {
    const el = rowEls[r];
    if (!el) continue;
    const period = rowPeriod(r);
    const pos = period > 0 ? (phases[r] ?? 0) * period : 0;
    rowPos[r] = pos;
    el.scrollLeft = Math.round(pos);
  }
}

/* ============================================================
 * 触屏手势(pointer capture,仅 touch 指针)
 * ============================================================ */
const rowEls: (HTMLElement | null)[] = [];

function setRowRef(r: number, el: unknown) {
  rowEls[r] = el as HTMLElement | null;
}

interface ActiveDrag {
  row: number;
  pointerId: number;
  startX: number;
  startY: number;
  startT: number;
  lastX: number;
  dragging: boolean;
  samples: MoveSample[];
  period: number;
  /** 距上一帧累计的位移,由 rAF 统一落到滚动位置(见 onRowMove) */
  pendingDx: number;
}
let active: ActiveDrag | null = null;
/** 拖拽后抑制紧随其后的合成 click(误开灯箱) */
let justDragged = false;
let justDraggedTimer: ReturnType<typeof setTimeout> | null = null;
/** 触屏延迟开灯箱的定时器(给双击暂停留判定窗口) */
let pendingOpenTimer: ReturnType<typeof setTimeout> | null = null;
/** 最近一次按下的指针类型(触屏点击卡片才延迟开灯箱) */
let lastPointerType = 'mouse';
/** 每行最近一次点按时间(双击判定) */
const lastTap = new Map<number, number>();
/** 每行惯性速度(0 = 无惯性) */
const flingV: number[] = [];
let rafId: number | null = null;
let lastFrameT = 0;

/** 行一份内容的宽度缓存(= 滚动周期,px)。
 *
 *  ⚠ scrollWidth 读取会强制同步重排,绝不能放进每帧循环
 *    (最多 6 行 × 60 帧 = 每秒 360 次强制布局)。
 *    这里改成:内容或尺寸变化后把缓存清空,下次用到时量一次并落缓存。 */
function rowPeriod(r: number): number {
  const cached = rowPeriods[r];
  if (cached) return cached;
  const copies = rowCopies.value[r] ?? 2;
  const track = rowEls[r]?.querySelector('.row-track');
  const w = track instanceof HTMLElement ? track.scrollWidth : 0;
  // 轨道 = 若干份相同内容 → 一份宽(= 滚动周期) = 总宽 / 份数
  rowPeriods[r] = copies >= 2 ? w / copies : w;
  return rowPeriods[r];
}

/** 内容/尺寸变化后作废缓存(下次读取会重新量) */
function invalidateRowPeriods(): void {
  rowPeriods.length = 0;
}

function addHeld(r: number) {
  const s = new Set(heldRows.value); s.add(r); heldRows.value = s;
}
function removeHeld(r: number) {
  const s = new Set(heldRows.value); s.delete(r); heldRows.value = s;
}
function togglePaused(r: number) {
  const s = new Set(pausedRows.value);
  if (s.has(r)) s.delete(r); else s.add(r);
  pausedRows.value = s;
}

function onRowDown(r: number, e: PointerEvent) {
  if (e.pointerType === 'mouse') return; // 桌面用 :hover 暂停,不做鼠标拖拽
  lastPointerType = e.pointerType;
  if (!allLoaded.value || active || swapping.value) return;
  stopFling(r); // 该行惯性立即停,从当前位置接管
  const el = e.currentTarget as HTMLElement;
  el?.setPointerCapture?.(e.pointerId);
  active = {
    row: r,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    startT: performance.now(),
    lastX: e.clientX,
    dragging: false,
    samples: [{ x: e.clientX, t: performance.now() }],
    period: 0,
    pendingDx: 0,
  };
  addHeld(r);
}

/** 高采样率鼠标/触屏的 pointermove 可达每秒数百次,每次都写位置就是
 *  每秒几百次 DOM 写。改为只累计位移,拖拽渲染合并到每帧一次。 */
let dragRaf: number | null = null;

function applyDragFrame() {
  dragRaf = null;
  if (!active || !active.dragging || active.pendingDx === 0) return;
  const dx = active.pendingDx;
  active.pendingDx = 0;
  const r = active.row;
  const period = active.period || rowPeriod(r);
  // 手指右移 → 内容跟着右移 → 滚动位置左移
  applyRowPos(r, dragPos(rowPos[r] ?? 0, period, dx));
}

function onRowMove(e: PointerEvent) {
  if (!active || active.pointerId !== e.pointerId) return;
  const now = performance.now();
  const dx = e.clientX - active.startX;
  const dy = e.clientY - active.startY;

  if (!active.dragging) {
    if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
    active.dragging = true;
    active.period = rowPeriod(active.row);
  }

  active.samples.push({ x: e.clientX, t: now });
  if (active.samples.length > 8) active.samples.shift();

  active.pendingDx += e.clientX - active.lastX;
  active.lastX = e.clientX;
  if (dragRaf == null) dragRaf = requestAnimationFrame(applyDragFrame);
}

function onRowUp(e: PointerEvent) {
  if (!active || active.pointerId !== e.pointerId) return;
  const el = e.currentTarget as HTMLElement | null;
  if (el && el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  removeHeld(active.row);

  const dist = Math.hypot(e.clientX - active.startX, e.clientY - active.startY);
  const dur = performance.now() - active.startT;

  // 松手前把还没落到帧上的剩余位移补齐,否则惯性从旧位置起跳会回跳一小段
  if (active.pendingDx !== 0) {
    const r = active.row;
    const period = active.period || rowPeriod(r);
    applyRowPos(r, dragPos(rowPos[r] ?? 0, period, active.pendingDx));
    active.pendingDx = 0;
  }

  if (active.dragging) {
    justDragged = true;
    if (justDraggedTimer) clearTimeout(justDraggedTimer);
    justDraggedTimer = setTimeout(() => { justDragged = false; }, 150);
    const v = flingVelocity(active.samples);
    if (Math.abs(v) > FLING_MIN_V) startFling(active.row, v);
  } else if (isTap(dist, dur)) {
    handleTap(active.row);
  }
  active = null;
  // 交互结束:重置轮换计时,避免刚松手就换班
  scheduleRotate();
}

/** 单击记录,300ms 内第二次点按 → 切换该行持久暂停 */
function handleTap(r: number) {
  const now = performance.now();
  const prev = lastTap.get(r) ?? -Infinity;
  lastTap.set(r, now);
  if (now - prev < DOUBLE_TAP_MS) {
    lastTap.set(r, -Infinity);
    stopFling(r);
    // 取消第一击排队的开灯箱,并吞掉第二击的合成 click
    if (pendingOpenTimer) { clearTimeout(pendingOpenTimer); pendingOpenTimer = null; }
    justDragged = true;
    if (justDraggedTimer) clearTimeout(justDraggedTimer);
    justDraggedTimer = setTimeout(() => { justDragged = false; }, 150);
    togglePaused(r);
  }
}

function startFling(r: number, v: number) {
  flingV[r] = v;
  if (rafId == null) {
    lastFrameT = performance.now();
    rafId = requestAnimationFrame(flingFrame);
  }
}

function stopFling(r: number) {
  flingV[r] = 0;
}

function flingFrame(now: number) {
  const dt = Math.max(4, Math.min(64, now - lastFrameT));
  lastFrameT = now;
  let moving = false;
  for (let r = 0; r < flingV.length; r++) {
    const v = flingV[r];
    if (!v) continue;
    const [nv, dx] = flingStep(v, dt);
    flingV[r] = nv;
    if (nv === 0) continue;
    moving = true;
    // 惯性方向跟着手指:内容跟手走 → 滚动位置反向
    applyRowPos(r, flingPos(rowPos[r] ?? 0, rowPeriod(r), dx));
  }
  rafId = moving ? requestAnimationFrame(flingFrame) : null;
  // 惯性结束 → 自动流动可以恢复(惯性期间该行是被跳过的)
  if (!moving) startFlow();
}

/** 卡片点击入口:拖拽手势后的合成 click 不开灯箱;
 * 触屏延迟 280ms 开,双击(暂停/继续)可在此窗口内取消它 */
function onCardClick(gi: number) {
  // 换班中:池顺序可能已被重洗,画面上的旧 gi 会开错图,直接忽略
  if (swapping.value) return;
  if (justDragged) {
    justDragged = false;
    return;
  }
  if (lastPointerType === 'touch') {
    if (pendingOpenTimer) return; // 已有等待中的打开(双击的第二击)
    pendingOpenTimer = setTimeout(() => {
      pendingOpenTimer = null;
      openLightbox(gi);
    }, 280);
    return;
  }
  openLightbox(gi);
}

/* 行数变更 → 从当前窗口重建分桶(不重新请求),触屏状态一并复位 */
watch(() => settings.value.rows, (n) => {
  if (windowItems.value.length > 0) rows.value = buildRows(windowItems.value, n);
  resetTouchState();
  scheduleRotate();
});

/* 轮换开关/间隔变更 → 立刻重排(关闭则清计时器) */
watch(
  [() => settings.value.autoRotate, () => settings.value.rotateSec, () => settings.value.motion],
  () => scheduleRotate(),
);

/* 动画开关/动效总闸/流速变更 → 流动循环要跟着停/启(速度下一帧自然生效) */
watch(
  [() => settings.value.animate, () => settings.value.motion, () => settings.value.speed],
  () => {
    if (canFlow()) startFlow(); else stopFlow();
  },
);

/* 卡片宽度变更 → 窗口「填满一屏」下限可能变化,重算并要求补足 */
watch(() => settings.value.cardWidth, () => onResize());

/* 内容/份数变了 → 位置与周期都要重置(旧位置在新内容里无意义) */
watch(displayRows, () => {
  invalidateRowPeriods();
  resetPositions();
}, { flush: 'post' });

/** 视口变化:仅当窗口需「变宽补卡」时重建(避免循环露白);防抖 */
const onResize = debounce(() => {
  // 卡片宽变了 → 轨道宽度必然变了 → 必须作废缓存,
  // 否则下面即使不换班也会继续用旧周期做惯性折返(位移对不上画面)
  invalidateRowPeriods();
  const n = gallery.value.length;
  // 换班中忽略本次 resize,避免与轮换并发两次换班
  if (disposed || !viewActive || n === 0 || swapping.value) return;
  const size = currentWindowSize();
  if (size <= windowItems.value.length) return;
  const plan = planNext();
  if (!plan) return;
  void swapTo(commitPlan(plan));
}, 300);

/** 视口宽度变化(立即生效,不用等防抖):决定每行要渲染几份内容 */
function onViewportResize() {
  viewportW.value = window.innerWidth;
}

function onVisibilityChange() {
  if (document.hidden) return;
  if (!viewActive) return;   // 已被 KeepAlive 停用:不在后台干活
  // 后台期间 rAF 停摆,滞留的加载登记回前台立刻冲一次(不等下一帧),
  // 否则「后台打开、切回前台」时墙面可能多等一拍才算就绪
  cancelLoadedFlushRaf();
  clearLoadedFlushTimer();
  flushLoaded();
  // 回到前台时重置轮换计时(后台不计时),并刷新下一窗预热
  scheduleRotate();
  // 流动循环在后台会自己停摆,回前台要重新起
  startFlow();
  // 回前台:继续升级原画(后台暂停的队列)
  refreshHdObserver();
}

/** 网络状况变化(开了省流模式/换到 2G)→ 立刻停/启升级原画 */
function onConnectionChange() {
  if (!hdAllowed()) {
    teardownHdObserver();
    hdQueue.length = 0;
    return;
  }
  refreshHdObserver();
}

/** 系统「减少动态效果」开关变化 → 立刻停/启轮换与流动 */
function onMotionPrefChange() {
  scheduleRotate();
  if (canFlow()) startFlow(); else stopFlow();
}

/** 订阅减少动态效果变化(旧版 Safari 只有 addListener) */
let motionQuery: MediaQueryList | null = null;
function watchMotionPref() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', onMotionPrefChange);
  } else if (typeof motionQuery.addListener === 'function') {
    motionQuery.addListener(onMotionPrefChange);
  }
}

function unwatchMotionPref() {
  if (!motionQuery) return;
  if (typeof motionQuery.removeEventListener === 'function') {
    motionQuery.removeEventListener('change', onMotionPrefChange);
  } else if (typeof motionQuery.removeListener === 'function') {
    motionQuery.removeListener(onMotionPrefChange);
  }
  motionQuery = null;
}

/** 是否处于「在场」状态:挂载中且未被 KeepAlive 停用 */
let viewActive = true;
/** 事件监听是否已挂上(KeepAlive 下 mount/activate 都会来,别重复挂) */
let listenersOn = false;

function addListeners(): void {
  if (listenersOn) return;
  listenersOn = true;
  window.addEventListener('resize', onResize);
  window.addEventListener('resize', onViewportResize);
  document.addEventListener('visibilitychange', onVisibilityChange);
  // 网络状况变化(Chromium/Android):开了省流模式就别再升级原画
  const conn = hdConnection() as (ConnInfo & { addEventListener?: (t: string, cb: () => void) => void }) | null;
  conn?.addEventListener?.('change', onConnectionChange);
}

function removeListeners(): void {
  if (!listenersOn) return;
  listenersOn = false;
  window.removeEventListener('resize', onResize);
  window.removeEventListener('resize', onViewportResize);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  const conn = hdConnection() as (ConnInfo & { removeEventListener?: (t: string, cb: () => void) => void }) | null;
  conn?.removeEventListener?.('change', onConnectionChange);
}

function resetTouchState() {
  flingV.length = rows.value.length;
  flingV.fill(0);
  heldRows.value = new Set();
  pausedRows.value = new Set();
  hoverRows.clear();
  invalidateRowPeriods();
  resetPositions();
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
}

/** 桌面端:hover 暂停该行流动(旧实现是 CSS :hover 规则,改为 JS 判定) */
function onRowEnter(r: number, e: PointerEvent) {
  if (e.pointerType === 'touch') return;   // 触屏没有真 hover
  hoverRows.add(r);
}

function onRowLeave(r: number, e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  hoverRows.delete(r);
}

onMounted(async () => {
  disposed = false;
  viewActive = true;
  openedAt = performance.now();

  addListeners();
  watchMotionPref();

  const { images } = await loadImages();
  if (disposed) return;

  gallery.value = shuffle(images.slice());

  // 首屏 = 池中第一个登台窗口
  const first = planNext();
  const items = first ? commitPlan(first) : [];
  windowItems.value = items;
  total.value = new Set(items.map((it) => it.img.url)).size;

  rows.value = buildRows(items, settings.value.rows);
  resetTouchState();

  if (total.value > 0) {
    // 30 秒兜底:个别图片卡死也强制启动(失败图显示深灰底)
    safetyTimer = setTimeout(forceReady, 30000);
    scheduleRotate();
  } else {
    allLoaded.value = true;
    hideSplash();
  }
});

/* KeepAlive 停用(离开主页):把后台该停的都停掉 ——
 * 流动循环、轮换计时、事件监听。组件实例与 DOM 保留在内存里,
 * 切回来时原样秒开(不重拉名单、不重挂缩略图、不重弹开屏)。 */
onDeactivated(() => {
  viewActive = false;
  stopFlow();
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  rotationPlan = null;
  removeListeners();
  // 不在后台偷偷下原图
  teardownHdObserver();
});

/* KeepAlive 激活(回到主页):恢复流动与轮换 */
onActivated(() => {
  viewActive = true;
  addListeners();
  // 离开期间窗口可能变过:刷新视口宽(决定每行渲染几份内容)
  onViewportResize();
  startFlow();
  scheduleRotate();
  // 回到主页:继续升级原画
  refreshHdObserver();
});

onUnmounted(() => {
  disposed = true;
  viewActive = false;
  stopFlow();
  imgFallback.dispose();
  removeListeners();
  unwatchMotionPref();
  teardownHdObserver();
  hdQueue.length = 0;
  hdTried.clear();
  if (safetyTimer) clearTimeout(safetyTimer);
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  if (pendingReadyTimer) { clearTimeout(pendingReadyTimer); pendingReadyTimer = null; }
  if (justDraggedTimer) clearTimeout(justDraggedTimer);
  if (pendingOpenTimer) clearTimeout(pendingOpenTimer);
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  if (rafId != null) cancelAnimationFrame(rafId);
  if (dragRaf != null) cancelAnimationFrame(dragRaf);
  cancelLoadedFlushRaf();
  clearLoadedFlushTimer();
  pendingLoaded.clear();
});
</script>

<template>
  <main ref="wallEl" class="wall" :class="{ ready: allLoaded, swapping }" aria-label="流动图片墙">
    <!-- 开屏遮罩(v2.5):名单请求与图片下载全程藏在遮罩后,墙就绪即整幕淡出揭幕
     * ⚠ 不用 <transition>:Vue 过渡靠 rAF 推进,浏览器挂起 rAF 时遮罩会永远
     *   停在 leave-from(不透明),把整墙盖死 → 表现为「一片空白」。改类名 + 定时器 -->
    <div
      v-if="splashVisible"
      class="wall-splash"
      :class="{ 'is-fading': splashFading }"
      role="status"
      aria-label="正在准备图片墙"
    >
      <span class="wall-splash-mark" aria-hidden="true">V</span>
      <span class="wall-splash-spinner" aria-hidden="true"></span>
    </div>

    <div
      v-for="(row, r) in displayRows"
      :key="r"
      :ref="(el) => setRowRef(r, el)"
      class="row"
      :class="{ 'is-held': heldRows.has(r), 'is-paused': pausedRows.has(r) }"
      @pointerdown="onRowDown(r, $event)"
      @pointermove="onRowMove"
      @pointerup="onRowUp"
      @pointercancel="onRowUp"
      @pointerenter="onRowEnter(r, $event)"
      @pointerleave="onRowLeave(r, $event)"
    >
      <!-- 真滚动(v2.15):.row 是滚动容器,内容在 .row-track 里;
           滚动位置由 JS 每帧写 scrollLeft(整数像素)→ 画面不糊 -->
      <div class="row-track" :style="trackStyle(r)">
        <figure
          v-for="(item, j) in row"
          :key="`${r}-${item.gi}-${j}`"
          class="card"
          :data-index="item.gi"
          @click="onCardClick(item.gi)"
        >
          <div class="img-box" :class="orientClass(item.img.url)">
            <img
              :src="cardSrc(item.img)"
              :alt="item.img.name || '图片'"
              :style="focalStyle(item.img.url)"
              :class="{ 'is-loaded': loadedUrls.has(item.img.url) }"
              :data-hd-url="item.img.url"
              loading="eager"
              decoding="async"
              @load="onImgDone(item.img)"
              @error="onImgError(item.img)"
            >
          </div>
        </figure>
      </div>
    </div>
  </main>
</template>
