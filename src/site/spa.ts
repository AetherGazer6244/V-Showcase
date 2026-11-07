/* ============================================================
 * spa — 站内视图切换导航(前台内链 SPA 化)
 * ------------------------------------------------------------
 * 为什么存在:MPA 每次导航都是整页加载,audio 元素随页面销毁,
 * player.ts 的「跨页续播」只能恢复曲目/进度,音乐必然中断。
 * 这里把前台内链点击升级为 fetch + 就地换视图:
 *   - player.ts 的 audio 单例在同一段 JS 世界里永不销毁 → 音乐真连续
 *   - URL 用 pushState 保持真实地址(可刷新/分享/前进后退)
 *   - 鼠标悬停/键盘聚焦时先取目标 HTML,点击时直接用预取结果
 *
 * 拦截范围(窄白名单,宁缺毋滥,改动前都有问题勿回退):
 *   1. 只拦前台 8 视图(.html 与美化路径两种形态)+ /posts/<slug>/
 *      文章静态页;manager.html、/api/*、静态资产、外链一律放行整页
 *      (404 也交给服务端呈现)
 *   2. 仅 hash 差异(同页锚点/文章 TOC)不拦,交给浏览器平滑滚动
 *   3. fetch 任何一步失败 → location.href 整页兜底,永不白屏
 *   4. 会话过期/站点锁定的响应没有 __VIEW__ 内联标记 → 识别后整页
 *      跳转,让中间件的登录页/锁定页正常呈现(不能把登录页当数据吞进来)
 *
 * 页面元数据:title/description 从 fetch 到的 HTML 文本里正则解析;
 * 视图标识由 URL 推导(__VIEW__ 不靠脚本执行,DOMParser 也不执行脚本)。
 * 滚动:push 导航回顶;popstate 尽力恢复 spaScroll(异步组件加载完成
 * 时机不定,恢复是尽力而为)。内部导航链接必须用根绝对路径:
 * 文章页在 /posts/<slug>/ 子目录下,相对路径会解析进子目录 → 404。
 * ============================================================ */
import { ref } from 'vue';

export type SpaView =
  | 'home' | 'blog' | 'post' | 'gallery'
  | 'music' | 'projects' | 'about' | 'settings';

export interface RouteTarget {
  view: SpaView;
  /** 仅 post 有值:生产来自 /posts/<slug>/ 路径,开发来自 ?slug= 查询参数 */
  slug: string;
}

/** 全站共享的视图状态:App.vue 渲染谁、PostView 渲染哪篇,由这两者驱动 */
export const spaView = ref<string>(typeof window !== 'undefined' ? (window.__VIEW__ || 'home') : 'home');
export const spaSlug = ref<string>(typeof window !== 'undefined' ? (window.__POST_SLUG__ || '') : '');

/* ---------- 路由推导(纯函数,可单测) ---------- */

/** 单段路径 → 视图;.html 与美化路径(如 /music)两种形态都收 */
const SEGMENT_VIEW: Record<string, SpaView> = {
  '': 'home',
  'index.html': 'home',
  'blog.html': 'blog', 'blog': 'blog',
  'gallery.html': 'gallery', 'gallery': 'gallery',
  'music.html': 'music', 'music': 'music',
  'projects.html': 'projects', 'projects': 'projects',
  'settings.html': 'settings', 'settings': 'settings',
  'about.html': 'about', 'about': 'about',
  'post.html': 'post',   // 开发壳:slug 在查询参数
};

/** URL → 前台路由;不在白名单返回 null(调用方放行整页导航) */
export function routeFromUrl(href: string, base: string): RouteTarget | null {
  let u: URL;
  let b: URL;
  try {
    u = new URL(href, base);
    b = new URL(base);
  } catch {
    return null;
  }
  if (u.origin !== b.origin) return null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  // 文章静态页:/posts/<slug>/ 或 /posts/<slug>/index.html
  const postDir = /^\/posts\/([^/]+?)(?:\/index\.html)?\/?$/.exec(u.pathname);
  if (postDir) {
    let slug = postDir[1];
    try { slug = decodeURIComponent(slug); } catch { /* 保留原样 */ }
    return { view: 'post', slug };
  }

  // 其余只认根下单段路径;多段嵌套(多半是相对链接解析错了)放行整页
  const seg = u.pathname.replace(/^\/+/, '');
  if (seg.includes('/')) return null;
  const view = SEGMENT_VIEW[seg];
  if (!view) return null;
  return { view, slug: view === 'post' ? (u.searchParams.get('slug') || '') : '' };
}

