import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import HomeView from './HomeView.vue';
import { useSettings, defaultSettings } from './settings';
import type { Image } from '@/shared/types';

/* rAF 垫片:markLoaded 的批量提交依赖 requestAnimationFrame,
 * jsdom 无 rAF 时用 setTimeout 兜底(仅测试环境) */
if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = ((cb: (t: number) => void) =>
    setTimeout(() => cb(performance.now()), 16)) as unknown as typeof window.requestAnimationFrame;
}

/* ── mock 图片列表(10 张,窗口会全量登台) ── */
const imgs: Image[] = Array.from({ length: 10 }, (_, i) => ({
  url: `https://a/${i + 1}.jpg`,
  thumb: `https://t/${i + 1}.jpg`,
  name: `img${i + 1}`,
}));

vi.mock('@/shared/apiClient', () => ({
  loadImages: vi.fn(async () => ({ images: imgs })),
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('HomeView 开屏最短时长(MIN_SPLASH_MS)', () => {
  beforeEach(() => {
    localStorage.clear();
    // 关掉自动轮换:就绪后不排轮换计时,测试时序不受 rotateSec 干扰
    const { settings } = useSettings();
    settings.value = { ...defaultSettings(), autoRotate: false };
  });

  it('瞬时加载完成 → 开屏遮罩仍停留满最短时长才揭幕', async () => {
    const wrapper = mount(HomeView);
    await flushMicrotasks();
    // 名单已到,进入图片下载阶段;遮罩盖着墙,未就绪
    expect(wrapper.find('.wall-splash').exists()).toBe(true);
    expect(wrapper.find('.wall.ready').exists()).toBe(false);

    // 全部 @load → forceReady;但距挂载远不足 800ms → 延迟就绪
    for (const img of wrapper.findAll('.card img')) await img.trigger('load');
    await sleep(80); // 等加载态批量提交
    expect(wrapper.find('.wall.ready').exists()).toBe(false);

    await sleep(900); // 越过 800ms 补足窗
    expect(wrapper.find('.wall.ready').exists()).toBe(true);
    // 揭幕淡出 0.6s 后遮罩才从 DOM 摘掉(定时器驱动,不依赖 rAF)
    await sleep(700);
    expect(wrapper.find('.wall-splash').exists()).toBe(false);
    wrapper.unmount();
  });

  it('慢加载(超过最短时长)→ 就绪不再被额外拖慢', async () => {
    const { loadImages } = await import('@/shared/apiClient');
    vi.mocked(loadImages).mockImplementationOnce(
      () => new Promise((r) => setTimeout(() => r({ images: imgs }), 950)),
    );

    const wrapper = mount(HomeView);
    await sleep(1050); // 名单 950ms 后才到
    expect(wrapper.find('.wall-splash').exists()).toBe(true);

    // 触发加载时已超 800ms → 只等 rAF 提交即就绪,无 800ms 补足
    for (const img of wrapper.findAll('.card img')) await img.trigger('load');
    await sleep(120);
    expect(wrapper.find('.wall.ready').exists()).toBe(true);
    wrapper.unmount();
  });
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

/* ============================================================
 * 真滚动(v2.15):流动墙不再用 transform 搬整行
 * ------------------------------------------------------------
 * jsdom 没有真实布局:scrollLeft 恒为 0 且赋值无效、scrollWidth 恒 0。
 * 这里用原型存根造出可滚动的行,才能断言「组件真的在写 scrollLeft」。
 * ============================================================ */
describe('HomeView 真滚动(v2.15)', () => {
  const scrollStore = new WeakMap<HTMLElement, number>();
  const origScrollLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollLeft');
  const origScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
  const origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

  beforeEach(() => {
    localStorage.clear();
    const { settings } = useSettings();
    settings.value = { ...defaultSettings(), autoRotate: false };
    scrollStore;   // WeakMap 按元素存,每次挂载都是新元素,无需清空
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get() { return scrollStore.get(this) ?? 0; },
      set(v: number) { scrollStore.set(this, v); },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() { return 4000; },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() { return 800; },
    });
  });

  afterEach(() => {
    if (origScrollLeft) Object.defineProperty(HTMLElement.prototype, 'scrollLeft', origScrollLeft);
    if (origScrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', origScrollWidth);
    if (origClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origClientWidth);
    vi.restoreAllMocks();
  });

  /** 挂载 → 触发全部图片加载 → 等墙就绪 */
  async function mountReady() {
    const wrapper = mount(HomeView);
    await flushMicrotasks();
    for (const img of wrapper.findAll('.card img')) await img.trigger('load');
    await sleep(1000);   // 越过开屏最短时长 + 让流动跑几帧
    return wrapper;
  }

  function readScrollLeft(wrapper: ReturnType<typeof mount>): number {
    const row = wrapper.findAll('.row')[0];
    return row ? (row.element as HTMLElement).scrollLeft : -1;
  }

  it('就绪后行的 scrollLeft 递增(真滚动)', async () => {
    const wrapper = await mountReady();
    const a = readScrollLeft(wrapper);
    await sleep(400);
    const b = readScrollLeft(wrapper);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    wrapper.unmount();
  });

  it('滚动位置是整数像素(不对齐到半像素 → 画面不糊)', async () => {
    const wrapper = await mountReady();
    await sleep(300);
    const sl = readScrollLeft(wrapper);
    expect(Number.isInteger(sl)).toBe(true);
    wrapper.unmount();
  });

  it('DOM 里没有 transform 位移层,内容直接在 .row 里', async () => {
    const wrapper = await mountReady();
    expect(wrapper.find('.row-drag').exists()).toBe(false);
    expect(wrapper.find('.row > .row-track').exists()).toBe(true);
    wrapper.unmount();
  });

  it('鼠标悬停该行 → 停住;移开 → 恢复', async () => {
    const wrapper = await mountReady();
    const row = wrapper.findAll('.row')[0];

    await row.trigger('pointerenter', { pointerType: 'mouse' });
    const a = readScrollLeft(wrapper);
    await sleep(400);
    const b = readScrollLeft(wrapper);
    expect(b).toBe(a);

    await row.trigger('pointerleave', { pointerType: 'mouse' });
    await sleep(400);
    expect(readScrollLeft(wrapper)).toBeGreaterThan(b);
    wrapper.unmount();
  });

  it('动效总开关关 → 墙不滚动', async () => {
    const { settings } = useSettings();
    settings.value = { ...defaultSettings(), autoRotate: false, motion: false };
    const wrapper = mount(HomeView);
    await flushMicrotasks();
    for (const img of wrapper.findAll('.card img')) await img.trigger('load');
    await sleep(1200);
    expect(readScrollLeft(wrapper)).toBe(0);
    wrapper.unmount();
  });
});

/* ============================================================
 * 闲时升级原画(v2.17)
 * ------------------------------------------------------------
 * 墙先用 600w 缩略图开屏;卡片真正进入视口后,后台预载原图,
 * 载好即把 src 换成原图(原图进缓存,换图不闪)。
 * jsdom 没有 IntersectionObserver,也不会真下载图片 → 两者都打桩。
 * ============================================================ */
describe('HomeView 闲时升级原画(v2.17)', () => {
  const origIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  const origImage = (globalThis as { Image?: unknown }).Image;

  /** 假的 IntersectionObserver:记下被观察的元素,由测试手动触发 */
  let ioCallback: ((entries: unknown[]) => void) | null = null;
  let observed: Element[] = [];

  beforeEach(() => {
    localStorage.clear();
    const { settings } = useSettings();
    settings.value = { ...defaultSettings(), autoRotate: false };
    ioCallback = null;
    observed = [];

    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      constructor(cb: (entries: unknown[]) => void) { ioCallback = cb; }
      observe(el: Element) { observed.push(el); }
      unobserve() { /* noop */ }
      disconnect() { observed = []; }
    };

    // 假的 Image:设置 src 后异步触发 onload(模拟原图预载成功)
    (globalThis as { Image?: unknown }).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = '';
      set src(v: string) {
        this._src = v;
        setTimeout(() => { if (this.onload) this.onload(); }, 0);
      }
      get src() { return this._src; }
    };
  });

  afterEach(() => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = origIO;
    (globalThis as { Image?: unknown }).Image = origImage;
    vi.restoreAllMocks();
  });

  async function mountReady() {
    const wrapper = mount(HomeView);
    await flushMicrotasks();
    for (const img of wrapper.findAll('.card img')) await img.trigger('load');
    await sleep(1000);   // 越过开屏最短时长 → 墙就绪 → 开始观察
    return wrapper;
  }

  it('就绪后卡片进入视口 → 预载原图 → src 换成原图', async () => {
    const wrapper = await mountReady();
    const first = wrapper.find('.card img');
    // 起初是 600w 缩略图(原图地址在 data-hd-url 上)
    const origUrl = first.attributes('data-hd-url') as string;
    expect(origUrl).toMatch(/^https:\/\/a\/\d+\.jpg$/);
    expect(first.attributes('src')).not.toBe(origUrl);
    expect(observed.length).toBeGreaterThan(0);

    // 模拟「这张卡片进入视口」
    ioCallback?.([{ isIntersecting: true, target: observed[0] }]);
    await sleep(60);   // 等预载 + 响应式更新

    expect(wrapper.find('.card img').attributes('src')).toBe(origUrl);
    wrapper.unmount();
  });

  it('没进视口的卡片不会被升级(省流量)', async () => {
    const wrapper = await mountReady();
    const first = wrapper.find('.card img');
    const origUrl = first.attributes('data-hd-url') as string;
    expect(first.attributes('src')).not.toBe(origUrl);
    wrapper.unmount();
  });
});

/* ============================================================
 * 加载态提交兜底(2026-11 线上事故回归)
 * ------------------------------------------------------------
 * 事故:窗口被遮挡 / 节能模式下浏览器会挂起 requestAnimationFrame
 * (此时 document.visibilityState 仍是 'visible'),带来两处空白:
 *   1. 只靠 rAF 提交加载态 → 图片早就下载完成,卡片却一直 opacity:0;
 *   2. Vue <transition> 的 nextFrame 同样靠 rAF → 开屏遮罩永远停在
 *      leave-from(不透明),把整墙盖死。
 * 修复:加载态改 rAF + setTimeout 双通道;开屏遮罩改「类名 + 定时器」收尾。
 * ============================================================ */
describe('HomeView 加载态提交兜底', () => {
  beforeEach(() => {
    localStorage.clear();
    const { settings } = useSettings();
    settings.value = { ...defaultSettings(), autoRotate: false };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rAF 被挂起(不回调)时,setTimeout 兜底仍把加载态落地', async () => {
    // 模拟浏览器挂起 rAF:注册了回调但永不执行
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

    const wrapper = mount(HomeView);
    await flushMicrotasks();

    // 图片全部加载完成(与真实浏览器一致:complete 且 naturalWidth > 0)
    for (const img of wrapper.findAll('.card img')) await img.trigger('load');

    // 没有 rAF 时,兜底计时器必须在 100ms 内提交
    await sleep(250);
    const lit = wrapper.findAll('.card img.is-loaded').length;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBe(wrapper.findAll('.card img').length);

    // 开屏最短时长(800ms)过后,墙必须就绪且卡片可见
    await sleep(900);
    expect(wrapper.find('.wall.ready').exists()).toBe(true);

    // 遮罩必须自己摘掉(定时器驱动),不能永远不透明地盖住整墙
    await sleep(700);
    expect(wrapper.find('.wall-splash').exists()).toBe(false);
    wrapper.unmount();
  });
});
