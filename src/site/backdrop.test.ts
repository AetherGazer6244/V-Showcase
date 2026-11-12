import { describe, it, expect } from 'vitest';
import { backdropHash, backdropSrc, pickBackdropImage, safeBackgroundImage } from './backdrop';
import type { Image } from '@/shared/types';

const imgs: Image[] = Array.from({ length: 7 }, (_, i) => ({
  url: `https://a/${i + 1}.jpg`,
  thumb: `https://t/${i + 1}.jpg`,
  name: `img${i + 1}`,
}));

describe('backdropHash 稳定哈希', () => {
  it('同一个键永远同一个值', () => {
    expect(backdropHash('blog')).toBe(backdropHash('blog'));
  });
  it('不同键散得开(博客 / 音乐 / 图集互不相同)', () => {
    expect(backdropHash('blog')).not.toBe(backdropHash('music'));
    expect(backdropHash('music')).not.toBe(backdropHash('gallery'));
  });
});

describe('pickBackdropImage 选图', () => {
  it('选中的图在图池内,且与哈希一致', () => {
    expect(pickBackdropImage(imgs, 'blog')).toBe(imgs[backdropHash('blog') % imgs.length]);
  });
  it('同一页面键每次选同一张', () => {
    expect(pickBackdropImage(imgs, 'post:hello')).toEqual(pickBackdropImage(imgs, 'post:hello'));
  });
  it('空图池 → null(不炸)', () => {
    expect(pickBackdropImage([], 'blog')).toBeNull();
  });
});

describe('backdropSrc 取地址', () => {
  it('优先缩略图(主页墙已缓存,几乎零成本)', () => {
    expect(backdropSrc(imgs[0])).toBe('https://t/1.jpg');
  });
  it('没有缩略图 → 退回原图', () => {
    expect(backdropSrc({ url: 'https://a/x.jpg', thumb: '', name: '' })).toBe('https://a/x.jpg');
  });
  it('null → 空串', () => {
    expect(backdropSrc(null)).toBe('');
  });
});

describe('safeBackgroundImage URL 白名单', () => {
  it('https → 带引号的 url()', () => {
    expect(safeBackgroundImage('https://a.com/x.jpg')).toBe('url("https://a.com/x.jpg")');
  });
  it('javascript: → 空串(不拼进 CSS)', () => {
    expect(safeBackgroundImage('javascript:alert(1)')).toBe('');
  });
  it('data: → 空串', () => {
    expect(safeBackgroundImage('data:text/html,<script>')).toBe('');
  });
  it('空串 → 空串', () => {
    expect(safeBackgroundImage('')).toBe('');
  });
  it('地址里的引号被转义,拼不出第二个 url()', () => {
    const out = safeBackgroundImage('https://a.com/x".jpg');
    expect(out.startsWith('url("')).toBe(true);
    expect(out).not.toContain('".jpg"');
  });
});