/** 结构化点击事件(真实 MouseEvent 天然满足;抽出来是为了可单测) */
interface ClickLike {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

/** 这次点击是否应当拦截为 SPA 导航(所有检查都是放行语义,宁可不拦) */
export function willIntercept(e: ClickLike): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a) return false;
  if (a.target && a.target !== '_self') return false;   // 新标签交给浏览器
  if (a.hasAttribute('download')) return false;
  if (/\bexternal\b/i.test(a.rel)) return false;
  const raw = a.getAttribute('href') || '';
  if (!raw || raw.startsWith('#')) return false;        // 页内锚点/空链
  if (!routeFromUrl(a.href, window.location.href)) return false;
  // 同路径+同查询(仅 hash 差异/原地重进)交给浏览器:TOC 平滑滚动
  const dest = new URL(a.href);
  const here = new URL(window.location.href);
  if (dest.pathname === here.pathname && dest.search === here.search) return false;
  return true;
}

/* ---------- 元数据解析(纯函数,可单测) ---------- */

export interface PageMeta {
  title?: string;
  description?: string;
}

/** 从入口 HTML 文本解析 title / description(内联脚本不执行,只当文本) */
export function parseMeta(html: string): PageMeta {
  const t = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const d = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html)
    || /<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i.exec(html);
  return {
    title: t ? t[1].trim() : undefined,
    description: d ? d[1].trim() : undefined,
  };
}

/* ---------- 导航执行 ---------- */

let initialized = false;
let seq = 0;                 // 并发导航令牌:连点时只认最后一次
let onNavigateCb: (() => void) | null = null;
/** URL(pathname+search) → 已见过的 title/description,popstate 恢复标题用 */
const metaCache = new Map<string, PageMeta>();
/** 鼠标悬停/键盘聚焦预取的页面 HTML;短 TTL 避免长时间使用旧内容 */
const PREFETCH_TTL_MS = 30_000;
const PREFETCH_MAX_ENTRIES = 8;
interface PageResponse {
  url: URL;
  html: string;
}
const pageCache = new Map<string, { at: number; promise: Promise<PageResponse | null> }>();

function pageKey(href: string): string {
  return new URL(href, window.location.href).href;
}

/** HTML 请求 single-flight:预取与点击共用同一请求 */
function loadPage(href: string): Promise<PageResponse | null> {
  const key = pageKey(href);
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < PREFETCH_TTL_MS) return cached.promise;
  if (cached) pageCache.delete(key);

  const entry: { at: number; promise: Promise<PageResponse | null> } = {
    at: Date.now(),
    promise: Promise.resolve(null),
  };
  entry.promise = fetch(key, { headers: { Accept: 'text/html' } })
    .then(async (res) => {
      if (!res.ok) return null;
      return { url: new URL(res.url, window.location.href), html: await res.text() };
    })
    .catch((err: unknown) => {
      if (pageCache.get(key) === entry) pageCache.delete(key);
      throw err;
    });
  pageCache.set(key, entry);
  while (pageCache.size > PREFETCH_MAX_ENTRIES) {
    const oldest = pageCache.keys().next().value as string | undefined;
    if (!oldest) break;
    pageCache.delete(oldest);
  }
  return entry.promise;
}

function prefetchFromTarget(target: EventTarget | null): void {
  const a = (target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || /\bexternal\b/i.test(a.rel)) return;
  const href = a.getAttribute('href') || '';
  if (!href || href.startsWith('#')) return;
  if (!routeFromUrl(a.href, window.location.href)) return;
  const dest = new URL(a.href);
  const here = new URL(window.location.href);
  if (dest.pathname === here.pathname && dest.search === here.search) return;
  // 预取失败不影响正常点击;届时 go() 会走完整页兜底。
  void loadPage(a.href).catch(() => undefined);
}

function onPointerOver(e: PointerEvent): void {
  // 触屏通常没有悬停;即便浏览器模拟 pointerover,预取也是低风险 GET。
  prefetchFromTarget(e.target);
}

function onFocusIn(e: FocusEvent): void {
  prefetchFromTarget(e.target);
}

