/* ============================================================
 * 上传前图片体检 —— 纯函数测试
 * (magic bytes 嗅探 / 名实不符改名 / md5 内容摘要)
 * ============================================================ */
import { describe, it, expect } from 'vitest';

import { md5Hex } from './md5';
import {
  sniffFormat,
  fixFileName,
  extOf,
  canonicalExt,
  mimeOf,
  formatLabel,
  UPLOADABLE_FORMATS,
} from './imageGuard';

/* ── 测试用字节构造 ── */
const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));
const jpegBytes = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const pngBytes = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const webpBytes = new Uint8Array([
  ...Array.from('RIFF', (c) => c.charCodeAt(0)),
  0x20, 0x00, 0x00, 0x00,
  ...Array.from('WEBP', (c) => c.charCodeAt(0)),
]);
const gifBytes = ascii('GIF89a');
const avifBytes = new Uint8Array([
  0x00, 0x00, 0x00, 0x20,
  ...Array.from('ftyp', (c) => c.charCodeAt(0)),
  ...Array.from('avif', (c) => c.charCodeAt(0)),
]);
const heicBytes = new Uint8Array([
  0x00, 0x00, 0x00, 0x20,
  ...Array.from('ftyp', (c) => c.charCodeAt(0)),
  ...Array.from('heic', (c) => c.charCodeAt(0)),
]);

describe('md5Hex', () => {
  it('标准向量(RFC 1321 附录 A.5)', () => {
    expect(md5Hex(new Uint8Array(0))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex(ascii('a'))).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5Hex(ascii('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex(ascii('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5Hex(ascii('abcdefghijklmnopqrstuvwxyz'))).toBe('c3fcd3d76192e4007dfb496cca67e13b');
  });

  it('跨块长度(80 字节,验证多轮填充与长度域)', () => {
    expect(md5Hex(ascii('1234567890'.repeat(8)))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('内容不同 → 摘要不同(对账的基础)', () => {
    expect(md5Hex(ascii('abc'))).not.toBe(md5Hex(ascii('abd')));
  });
});

describe('sniffFormat', () => {
  it('识别常见图片格式', () => {
    expect(sniffFormat(jpegBytes)).toBe('jpeg');
    expect(sniffFormat(pngBytes)).toBe('png');
    expect(sniffFormat(webpBytes)).toBe('webp');
    expect(sniffFormat(gifBytes)).toBe('gif');
    expect(sniffFormat(avifBytes)).toBe('avif');
    expect(sniffFormat(heicBytes)).toBe('heic');
  });

  it('非图片字节 → unknown', () => {
    expect(sniffFormat(bytes(0x25, 0x50, 0x44, 0x46))).toBe('unknown'); // %PDF
    expect(sniffFormat(new Uint8Array(0))).toBe('unknown');
  });

  it('可上传格式白名单只含 jpeg/png/webp/gif/avif', () => {
    expect([...UPLOADABLE_FORMATS]).toEqual(['jpeg', 'png', 'webp', 'gif', 'avif']);
    expect(UPLOADABLE_FORMATS).not.toContain('heic');
    expect(UPLOADABLE_FORMATS).not.toContain('unknown');
  });
});

describe('fixFileName', () => {
  it('webp 字节伪装 .jpg → 改名成 .webp(lessons-learned 1.3)', () => {
    const r = fixFileName('IMG_20201017.webp.jpg', 'webp');
    expect(r.changed).toBe(true);
    expect(r.name).toBe('IMG_20201017.webp.webp');
  });

  it('名实相符 → 不改', () => {
    expect(fixFileName('a.jpg', 'jpeg')).toEqual({ name: 'a.jpg', changed: false });
    expect(fixFileName('a.jpeg', 'jpeg')).toEqual({ name: 'a.jpeg', changed: false });
    expect(fixFileName('a.png', 'png')).toEqual({ name: 'a.png', changed: false });
    expect(fixFileName('a.webp', 'webp')).toEqual({ name: 'a.webp', changed: false });
  });

  it('无扩展名 → 补上规范扩展名', () => {
    const r = fixFileName('screenshot', 'png');
    expect(r.changed).toBe(true);
    expect(r.name).toBe('screenshot.png');
  });

  it('未知格式 → 原样返回', () => {
    expect(fixFileName('x.bin', 'unknown')).toEqual({ name: 'x.bin', changed: false });
  });
});

describe('辅助函数', () => {
  it('extOf 取小写扩展名', () => {
    expect(extOf('a.JPG')).toBe('jpg');
    expect(extOf('a')).toBe('');
    expect(extOf('a.')).toBe('');
  });

  it('canonicalExt / mimeOf 映射正确', () => {
    expect(canonicalExt('jpeg')).toBe('jpg');
    expect(canonicalExt('webp')).toBe('webp');
    expect(canonicalExt('unknown')).toBe('');
    expect(mimeOf('jpeg')).toBe('image/jpeg');
    expect(mimeOf('avif')).toBe('image/avif');
    expect(mimeOf('unknown')).toBe('');
  });

  it('formatLabel 可读', () => {
    expect(formatLabel('webp')).toBe('WebP');
    expect(formatLabel('unknown')).toBe('未知格式');
  });
});
