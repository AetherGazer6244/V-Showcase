/* ============================================================
 * MD5 — 纯 JS 实现(不引第三方包)
 * ------------------------------------------------------------
 * 用途:上传前算文件 md5,交给本地服务与图床目录对账
 * (图床 Lsky Pro 的目录接口每条记录带 md5 字段,内容相同 → md5 相同,
 *  正是 lessons-learned 1.2「批量上传产生重复 URL」的对账依据)。
 *
 * 为什么不用 WebCrypto:crypto.subtle.digest 只支持 SHA-1/256/384/512,
 * 没有 MD5;图床给的是 md5,对不上就没法按内容去重。
 * 为什么不引依赖:仓库坚持零运行时依赖(package.json 只有 vue),
 * MD5 是公开的固定算法,自己实现没有维护负担。
 *
 * ⚠️ MD5 已不抗碰撞,这里只用于「本地内容去重」,不做任何安全用途。
 * ============================================================ */

/** 每轮的左移位数(RFC 1321) */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** K[i] = floor(abs(sin(i+1)) × 2^32) */
const K = (() => {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  return k;
})();

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

/** 计算 MD5 摘要(16 字节) */
export function md5Bytes(input: Uint8Array): Uint8Array {
  const origLen = input.length;
  const bitLen = origLen * 8;
  // 填充:0x80 + 若干 0 + 8 字节小端长度,总长为 64 的倍数
  const padded = new Uint8Array(Math.ceil((origLen + 9) / 64) * 64);
  padded.set(input);
  padded[origLen] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const m = new Uint32Array(16);

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let j = 0; j < 16; j++) m[j] = view.getUint32(chunk + j * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + K[i] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(f, SHIFTS[i])) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true);
  ov.setUint32(4, b0, true);
  ov.setUint32(8, c0, true);
  ov.setUint32(12, d0, true);
  return out;
}

/** 计算 MD5 十六进制小写字符串(32 位) */
export function md5Hex(input: Uint8Array): string {
  const bytes = md5Bytes(input);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}
