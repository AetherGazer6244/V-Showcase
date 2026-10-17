/* ============================================================
 * 共享网络工具 — 供 audit-images.mjs / ai/build-focal-points.mjs 使用
 * ------------------------------------------------------------
 * - resilientLookup: 系统 DNS 失败(如校园网对部分域名间歇性
 *   Server failed / EAI_AGAIN)时,换公共 DNS 兜底解析
 * - httpGet: 跟随重定向(≤3 次),支持流式提前断开(探针只取字节头)
 * - apiGet: JSON API GET
 * - pMap: 固定并发跑数组
 * - sniffFormat: magic bytes 嗅探真实图片格式
 * ============================================================ */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';

const fallbackResolver = new dns.Resolver();
fallbackResolver.setServers(['223.5.5.5', '119.29.29.29', '8.8.8.8']);

export function resilientLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, ...rest) => {
    if (!err) return callback(null, ...rest);
    fallbackResolver.resolve4(hostname, (e2, addrs) => {
      if (e2 || !addrs || addrs.length === 0) return callback(err, ...rest);
      if (options && options.all) {
        return callback(null, addrs.map((a) => ({ address: a, family: 4 })));
      }
      callback(null, addrs[0], 4);
    });
  });
}

/** GET 请求(跟随重定向 ≤3 次),支持流式提前断开。
 *  onData(chunks, res) 返回 true 表示字节已够,立即断开连接。 */
export function httpGet(url, headers, onData, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers, timeout: 20000, lookup: resilientLookup }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) return reject(new Error(`重定向过多(>3): ${url}`));
        const next = new URL(res.headers.location, url).toString();
        return resolve(httpGet(next, headers, onData, redirects + 1));
      }
      const chunks = [];
      let closed = false;
      res.on('data', (c) => {
        if (closed) return;
        chunks.push(c);
        if (onData && onData(chunks, res) === true) {
          closed = true;
          res.destroy();
          resolve({ status: res.statusCode, headers: res.headers, chunks, truncated: true });
        }
      });
      res.on('end', () => {
        if (!closed) resolve({ status: res.statusCode, headers: res.headers, chunks, truncated: false });
      });
      res.on('error', (e) => {
        if (!closed) reject(e);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

/** 图床 API JSON GET(带状态码校验) */
export function apiGet(url, headers) {
  return httpGet(url, headers, null).then(({ status, chunks }) => {
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  });
}

/** 下载完整文件为 Buffer(跟随重定向) */
export function downloadBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 30000, lookup: resilientLookup }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) return reject(new Error(`重定向过多(>3): ${url}`));
        const next = new URL(res.headers.location, url).toString();
        return resolve(downloadBuffer(next, redirects + 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume(); return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

/** 固定并发跑数组,保序返回结果 */
export async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let cur = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = cur++;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/** magic bytes 嗅探真实图片格式(16 字节足够) */
export function sniffFormat(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' &&
      buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf.slice(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand.startsWith('avi')) return 'avif';
    if (brand.startsWith('hei') || brand.startsWith('msf')) return 'heic';
    return 'isobmff';
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  return 'unknown';
}
