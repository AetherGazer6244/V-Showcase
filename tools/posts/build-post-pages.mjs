/* ============================================================
 * build-post-pages.mjs — 博客构建期第三步(vite build 之后运行)
 * ------------------------------------------------------------
 * 职责:
 *   1. 从 dist/index.html 提取哈希资源引用(main-*.js / *.css)
 *   2. 为每篇文章生成独立静态页 dist/posts/<slug>/index.html:
 *      专属 title/description/OG/canonical + 内联 __POST_SLUG__
 *      (CF Pages 静态托管原生支持 /posts/<slug>/ → xxx/index.html)
 *   3. 生成 dist/sitemap.xml:首页/博客/图集/音乐/项目/关于 + 全部文章
 *      (404 页 noindex,不入表)
 *
 * 为什么后置:vite 的产物文件名带内容哈希,只有构建完成后才知道
 * 该引用哪个 main-*.js。生成页只复制 dist/index.html 的资源引用,
 * 不参与 vite 打包。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const SITE = 'https://vshowcase.pages.dev';
const DEFAULT_COVER = 'https://bu.dusays.com/2026/08/25/6a8da73da2991.jpg';

/** html 属性值转义(标题/摘要可能含引号) */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 从 dist/index.html 提取资源引用行(JS/CSS) */
export function extractAssets(indexHtml) {
  const lines = String(indexHtml).split('\n').filter((l) => l.includes('/assets/'));
  return lines.map((l) => l.trim()).join('\n');
}

/** 生成单篇文章静态页 HTML */
export function renderPostPage({ post, assets, themeScript }) {
  const url = `${SITE}/posts/${post.slug}/`;
  const desc = post.excerpt || `${post.title} — V-Showcase 文章`;
  const cover = post.cover || DEFAULT_COVER;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${themeScript}
  <meta name="theme-color" content="#fdfdfd">
  <meta name="description" content="${esc(desc)}">
  <title>${esc(post.title)} · V-Showcase</title>
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="V-Showcase">
  <meta property="og:title" content="${esc(post.title)} · V-Showcase">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${esc(cover)}">
  <meta property="og:image:alt" content="${esc(post.title)}">
  <meta property="article:published_time" content="${esc(post.date)}">
  <meta name="twitter:card" content="summary_large_image">
  <script>window.__VIEW__ = 'post';window.__POST_SLUG__ = ${JSON.stringify(post.slug)};</script>
</head>
<body>
  <div id="app"></div>
${assets}
</body>
</html>
`;
}

/** 生成 sitemap.xml */
export function renderSitemap({ posts, generatedAt }) {
  const now = (generatedAt ? new Date(generatedAt) : new Date()).toISOString();
  const staticPages = [
    { loc: `${SITE}/`, priority: '1.0' },
    { loc: `${SITE}/blog.html`, priority: '0.9' },
    { loc: `${SITE}/gallery.html`, priority: '0.8' },
    { loc: `${SITE}/music.html`, priority: '0.6' },
    { loc: `${SITE}/projects.html`, priority: '0.6' },
    { loc: `${SITE}/about.html`, priority: '0.5' },
    { loc: `${SITE}/settings.html`, priority: '0.3' },
  ];
  const urls = [
    ...staticPages.map((p) => `  <url><loc>${p.loc}</loc><lastmod>${now.slice(0, 10)}</lastmod><priority>${p.priority}</priority></url>`),
    ...posts.map((p) => `  <url><loc>${SITE}/posts/${p.slug}/</loc><lastmod>${p.date}</lastmod><priority>0.7</priority></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

/* ---- 主流程 ---- */

export function main() {
  const postsJsonPath = path.join(ROOT, 'src', 'generated', 'posts.json');
  if (!fs.existsSync(postsJsonPath)) {
    console.error('[build-post-pages] 缺少 src/generated/posts.json — 先跑 build-posts');
    process.exitCode = 1;
    return;
  }
  const { posts, generatedAt } = JSON.parse(fs.readFileSync(postsJsonPath, 'utf8'));

  const indexHtmlPath = path.join(DIST, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    console.error('[build-post-pages] 缺少 dist/index.html — 先跑 vite build');
    process.exitCode = 1;
    return;
  }
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const assets = extractAssets(indexHtml);

  // 防闪烁脚本与各入口一致(明亮默认,深色/auto+系统深色置 data-theme)
  const themeScript = '<script>try{var s=JSON.parse(localStorage.getItem("vshowcase.settings")||"{}").theme,d=s==="dark"||((!s||s==="auto")&&window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.dataset.theme="dark"}catch(e){}</script>';

  let count = 0;
  for (const post of posts) {
    const dir = path.join(DIST, 'posts', post.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPostPage({ post, assets, themeScript }), 'utf8');
    count += 1;
  }

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), renderSitemap({ posts, generatedAt }), 'utf8');
  console.log(`[build-post-pages] ${count} 个文章静态页 + sitemap.xml → dist/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
