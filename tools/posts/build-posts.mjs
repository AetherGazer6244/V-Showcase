/* ============================================================
 * build-posts.mjs — 博客内容管线(构建期第一步)
 * ------------------------------------------------------------
 * 输入:  content/posts/<slug>.md      博客文章(front-matter + Markdown)
 *        content/pages/<name>.md      独立页面(目前 about)
 * 输出:  src/generated/posts.json     全部文章(HTML 已预渲染 + TOC + 摘要)
 *        src/generated/pages.json     独立页面
 *
 * 设计要点:
 *   - Markdown 在构建期转 HTML,浏览器端零 md 解析开销
 *   - highlight.js 构建期代码高亮(随主题换肤由 CSS 变量完成)
 *   - GFM(删除线/表格/任务列表) + 预清洗(借 Cecilian-Hub 踩坑经验:
 *     无空格数字列表修复等,防渲染翻车)
 *   - 标题自动挂 slug id(TOC 锚点)
 *   - draft: true 的文章跳过,不进产物
 *   - 摘要缺省取正文首段纯文本;阅读时长按中文 400 字/分估算
 *   - front-matter tags:数组或逗号/顿号分隔字符串,归一化上限 6 个
 *
 * 纯函数(正则清洗/slug/摘要/时长)可被 tools/test 单测直接导入;
 * main() 仅在 CLI 直跑时执行。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { Marked } from 'marked';
import hljs from 'highlight.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const POSTS_DIR = path.join(ROOT, 'content', 'posts');
const PAGES_DIR = path.join(ROOT, 'content', 'pages');
const OUT_DIR = path.join(ROOT, 'src', 'generated');

/** 中文为主的阅读速度:400 字/分钟,不足 1 分钟记 1 分钟 */
const READ_WPM = 400;
/** 自动摘要最大长度(字符) */
const EXCERPT_MAX = 96;

/* ---------- 纯函数(可单测) ---------- */

/** Markdown 预清洗:修复常见手滑,输出去 BOM/CRLF 的文本 */
export function preclean(mdText) {
  let t = String(mdText).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  // 1. 数字列表缺空格(1.百度 → 1. 百度),否则 GFM 不认
  t = t.replace(/^(\s*\d+)\.([^ \n])/gm, '$1. $2');
  // 2. 无语言标记的围栏代码块保持原样(highlight.js highlightAuto 兜底)
  return t;
}

