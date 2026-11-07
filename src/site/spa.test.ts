/* ============================================================
 * spa.ts 单测 —— 站内 SPA 导航的路由推导 / 点击拦截 / 元数据解析
 * jsdom:window.location 提供基准 URL,锚点 href 相对解析可用
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import { routeFromUrl, willIntercept, parseMeta } from './spa';

const BASE = 'http://localhost:3000/';

describe('routeFromUrl 路由推导', () => {
  it('前台 8 视图:.html 与美化路径两种形态', () => {
    expect(routeFromUrl('/', BASE)).toEqual({ view: 'home', slug: '' });
    expect(routeFromUrl('/index.html', BASE)).toEqual({ view: 'home', slug: '' });
    expect(routeFromUrl('/blog.html', BASE)).toEqual({ view: 'blog', slug: '' });
    expect(routeFromUrl('/blog', BASE)).toEqual({ view: 'blog', slug: '' });
    expect(routeFromUrl('/gallery.html', BASE)).toEqual({ view: 'gallery', slug: '' });
    expect(routeFromUrl('/music.html', BASE)).toEqual({ view: 'music', slug: '' });
    expect(routeFromUrl('/music', BASE)).toEqual({ view: 'music', slug: '' });
    expect(routeFromUrl('/projects.html', BASE)).toEqual({ view: 'projects', slug: '' });
    expect(routeFromUrl('/settings.html', BASE)).toEqual({ view: 'settings', slug: '' });
    expect(routeFromUrl('/about.html', BASE)).toEqual({ view: 'about', slug: '' });
    expect(routeFromUrl('/about', BASE)).toEqual({ view: 'about', slug: '' });
  });

  it('文章静态页 /posts/<slug>/ 从路径提取 slug(含 /index.html 变体与 URL 编码)', () => {
    expect(routeFromUrl('/posts/demo/', BASE)).toEqual({ view: 'post', slug: 'demo' });
    expect(routeFromUrl('/posts/demo/index.html', BASE)).toEqual({ view: 'post', slug: 'demo' });
    expect(routeFromUrl('/posts/%E4%B8%AD%E6%96%87/', BASE)).toEqual({ view: 'post', slug: '中文' });
    expect(routeFromUrl('/posts/demo', BASE)).toEqual({ view: 'post', slug: 'demo' });
  });

  it('开发壳 post.html?slug= 从查询参数取 slug', () => {
    expect(routeFromUrl('/post.html?slug=hello-world', BASE)).toEqual({ view: 'post', slug: 'hello-world' });
    expect(routeFromUrl('/post.html', BASE)).toEqual({ view: 'post', slug: '' });
  });

  it('白名单之外一律 null(manager/api/资产/多段嵌套/外链/伪协议)', () => {
    expect(routeFromUrl('/manager.html', BASE)).toBeNull();
    expect(routeFromUrl('/api/logout', BASE)).toBeNull();
    expect(routeFromUrl('/api/likes?url=x', BASE)).toBeNull();
    expect(routeFromUrl('/sitemap.xml', BASE)).toBeNull();
    expect(routeFromUrl('/favicon.svg', BASE)).toBeNull();
    expect(routeFromUrl('/unknown-page', BASE)).toBeNull();
    expect(routeFromUrl('/posts/a/b/', BASE)).toBeNull();
    expect(routeFromUrl('https://7bu.top/api/v1/images', BASE)).toBeNull();
    expect(routeFromUrl('javascript:void(0)', BASE)).toBeNull();
    expect(routeFromUrl('not a url', BASE)).toBeNull();
  });

  it('相对 href 以 base 解析(根绝对正常;文章页里的相对链接解析进子目录 → 放行整页)', () => {
    const inPost = 'http://localhost:3000/posts/demo/';
    expect(routeFromUrl('/blog.html', inPost)).toEqual({ view: 'blog', slug: '' });
    expect(routeFromUrl('blog.html', inPost)).toBeNull();   // → /posts/demo/blog.html,交服务端 404
  });
});

/* willIntercept 的点击事件入参(结构化,真实 MouseEvent 天然满足) */
function clickOn(a: HTMLAnchorElement, extra: Partial<MouseEvent> = {}): MouseEvent {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: a,
    ...extra,
  } as unknown as MouseEvent;
}

/* 直接以元素为 target 构造(测 closest 冒泡:span 命中父级 a、div 无 a) */
function clickRaw(target: EventTarget | null): MouseEvent {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target,
  } as unknown as MouseEvent;
}

function makeAnchor(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  document.body.appendChild(a);
  return a;
}

describe('willIntercept 点击拦截判定', () => {
  it('前台内链:拦截(含嵌套元素的 closest 冒泡)', () => {
    const a = makeAnchor('/blog.html');
    const span = document.createElement('span');
    a.appendChild(span);
    expect(willIntercept(clickOn(a))).toBe(true);
    expect(willIntercept(clickRaw(span))).toBe(true);   // span → closest → 父级 a
  });

  it('修饰键/右键/已阻止默认 → 放行(浏览器接管新标签等)', () => {
    const a = makeAnchor('/blog.html');
    expect(willIntercept(clickOn(a, { ctrlKey: true }))).toBe(false);
    expect(willIntercept(clickOn(a, { metaKey: true }))).toBe(false);
    expect(willIntercept(clickOn(a, { button: 2 }))).toBe(false);
    expect(willIntercept(clickOn(a, { defaultPrevented: true }))).toBe(false);
  });

  it('新标签/下载/external/页内锚点/空链 → 放行', () => {
    expect(willIntercept(clickOn(makeAnchor('/blog.html', { target: '_blank' })))).toBe(false);
    expect(willIntercept(clickOn(makeAnchor('/blog.html', { download: 'x' })))).toBe(false);
    expect(willIntercept(clickOn(makeAnchor('/blog.html', { rel: 'external' })))).toBe(false);
    expect(willIntercept(clickOn(makeAnchor('#toc')))).toBe(false);
    expect(willIntercept(clickOn(makeAnchor('')))).toBe(false);
  });

  it('同路径+同查询(仅 hash 差异)→ 放行给平滑滚动;跨页 hash → 拦截', () => {
    window.history.replaceState(null, '', BASE);
    expect(willIntercept(clickOn(makeAnchor('/#intro')))).toBe(false);
    expect(willIntercept(clickOn(makeAnchor('/blog.html#x')))).toBe(true);
  });

  it('白名单之外(manager/api/外链)→ 放行整页', () => {
    expect(willIntercept(clickOn(makeAnchor('/manager.html')))).toBe(false);
    expect(willIntercept(clickOn(makeAnchor('/api/logout')))).toBe(false);
    expect(willIntercept(clickOn(makeAnchor('https://example.com/x')))).toBe(false);
    expect(willIntercept(clickRaw(document.createElement('div')))).toBe(false);
  });
});

describe('parseMeta 元数据解析', () => {
  it('提取 title 与 description', () => {
    const html = '<html><head><title>音乐 · V-Showcase</title>'
      + '<meta name="description" content="云端乐律 — 全站常驻播放"></head></html>';
    expect(parseMeta(html)).toEqual({ title: '音乐 · V-Showcase', description: '云端乐律 — 全站常驻播放' });
  });

  it('缺失字段返回 undefined 而不是抛错', () => {
    expect(parseMeta('<html><head></head></html>')).toEqual({});
    expect(parseMeta('')).toEqual({});
  });
});
