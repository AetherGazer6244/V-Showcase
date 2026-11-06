/* ============================================================
 * functions/api/music.js 单测
 * ------------------------------------------------------------
 * 网易云代理此前零覆盖。重点回归一个真实生产 bug:
 *   cache.match 命中的 Response 头不可变(Workers 规范),
 *   旧 withBrowserCache 直接 headers.set → 每次缓存命中必 500。
 *   本地 wrangler 复现为「第二次起同 ids 请求全 500」,
 *   修复 = 复制头并新建 Response 返回(勿回退成原地 set)。
 *
 * 用 mock fetch + mock Cache API 在 Node 里跑通全部路径:
 *   - 缓存命中(含不可变头)/未命中、是否入缓存
 *   - 字段投影(name/artist/cover/url/lrc,垃圾字段丢弃)
 *   - 部分失败不缓存、全部失败 502
 *   - 方法校验、缺 ids、超 MAX_IDS
 * ============================================================ */
import { describe, it, expect, vi } from 'vitest';
import { onRequest as musicHandler } from '../../functions/api/music.js';

/** 模拟 workerd 规范:cache.match 返回的 Response 头不可变 */
function frozenHeaders(init) {
  const h = new Headers(init);
  return new Proxy(h, {
    get(target, prop) {
      if (prop === 'set') {
        return () => { throw new TypeError("Can't modify immutable headers."); };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** 造一首上游歌曲的详情/歌词 mock 响应 */
function install({ lyricOk = true } = {}) {
  const calls = [];
  const cacheStore = new Map();
  const cacheHits = { match: 0, put: 0 };

  globalThis.caches = {
    default: {
      async match(key) {
        cacheHits.match++;
        return cacheStore.get(key);
      },
      async put(key, res) {
        cacheHits.put++;
        cacheStore.set(key, res);
      },
    },
  };

  globalThis.fetch = vi.fn(async (url) => {
    calls.push(String(url));
    const isDetail = String(url).includes('/song/detail/');
    if (isDetail) {
      return new Response(JSON.stringify({
        // 故意带上 album 全量等垃圾字段,投影测试验证丢弃
        songs: [{ name: '测试歌', artists: [{ name: '甲' }, { name: '乙', extra: 1 }], album: { picUrl: 'https://p/cover.jpg', big: true, company: 'x' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (lyricOk) {
      return new Response(JSON.stringify({ lrc: { lyric: '[00:01.00]测试歌词' } }), { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  });

  return { calls, cacheStore, cacheHits };
}

function req(ids) {
  return new Request(`https://vshowcase.test/api/music?ids=${ids}`, { method: 'GET' });
}

describe('functions/api/music — 入参与方法', () => {
  it('非 GET → 405 且带 Allow', async () => {
    install();
    const res = await musicHandler({ request: new Request('https://x/api/music', { method: 'POST' }) });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toContain('GET');
  });

  it('缺 ids → 400;非数字 ids 被过滤,剩空 → 400', async () => {
    install();
    expect((await musicHandler({ request: req('') })).status).toBe(400);
    expect((await musicHandler({ request: req('abc,!!') })).status).toBe(400);
  });

  it('超过 MAX_IDS(20) → 400(每首 2 条上游子请求,防超限)', async () => {
    install();
    const ids = Array.from({ length: 21 }, (_, i) => String(100 + i)).join(',');
    const res = await musicHandler({ request: req(ids) });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('20');
  });
});

describe('functions/api/music — 回源与投影', () => {
  it('缓存未命中:回源详情+歌词,投影出 5 字段,成功且入边缘缓存', async () => {
    const { calls, cacheHits } = install();
    const res = await musicHandler({ request: req('186016') });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe(true);
    expect(body.data.songs[0]).toEqual({
      id: '186016',
      name: '测试歌',
      artist: '甲/乙',
      cover: 'https://p/cover.jpg',
      url: 'https://music.163.com/song/media/outer/url?id=186016.mp3',
      lrc: '[00:01.00]测试歌词',
    });
    expect(calls).toHaveLength(2);                    // 详情 + 歌词
    expect(cacheHits.put).toBe(1);                    // 完整成功才入缓存
    expect(res.headers.get('Cache-Control')).toContain('max-age=600');
  });

  it('歌词接口失败 → 降级为空歌词,照常成功', async () => {
    install({ lyricOk: false });
    const body = await (await musicHandler({ request: req('186016') })).json();
    expect(body.status).toBe(true);
    expect(body.data.songs[0].lrc).toBe('');
  });

  it('全部上游失败 → 502 且不入缓存(恢复后无需等 TTL)', async () => {
    const { cacheHits } = install();
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 }));
    const res = await musicHandler({ request: req('186016') });
    expect(res.status).toBe(502);
    expect((await res.json()).status).toBe(false);
    expect(cacheHits.put).toBe(0);
  });
});

describe('functions/api/music — 边缘缓存(回归:不可变头)', () => {
  it('缓存命中:不可变头的缓存条目也能返回 200(旧代码 headers.set 直接抛错)', async () => {
    const payload = JSON.stringify({
      status: true, message: 'success',
      data: { songs: [{ id: '186016', name: '缓存歌', artist: '甲', cover: '', url: 'https://u.mp3', lrc: '' }], failed: 0 },
    });
    // 模拟 workerd:cache.match 返回头不可变的 Response 形状对象
    const cached = {
      status: 200,
      statusText: 'OK',
      headers: frozenHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
      body: payload,
    };
    globalThis.caches = {
      default: {
        async match() { return cached; },
        async put() { throw new Error('命中时不应回源入缓存'); },
      },
    };
    globalThis.fetch = vi.fn();                       // 命中即不应回源
    const res = await musicHandler({ request: req('186016') });
    expect(res.status).toBe(200);
    expect((await res.json()).data.songs[0].name).toBe('缓存歌');
    expect(res.headers.get('Cache-Control')).toContain('max-age=600');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // 原条目头未被改写(保持边缘缓存语义干净)
    expect(cached.headers.get('Cache-Control')).toBeNull();
  });

  it('ids 归一化:顺序不同/重复 → 同一缓存键(排序去重)', async () => {
    const { calls, cacheStore, cacheHits } = install();
    await musicHandler({ request: req('347230,186016') });
    await musicHandler({ request: req('186016,347230,347230') });
    // 第二次命中缓存:不再回源(每次回源 = ids 数 × 2 条)
    expect(cacheHits.put).toBe(1);
    expect(cacheHits.match).toBe(2);
    expect(calls).toHaveLength(4);                    // 只有第一次的详情+歌词 ×2
    expect([...cacheStore.keys()][0]).toContain('186016,347230');
  });
});
