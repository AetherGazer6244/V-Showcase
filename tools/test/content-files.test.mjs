/* ============================================================
 * 测试内容文件读写库(content-files.mjs)
 * ------------------------------------------------------------
 * 重点:路径穿越防护 / 文件名校验 / front-matter 校验 /
 *       playlist 与 projects 的 schema 校验。
 * 对真实 content/ 目录只做「写后即删」的临时文件操作。
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import {
  listMarkdown, readMarkdown, writeMarkdown, deleteMarkdown,
  validatePlaylistDoc, validateProjectsDoc, readPlaylist, readProjects,
} from '../server/lib/content-files.mjs';

describe('路径穿越与文件名校验', () => {
  it('readMarkdown 拒绝穿越路径与非法字符', async () => {
    for (const bad of ['..', '../etc', 'a/b', '.hidden', '中文', 'a b', 'a'.repeat(81), '']) {
      await expect(readMarkdown('posts', bad)).rejects.toThrow(/非法文件名/);
    }
  });

  it('readMarkdown 拒绝未知 kind', async () => {
    await expect(readMarkdown('hacker', 'x')).rejects.toThrow(/未知内容类型/);
  });

  it('不存在的合法名字 → ENOENT', async () => {
    await expect(readMarkdown('posts', 'definitely-not-exist-xyz')).rejects.toThrow();
  });
});

describe('listMarkdown', () => {
  it('posts 列出仓库里的 2 篇示例,含 title/draft', async () => {
    const { files } = await listMarkdown('posts');
    const slugs = files.map((f) => f.slug);
    expect(slugs).toContain('hello-world');
    expect(slugs).toContain('redesign-notes');
    const hw = files.find((f) => f.slug === 'hello-world');
    expect(hw.title).toContain('你好,世界');
    expect(hw.draft).toBe(false);
    expect(hw.size).toBeGreaterThan(0);
  });

  it('pages 列出 about', async () => {
    const { files } = await listMarkdown('pages');
    expect(files.map((f) => f.slug)).toContain('about');
  });

  it('按 mtime 倒序(最新在前)', async () => {
    const { files } = await listMarkdown('posts');
    for (let i = 1; i < files.length; i++) {
      expect(files[i - 1].mtime).toBeGreaterThanOrEqual(files[i].mtime);
    }
  });
});

describe('writeMarkdown / deleteMarkdown(临时文件写后即删)', () => {
  const name = 'zz-api-selftest';

  it('缺 title 的内容被拒', async () => {
    await expect(writeMarkdown('posts', name, '---\ndate: 2026-01-01\n---\n\n正文'))
      .rejects.toThrow(/title/);
  });

  it('front-matter 语法错误被拒', async () => {
    await expect(writeMarkdown('posts', name, '---\ntitle: [未闭合\n---\n\n正文'))
      .rejects.toThrow(/front-matter/);
  });

  it('空内容被拒', async () => {
    await expect(writeMarkdown('posts', name, '   ')).rejects.toThrow(/不能为空/);
  });

  it('合法内容写入成功 + 重建产物 + 读回一致 + 删除成功', async () => {
    const raw = ['---', 'title: "API 自测"', 'date: 2026-01-01', 'draft: true', '---', '', '临时内容'].join('\n');
    const w = await writeMarkdown('posts', name, raw);
    expect(w.bytes).toBeGreaterThan(0);
    expect(w.rebuilt.ok).toBe(true);            // 写入后 build-posts 重建成功

    const r = await readMarkdown('posts', name);
    expect(r.raw).toContain('API 自测');

    const { files } = await listMarkdown('posts');
    expect(files.map((f) => f.slug)).toContain(name);

    await expect(deleteMarkdown('posts', name)).resolves.toMatchObject({ name });
    await expect(readMarkdown('posts', name)).rejects.toThrow();
  }, 20000);
});

describe('validatePlaylistDoc', () => {
  it('接受空数组与两种合法条目', () => {
    expect(() => validatePlaylistDoc([])).not.toThrow();
    expect(() => validatePlaylistDoc([
      { source: 'netease', id: '186016' },
      { source: 'url', url: 'https://a.com/b.mp3', title: '曲' },
    ])).not.toThrow();
  });

  it('拒绝非数组/未知 source/非法 ID/直链缺 title', () => {
    expect(() => validatePlaylistDoc({})).toThrow(/数组/);
    expect(() => validatePlaylistDoc([{ source: 'x' }])).toThrow(/source/);
    expect(() => validatePlaylistDoc([{ source: 'netease', id: '12a' }])).toThrow(/纯数字/);
    expect(() => validatePlaylistDoc([{ source: 'url', url: 'https://a.com/b.mp3' }])).toThrow(/title/);
    expect(() => validatePlaylistDoc([{ source: 'url', url: 'ftp://a.com', title: 't' }])).toThrow(/http/);
  });
});

describe('validateProjectsDoc', () => {
  it('接受合法项目', () => {
    expect(() => validateProjectsDoc([
      { name: 'Demo', desc: '介绍', status: 'active', tech: ['Vue'], year: '2026', link: '', repo: null },
    ])).not.toThrow();
  });

  it('拒绝缺 name/desc、非法 status、空 tech', () => {
    expect(() => validateProjectsDoc([{ name: '', desc: 'd', status: 'active', tech: ['a'] }])).toThrow(/name/);
    expect(() => validateProjectsDoc([{ name: 'n', desc: 'd', status: 'gone', tech: ['a'] }])).toThrow(/status/);
    expect(() => validateProjectsDoc([{ name: 'n', desc: 'd', status: 'active', tech: [] }])).toThrow(/tech/);
    expect(() => validateProjectsDoc('nope')).toThrow(/数组/);
  });
});

describe('readPlaylist / readProjects(真实数据文件)', () => {
  it('playlist.json 为合法数组(v2.3 种子:5 首 netease)', async () => {
    const doc = await readPlaylist();
    expect(Array.isArray(doc)).toBe(true);
    expect(doc.length).toBe(5);
    expect(doc.every((t) => t.source === 'netease' && /^\d+$/.test(t.id))).toBe(true);
  });

  it('projects.json 与站点数据一致且通过校验', async () => {
    const doc = await readProjects();
    expect(doc.length).toBeGreaterThanOrEqual(3);
    expect(doc[0].name).toBe('V-Showcase');
  });
});
