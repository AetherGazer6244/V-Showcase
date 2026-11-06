/* ============================================================
 * 测试博客内容管线纯函数
 * ------------------------------------------------------------
 * build-posts.mjs 导出的纯函数(清洗/slug/摘要/时长/装配/slug 校验)
 * 与 build-post-pages.mjs 的静态页/sitemap 渲染。
 * main() 流程不在此测(需要 content fixture 与 dist 环境)。
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import {
  preclean, slugifyHeading, createSlugger, toPlainText,
  excerptOf, readingMinutes, assemblePosts, isValidSlug, buildOne,
} from '../posts/build-posts.mjs';
import { extractAssets, renderPostPage, renderSitemap } from '../posts/build-post-pages.mjs';

describe('preclean 预清洗', () => {
  it('去 BOM 与 CRLF', () => {
    expect(preclean('\uFEFFa\r\nb\r\n')).toBe('a\nb\n');
  });

  it('修复无空格数字列表(1.百度 → 1. 百度)', () => {
    expect(preclean('1.百度\n2. 谷歌\n10.必应\n')).toBe('1. 百度\n2. 谷歌\n10. 必应\n');
  });

  it('不误伤小数与代码内文本', () => {
    expect(preclean('版本 1.2.3')).toBe('版本 1.2.3');
  });
});

describe('slugifyHeading / createSlugger', () => {
  it('小写化 + 空格转连字符 + 去非法字符', () => {
    expect(slugifyHeading('Hello World!')).toBe('hello-world');
    expect(slugifyHeading('A "quoted" title')).toBe('a-quoted-title');
  });

  it('保留中文', () => {
    expect(slugifyHeading('写作方式')).toBe('写作方式');
  });

  it('createSlugger 同名标题去重', () => {
    const slug = createSlugger();
    expect(slug('用法')).toBe('用法');
    expect(slug('用法')).toBe('用法-1');
    expect(slug('用法')).toBe('用法-2');
  });
});

describe('toPlainText / excerptOf / readingMinutes', () => {
  it('剥代码块/图片/链接/标记', () => {
    const t = toPlainText('# 标题\n\n看[这个链接](https://a.b)和![图](https://i.j)\n\n```js\nconst x = 1;\n```\n');
    expect(t).not.toContain('https://i.j');
    expect(t).not.toContain('const x');
    expect(t).toContain('这个链接');
    expect(t).toContain('标题');
  });

  it('摘要截断加省略号', () => {
    const long = '字'.repeat(200);
    const e = excerptOf(long, 20);
    expect(e.length).toBe(20);
    expect(e.endsWith('…')).toBe(true);
  });

  it('摘要短文不截断', () => {
    expect(excerptOf('短摘要')).toBe('短摘要');
  });

  it('多段正文取首段(先分段后纯文本化,不被吞换行破坏)', () => {
    expect(excerptOf('正文一段\n\n第二段')).toBe('正文一段');
    expect(excerptOf('# 标题\n\n首段内容')).toBe('标题'); // 分段前剥掉标题标记也成立
  });

  it('阅读时长:400 字/分,最少 1', () => {
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes('字'.repeat(399))).toBe(1);
    expect(readingMinutes('字'.repeat(801))).toBe(3);
  });
});

describe('assemblePosts 装配', () => {
  const mk = (slug, date) => ({ slug, title: slug, date, html: '', toc: [], cover: '', excerpt: '', wordCount: 1, readingMin: 1 });

  it('按日期倒序 + prev=更早 / next=更新', () => {
    const [newest, mid, oldest] = assemblePosts([mk('old', '2026-01-01'), mk('new', '2026-03-01'), mk('mid', '2026-02-01')]);
    expect([newest.slug, mid.slug, oldest.slug]).toEqual(['new', 'mid', 'old']);
    expect(newest.next).toBeNull();          // 最新一篇没有「更新一篇」
    expect(newest.prev).toEqual({ slug: 'mid', title: 'mid' });
    expect(oldest.prev).toBeNull();
    expect(oldest.next).toEqual({ slug: 'mid', title: 'mid' });
  });

  it('同日期按 slug 倒序稳定排序', () => {
    const [a, b] = assemblePosts([mk('aa', '2026-01-01'), mk('bb', '2026-01-01')]);
    expect(a.slug).toBe('bb');
    expect(b.slug).toBe('aa');
  });

  it('不修改输入数组', () => {
    const input = [mk('a', '2026-01-01'), mk('b', '2026-02-01')];
    assemblePosts(input);
    expect(input.map((p) => p.slug)).toEqual(['a', 'b']);
  });
});

describe('isValidSlug', () => {
  it('允许字母数字-_ 开头字母数字', () => {
    expect(isValidSlug('hello-world')).toBe(true);
    expect(isValidSlug('Post_2')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
  });

  it('拒绝路径穿越/中文/点开头/超长', () => {
    expect(isValidSlug('..')).toBe(false);
    expect(isValidSlug('../etc')).toBe(false);
    expect(isValidSlug('中文')).toBe(false);
    expect(isValidSlug('.hidden')).toBe(false);
    expect(isValidSlug('a'.repeat(81))).toBe(false);
  });
});

describe('buildOne 渲染', () => {
  it('front-matter 解析 + 标题锚点 + TOC + 代码高亮', () => {
    const raw = [
      '---',
      'title: 测试文章',
      'date: 2026-11-06',
      'excerpt: 自定义摘要',
      '---',
      '',
      '## 第一节',
      '',
      '正文',
      '',
      '## 第一节',           // 同名标题 → 去重 slug
      '',
      '### 深入',
      '',
      '# 一级标题不入 TOC',
      '',
      '```ts',
      'const x: number = 1;',
      '```',
    ].join('\n');

    const p = buildOne('demo', raw);
    expect(p.title).toBe('测试文章');
    expect(p.date).toBe('2026-11-06');
    expect(p.excerpt).toBe('自定义摘要');
    expect(p.toc.map((t) => t.text)).toEqual(['第一节', '第一节', '深入']);
    expect(p.toc[0].id).not.toBe(p.toc[1].id);
    expect(p.html).toContain('<h2 id="第一节">');
    expect(p.html).toContain('hljs-keyword');       // const 被高亮
    expect(p.html).toContain('<code class="hljs language-ts">');
    expect(p.readingMin).toBeGreaterThanOrEqual(1);
  });

  it('缺省日期/摘要自动补', () => {
    const p = buildOne('nodate', '正文一段\n\n第二段');
    expect(p.date).toBe('');
    expect(p.excerpt).toBe('正文一段');
  });

  it('draft 处理在 main 层(front-matter 不影响 buildOne)', () => {
    const p = buildOne('d', '---\ndraft: true\n---\n\n内容');
    expect(p.html).toContain('内容');
  });
});

describe('renderPostPage / renderSitemap / extractAssets', () => {
  const post = {
    slug: 'demo', title: 'Demo "引号" 标题', date: '2026-11-06',
    cover: '', excerpt: '含 & 符号', toc: [], html: '', wordCount: 1, readingMin: 1, prev: null, next: null,
  };

  it('extractAssets 只取 assets 引用行', () => {
    const assets = extractAssets('<html>\n<script src="/assets/main-abc.js"></script>\n<link href="/assets/x.css">\n</html>');
    expect(assets).toContain('main-abc.js');
    expect(assets).toContain('x.css');
    expect(assets).not.toContain('<html>');
  });

  it('静态页:专属 meta + slug 注入 + 属性转义', () => {
    const html = renderPostPage({ post, assets: '<script src="/assets/main-abc.js"></script>', themeScript: '<script>theme</script>' });
    expect(html).toContain('<title>Demo &quot;引号&quot; 标题 · V-Showcase</title>');
    expect(html).toContain('content="含 &amp; 符号"');
    expect(html).toContain('window.__POST_SLUG__ = "demo"');
    expect(html).toContain('/assets/main-abc.js');
    expect(html).toContain('canonical" href="https://vshowcase.pages.dev/posts/demo/"');
    expect(html).toContain('article:published_time" content="2026-11-06"');
    expect(html).toContain('content="https://bu.dusays.com/2026/08/25/6a8da73da2991.jpg"'); // 封面兜底
  });

  it('sitemap:静态页 + 文章 + 日期', () => {
    const xml = renderSitemap({ posts: [post], generatedAt: '2026-11-06T00:00:00Z' });
    expect(xml).toContain('<loc>https://vshowcase.pages.dev/</loc>');
    expect(xml).toContain('<loc>https://vshowcase.pages.dev/posts/demo/</loc>');
    expect(xml).toContain('<lastmod>2026-11-06</lastmod>');
    expect(xml).toContain('blog.html');
  });
});
