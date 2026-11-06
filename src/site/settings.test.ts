import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import {
  defaultSettings, defaultSaver, defaultReading, loadSettings, saveSettings, applySettings,
  resetSettings, useSettings, flushSettingsSave, resolveTheme,
  ROWS_RANGE, WIDTH_RANGE, SPEED_RANGE, ROTATE_RANGE,
} from './settings';
import type { SiteSettings } from './settings';
import { CONFIG } from './config';

const LS_KEY = 'vshowcase.settings';

beforeEach(() => {
  localStorage.clear();
  resetSettings();
});

describe('settings 默认值', () => {
  it('rows/cardWidth 取自 CONFIG 且在范围内', () => {
    const d = defaultSettings();
    expect(d.rows).toBe(CONFIG.rows);
    expect(d.cardWidth).toBe(CONFIG.cardWidth);
    expect(d.rows).toBeGreaterThanOrEqual(ROWS_RANGE.min);
    expect(d.rows).toBeLessThanOrEqual(ROWS_RANGE.max);
    expect(d.cardWidth).toBeGreaterThanOrEqual(WIDTH_RANGE.min);
    expect(d.cardWidth).toBeLessThanOrEqual(WIDTH_RANGE.max);
    expect(d.speed).toBe(1);
    expect(d.animate).toBe(true);
    // 明亮为默认主题(简洁明亮定位),动效总闸默认开
    expect(d.theme).toBe('light');
    expect(d.motion).toBe(true);
    expect(d.reading).toEqual(defaultReading());
    expect(d.autoRotate).toBe(true);
    expect(d.rotateSec).toBe(45);
  });
});

describe('loadSettings 校验', () => {
  it('无存储 → 默认值', () => {
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it('非法 JSON → 默认值', () => {
    localStorage.setItem(LS_KEY, '{broken json');
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it('非对象存储 → 默认值', () => {
    localStorage.setItem(LS_KEY, '[1,2,3]');
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it('越界值逐字段 clamp', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      rows: 99, cardWidth: 10, speed: 100, animate: 'x', theme: 'blue', motion: 'no',
    }));
    expect(loadSettings()).toEqual({
      rows: ROWS_RANGE.max,
      cardWidth: WIDTH_RANGE.min,
      speed: SPEED_RANGE.max,
      animate: true, // 非法类型回默认
      autoRotate: true, // 非法类型回默认
      rotateSec: 45, // 缺失补默认
      theme: 'light', // 非法主题回默认(明亮)
      motion: true, // 非法类型回默认
      reading: defaultReading(),
      screensaver: defaultSaver(),
    });
  });

  it('部分字段合法 → 合法字段保留,缺失字段补默认', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ rows: 5 }));
    const s = loadSettings();
    expect(s.rows).toBe(5);
    expect(s.cardWidth).toBe(defaultSettings().cardWidth);
    expect(s.speed).toBe(1);
    expect(s.animate).toBe(true);
    expect(s.theme).toBe('light');
  });
});

describe('theme 三态(light/dark/auto)', () => {
  it('合法值全部接受', () => {
    for (const t of ['dark', 'light', 'auto'] as const) {
      localStorage.setItem(LS_KEY, JSON.stringify({ theme: t }));
      expect(loadSettings().theme).toBe(t);
    }
  });

  it('非法 theme 值回退 light', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ theme: 'blue' }));
    expect(loadSettings().theme).toBe('light');
  });
});

describe('resolveTheme(auto 解析)', () => {
  it('dark/light 直接透传', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it('auto:无 matchMedia 环境(jsdom)回明亮', () => {
    // jsdom 未实现 matchMedia;mock 一个不匹配的实例验证明亮分支
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
    });
    expect(resolveTheme('auto')).toBe('light');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }),
    });
    expect(resolveTheme('auto')).toBe('dark');
    if (original === undefined) delete (window as { matchMedia?: unknown }).matchMedia;
    else Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: original });
  });
});

describe('持久化往返', () => {
  it('save → load 一致', () => {
    const s: SiteSettings = {
      ...defaultSettings(),
      theme: 'auto', motion: false, reading: { fontSize: 'lg', lineHeight: 'loose', width: 'wide' },
      rows: 2, cardWidth: 420, speed: 1.5, animate: false,
      screensaver: { idleMin: 5, intervalSec: 40, order: 'seq', kenBurns: false },
    };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });
});

