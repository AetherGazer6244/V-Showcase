/* ============================================================
 * FloatingCapsule —— 位置记忆与缩放行为(组件级)
 * ------------------------------------------------------------
 * 覆盖本 bug 的核心:浏览器缩放后胶囊位置不跑偏、不往角落漂。
 * ============================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';

vi.mock('./player', () => ({
  usePlayer: () => ({
    index: ref(0),
    current: ref({ title: '测试曲', cover: '', lrc: '' }),
    playing: ref(false),
    lrcLines: ref([]),
    activeLrcIdx: ref(-1),
    toggle: () => { /* noop */ },
    next: () => { /* noop */ },
  }),
}));

import FloatingCapsule from './FloatingCapsule.vue';

const KEY = 'vshowcase.capsule-pos';

function setViewport(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true });
}

function styleOf(w: ReturnType<typeof mount>): string {
  return w.get('.capsule-anchor').attributes('style') || '';
}

beforeEach(() => {
  localStorage.clear();
  setViewport(1200, 800);
  // jsdom 未实现指针捕获,桩掉避免 pointerdown 抛错
  (Element.prototype as unknown as { setPointerCapture: unknown }).setPointerCapture = vi.fn();
  (Element.prototype as unknown as { releasePointerCapture: unknown }).releasePointerCapture = vi.fn();
});

describe('FloatingCapsule 位置记忆', () => {
  it('挂载时按视口比例还原像素位置', async () => {
    localStorage.setItem(KEY, JSON.stringify({ fx: 0.5, fy: 0.5 }));
    const w = mount(FloatingCapsule);
    await nextTick();                       // onMounted 里改的状态要等一次微任务才落到 DOM
    expect(styleOf(w)).toContain('left: 600px');
    expect(styleOf(w)).toContain('top: 400px');
  });

  it('首访(无记录)→ 交给 CSS 默认停靠,不写 left/top', () => {
    const w = mount(FloatingCapsule);
    expect(styleOf(w)).not.toContain('left:');
    expect(w.get('.capsule-anchor').classes()).toContain('is-docked');
  });

  it('缩放(视口变小)后按比例重算位置', async () => {
    localStorage.setItem(KEY, JSON.stringify({ fx: 0.5, fy: 0.5 }));
    const w = mount(FloatingCapsule);
    setViewport(800, 600);                       // 模拟放大:视口像素变小
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(styleOf(w)).toContain('left: 400px');
    expect(styleOf(w)).toContain('top: 300px');
  });

  it('缩放不写回记忆值 → 来回缩放不会往角落漂', async () => {
    localStorage.setItem(KEY, JSON.stringify({ fx: 0.5, fy: 0.5 }));
    const w = mount(FloatingCapsule);
    // 缩到很小,显示坐标会被夹取到视口内
    setViewport(400, 300);
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    // 关键:存储的仍是原始比例,没有被夹取后的像素覆盖
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ fx: 0.5, fy: 0.5 }));
    // 缩回原尺寸,位置回到原处
    setViewport(1200, 800);
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(styleOf(w)).toContain('left: 600px');
    expect(styleOf(w)).toContain('top: 400px');
  });

  it('拖动松手后按比例写入存储', async () => {
    localStorage.setItem(KEY, JSON.stringify({ fx: 0.5, fy: 0.5 }));
    const w = mount(FloatingCapsule);
    const anchor = w.get('.capsule-anchor');
    await anchor.trigger('pointerdown', { clientX: 100, clientY: 100 });
    await anchor.trigger('pointermove', { clientX: 200, clientY: 150 });
    await anchor.trigger('pointerup');
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    expect(saved.fx).toBeCloseTo(700 / 1200, 5);
    expect(saved.fy).toBeCloseTo(450 / 800, 5);
  });

  it('v1 旧数据(绝对像素)能读出并按比例记住', async () => {
    localStorage.setItem(KEY, JSON.stringify({ x: 600, y: 400 }));
    const w = mount(FloatingCapsule);
    await nextTick();
    expect(styleOf(w)).toContain('left: 600px');
    await w.get('.capsule-anchor').trigger('pointerdown', { clientX: 10, clientY: 10 });
    await w.get('.capsule-anchor').trigger('pointerup');
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    expect(saved.fx).toBeCloseTo(0.5, 5);
    expect(saved.fy).toBeCloseTo(0.5, 5);
  });
});