/** 首屏稳定后预热视图代码;用户第一次点击时免等分包下载 */
function warmViewChunks(): void {
  const loaders = [
    () => import('./HomeView.vue'),
    () => import('./BlogView.vue'),
    () => import('./PostView.vue'),
    () => import('./GalleryView.vue'),
    () => import('./MusicView.vue'),
    () => import('./ProjectsView.vue'),
    () => import('./AboutView.vue'),
    () => import('./SettingsView.vue'),
  ];
  loaders.forEach((load) => { void load().catch(() => undefined); });
}

function scheduleChunkWarmup(): void {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warmViewChunks, { timeout: 2000 });
  } else {
    globalThis.setTimeout(warmViewChunks, 1500);
  }
}

function onClick(e: MouseEvent): void {
  if (!willIntercept(e)) return;
  e.preventDefault();
  const a = (e.target as Element).closest('a[href]') as HTMLAnchorElement;
  void go(a.href);
}

/** fetch 目标页 → 解析元数据 → 就地换视图;任何一步失败整页兜底 */
async function go(href: string): Promise<void> {
  const token = ++seq;
  // 出发前把当前滚动深度记进历史条目,popstate 回来时恢复
  try {
    history.replaceState({ ...(history.state as Record<string, unknown> | null), spaScroll: window.scrollY }, '');
  } catch { /* 状态序列化失败无碍 */ }

  let page: PageResponse | null;
  try {
    page = await loadPage(href);
  } catch {
    if (token !== seq) return;
    window.location.href = href;   // 断网/CSP 拦截 → 整页照旧
    return;
  }
  if (token !== seq) return;
  if (!page) {
    window.location.href = href;   // 404 等 → 让服务端呈现错误页
    return;
  }
  const { url, html } = page;
  const route = routeFromUrl(url.href, window.location.href);
  if (!route) {
    window.location.href = url.href;   // 重定向出了白名单 → 整页
    return;
  }
  if (!/window\.__VIEW__/.test(html)) {
    // 没有 __VIEW__ 标记 = 登录页/锁定页(会话过期/站点锁定):
    // 整页跳转让中间件的完整页面正常呈现,绝不能吞成数据
    window.location.href = url.href;
    return;
  }

  const meta = parseMeta(html);
  metaCache.set(url.pathname + url.search, meta);
  applyRoute(route, url, meta, true);
}

/** 就地切视图。push=true 时写历史并回顶;false = popstate 回退 */
function applyRoute(route: RouteTarget, url: URL, meta: PageMeta, push: boolean): void {
  if (push) history.pushState({ spa: true }, '', url.href);
  // 先写全局与 slug 再切视图:PostView setup 同步读 __POST_SLUG__,顺序不能反
  window.__VIEW__ = route.view;
  window.__POST_SLUG__ = route.view === 'post' ? route.slug : '';
  spaSlug.value = route.slug;
  spaView.value = route.view;
  if (meta.title) document.title = meta.title;
  if (meta.description) {
    document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
  }
  onNavigateCb?.();                    // PV 记账:与旧整页加载语义一致
  if (push) window.scrollTo(0, 0);
}

function onPop(e: PopStateEvent): void {
  const route = routeFromUrl(window.location.href, window.location.href);
  if (!route) {
    window.location.reload();          // 回退出了前台白名单 → 整页兜底
    return;
  }
  const u = new URL(window.location.href);
  applyRoute(route, u, metaCache.get(u.pathname + u.search) || {}, false);
  const y = Number((e.state as { spaScroll?: unknown } | null)?.spaScroll);
  requestAnimationFrame(() => {
    window.scrollTo(0, Number.isFinite(y) && y > 0 ? y : 0);
  });
}

/**
 * App.vue onMounted 调用一次。onNavigate:每次站内切页后的回调
 * (访客统计 PV 记账,与旧整页加载语义对齐)。
 */
export function initSpaNav(onNavigate?: () => void): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  onNavigateCb = onNavigate || null;
  // 接管滚动:浏览器原生的 history scroll restoration 会被视图重挂打乱
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  metaCache.set(
    window.location.pathname + window.location.search,
    { title: document.title, description: document.querySelector('meta[name="description"]')?.getAttribute('content') || undefined },
  );
  document.addEventListener('click', onClick);
  document.addEventListener('pointerover', onPointerOver, { passive: true });
  document.addEventListener('focusin', onFocusIn);
  window.addEventListener('popstate', onPop);
  scheduleChunkWarmup();
}
