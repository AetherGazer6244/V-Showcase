import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapImage, toFallbackImages, isFallback, rewriteThumb } from './apiClient';
import { CONFIG } from '@/site/config';

describe('mapImage', () => {
  it('按 CONFIG 字段路径映射 url/thumb/name', () => {
    const item = {
      origin_name: 'a.png',
      links: {
        url: 'https://bu.dusays.com/x/a.png',
        thumbnail_url: 'https://7bu.top/thumbnails/a.png',
      },
    };
    const img = mapImage(item);
    expect(img.url).toBe('https://bu.dusays.com/x/a.png');
    expect(img.thumb).toBe('https://7bu.top/thumbnails/a.png');
    expect(img.name).toBe('a.png');
  });

  it('宽高透传;缺失时补 0(横竖判断/旋转缩放依赖)', () => {
    const withSize = mapImage({
      origin_name: 'a.png',
      width: 800,
      height: 1200,
      links: { url: 'https://bu.dusays.com/x/a.png', thumbnail_url: 'https://t/a.png' },
    });
    expect(withSize.width).toBe(800);
    expect(withSize.height).toBe(1200);

    const noSize = mapImage({ links: { url: 'https://a/1.jpg' } });
    expect(noSize.width).toBe(0);
    expect(noSize.height).toBe(0);
  });

  // 回归:曾经把原图 url 当 srcset 的 2x 候选,导致高清屏首屏下载全部原图,
  // 且频繁加载失败。thumbWidth(600) 恰好等于 300px 卡片在 2x 屏上的需求。
  it('不产出 srcset —— 避免高清屏去拉原图', () => {
    const img = mapImage({
      origin_name: 'a.png',
      links: { url: 'https://bu.dusays.com/x/a.png', thumbnail_url: 'https://7bu.top/thumbnails/a.png' },
    });
    expect('srcset' in img).toBe(false);
  });

  it('thumb 字段缺失时回退 url', () => {
    const img = mapImage({ links: { url: 'https://a/1.jpg' } });
    expect(img.thumb).toBe('https://a/1.jpg');
  });
});

describe('toFallbackImages / isFallback', () => {
  it('兜底图 url === thumb,可被 isFallback 识别', () => {
    // 用真实 CONFIG 兜底列表的前缀(isFallback 与 CONFIG.fallbackImages 逐位比对)
    const imgs = toFallbackImages(CONFIG.fallbackImages.slice(0, 3));
    expect(imgs[0].thumb).toBe(imgs[0].url);
    expect(isFallback(imgs)).toBe(true);
    expect(isFallback([{ url: 'https://other/9.jpg', name: '', thumb: '' }])).toBe(false);
  });
});

describe('rewriteThumb', () => {
  it('thumbRewrite 为 null 时原样返回', () => {
    expect(rewriteThumb('https://a/t.jpg')).toBe('https://a/t.jpg');
  });
});

/* ---- loadImages 缓存(模块级单例 → vi.resetModules + 动态 import 取新实例) ---- */

/** 构造图床三段式响应(proxy 模式,单张图片) */
function okResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: { data: [{ origin_name: 'a.png', links: { url: 'https://x/a.png' } }] },
    }),
  };
}

describe('loadImages 缓存', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function freshLoadImages() {
    vi.resetModules();
    const mod = await import('./apiClient');
    return mod.loadImages;
  }

  it('TTL 内复用缓存:并发+顺序调用都只发一次请求', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const loadImages = await freshLoadImages();

    await Promise.all([loadImages(), loadImages()]);
    await loadImages();
    vi.advanceTimersByTime(30_000);
    await loadImages();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('5 分钟内复用缓存,过期后先返回旧数据并后台刷新', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const loadImages = await freshLoadImages();

    const first = await loadImages();
    vi.advanceTimersByTime(4 * 60_000);
    await loadImages();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61_000);
    const stale = await loadImages();
    expect(stale).toBe(first); // 过期也先把旧名单交给页面,不等网络
    expect(fetchMock).toHaveBeenCalledTimes(2); // 后台刷新已启动

    // 后台成功后缓存更新;短暂再访问不会发第三次请求
    await Promise.resolve();
    await loadImages();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('后台刷新失败时保留旧名单,并节流重试', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => okResponse())
      .mockImplementationOnce(async () => { throw new Error('refresh failed'); })
      .mockImplementationOnce(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const loadImages = await freshLoadImages();

    const good = await loadImages();
    vi.advanceTimersByTime(5 * 60_000 + 1);
    const stale = await loadImages();
    expect(stale).toBe(good);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await Promise.resolve();
    await loadImages();
    expect(fetchMock).toHaveBeenCalledTimes(2); // 失败后保留旧值,30s 内不重敲上游

    vi.advanceTimersByTime(30_001);
    await loadImages();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('失败回退兜底图时不缓存,下次进入重试', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('boom'); });
    vi.stubGlobal('fetch', fetchMock);
    const loadImages = await freshLoadImages();

    const first = await loadImages();
    expect(isFallback(first.images)).toBe(true);
    const second = await loadImages();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(isFallback(second.images)).toBe(true);
  });

  it('proxy 模式 URL 不再携带 _t 时间戳', async () => {
    const fetchMock = vi.fn(async (_url: unknown) => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const loadImages = await freshLoadImages();

    await loadImages();
    const calledWith = String(fetchMock.mock.calls[0][0]);
    expect(calledWith).toBe('/api/images?per_page=' + CONFIG.perPage);
  });
});
