#!/usr/bin/env node
/* ============================================================
 * V-Showcase 图库体检(audit)— 直连图床全字段核查
 * ------------------------------------------------------------
 * 与 Manager 的 /api/proxy-images 不同,本脚本直连图床 API
 * (网站清单保持精简,不做字段投影),拿到全量元数据后:
 *
 *   1. 分页拉全量列表(上游单页硬上限 40 张,last_page 决定页数)
 *   2. 逐张 Range GET 前 16 字节:验活 + 嗅探真实格式
 *      (只取字节头即断开,绝不整张下载)
 *   3. 按 md5 分组找重复
 *   4. 标记伪装图(扩展名/ mimetype 与 magic bytes 不符,如 webp 伪装 .jpg)
 *   5. 缺宽高/大小等元数据的列出来
 *
 * 报告:控制台汇总 + JSON 写 tools/audit-report.json(已 gitignore),
 * 条目带 delete_url,处理时直接用。
 *
 * 用法:
 *   node audit-images.mjs                    # 全量体检
 *   node audit-images.mjs --concurrency=8    # 并发探测(默认 6)
 *   node audit-images.mjs --skip-ping        # 只查元数据,不验活
 *   node audit-images.mjs --no-thumbs        # 跳过缩略图验活
 *   node audit-images.mjs --max-pages=10     # 页数保险丝(默认 50)
 * ============================================================ */
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readViewerConfig, readLocalSecret } from './server/lib/config-reader.mjs';
import { httpGet, apiGet, pMap, sniffFormat } from './server/lib/net-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(__dirname);
const OUT_DEFAULT = path.join(TOOLS, 'audit-report.json');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const CONCURRENCY = Math.max(1, Math.min(16, Number(args.concurrency) || 6));
const SKIP_PING = !!args['skip-ping'];
const NO_THUMBS = !!args['no-thumbs'];
const MAX_PAGES = Math.max(1, Math.min(200, Number(args['max-pages']) || 50));
const OUT = typeof args.out === 'string' ? path.resolve(args.out) : OUT_DEFAULT;

function log(emoji, msg) {
  console.log(`${emoji} ${msg}`);
}
function progress(cur, total, msg) {
  process.stdout.write(`\r📡 [${cur}/${total}] ${msg.padEnd(44, ' ')}`);
  if (cur >= total) process.stdout.write('\n');
}

/** 探测一张图:Range GET 前 16 字节 → 存活状态 + 真实格式(绝不整张下载)。
 *  >=400 时复核一次(CDN 边缘偶发抖动不算死链)。 */
async function probeImage(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { status, headers, chunks } = await httpGet(
        url,
        { Range: 'bytes=0-15', 'User-Agent': 'V-ShowcaseAudit/1.0' },
        (chunks) => chunks.reduce((n, c) => n + c.length, 0) >= 16,
      );
      // 206(部分内容)/200(忽略 Range 的 CDN)都算活;416 = 范围越界但存在
      if (status === 206 || status === 200 || status === 416) {
        return { alive: true, status, format: sniffFormat(Buffer.concat(chunks)), contentType: headers['content-type'] || '' };
      }
      if (attempt === 0 && status >= 400) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      return { alive: false, status, format: null, contentType: '' };
    } catch (e) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      return { alive: false, status: 0, error: e.message, format: null, contentType: '' };
    }
  }
}

/** 嗅探格式 → 与扩展名同口径(jpeg 统一叫 jpg),避免误报 */
function canonicalFormat(sniffed) {
  return sniffed === 'jpeg' ? 'jpg' : sniffed;
}

/** 扩展名归一化(jpeg/jpg 同物) */
function canonicalExt(ext) {
  const e = (ext || '').toLowerCase();
  return e === 'jpeg' ? 'jpg' : e;
}

/** 带进度条的 pMap */
function pMapProgress(items, mapper, concurrency) {
  let done = 0;
  return pMap(items, async (item, idx) => {
    const r = await mapper(item, idx);
    done++;
    progress(done, items.length, '探测中...');
    return r;
  }, concurrency);
}

