import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createImgFallback, bustSrc, fallbackChain } from './imgFallback';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('bustSrc', () => {
  it('无查询串用 ?,有查询串用 &', () => {
    expect(bustSrc('https://7bu.top/thumbnails/abc.png', 1)).toBe('https://7bu.top/thumbnails/abc.png?vshowcase_retry=1');
    expect(bustSrc('https://x/img?p=1', 2)).toBe('https://x/img?p=1&vshowcase_retry=2');
  });
});

describe('fallbackChain', () => {
  it('thumb ≠ url:换查询串 → 原图 → 原图换查询串', () => {
    expect(fallbackChain('https://t/1.jpg', 'https://u/1.jpg')).toEqual([
      'https://t/1.jpg?vshowcase_retry=1',
      'https://u/1.jpg',
      'https://u/1.jpg?vshowcase_retry=2',
    ]);
  });

  it('thumb === url(封面/兜底图):「换原图」无意义,三级全换查询串', () => {
    expect(fallbackChain('https://u/c.jpg', 'https://u/c.jpg')).toEqual([
      'https://u/c.jpg?vshowcase_retry=1',
      'https://u/c.jpg?vshowcase_retry=2',
      'https://u/c.jpg?vshowcase_retry=3',
    ]);
  });
});

describe('createImgFallback', () => {
  it('失败后延时把 overrides 换成链的下一级', () => {
    const fb = createImgFallback(1000);
    fb.onError('u', 't', 'u');
    expect(fb.overrides.value.get('u')).toBeUndefined();
    vi.advanceTimersByTime(999);
    expect(fb.overrides.value.get('u')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(fb.overrides.value.get('u')).toBe('t?vshowcase_retry=1');
    fb.dispose();
  });

  it('同键重复 error 只登记一次(墙上双份渲染的迟到 error)', () => {
    const fb = createImgFallback(1000);
    fb.onError('u', 't', 'u');
    fb.onError('u', 't', 'u'); // 双份 <img> 对同一 src 各报一次
    vi.advanceTimersByTime(1000);
    // 只消耗了第 1 级:再次失败应进第 2 级(原图),而不是跳到第 3 级
    fb.onError('u', 't', 'u');
    vi.advanceTimersByTime(1000);
    expect(fb.overrides.value.get('u')).toBe('u');
    fb.dispose();
  });

  it('成功 onLoad 停掉在途重试', () => {
    const fb = createImgFallback(1000);
    fb.onError('u', 't', 'u');
    fb.onLoad('u');
    vi.advanceTimersByTime(5000);
    expect(fb.overrides.value.get('u')).toBeUndefined();
    fb.dispose();
  });

  it('链走完后放弃,overrides 停在最后一级', () => {
    const fb = createImgFallback(0);
    for (let i = 0; i < 10; i++) {
      fb.onError('u', 't', 'u');
      vi.advanceTimersByTime(1);
    }
    expect(fb.overrides.value.get('u')).toBe('u?vshowcase_retry=2');
    fb.dispose();
  });

  it('dispose 后不再改 overrides,后续 onError 也被忽略', () => {
    const fb = createImgFallback(1000);
    fb.onError('u', 't', 'u');
    fb.dispose();
    vi.advanceTimersByTime(5000);
    expect(fb.overrides.value.get('u')).toBeUndefined();

    fb.onError('v', 't2', 'v');
    vi.advanceTimersByTime(5000);
    expect(fb.overrides.value.get('v')).toBeUndefined();
  });

  it('多键互不干扰', () => {
    const fb = createImgFallback(1000);
    fb.onError('a', 'ta', 'a'); // t=0 → t=1000 触发
    vi.advanceTimersByTime(500);
    fb.onError('b', 'tb', 'b'); // t=500 → t=1500 触发
    vi.advanceTimersByTime(500); // t=1000:a 到期
    expect(fb.overrides.value.get('a')).toBe('ta?vshowcase_retry=1');
    expect(fb.overrides.value.get('b')).toBeUndefined();
    vi.advanceTimersByTime(500); // t=1500:b 到期
    expect(fb.overrides.value.get('b')).toBe('tb?vshowcase_retry=1');
    fb.dispose();
  });
});
