/* ============================================================
 * 上传前图片体检(浏览器侧)
 * ------------------------------------------------------------
 * 上传管线第一道闸:不信扩展名,只信文件头字节。
 *
 * 为什么:lessons-learned 1.3「WebP 字节伪装 .jpg」——
 * 2026-10-17 批量上传的图约 7/8 实际是 WebP,扩展名却是 .jpg、
 * Content-Type 还是 image/jpeg。老 Safari(iOS ≤13)直接挂,
 * 而且事后只有靠 audit-images.mjs 体检才发现。
 * 现在上传前就地修正扩展名,从源头不再产生伪装图。
 *
 * 字节判定逻辑与 tools/server/lib/net-utils.mjs 的 sniffFormat 保持一致
 * (服务端体检用同一套判定,避免两端口径不同)。
 * ============================================================ */

export type ImageFormat =
  | 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'heic' | 'bmp' | 'unknown';

/** 允许上传的格式(其余一律拒绝:浏览器无法预览,图床也不收录) */
export const UPLOADABLE_FORMATS: readonly ImageFormat[] = ['jpeg', 'png', 'webp', 'gif', 'avif'];

/** 各格式可接受的扩展名(在列表内 = 名副其实,不改名) */
const ACCEPTED_EXT: Record<Exclude<ImageFormat, 'unknown'>, string[]> = {
  jpeg: ['jpg', 'jpeg'],
  png: ['png'],
  webp: ['webp'],
  gif: ['gif'],
  avif: ['avif'],
  heic: ['heic', 'heif'],
  bmp: ['bmp'],
};

/** 各格式的规范扩展名(改名前用) */
const CANONICAL_EXT: Record<Exclude<ImageFormat, 'unknown'>, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  avif: 'avif',
  heic: 'heic',
  bmp: 'bmp',
};

/** 各格式的标准 MIME(改名时一并纠正 file.type) */
const MIME: Record<Exclude<ImageFormat, 'unknown'>, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  bmp: 'image/bmp',
};

/** magic bytes 嗅探真实格式(前 16 字节足够) */
export function sniffFormat(buf: Uint8Array): ImageFormat {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12
    && String.fromCharCode(...buf.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...buf.subarray(8, 12)) === 'WEBP') return 'webp';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && String.fromCharCode(...buf.subarray(0, 3)) === 'GIF') return 'gif';
  if (buf.length >= 12 && String.fromCharCode(...buf.subarray(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...buf.subarray(8, 12));
    if (brand.startsWith('avi')) return 'avif';
    if (brand.startsWith('hei') || brand.startsWith('msf')) return 'heic';
    return 'unknown';
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  return 'unknown';
}

/** 取文件名的小写扩展名(无扩展名返回空串) */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i < 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

/** 规范扩展名(unknown 返回空串) */
export function canonicalExt(format: ImageFormat): string {
  return format === 'unknown' ? '' : CANONICAL_EXT[format];
}

/** 规范 MIME(unknown 返回空串) */
export function mimeOf(format: ImageFormat): string {
  return format === 'unknown' ? '' : MIME[format];
}

/** 该格式是否在「可接受扩展名」白名单内 */
export function extMatches(format: ImageFormat, ext: string): boolean {
  if (format === 'unknown') return false;
  return ACCEPTED_EXT[format].includes(ext);
}

/**
 * 文件名与真实格式不符时,给出修正后的文件名。
 * @returns name 修正后的文件名;changed 是否发生了修改
 */
export function fixFileName(name: string, format: ImageFormat): { name: string; changed: boolean } {
  if (format === 'unknown') return { name, changed: false };
  const ext = extOf(name);
  if (extMatches(format, ext)) return { name, changed: false };
  const canonical = CANONICAL_EXT[format];
  const base = ext ? name.slice(0, name.length - ext.length - 1) : name;
  return { name: `${base}.${canonical}`, changed: true };
}

/** 内容摘要(SHA-256,批内去重用);环境不支持时返回空串 */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // 非安全上下文(如用局域网 IP 访问)没有 subtle,批内去重降级为不做
    return '';
  }
}

/** 给人看的格式名 */
export function formatLabel(format: ImageFormat): string {
  switch (format) {
    case 'jpeg': return 'JPEG';
    case 'png': return 'PNG';
    case 'webp': return 'WebP';
    case 'gif': return 'GIF';
    case 'avif': return 'AVIF';
    case 'heic': return 'HEIC';
    case 'bmp': return 'BMP';
    default: return '未知格式';
  }
}
