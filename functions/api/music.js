/* ============================================================
 * Cloudflare Pages Function — 网易云音乐代理
 * ------------------------------------------------------------
 * 路由：/api/music?ids=186016,347230（目录即路由：functions/api/music.js）
 *
 * 作用：
 *   浏览器 → 本函数 → music.163.com 公开 API（song/detail + song/lyric）
 *   聚合出前端播放器需要的最小字段：name / artist / cover / url / lrc。
 *   浏览器直连 music.163.com 会有 CORS 与 Referer 校验问题，
 *   必须经服务端代理（参考 Cecilian-Hub 同名实现）。
 *
 * 设计要点（仿 images.js，改动前都有问题，勿回退）：
 *
 * 1. ?ids 上限 20
 *    每首歌要发 2 条上游子请求（详情+歌词），20 首 = 40 条，
 *    远低于 Workers 免费版 50 条子请求上限；再多直接 400。
 *
 * 2. 每个上游请求都有超时（6s）
 *    Workers 对单条子请求没有墙钟上限，网易云挂起 = 前端永远转圈。
 *    歌词接口失败不影响主流程（歌词可选，降级为无歌词）。
 *
 * 3. 边缘缓存 1 小时（按归一化 ids 分键）
 *    歌曲详情/歌词几乎不变；播放列表对全体访客是同一份，
 *    不缓存 = 每个访客每次进音乐页都回源打网易云。
 *    键用「排序去重后的 ids」归一化，避免顺序不同击穿缓存。
 *    失败响应刻意【不进缓存】——网易云恢复后无需等 TTL。
 *
 * 4. 字段投影
 *    上游 song/detail 每首带 album 全量、artists 数组、别名、
 *    血缘信息等数十 KB 冗余；只投影 5 个前端消费的字段。
 * ============================================================ */

const UPSTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const DETAIL_TPL = 'https://music.163.com/api/song/detail/?id=ID&ids=[ID]';
const LYRIC_TPL = 'https://music.163.com/api/song/lyric?id=ID&lv=-1&kv=-1&tv=-1';
const FETCH_TIMEOUT_MS = 6000;
const MAX_IDS = 20;
const CACHE_TTL_SECONDS = 3600;
const CACHE_PREFIX = 'https://vshowcase.internal/api/music?ids=';

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET') {
    return json(405, { status: false, message: 'Method Not Allowed' }, { Allow: 'GET' });
  }

  const ids = normalizeIds(new URL(request.url).searchParams.get('ids'));
  if (ids.length === 0) {
    return json(400, { status: false, message: '缺少 ids 参数,形如 ?ids=186016,347230' });
  }
  if (ids.length > MAX_IDS) {
    return json(400, { status: false, message: `一次最多 ${MAX_IDS} 首(每首要 2 条上游请求)` });
  }

  // ---- 边缘缓存(键 = 归一化 ids;命中直接回) ----
  const cache = caches.default;
  const cacheKey = CACHE_PREFIX + ids.join(',');
  const cached = await cache.match(cacheKey);
  if (cached) return withBrowserCache(cached);

  const headers = {
    'User-Agent': UPSTREAM_UA,
    Referer: 'https://music.163.com/',
    Accept: 'application/json',
  };

  // 并发拉取(每首内部也是详情+歌词并发;ids 已限 20,无需分块排队)
  const songs = await Promise.all(ids.map((id) => fetchSong(id, headers)));
  const ok = songs.filter((s) => s !== null);
  const failed = ids.length - ok.length;

  if (ok.length === 0) {
    // 全军覆没:不进缓存,让下次请求有机会回源
    return json(502, { status: false, message: '网易云音乐接口不可达(或全部歌曲不存在)' });
  }

  const payload = {
    status: true,
    message: failed > 0 ? `${failed} 首获取失败,已跳过` : 'success',
    data: { songs: ok, failed: failed },
  };

  // 只有完整成功才入缓存(部分失败意味着有人缺歌词/缺详情,不缓存)
  if (failed === 0) {
    const entry = json(200, payload);
    entry.headers.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`);
    await cache.put(cacheKey, entry.clone());
    return withBrowserCache(entry);
  }
  return json(200, payload);
}

/* ---------- 上游 ---------- */

/** 归一化 ids:逗号/空白分隔 → 去空 → 去重 → 排序(缓存键稳定) → 只留数字 */
function normalizeIds(raw) {
  if (!raw) return [];
  return [...new Set(
    String(raw).split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d{1,15}$/.test(s)),
  )].sort();
}

/** 单首歌:详情 + 歌词并发。任何一步不可恢复失败 → null(调用方跳过) */
async function fetchSong(id, headers) {
  try {
    const [detailRes, lyricRes] = await Promise.all([
      fetchWithTimeout(det(id, DETAIL_TPL), headers),
      fetchWithTimeout(det(id, LYRIC_TPL), headers).catch(() => null), // 歌词可选
    ]);

    if (!detailRes || !detailRes.ok) return null;
    const body = await detailRes.json();
    const song = body && body.songs && body.songs[0];
    if (!song) return null;

    let lrc = '';
    if (lyricRes && lyricRes.ok) {
      try {
        const lyricBody = await lyricRes.json();
        lrc = (lyricBody && lyricBody.lrc && lyricBody.lrc.lyric) || '';
      } catch { /* 歌词降级为空 */ }
    }

    return project(id, song, lrc);
  } catch {
    return null;
  }
}

function det(id, tpl) {
  return tpl.replace(/ID/g, id);
}

async function fetchWithTimeout(url, headers) {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    return null;
  }
}

/* ---------- 响应组装 ---------- */

/** 字段投影:详情/歌词之外的一切(album 全量、别名、qrtt…都不要) */
function project(id, song, lrc) {
  const artists = Array.isArray(song.artists) ? song.artists : [];
  return {
    id,
    name: String(song.name || ''),
    artist: artists.map((a) => a && a.name).filter(Boolean).join('/') || '未知歌手',
    cover: (song.album && song.album.picUrl) || '',
    // 官方外链播放地址(302 到实际音频;支持 range,前端 <audio> 直接可用)
    url: `https://music.163.com/song/media/outer/url?id=${id}.mp3`,
    lrc,
  };
}

function json(status, obj, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}),
  });
}

/** 浏览器缓存:10 分钟,同页刷新/翻回不重复回源。
 *  注意:cache.match 命中的 Response 头不可变(Workers 规范),
 *  直接 headers.set 会抛「Can't modify immutable headers」,
 *  因此复制头并新建 Response 返回。 */
function withBrowserCache(res) {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'public, max-age=600');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
