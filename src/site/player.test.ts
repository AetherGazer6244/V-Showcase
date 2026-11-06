import { describe, it, expect, vi } from 'vitest';
import { parseLrc, activeLrcIndex, nextIndex } from './player';
import { resolvePlaylist, urlTrackId, NETEASE_CHUNK } from './playlist';
import { PROJECTS, STATUS_FILTERS } from './projects';

describe('parseLrc — LRC 歌词解析', () => {
  it('解析 [mm:ss.xx] 并按时间排序', () => {
    const lines = parseLrc('[00:12.50]第二句\n[00:03.20]第一句');
    expect(lines.map((l) => l.text)).toEqual(['第一句', '第二句']);
    expect(lines[0].t).toBeCloseTo(3.2, 5);
    expect(lines[1].t).toBeCloseTo(12.5, 5);
  });

  it('一行多时间标签展开为多行', () => {
    const lines = parseLrc('[00:01.00][00:05.00]副歌');
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.t)).toEqual([1, 5]);
    expect(lines[0].text).toBe('副歌');
  });

  it('跳过元数据行与非时间标签行', () => {
    const lines = parseLrc('[ti:歌名]\n[ar:歌手]\nplain text\n[01:02]正常行');
    expect(lines).toHaveLength(1);
    expect(lines[0].t).toBe(62);
    expect(lines[0].text).toBe('正常行');
  });

  it('[mm:ss] 无小数位与 [mm:ss.xxx] 三位数均正确', () => {
    expect(parseLrc('[01:02]a')[0].t).toBe(62);
    expect(parseLrc('[01:02.123]b')[0].t).toBeCloseTo(62.123, 5);
  });

  it('空输入 → 空数组', () => {
    expect(parseLrc('')).toEqual([]);
  });
});

describe('activeLrcIndex — 当前行二分定位', () => {
  const lines = parseLrc('[00:01]a\n[00:05]b\n[00:10]c');

  it('开始前 → -1', () => {
    expect(activeLrcIndex(lines, 0)).toBe(-1);
    expect(activeLrcIndex(lines, 0.9)).toBe(-1);
  });

  it('落在某行内 → 该行索引', () => {
    expect(activeLrcIndex(lines, 1)).toBe(0);
    expect(activeLrcIndex(lines, 4.99)).toBe(0);
    expect(activeLrcIndex(lines, 5)).toBe(1);
    expect(activeLrcIndex(lines, 30)).toBe(2);   // 最后一行持续到结束
  });
});

describe('nextIndex / prevIndex — 播放模式', () => {
  it('order:到尾即停(返回自身)', () => {
    expect(nextIndex(0, 'order', 3)).toBe(1);
    expect(nextIndex(2, 'order', 3)).toBe(2);
  });

  it('loop:环形', () => {
    expect(nextIndex(2, 'loop', 3)).toBe(0);
    expect(nextIndex(1, 'loop', 3)).toBe(2);
  });

  it('single:手动切歌按顺序前进(播完原地重播由 onEnded 处理,不在此层)', () => {
    expect(nextIndex(0, 'single', 3)).toBe(1);
    expect(nextIndex(2, 'single', 3)).toBe(2);   // 到尾即停
  });

  it('shuffle:不重复自身', () => {
    for (let i = 0; i < 20; i++) {
      const n = nextIndex(1, 'shuffle', 3);
      expect(n).not.toBe(1);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(3);
    }
  });

  it('单曲/空库边界', () => {
    expect(nextIndex(0, 'order', 1)).toBe(0);
    expect(nextIndex(0, 'single', 1)).toBe(0);
    expect(nextIndex(0, 'shuffle', 1)).toBe(0);
    expect(nextIndex(0, 'order', 0)).toBe(-1);
  });
});