/** 标题文本 → URL 安全 slug(中文转拼音不做,保留 CJK;去 HTML 标签与非法字符) */
export function slugifyHeading(text) {
  const clean = String(text)
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/["'`~!@#$%^&*()+=[\]{}|\\:;<>,.?/]/g, '');
  return clean || 'section';
}

/** 顺序计数器防重名 slug:同文档内同名标题自动加后缀 */
export function createSlugger() {
  const seen = new Map();
  return (text) => {
    const base = slugifyHeading(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

/** Markdown → 纯文本(摘要用;去代码块/图片/标签/标记符号) */
export function toPlainText(mdText) {
  return String(mdText)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 自动摘要:正文首段纯文本,超长截断加省略号。
 *  顺序要点:先按空行分段再纯文本化 —— toPlainText 会吞掉换行,
 *  反过来先纯文本化就再也找不到段落边界了。 */
export function excerptOf(mdBody, max = EXCERPT_MAX) {
  const firstPara = String(mdBody).split(/\n{2,}/)[0] ?? '';
  const text = toPlainText(firstPara);
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** 阅读时长(分钟,向上取整,最少 1) */
export function readingMinutes(plainText) {
  return Math.max(1, Math.ceil(plainText.length / READ_WPM));
}

/** 单个标签上限(字符),超长截断防撑爆胶囊 */
const TAG_MAX_CHARS = 16;
/** 全文标签上限,超出丢弃(胶囊行放不下) */
const TAG_MAX_COUNT = 6;

/** front-matter tags 归一化:数组或逗号/顿号分隔字符串 →
 *  去空去重(trim) → 逐个截断 → 上限 6 个。非法输入一律回空数组。 */
export function normalizeTags(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') list = value.split(/[,、，;；\s]+/);
  else return [];
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const clean = t.trim().slice(0, TAG_MAX_CHARS);
    if (!clean) continue;
    if (!out.includes(clean)) out.push(clean);
    if (out.length >= TAG_MAX_COUNT) break;
  }
  return out;
}

/** front-matter + 正文 → 文章数据(不含 prev/next,由 assemblePosts 补) */
export function buildOne(slug, raw) {
  const { data, content } = matter(raw);
  const body = preclean(content);
  const plain = toPlainText(body);

  const slugger = createSlugger();
  const toc = [];
  const marked = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugger(text);
        if (depth >= 2 && depth <= 3) toc.push({ id, text, depth });
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang ?? '').trim().split(/\s+/)[0];
        let html;
        let cls = 'hljs';
        if (language && hljs.getLanguage(language)) {
          html = hljs.highlight(text, { language }).value;
          cls += ` language-${language}`;
        } else {
          html = hljs.highlightAuto(text).value;
        }
        return `<pre><code class="${cls}">${html}</code></pre>\n`;
      },
    },
  });

  const html = marked.parse(body);

  const dateRaw = data.date ? new Date(data.date) : null;
  const date = dateRaw && !Number.isNaN(dateRaw.valueOf())
    ? dateRaw.toISOString().slice(0, 10)
    : '';

  return {
    slug,
    title: String(data.title ?? slug),
    date,
    cover: typeof data.cover === 'string' ? data.cover : '',
    tags: normalizeTags(data.tags),
    excerpt: typeof data.excerpt === 'string' && data.excerpt.trim() ? data.excerpt.trim() : excerptOf(body),
    wordCount: plain.length,
    readingMin: readingMinutes(plain),
    toc,
    html,
  };
}

/** 按日期倒序装配文章列表 + 补上一篇/下一篇 */
export function assemblePosts(list) {
  const sorted = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug < b.slug ? 1 : -1));
  return sorted.map((p, i) => ({
    ...p,
    prev: sorted[i + 1] ? { slug: sorted[i + 1].slug, title: sorted[i + 1].title } : null,  // 更早一篇
    next: sorted[i - 1] ? { slug: sorted[i - 1].slug, title: sorted[i - 1].title } : null,  // 更新一篇
  }));
}

/* ---------- 目录遍历 ---------- */

function readMarkdownDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((f) => ({
      slug: f.replace(/\.md$/i, ''),
      raw: fs.readFileSync(path.join(dir, f), 'utf8'),
    }));
}

/** slug 合法性:URL 路径段,禁止路径穿越与保留字符 */
export function isValidSlug(slug) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(slug);
}

/* ---------- 主流程 ---------- */

export function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const drafts = [];
  const posts = [];
  for (const { slug, raw } of readMarkdownDir(POSTS_DIR)) {
    if (!isValidSlug(slug)) {
      console.warn(`[build-posts] 跳过非法文件名: ${slug}.md(仅允许字母数字-_ )`);
      continue;
    }
    const { data } = matter(raw);
    if (data.draft === true) { drafts.push(slug); continue; }
    posts.push(buildOne(slug, raw));
  }
  const assembled = assemblePosts(posts);

  const pages = {};
  for (const { slug, raw } of readMarkdownDir(PAGES_DIR)) {
    if (!isValidSlug(slug)) continue;
    pages[slug] = buildOne(slug, raw);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    posts: assembled,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'posts.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'pages.json'), JSON.stringify({ pages }, null, 2) + '\n', 'utf8');

  const skipped = drafts.length ? `,草稿 ${drafts.length} 篇(${drafts.join(', ')})` : '';
  console.log(`[build-posts] ${assembled.length} 篇文章 + ${Object.keys(pages).length} 个页面 → src/generated/${skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
