#!/usr/bin/env node
/* ============================================================
 * V-Showcase — AI 批量焦点分析工具
 * ------------------------------------------------------------
 * 用 @vladmandic/face-api 检测每张图的人脸,
 * 自动生成 viewer 的 src/site/focalPoints.ts。
 *
 * 用法:
 *   node ai/build-focal-points.mjs
 *   node ai/build-focal-points.mjs --strategy=max        (默认,最大脸)
 *   node ai/build-focal-points.mjs --strategy=center     (所有人脸包围盒中心)
 *   node ai/build-focal-points.mjs --source=fallback     (默认,从 config.js 的兜底图)
 *   node ai/build-focal-points.mjs --source=upstream     (从 config.js 的图床拉)
 *   node ai/build-focal-points.mjs --concurrency=4       (并发下载数,默认 4)
 *   node ai/build-focal-points.mjs --limit=10            (只处理前 N 张,试跑用)
 *   node ai/build-focal-points.mjs --no-write            (只报告,不写 focalPoints.ts)
 *   node ai/build-focal-points.mjs --download-only       (只下载模型,不分析)
 *
 * 运行底座(WASM,不挑 Node 版本):
 *   face-api 用 dist/face-api.node-wasm.js 变体 —— 只依赖
 *   @tensorflow/tfjs + @tensorflow/tfjs-backend-wasm(纯 WASM),
 *   不再需要 @tensorflow/tfjs-node 的原生二进制(那玩意没有 Node 25
 *   预编译版,是本工具此前从未跑通过的根本原因)。
 *   WASM 初始化失败时自动退回 cpu 后端(纯 JS,更慢但可用)。
 *   图片解码用 sharp(prebuilt,无编译),因为 tf.node.decodeImage 只有
 *   tfjs-node 才有。
 *
 * 首次运行:自动下载 face-api 模型到 ../weights/(约 6MB)
 * ============================================================ */
import faceapi from '@vladmandic/face-api/dist/face-api.node-wasm.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import {
  readViewerConfig,
  writeFocalPoints,
  readFocalPoints,
  mergeFocalPoints,
  readLocalSecret,
  getByPath,
} from '../server/lib/config-reader.mjs';
import { apiGet, downloadBuffer, pMap } from '../server/lib/net-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(__dirname, '..');
const VIEWER = path.resolve(TOOLS, '..');
const WEIGHTS = path.join(TOOLS, 'weights');

// ── CLI 参数 ─────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [];
  })
);
const STRATEGY     = (args.strategy === 'center' ? 'center' : 'max');
const SOURCE       = (args.source === 'upstream' ? 'upstream' : 'fallback');
const CONCURRENCY  = Math.max(1, Math.min(16, Number(args.concurrency) || 4));
const DOWNLOAD_ONLY = !!args['download-only'];
const LIMIT        = Math.max(0, Number(args.limit) || 0);
const NO_WRITE     = !!args['no-write'];

function log(emoji, msg) {
  console.log(`${emoji} ${msg}`);
}
function progress(cur, total, msg) {
  process.stdout.write(`\r🧠 [${cur}/${total}] ${msg.padEnd(40, ' ')}`);
  if (cur === total) process.stdout.write('\n');
}

// ── 模型权重 ─────────────────────────────────────
// @vladmandic/face-api 的 npm 包自带全部模型(node_modules/…/model/),
// 直接用即可 —— 零下载,也不依赖 github 可达性。
const NPM_MODEL_DIR = path.join(TOOLS, 'node_modules', '@vladmandic', 'face-api', 'model');