describe('playlist 解析', () => {
  it('urlTrackId 稳定且可读', () => {
    expect(urlTrackId('https://cdn.example.com/music/song-name.mp3')).toBe('url-song-name');
    expect(urlTrackId('https://cdn.example.com/music/song-name.mp3'))
      .toBe(urlTrackId('https://cdn.example.com/music/song-name.mp3'));
    expect(urlTrackId('not a url')).toMatch(/^url-/);
  });

  it('空曲库解析:零网络,直接返回空', async () => {
    const { tracks, failed } = await resolvePlaylist([]);
    expect(tracks).toEqual([]);
    expect(failed).toBe(0);
  });

  it('直链曲目同步映射(不发请求)', async () => {
    const { tracks, failed } = await resolvePlaylist([
      { source: 'url', url: 'https://cdn.example.com/a.mp3', title: '直链曲', artist: '某人', cover: 'https://c/1.jpg', lrc: '[00:01]词' },
    ]);
    expect(failed).toBe(0);
    expect(tracks[0]).toMatchObject({
      source: 'url', id: 'url-a', url: 'https://cdn.example.com/a.mp3',
      title: '直链曲', artist: '某人', cover: 'https://c/1.jpg', lrc: '[00:01]词',
    });
  });

  it('非法 netease ID 不发请求,标记为无效', async () => {
    const { tracks } = await resolvePlaylist([{ source: 'netease', id: 'abc!!' }]);
    expect(tracks[0].title).toContain('无效');
  });

  it(`netease 分块:超过 ${NETEASE_CHUNK} 首拆多次请求,顺序回填(上游大批量会 5xx)`, async () => {
    const calls: string[] = [];
    const stub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      const ids = new URL(url, 'http://x').searchParams.get('ids') || '';
      const songs = ids.split(',').map((id) => ({ id, name: `歌${id}`, artist: 'A', cover: '', url: `u:${id}`, lrc: '' }));
      return new Response(JSON.stringify({ status: true, message: 'success', data: { songs } }), { status: 200 });
    });
    try {
      const inputs = Array.from({ length: NETEASE_CHUNK + 1 }, (_, n) => ({ source: 'netease' as const, id: String(1000 + n) }));
      const { tracks, failed } = await resolvePlaylist(inputs);
      expect(calls).toHaveLength(2);                       // 4 + 1 两块
      expect(calls[0]).toContain(`ids=1000,1001,1002,1003`);
      expect(calls[1]).toContain('ids=1004');
      expect(failed).toBe(0);
      expect(tracks.map((t) => t.title)).toEqual(['歌1000', '歌1001', '歌1002', '歌1003', '歌1004']);
    } finally {
      stub.mockRestore();
    }
  });

  it('分块下单块失败只损失该块,其余正常回填', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const ids = new URL(String(input), 'http://x').searchParams.get('ids') || '';
      if (ids.includes('2000')) return new Response('boom', { status: 500 });  // 第一块挂
      const songs = ids.split(',').map((id) => ({ id, name: `歌${id}`, artist: 'A', cover: '', url: `u:${id}`, lrc: '' }));
      return new Response(JSON.stringify({ status: true, message: 'success', data: { songs } }), { status: 200 });
    });
    try {
      const inputs = Array.from({ length: NETEASE_CHUNK + 1 }, (_, n) => ({ source: 'netease' as const, id: String(2000 + n) }));
      const { tracks, failed } = await resolvePlaylist(inputs);
      expect(failed).toBe(NETEASE_CHUNK);                  // 只有第一块 4 首失败
      expect(tracks[NETEASE_CHUNK].title).toBe('歌2004');  // 第二块正常
    } finally {
      stub.mockRestore();
    }
  });
});

describe('projects 数据', () => {
  it('筛选顺序含全部四档且标签齐全', () => {
    expect(STATUS_FILTERS).toEqual(['all', 'active', 'wip', 'archived']);
    expect(PROJECTS.length).toBeGreaterThan(0);
    for (const p of PROJECTS) {
      expect(['active', 'wip', 'archived']).toContain(p.status);
      expect(p.tech.length).toBeGreaterThan(0);
    }
  });
});
