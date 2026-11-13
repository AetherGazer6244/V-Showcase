/* ============================================================
 * 上传管线 · 服务端对账与验活
 * ------------------------------------------------------------
 * 上传管线第二、三道闸:
 *   ① 对账:拿上传文件的 md5 与图床目录比对,命中就直接复用已有外链,
 *      不再上传 —— 对应 lessons-learned 1.2「批量上传产生重复 URL」。
 *   ② 验活:上传成功后拉一下返回的外链,确认真的能取到图片 ——
 *      对应 lessons-learned 1.1「原图死链,缩略图却正常」。
 *
 * 纯函数部分(建索引/查找)不依赖网络,可在 tools/test 里直接单测。
 * ============================================================ */
import { httpGet, sniffFormat } from './net-utils.mjs';

/**
 * 用图床目录建 md5 → 图片 的索引。
 * @param {Array<Record<string, any>>} items 图床目录原始条目(需带 md5 字段)
 * @returns {Map<string, {url: string, name: string}>}
 */
export function buildMd5Index(items) {
  const map = new Map();
  if (!Array.isArray(items)) return map;
  for (const it of items) {
    const md5 = String((it && it.md5) || '').trim().toLowerCase();
    if (!md5) continue;
    const url = String((it.links && it.links.url) || '').trim();
    if (!url) continue;
    // 同 md5 已在索引里 → 保留先出现的(目录按 newest 排序,先出现的更新)
    if (!map.has(md5)) map.set(md5, { url, name: String(it.origin_name || '') });
  }
  return map;
}

/**
 * 在索引里查 md5。
 * @returns {{url: string, name: string} | null}
 */
export function lookupByMd5(index, md5) {
  if (!index || typeof index.get !== 'function') return null;
  const key = String(md5 || '').trim().toLowerCase();
  if (!key) return null;
  return index.get(key) || null;
}

/**
 * 验活:GET 外链的前 16 字节,确认「真的能取到一张图」。
 *
 * 判定分三档,刻意区分「确定死了」和「网络不通」:
 *   ok:true                —— 200/206 且内容确实是图片
 *   ok:false, uncertain:false —— HTTP 4xx/5xx 或内容不是图片 → 确定不可用
 *   ok:false, uncertain:true  —— DNS/超时/连接中断 → 本地网络问题,不下结论
 *
 * ⚠️ 绝不能把「本地 DNS 解析失败」当成「图片死了」——本机校园网对
 * 部分域名间歇性解析失败(lessons-learned 3.1),那样会把好图误判成坏图。
 *
 * @param {string} url 原图外链
 * @returns {Promise<{ok: boolean, status: number, uncertain: boolean, error?: string, format?: string}>}
 */
export async function verifyImageAlive(url) {
  if (!url) return { ok: false, status: 0, uncertain: false, error: '外链为空' };
  try {
    const res = await httpGet(url, { Range: 'bytes=0-15' }, (chunks) => {
      let n = 0;
      for (const c of chunks) n += c.length;
      return n >= 16;
    });
    const status = res.status;
    if (status < 200 || status >= 400) {
      return { ok: false, status, uncertain: false, error: 'HTTP ' + status };
    }
    const head = Buffer.concat(res.chunks).subarray(0, 16);
    const format = sniffFormat(head);
    if (format === 'unknown') {
      // 200 但不是图片(常见:CDN 返回 HTML 错误页/占位页)
      return { ok: false, status, uncertain: false, error: '返回内容不是图片', format };
    }
    return { ok: true, status, uncertain: false, format };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      uncertain: true,
      error: (e && e.message) || String(e),
    };
  }
}