// 兜底:npm 包缺失模型时才去网上下。jsDelivr 在前(raw.githubusercontent
// 在部分网络不可达,曾让本工具第一次运行就卡死在这)。
const WEIGHT_FILES = [
  { name: 'ssd_mobilenetv1_model-weights_manifest.json' },
  { name: 'ssd_mobilenetv1_model.bin' },
  { name: 'face_landmark_68_model-weights_manifest.json' },
  { name: 'face_landmark_68_model.bin' },
];
const WEIGHT_MIRRORS = [
  (f) => `https://cdn.jsdelivr.net/gh/vladmandic/face-api@master/model/${f}`,
  (f) => `https://raw.githubusercontent.com/vladmandic/face-api/master/model/${f}`,
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(downloadFile(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        reject(new Error(url + ' HTTP ' + res.statusCode));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      const file = fsSync.createWriteStream(dest);
      let received = 0;
      res.pipe(file);
      res.on('data', (c) => {
        received += c.length;
        if (total) {
          const pct = (received / total * 100).toFixed(1);
          process.stdout.write(`\r📥 ${path.basename(dest)}: ${received}/${total} (${pct}%)`);
        }
      });
      file.on('finish', () => {
        process.stdout.write('\n');
        file.close(() => resolve());
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureWeights() {
  fsSync.mkdirSync(WEIGHTS, { recursive: true });
  log('📦', `准备 face-api 模型到 ${WEIGHTS}`);
  for (const f of WEIGHT_FILES) {
    const dest = path.join(WEIGHTS, f.name);
    if (fsSync.existsSync(dest) && fsSync.statSync(dest).size > 0) {
      log('✓', `已存在: ${f.name}`);
      continue;
    }
    let done = false;
    for (const mirror of WEIGHT_MIRRORS) {
      log('⬇️ ', `下载: ${mirror(f.name)}`);
      try {
        await downloadFile(mirror(f.name), dest);
        log('✅', `完成: ${f.name}`);
        done = true;
        break;
      } catch (e) {
        log('❌', `失败: ${f.name} - ${e.message}`);
      }
    }
    if (!done) throw new Error(`模型文件下载失败(所有镜像): ${f.name}`);
  }
}

/** 模型目录:npm 包自带优先,缺失时才下载到 tools/weights/ */
async function resolveWeightsDir() {
  const need = ['ssd_mobilenetv1_model-weights_manifest.json', 'face_landmark_68_model-weights_manifest.json'];
  if (need.every((f) => fsSync.existsSync(path.join(NPM_MODEL_DIR, f)))) {
    log('📦', `使用 npm 包自带模型: ${NPM_MODEL_DIR}`);
    return NPM_MODEL_DIR;
  }
  await ensureWeights();
  return WEIGHTS;
}

// ── 收集图片 URL ─────────────────────────────────
// 上游图床单页硬上限 40 张,per_page 再大也只回 40 —— 必须按
// last_page 分页拉全(此前没分页,--source=upstream 只能拿到最新 40 张)
async function collectUrls() {
  const cfg = await readViewerConfig();
  if (SOURCE === 'fallback') {
    log('📂', `数据源: viewer 的 fallbackImages(${cfg.fallbackImages.length} 张)`);
    return cfg.fallbackImages.map((u, i) => ({ url: u, name: `fallback-${i}` }));
  }

  if (!cfg.apiBase || !cfg.listPath) {
    log('⚠️', '未配置 apiBase/listPath,回退到 fallbackImages');
    return cfg.fallbackImages.map((u, i) => ({ url: u, name: `fallback-${i}` }));
  }

  const token = cfg.token || await readLocalSecret('QUBU_TOKEN');
  if (cfg.authType !== 'none' && !token) {
    throw new Error('缺少 QUBU_TOKEN，请在 viewer 根目录 .dev.vars 中配置');
  }

  const headers = { Accept: 'application/json' };
  if (token && cfg.authType === 'bearer') {
    headers.Authorization = 'Bearer ' + token;
  } else if (token && cfg.authType === 'header') {
    headers[cfg.authKey] = (cfg.tokenPrefix || '') + token;
  }

  const baseUrl = cfg.apiBase + cfg.listPath + '?order=newest';
  const first = await apiGet(`${baseUrl}&page=1&per_page=40`, headers);
  const inner = (first && first.data) || {};
  const rawItems = Array.isArray(inner.data) ? inner.data.slice() : [];
  const lastPage = Math.min(200, Number(inner.last_page) || 1);
  if (Number(inner.last_page) > lastPage) {
    log('⚠️', `上游共 ${inner.last_page} 页,只取前 ${lastPage} 页`);
  }
  for (let p = 2; p <= lastPage; p++) {
    const page = await apiGet(`${baseUrl}&page=${p}&per_page=40`, headers);
    const more = page && page.data && page.data.data;
    if (Array.isArray(more)) rawItems.push(...more);
  }
  log('🌐', `上游分页拉取:共 ${Number(inner.total) || rawItems.length} 张,实取 ${rawItems.length} 张(${lastPage} 页)`);

  return rawItems
    .map((it) => ({
      url: getByPath(it, cfg.imgUrlField),
      name: getByPath(it, cfg.imgNameField) || '',
    }))
    .filter((it) => it.url);
}

// ── tf 后端初始化:优先 WASM,失败退 CPU ──────────
async function initBackend() {
  const tf = faceapi.tf;
  try {
    await tf.setBackend('wasm');
    await tf.ready();
    log('⚙️', `tf 后端: ${tf.getBackend()}(WASM,不挑 Node 版本)`);
  } catch (e) {
    log('⚠️', `WASM 后端初始化失败(${e.message}),退回 CPU 后端(纯 JS,较慢)`);
    await tf.setBackend('cpu');
    await tf.ready();
    log('⚙️', `tf 后端: ${tf.getBackend()}(CPU)`);
  }
}

// sharp 解码 → RGB 张量(tf.node.decodeImage 只有 tfjs-node 才有,WASM 路线用 sharp)
async function decodeToTensor(buf) {
  const { data, info } = await sharp(buf)
    .flatten({ background: '#000000' })   // 去 alpha(含 webp/png 透明通道),垫黑底
    .toColourspace('srgb')                // 灰度等统一为 3 通道
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`解码通道数异常: ${info.channels}`);
  return faceapi.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);
}

// ── 主流程 ─────────────────────────────────
async function main() {
  log('✨', 'V-Showcase AI 批量焦点分析');
  log('⚙️', `strategy=${STRATEGY}, source=${SOURCE}, concurrency=${CONCURRENCY}`);

  // 1. tf 后端(WASM 优先)+ 模型权重
  await initBackend();
  const weightsDir = await resolveWeightsDir();

  if (DOWNLOAD_ONLY) {
    log('🎉', '模型就绪(--download-only,跳过分析)');
    return;
  }

  // 2. 收集 URL
  const itemsAll = await collectUrls();
  const items = LIMIT > 0 ? itemsAll.slice(0, LIMIT) : itemsAll;
  log('📊', `共 ${itemsAll.length} 张图${LIMIT > 0 ? `(--limit=${LIMIT},本轮只处理前 ${items.length} 张)` : '待处理'}`);

  if (!items.length) {
    log('❌', '无可处理的图片,退出');
    process.exit(1);
  }

  // 3. 加载模型
  log('📦', `加载 face-api 模型从 ${weightsDir}`);
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(weightsDir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(weightsDir);
  log('✅', '模型就绪');

  // 4. 读取已有的焦点数据(保留人工标注,不被 AI 覆盖)
  const existing = await readFocalPoints();
  const existingCount = Object.keys(existing).length;
  log('📂', `已读取 src/site/focalPoints.ts (${existingCount} 项,将被保留/合并)`);

  // 5. 逐张检测(并发) — 本轮新检出的存到 detected,最后再 merge
  const detected = {};
  let analyzed = 0;   // 处理成功(含无人脸)
  let withFaces = 0;  // 其中检出人脸的
  let failed = 0;

  await pMap(items, async (it, i) => {
    progress(analyzed + 1, items.length, `${(i+1)}/${items.length} 检测中...`);
    try {
      const buf = await downloadBuffer(it.url);
      const decoded = await decodeToTensor(buf);
      let detections;
      try {
        detections = await faceapi.detectAllFaces(decoded,
          new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }));
      } finally {
        // 解码张量必须无条件释放:detect 抛错时不释放的话,
        // 长批量跑下来内存只增不减,最后 OOM
        decoded.dispose();
      }

      if (detections.length === 0) {
        analyzed++;
        return;
      }

      let box;
      if (STRATEGY === 'center') {
        const xs = detections.map((d) => d.box.x);
        const ys = detections.map((d) => d.box.y);
        const xe = detections.map((d) => d.box.x + d.box.width);
        const ye = detections.map((d) => d.box.y + d.box.height);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const w = Math.max(...xe) - x;
        const h = Math.max(...ye) - y;
        box = { x: x + w/2, y: y + h/2 };
      } else {
        const biggest = detections.reduce((a, b) =>
          (a.box.width * a.box.height) > (b.box.width * b.box.height) ? a : b);
        box = {
          x: biggest.box.x + biggest.box.width / 2,
          y: biggest.box.y + biggest.box.height / 2,
        };
      }

      const imgW = detections[0].imageWidth;
      const imgH = detections[0].imageHeight;
      detected[it.url] = {
        x: round(box.x / imgW, 3),
        y: round(box.y / imgH, 3),
      };
      analyzed++;
      withFaces++;
    } catch (e) {
      failed++;
    } finally {
      if ((analyzed + failed) % 5 === 0 || analyzed + failed === items.length) {
        progress(analyzed + failed, items.length,
          `完成 ${analyzed} 失败 ${failed}`);
      }
    }
  }, CONCURRENCY);

  log('📈', `检测结果: 处理成功 ${analyzed} 张(其中检出人脸 ${withFaces} 张,检出率 ${analyzed ? Math.round(withFaces / analyzed * 100) : 0}%),失败 ${failed}`);
  if (analyzed > 0 && withFaces === 0) {
    log('⚠️', '本轮没有检出任何人脸。SSD MobileNet 是真人脸模型,对二次元插画/动漫图基本无效;若图库以插画为主,焦点请改用「按横竖预填」或人工标注。');
  }

  // 6. 合并:已有的人工标注 + 本轮新检测结果(mergeFocalPoints 在 config-reader.mjs)
  //    - AI 检测到且已有 → 用 AI 的(更新)
  //    - AI 未检测到但已有 → 保留旧值(绝不覆盖人工标注)
  //    - AI 新检出的 → 新增
  if (NO_WRITE) {
    log('📝', '--no-write:跳过写入。本轮检出预览(最多 20 条):');
    for (const [u, p] of Object.entries(detected).slice(0, 20)) {
      log('   ', `${decodeURIComponent(u).split('/').pop()} → (${p.x}, ${p.y})`);
    }
    log('🎉', '试跑结束(未写文件)');
    return;
  }

  const { merged, stats } = mergeFocalPoints(existing, detected);

  log('🔀', `合并结果: 保留旧值 ${stats.kept} / 更新 ${stats.updated} / 新增 ${stats.added}`);

  // 7. 写文件
  await writeFocalPoints(merged);
  log('💾', `已写入 src/site/focalPoints.ts(${Object.keys(merged).length} 项)`);
  log('🎉', '完成');
}

function round(v, n) {
  const f = Math.pow(10, n);
  return Math.round(v * f) / f;
}

main().catch((e) => {
  console.error('❌ 失败:', e);
  process.exit(1);
});
