import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ReadingProgress from './ReadingProgress.vue';

describe('ReadingProgress 阅读进度条', () => {
  it('progress=0 → 宽度 0%', () => {
    const w = mount(ReadingProgress, { props: { progress: 0 } });
    expect(w.get('.reading-progress-bar').attributes('style')).toContain('width: 0%');
    w.unmount();
  });

  it('progress=0.42 → 宽度 42%', () => {
    const w = mount(ReadingProgress, { props: { progress: 0.42 } });
    expect(w.get('.reading-progress-bar').attributes('style')).toContain('width: 42%');
    w.unmount();
  });

  it('越界值被夹在 0~100', () => {
    const over = mount(ReadingProgress, { props: { progress: 1.8 } });
    expect(over.get('.reading-progress-bar').attributes('style')).toContain('width: 100%');
    const under = mount(ReadingProgress, { props: { progress: -0.5 } });
    expect(under.get('.reading-progress-bar').attributes('style')).toContain('width: 0%');
    over.unmount();
    under.unmount();
  });

  it('带 role=progressbar 与 aria 值', () => {
    const w = mount(ReadingProgress, { props: { progress: 0.25 } });
    const bar = w.get('.reading-progress');
    expect(bar.attributes('role')).toBe('progressbar');
    expect(bar.attributes('aria-valuenow')).toBe('25');
    expect(bar.attributes('aria-valuemin')).toBe('0');
    expect(bar.attributes('aria-valuemax')).toBe('100');
    w.unmount();
  });
});
