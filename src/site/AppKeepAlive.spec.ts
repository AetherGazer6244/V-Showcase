import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { Image } from '@/shared/types';

/* ============================================================
 * 主页保活(v2.16)—— 站内切走再切回主页应当「秒开」
 * ------------------------------------------------------------
 * 旧行为:切走主页 → 组件销毁 → 切回来整面墙重建(重拉名单、重挂缩略图、
 * 重弹开屏遮罩、要等所有图加载完才揭幕)→ 用户感觉「切回主页加载很久」。
 * 新行为:App.vue 用 <KeepAlive include="['HomeView']"> 只保活主页,
 * 切回来是同一个实例、原样恢复。
 * ============================================================ */

/* App.vue 在模块顶层读 window.__VIEW__ 决定挂哪个视图 → 必须早于 import */
(window as unknown as { __VIEW__: string }).__VIEW__ = 'home';

const imgs: Image[] = Array.from({ length: 10 }, (_, i) => ({
  url: `https://a/${i + 1}.jpg`,
  thumb: `https://t/${i + 1}.jpg`,
  name: `img${i + 1}`,
}));

vi.mock('@/shared/apiClient', () => ({
  loadImages: vi.fn(async () => ({ images: imgs })),
}));

const { default: App } = await import('./App.vue');
const { default: HomeView } = await import('./HomeView.vue');
const { spaView } = await import('./spa');
const { useSettings, defaultSettings } = await import('./settings');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('App 主页保活', () => {
  /* jsdom 没有真实布局:scrollLeft 赋值无效、scrollWidth 恒 0。
   * 用原型存根造出可滚动的行,才能断言「流动真的在写位置」。 */
  const scrollStore = new WeakMap<HTMLElement, number>();
  const origScrollLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollLeft');
  const origScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
  const origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    const { settings } = useSettings();
    const def = defaultSettings();
    settings.value = {
      ...def,
      autoRotate: false,                     // 关轮换:测试时序不受换班干扰
      screensaver: { ...def.screensaver, idleMin: 30 },
    };
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
    spaView.value = 'home';
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    if (origScrollLeft) Object.defineProperty(HTMLElement.prototype, 'scrollLeft', origScrollLeft);
    if (origScrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', origScrollWidth);
    if (origClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origClientWidth);
    vi.restoreAllMocks();
  });

  /** 挂载 App 并等主页就绪(异步视图 chunk + 名单请求 + 图片加载 + 开屏最短时长) */
  async function mountReady(): Promise<VueWrapper> {
    wrapper = mount(App);
    await nextTick();
    await nextTick();
    await sleep(80);                       // 等异步视图 chunk 与名单请求落地
    const imgs2 = wrapper.findAll('.card img');
    expect(imgs2.length).toBeGreaterThan(0);
    for (const img of imgs2) await img.trigger('load');
    await sleep(1600);                     // 开屏最短时长 800ms + 揭幕淡出 600ms
    return wrapper;
  }

  it('切走再切回主页:同一个实例(被保活),不重弹开屏', async () => {
    const app = await mountReady();
    expect(app.find('.wall.ready').exists()).toBe(true);
    expect(app.find('.wall-splash').exists()).toBe(false);
    const vm1 = app.findComponent(HomeView).vm;
    const uid1 = (vm1 as unknown as { $: { uid: number } }).$.uid;

    // 切到博客页
    spaView.value = 'blog';
    await nextTick();
    await nextTick();
    expect(app.find('.wall').exists()).toBe(false);

    // 切回主页
    spaView.value = 'home';
    await nextTick();
    await nextTick();
    expect(app.find('.wall').exists()).toBe(true);
    // 关键:还是同一个组件实例(没被重建),开屏遮罩也不该再弹
    const uid2 = (app.findComponent(HomeView).vm as unknown as { $: { uid: number } }).$.uid;
    expect(uid2).toBe(uid1);
    expect(app.find('.wall-splash').exists()).toBe(false);
  });

  it('离开主页时流动暂停(不在后台空转),回来后恢复', async () => {
    const app = await mountReady();
    const row = () => app.find('.row').element as HTMLElement;

    await sleep(300);
    const moving = row().scrollLeft;
    expect(moving).toBeGreaterThan(0);

    // 切走:行元素被摘出文档,但对象还在 → 位置若还在变 = 后台空转
    const rowEl = row();
    spaView.value = 'blog';
    await nextTick();
    await nextTick();
    expect(app.find('.row').exists()).toBe(false);
    const frozen = rowEl.scrollLeft;
    await sleep(400);
    expect(rowEl.scrollLeft).toBe(frozen);

    // 回到主页:位置接着走(说明停用时暂停、激活时恢复)
    spaView.value = 'home';
    await nextTick();
    await nextTick();
    await sleep(300);
    expect(row().scrollLeft).toBeGreaterThan(moving);
  });
});
