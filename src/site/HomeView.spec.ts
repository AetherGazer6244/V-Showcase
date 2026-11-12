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
