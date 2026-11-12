/* ============================================================
 * 非主页图片蒙版背景 — 选图与 URL 安全处理(纯函数,可单测)
 * ------------------------------------------------------------
 * 背景图取自主页图片墙的同一图池(loadImages 的清单),
 * 按页面键做稳定哈希选一张:同一页面每次进都是同一张,
 * 不同页面 / 不同文章各取各的(哈希散得够开,不会撞)。
 *
 * ⚠ URL 必须过白名单:
 *   清单来自上游图床 API,理论上可被篡改。直接拼进 CSS url()
 *   一旦是 javascript: / data: 就是注入面。这里只放行 http(s),
 *   并用 JSON.stringify 生成带引号的安全字符串(内部引号/反斜杠被转义)。
 * ============================================================ */
import type { Image } from '@/shared/types';

/** FNV-1a 32 位哈希:稳定、无依赖、够散 */
export function backdropHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 按页面键从图池稳定选一张(空池 → null) */
export function pickBackdropImage(images: Image[], key: string): Image | null {
  if (!images.length) return null;
  const idx = backdropHash(key) % images.length;
  return images[idx] ?? null;
}

/** 背景图取哪个地址:优先缩略图(主页墙已经缓存过,几乎零成本),没有则用原图 */
export function backdropSrc(img: Image | null): string {
  if (!img) return '';
  return img.thumb || img.url || '';
}

/** 背景图地址 → 安全的 CSS background-image 值(非 http(s) → 空串) */
export function safeBackgroundImage(raw: string): string {
  if (!raw) return '';
  let u: URL;
  try {
    u = new URL(raw, typeof location !== 'undefined' ? location.href : 'https://localhost/');
  } catch {
    return '';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  // JSON.stringify 生成带引号的字符串:内部引号/反斜杠被转义,拼不进第二个 url()
  return `url(${JSON.stringify(u.href)})`;
}
