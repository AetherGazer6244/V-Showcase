/* ============================================================
 * playlist — 音乐库定义与解析(双曲库模式)
 * ------------------------------------------------------------
 * 两种曲目来源:
 *   1. netease  → 只写网易云歌曲 ID,详情(歌名/歌手/封面/播放地址/歌词)
 *                 由 /api/music 代理在运行时补全(见 functions/api/music.js)
 *   2. url      → 直链自备(音频地址/标题/歌手/封面/LRC 歌词全部自己给),
 *                 不依赖任何第三方,兜底网易云外链失效
 *
 * 本期曲库为空(空库上线):往 PLAYLIST 里加一条即可出现在音乐页。
 * netease 批量解析走单次代理请求(ids 合并,边缘缓存 1h)。
 * ============================================================ */

import playlistJson from '../../content/playlist.json';

export interface NeteaseTrackInput {
  source: 'netease';
  /** 网易云歌曲 ID(纯数字) */
  id: string;
}

export interface UrlTrackInput {
  source: 'url';
  /** 音频直链(mp3/m4a/ogg…) */
  url: string;
  title: string;
  artist?: string;
  cover?: string;
  /** LRC 歌词原文(可选;直链曲目歌词自备) */
  lrc?: string;
}

export type TrackInput = NeteaseTrackInput | UrlTrackInput;

/** 播放器消费的完整曲目(输入经解析补全后的形态) */
export interface Track {
  source: 'netease' | 'url';
  /** netease: 歌曲 ID;url: 由地址派生的稳定 id(跨页恢复进度用) */
  id: string;
  /** 播放地址 */
  url: string;
  title: string;
  artist: string;
  cover: string;
  /** LRC 原文('' = 无歌词) */
  lrc: string;
}

/* ---- 曲库(本期空库上线) ----
 * 数据在 content/playlist.json(Manager 音乐 Tab 读写),
 * 此处仅类型化装载。两种条目:
 *   { "source": "netease", "id": "186016" }
 *   { "source": "url", "url": "https://.../song.mp3", "title": "曲名",
 *     "artist": "歌手", "cover": "https://...", "lrc": "[00:00.00] …" }
 */
export const PLAYLIST: TrackInput[] = playlistJson as TrackInput[];

/** url 输入 → 稳定 id(取路径段做可读 id;同地址恒等) */
export function urlTrackId(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    return 'url-' + seg.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w-]+/g, '_');
  } catch {
    return 'url-' + url.slice(0, 32).replace(/[^\w-]+/g, '_');
  }
}

/** 直链输入直接映射(纯同步,无网络) */
function fromUrlInput(t: UrlTrackInput): Track {
  return {
    source: 'url',
    id: urlTrackId(t.url),
    url: t.url,
    title: t.title,
    artist: t.artist || '未知歌手',
    cover: t.cover || '',
    lrc: t.lrc || '',
  };
}

export interface PlaylistResult {
  /** 顺序 = PLAYLIST 声明顺序(netease 批量补全后按原位回填) */
  tracks: Track[];
  /** netease 解析失败的数量(ID 不存在/代理不可达) */
  failed: number;
}

/**
 * 解析曲库:直链同步映射;netease 收集 id 批量走 /api/music 一次补全。
 * 代理不可达/无结果 → netease 条目整批跳过(failed 计数),直链不受影响。
 */
export async function resolvePlaylist(playlist: TrackInput[] = PLAYLIST): Promise<PlaylistResult> {
  const neteaseIdx: number[] = [];
  const ids: string[] = [];
  const tracks: Track[] = [];

  playlist.forEach((t, i) => {
    if (t.source === 'url') {
      tracks[i] = fromUrlInput(t);
    } else if (/^\d{1,15}$/.test(String(t.id))) {
      neteaseIdx.push(i);
      ids.push(String(t.id));
    } else {
      tracks[i] = {
        source: 'netease', id: String(t.id), url: '', title: `无效 ID:${t.id}`,
        artist: '', cover: '', lrc: '',
      };
    }
  });

  let failed = 0;
  if (ids.length > 0) {
    try {
      const res = await fetch(`/api/music?ids=${ids.join(',')}`);
      const body = res.ok ? await res.json() : null;
      const byId = new Map<string, unknown>();
      for (const s of (body && body.status && body.data && body.data.songs) || []) {
        byId.set(String(s.id), s);
      }
      for (const [k, i] of neteaseIdx.entries()) {
        const s = byId.get(ids[k]) as {
          name?: string; artist?: string; cover?: string; url?: string; lrc?: string;
        } | undefined;
        if (s) {
          tracks[i] = {
            source: 'netease',
            id: ids[k],
            url: s.url || '',
            title: s.name || `歌曲 ${ids[k]}`,
            artist: s.artist || '未知歌手',
            cover: s.cover || '',
            lrc: s.lrc || '',
          };
        } else {
          failed += 1;
          tracks[i] = {
            source: 'netease', id: ids[k], url: '', title: `歌曲 ${ids[k]}(加载失败)`,
            artist: '', cover: '', lrc: '',
          };
        }
      }
    } catch {
      failed = ids.length;
      for (const [k, i] of neteaseIdx.entries()) {
        tracks[i] = {
          source: 'netease', id: ids[k], url: '', title: `歌曲 ${ids[k]}(加载失败)`,
          artist: '', cover: '', lrc: '',
        };
      }
    }
  }

  return { tracks, failed };
}