/* ── 主流程 ───────────────────────────────── */
async function main() {
  log('🔍', 'V-Showcase 图库体检(直连图床,全字段)');

  const cfg = await readViewerConfig();
  if (!cfg.apiBase || !cfg.listPath) throw new Error('未配置 apiBase/listPath');
  const token = cfg.token || await readLocalSecret('QUBU_TOKEN');
  if (cfg.authType !== 'none' && !token) {
    throw new Error('缺少 QUBU_TOKEN,请在项目根目录 .dev.vars 中配置');
  }
  const headers = { Accept: 'application/json' };
  if (token && cfg.authType === 'bearer') headers.Authorization = 'Bearer ' + token;
  else if (token && cfg.authType === 'header') headers[cfg.authKey] = (cfg.tokenPrefix || '') + token;

  // 1. 分页拉全量(单页硬上限 40,last_page 决定页数)
  const baseUrl = cfg.apiBase + cfg.listPath + '?order=newest';
  const first = await apiGet(`${baseUrl}&page=1&per_page=40`, headers);
  const inner = (first && first.data) || {};
  const items = Array.isArray(inner.data) ? inner.data.slice() : [];
  const total = Number(inner.total) || items.length;
  const lastPage = Math.min(MAX_PAGES, Number(inner.last_page) || 1);
  if (Number(inner.last_page) > MAX_PAGES) {
    log('⚠️', `上游共 ${inner.last_page} 页,--max-pages=${MAX_PAGES} 只取前 ${MAX_PAGES} 页`);
  }
  for (let p = 2; p <= lastPage; p++) {
    const page = await apiGet(`${baseUrl}&page=${p}&per_page=40`, headers);
    const more = page && page.data && page.data.data;
    if (Array.isArray(more)) items.push(...more);
  }
  log('📊', `列表拉取完成:上游 ${total} 张,实取 ${items.length} 张(${lastPage} 页)`);

  // 归一化条目(全字段保留 + 统一命名)
  const imgs = items.map((it) => ({
    key: it.key || '',
    name: it.name || '',
    originName: it.origin_name || '',
    url: (it.links && it.links.url) || '',
    thumb: (it.links && it.links.thumbnail_url) || '',
    deleteUrl: (it.links && it.links.delete_url) || '',
    sizeKb: Number(it.size) || 0,
    mimetype: it.mimetype || '',
    extension: canonicalExt(it.extension),
    md5: it.md5 || '',
    sha1: it.sha1 || '',
    width: Number(it.width) || 0,
    height: Number(it.height) || 0,
    date: it.date || '',
  })).filter((it) => it.url);

  // 2. 验活 + 嗅探格式(Range GET 16 字节)
  let pinged = null;
  if (!SKIP_PING) {
    log('📡', `开始探测 ${imgs.length} 张原图(并发 ${CONCURRENCY},每张只取 16 字节)`);
    const probeResults = await pMapProgress(imgs, (it) => probeImage(it.url), CONCURRENCY);
    pinged = new Map();
    imgs.forEach((it, i) => pinged.set(it.url, probeResults[i]));
  }

  // 3. 缩略图验活(站点主视图用的是缩略图,死缩略图同样致命)
  let thumbPinged = null;
  if (!SKIP_PING && !NO_THUMBS) {
    const withThumb = imgs.filter((it) => it.thumb);
    log('📡', `开始探测 ${withThumb.length} 张缩略图`);
    const r = await pMapProgress(withThumb, (it) => probeImage(it.thumb), CONCURRENCY);
    thumbPinged = new Map();
    withThumb.forEach((it, i) => thumbPinged.set(it.thumb, r[i]));
  }

  // ── 汇总 ──
  const dead = [];
  const thumbDead = [];
  const mislabeled = [];
  const missingMeta = [];
  const aliveOk = [];

  for (const it of imgs) {
    const ping = pinged ? pinged.get(it.url) : null;
    const tp = thumbPinged ? thumbPinged.get(it.thumb) : null;

    if (ping && !ping.alive) {
      dead.push({ key: it.key, name: it.name, url: it.url, status: ping.status, error: ping.error || '', date: it.date });
    }
    if (tp && !tp.alive) {
      thumbDead.push({ key: it.key, name: it.name, thumb: it.thumb, status: tp.status, error: tp.error || '' });
    }
    // 伪装图:extension 与真实格式不符(mimetype 也常被上游错标,以 magic bytes 为准)
    if (ping && ping.alive && ping.format && ping.format !== 'unknown') {
      const actual = canonicalFormat(ping.format);
      if (it.extension && it.extension !== actual) {
        mislabeled.push({
          key: it.key, name: it.name, url: it.url,
          extension: it.extension, mimetype: it.mimetype, actual,
          sizeKb: it.sizeKb, date: it.date,
        });
      }
    }
    if (!it.width || !it.height || !it.sizeKb) {
      missingMeta.push({ key: it.key, name: it.name, width: it.width, height: it.height, sizeKb: it.sizeKb, url: it.url });
    }
    if ((!ping || ping.alive) && (!tp || tp.alive) && it.width && it.height) aliveOk.push(it);
  }

  // 4. 重复组(md5 相同 = 同一文件传了多次)
  const byMd5 = new Map();
  for (const it of imgs) {
    if (!it.md5) continue;
    if (!byMd5.has(it.md5)) byMd5.set(it.md5, []);
    byMd5.get(it.md5).push(it);
  }
  const duplicates = [...byMd5.values()]
    .filter((g) => g.length >= 2)
    .map((g) => ({
      md5: g[0].md5,
      count: g.length,
      totalKb: g.reduce((n, it) => n + it.sizeKb, 0),
      items: g.map((it) => ({
        key: it.key, name: it.name, originName: it.originName, url: it.url,
        sizeKb: it.sizeKb, date: it.date, deleteUrl: it.deleteUrl,
      })),
    }))
    .sort((a, b) => b.count - a.count || b.totalKb - a.totalKb);

  // ── 报告 ──
  const report = {
    generatedAt: new Date().toISOString(),
    upstream: { total, fetched: imgs.length, pages: lastPage },
    summary: {
      ok: aliveOk.length,
      dead: dead.length,
      thumbDead: thumbDead.length,
      mislabeled: mislabeled.length,
      duplicateGroups: duplicates.length,
      duplicateExtraCopies: duplicates.reduce((n, d) => n + d.count - 1, 0),
      missingMeta: missingMeta.length,
    },
    dead, thumbDead, mislabeled, duplicates, missingMeta,
  };
  fsSync.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

  const s = report.summary;
  log('', '');
  log('📋', '══════════ 体检报告 ══════════');
  log('📊', `共 ${imgs.length} 张;健康 ${s.ok};死链 ${s.dead};缩略图死链 ${s.thumbDead};伪装图 ${s.mislabeled};重复组 ${s.duplicateGroups}(多余副本 ${s.duplicateExtraCopies} 张);缺元数据 ${s.missingMeta}`);

  if (dead.length) {
    log('💀', `原图死链 ${dead.length} 条:`);
    for (const d of dead) log('   ', `[${d.status || d.error}] ${d.name} → ${d.url}`);
  }
  if (thumbDead.length) {
    log('💀', `缩略图死链 ${thumbDead.length} 条:`);
    for (const d of thumbDead) log('   ', `[${d.status || d.error}] ${d.name} → ${d.thumb}`);
  }
  if (mislabeled.length) {
    log('🎭', `伪装图 ${mislabeled.length} 张(扩展名 ≠ 真实格式):`);
    const byCombo = new Map();
    for (const m of mislabeled) {
      const k = `${m.extension} → ${m.actual}`;
      if (!byCombo.has(k)) byCombo.set(k, []);
      byCombo.get(k).push(m);
    }
    for (const [combo, list] of byCombo) {
      log('   ', `${combo}: ${list.length} 张,例如 ${list[0].name}(${list[0].sizeKb}KB)`);
    }
  }
  if (duplicates.length) {
    log('👯', `重复组 ${duplicates.length} 组(每组列出全部副本,可择一保留):`);
    for (const d of duplicates) {
      log('   ', `md5=${d.md5.slice(0, 8)}… ×${d.count}(${d.totalKb.toFixed(0)}KB):`);
      for (const it of d.items) {
        log('    ', `· ${it.name} | 原名:${it.originName} | ${it.sizeKb}KB | ${it.date} | key=${it.key}`);
      }
    }
  }
  if (missingMeta.length) {
    log('❓', `缺元数据 ${missingMeta.length} 张(宽高/大小为 0,批量预设焦点会当方图处理):`);
    for (const m of missingMeta.slice(0, 10)) log('   ', `${m.name}(w=${m.width} h=${m.height} kb=${m.sizeKb})`);
    if (missingMeta.length > 10) log('   ', `…其余 ${missingMeta.length - 10} 条见 JSON 报告`);
  }

  log('💾', `完整报告(含 delete_url)已写入 ${path.relative(process.cwd(), OUT)}`);
  log('🎉', '体检完成');
}

main().catch((e) => {
  console.error('❌ 失败:', e);
  process.exit(1);
});
