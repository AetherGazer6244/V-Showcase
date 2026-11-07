/* ============================================================
 * posts / pages — 构建期产物的类型化装载器
 * ------------------------------------------------------------
 * 数据由 tools/posts/build-posts.mjs 在构建前生成到 src/generated/:
 *   posts.json → 全部文章(HTML 已预渲染,按日期倒序,带 prev/next)
 *   pages.json → 独立页面(about)
 * 本模块只做:类型断言 + 查询函数。不要在此处写解析逻辑。
 * ============================================================ */
import postsJson from '../generated/posts.json';
import pagesJson from '../generated/pages.json';

export interface PostTocItem {
  /** 标题锚点 id(与 html 内 h2/h3 的 id 一致) */
  id: string;
  text: string;
  depth: 2 | 3;
}

export interface PostRef {
  slug: string;
  title: string;
}

export interface Post {
  slug: string;
  title: string;
  /** yyyy-MM-dd */
  date: string;
  cover: string;
  /** front-matter 标签(归一化:去重、上限 6,可为空数组) */
  tags: string[];
  excerpt: string;
  wordCount: number;
  readingMin: number;
  toc: PostTocItem[];
  /** 预渲染 HTML(构建期 marked + highlight.js) */
  html: string;
  /** 更早一篇(时间线上的上一篇) */
  prev: PostRef | null;
  /** 更新一篇 */
  next: PostRef | null;
}

export interface GeneratedPosts {
  generatedAt: string;
  posts: Post[];
}

const data = postsJson as GeneratedPosts;

export const posts: Post[] = data.posts;
export const postsGeneratedAt: string = data.generatedAt;

export function findPost(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug);
}

/* ---- 独立页面(about 等) ---- */

export interface Page extends Omit<Post, 'prev' | 'next' | 'cover'> {
  cover?: string;
}

const pageData = pagesJson as { pages: Record<string, Page> };

export function getPage(name: string): Page | undefined {
  return pageData.pages[name];
}

/** yyyy-MM-dd → 2026 年 11 月 6 日(列表/详情日期展示) */
export function formatDateCN(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
}

/** 文章链接:开发模式走查询参数壳,生产走 /posts/<slug>/ 静态页。
 *  根绝对路径(勿回退):文章页自身在 /posts/<slug>/ 目录下,
 *  相对路径会被解析进子目录(上一篇/下一篇 404,2026-11 修复) */
export function postHref(slug: string): string {
  return import.meta.env.DEV ? `/post.html?slug=${encodeURIComponent(slug)}` : `/posts/${slug}/`;
}