describe('applySettings 应用到 <html>', () => {
  it('写入 --card-w 与 data-anim', () => {
    applySettings({ ...defaultSettings(), rows: 3, cardWidth: 360, animate: false });
    expect(
      document.documentElement.style.getPropertyValue('--card-w'),
    ).toBe('360px');
    expect(document.documentElement.dataset.anim).toBe('off');

    applySettings({ ...defaultSettings(), rows: 3, cardWidth: 360, animate: true });
    expect(document.documentElement.dataset.anim).toBeUndefined();
  });

  it('动效总开关:关 → data-motion=off + data-anim=off(动画开也停)', () => {
    applySettings({ ...defaultSettings(), motion: false, animate: true });
    expect(document.documentElement.dataset.motion).toBe('off');
    expect(document.documentElement.dataset.anim).toBe('off');

    applySettings({ ...defaultSettings(), motion: true, animate: true });
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(document.documentElement.dataset.anim).toBeUndefined();
  });

  it('阅读偏好 → --post-* CSS 变量', () => {
    applySettings({ ...defaultSettings(), reading: { fontSize: 'lg', lineHeight: 'loose', width: 'wide' } });
    const el = document.documentElement;
    expect(el.style.getPropertyValue('--post-fs')).toBe('18px');
    expect(el.style.getPropertyValue('--post-lh')).toBe('2.05');
    expect(el.style.getPropertyValue('--post-measure')).toBe('64rem');
  });

  it('data-theme 恒为解析后的具体值(light 默认)', () => {
    applySettings(defaultSettings());
    expect(document.documentElement.dataset.theme).toBe('light');
    applySettings({ ...defaultSettings(), theme: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('theme 主题', () => {
  /** jsdom 无内建 meta,真实页面 4 个入口 HTML 均已声明 */
  function ensureThemeColorMeta(): HTMLMetaElement {
    let m = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      document.head.appendChild(m);
    }
    return m;
  }

  it('light 应用 dataset.theme 与 meta theme-color', () => {
    const meta = ensureThemeColorMeta();
    applySettings({ ...defaultSettings(), theme: 'light' });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(meta.getAttribute('content')).toBe('#fdfdfd');
  });

  it('dark 应用 dataset.theme 与 meta theme-color', () => {
    const meta = ensureThemeColorMeta();
    applySettings({ ...defaultSettings(), theme: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(meta.getAttribute('content')).toBe('#16181d');
  });

  it('LS 预置 light 正确读出', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ theme: 'light' }));
    expect(loadSettings().theme).toBe('light');
  });
});

describe('reading 阅读偏好', () => {
  it('非法档位逐字段回默认,合法档位保留', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      reading: { fontSize: 'huge', lineHeight: 'loose', width: 'medium' },
    }));
    expect(loadSettings().reading).toEqual({ fontSize: 'md', lineHeight: 'loose', width: 'medium' });
  });

  it('reading 非对象 → 整体回默认', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ reading: 'big' }));
    expect(loadSettings().reading).toEqual(defaultReading());
  });

  it('save → load 保留阅读偏好', () => {
    const s: SiteSettings = {
      ...defaultSettings(),
      reading: { fontSize: 'sm', lineHeight: 'tight', width: 'narrow' },
    };
    saveSettings(s);
    expect(loadSettings().reading).toEqual(s.reading);
  });
});

describe('motion 动效总开关', () => {
  it('默认开;非法类型回默认', () => {
    expect(defaultSettings().motion).toBe(true);
    localStorage.setItem(LS_KEY, JSON.stringify({ motion: 'off' }));
    expect(loadSettings().motion).toBe(true);
    localStorage.setItem(LS_KEY, JSON.stringify({ motion: false }));
    expect(loadSettings().motion).toBe(false);
  });
});

describe('内容轮换设置', () => {
  it('默认:autoRotate 开 / 45 秒', () => {
    expect(defaultSettings().autoRotate).toBe(true);
    expect(defaultSettings().rotateSec).toBe(45);
  });

  it('rotateSec 越界 clamp + 非法 autoRotate 回默认', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ rotateSec: 1, autoRotate: 'yes' }));
    const s = loadSettings();
    expect(s.rotateSec).toBe(ROTATE_RANGE.min);
    expect(s.autoRotate).toBe(true);

    localStorage.setItem(LS_KEY, JSON.stringify({ rotateSec: 9999, autoRotate: false }));
    const s2 = loadSettings();
    expect(s2.rotateSec).toBe(ROTATE_RANGE.max);
    expect(s2.autoRotate).toBe(false);
  });

  it('save → load 保留轮换设置', () => {
    const s: SiteSettings = { ...defaultSettings(), autoRotate: false, rotateSec: 90 };
    saveSettings(s);
    expect(loadSettings().autoRotate).toBe(false);
    expect(loadSettings().rotateSec).toBe(90);
  });
});

describe('useSettings 单例', () => {
  it('修改后持久化,resetSettings 恢复默认并持久化', async () => {
    const { settings } = useSettings();
    settings.value = {
      ...defaultSettings(),
      theme: 'dark', rows: 6, cardWidth: 560, speed: 3, animate: false,
    };
    await nextTick(); // watch 异步 flush 后调度防抖保存
    flushSettingsSave(); // 持久化有 250ms 防抖,测试里直接冲刷
    expect(loadSettings().rows).toBe(6);

    resetSettings();
    await nextTick();
    flushSettingsSave();
    expect(settings.value).toEqual(defaultSettings());
    expect(loadSettings()).toEqual(defaultSettings());
  });
});

describe('screensaver 屏保子设置', () => {
  it('默认:idleMin=0(关)/ 10 秒 / 随机 / Ken Burns 开', () => {
    expect(defaultSaver()).toEqual({
      idleMin: 0, intervalSec: 10, order: 'random', kenBurns: true,
    });
    expect(loadSettings().screensaver).toEqual(defaultSaver());
  });

  it('越界 clamp + 非法类型回默认', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      screensaver: { idleMin: 99, intervalSec: 1, order: 'shuffle', kenBurns: 'yes' },
    }));
    expect(loadSettings().screensaver).toEqual({
      idleMin: 30, intervalSec: 3, order: 'random', kenBurns: true,
    });
  });

  it('负数 idleMin / 超大间隔 clamp 到范围', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      screensaver: { idleMin: -5, intervalSec: 999 },
    }));
    const s = loadSettings().screensaver;
    expect(s.idleMin).toBe(0);
    expect(s.intervalSec).toBe(120);
    expect(s.order).toBe('random'); // 缺失字段补默认
    expect(s.kenBurns).toBe(true);
  });

  it('screensaver 非对象 → 整体回默认', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ screensaver: 'fast' }));
    expect(loadSettings().screensaver).toEqual(defaultSaver());
  });

  it('部分合法字段保留,缺失补默认', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      screensaver: { idleMin: 3, order: 'seq' },
    }));
    expect(loadSettings().screensaver).toEqual({
      idleMin: 3, intervalSec: 10, order: 'seq', kenBurns: true,
    });
  });
});
