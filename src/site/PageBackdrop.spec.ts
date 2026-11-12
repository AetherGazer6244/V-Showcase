import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import PageBackdrop from './PageBackdrop.vue';
import type { Image } from '@/shared/types';

/* mock 图片列表(7 张,够散,不同页面键能选到不同图) */
const imgs: Image[] = Array.from({ length: 7 }, (_, i) => ({
  url: `https://a/${i + 1}.jpg`,
  thumb: `https://t/${i + 1}.jpg`,
  name: `img${i + 1}`,
}));

vi.mock('@/shared/apiClient', () => ({
  loadImages: vi.fn(async () => ({ images: imgs })),
}));

describe('PageBackdrop 非主页图片蒙版背景', () => {
  it('渲染固定背景层:aria-hidden + style 带 background-image', async () => {
    const wrapper = mount(PageBackdrop, { props: { pageKey: 'blog' } });
    await flushPromises();

    const layer = wrapper.find('.page-backdrop');
    expect(layer.exists()).toBe(true);
    /* 纯装饰层:对读屏软件隐藏 */
    expect(layer.attributes('aria-hidden')).toBe('true');

    const img = wrapper.find('.page-backdrop-image');
    expect(img.exists()).toBe(true);
    const style = img.attributes('style') || '';
    expect(style).toContain('background-image');
    /* 用的是缩略图(主页墙已缓存) */
    expect(style).toContain('https://t/');
    wrapper.unmount();
  });

  it('页面键切换 → 换成另一张背景图', async () => {
    const wrapper = mount(PageBackdrop, { props: { pageKey: 'blog' } });
    await flushPromises();
    const before = wrapper.find('.page-backdrop-image').attributes('style');

    await wrapper.setProps({ pageKey: 'music' });
    await flushPromises();
    const after = wrapper.find('.page-backdrop-image').attributes('style');

    expect(after).not.toBe(before);
    expect(after).toContain('background-image');
    wrapper.unmount();
  });
});
