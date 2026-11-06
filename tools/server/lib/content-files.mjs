/* ============================================================
 * content-files.mjs — Manager 内容读写库(posts/pages/playlist/projects)
 * ------------------------------------------------------------
 * 与 config-reader.mjs 分工:
 *   config-reader → src/site/*.ts 纯字面量数据(acorn 解析)
 *   content-files → content/ 目录下的 Markdown 与 JSON(博客化新增)
 *
 * 安全要点:
 *   1. 文件名白名单正则(^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$) + resolve 后
 *      必须仍位于目标目录内,双保险防路径穿越(../、绝对路径、编码绕过)
 *   2. 读写字节上限 512KB(Markdown 文章正常 5~50KB)
 *   3. Markdown 写入前必须能被 gray-matter 解析且 title 存在(可写)
 *   4. JSON 写入前逐字段校验(playlist/projects 各自的 schema)
 *   5. 只读写固定两个目录,content 其它文件不暴露
 * ============================================================ */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'content');
const POSTS_DIR = path.join(CONTENT_DIR, 'posts');
const PAGES_DIR = path.join(CONTENT_DIR, 'pages');

const MAX_BYTES = 512 * 1024;
/** slug/页面名:URL 安全,禁止点开头与路径分隔 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

/** 目录内安全定位:名字合法 + resolve 后不越出目录。返回绝对路径或 null */
function safePath(dir, name, suffix = '.md') {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return null;
  const base = path.resolve(dir);
  const full = path.resolve(base, name + suffix);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

async function readText(file) {
  const buf = await fs.readFile(file);
  if (buf.length > MAX_BYTES) throw new Error(`文件超过 ${Math.round(MAX_BYTES / 1024)}KB 上限`);
  return buf.toString('utf8');
}

/* ---------- Markdown:front-matter 校验 ---------- */

/** 校验 Markdown:可解析 + title 为非空字符串。返回解析后的 data */
function validateMarkdown(raw) {
  let parsed;
  try {
    parsed = matter(raw);
  } catch (e) {
    throw new Error('front-matter 解析失败:' + e.message);
  }
  const t = parsed.data.title;
  if (typeof t !== 'string' || !t.trim()) throw new Error('front-matter 缺少非空 title 字段');
  return parsed.data;
}

/* ---------- posts / pages(目录约定:posts | pages) ---------- */

function dirOf(kind) {
  if (kind === 'posts') return POSTS_DIR;
  if (kind === 'pages') return PAGES_DIR;
  throw new Error(`未知内容类型: ${kind}(仅支持 posts/pages)`);
}

/** 列表:含 front-matter 摘要(title/date/draft),供 Manager 侧栏 */
export async function listMarkdown(kind) {
  const dir = dirOf(kind);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { dir, files: [] };   // 目录还没建(空库)→ 空列表
  }
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue;
    const slug = e.name.replace(/\.md$/i, '');
    if (!NAME_RE.test(slug)) continue;
    const full = path.join(dir, e.name);
    try {
      const st = await fs.stat(full);
      if (st.size > MAX_BYTES) continue;
      let data = {};
      try {
        data = matter(await readText(full)).data;
      } catch { /* 坏文件也列出来,让用户能打开修复 */ }
      files.push({
        slug,
        title: typeof data.title === 'string' ? data.title : slug,
        date: typeof data.date === 'string' || data.date instanceof Date ? String(data.date).slice(0, 10) : '',
        draft: data.draft === true,
        size: st.size,
        mtime: st.mtimeMs,
      });
    } catch { /* stat 失败跳过 */ }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return { dir, files };
}

export async function readMarkdown(kind, name) {
  const full = safePath(dirOf(kind), name);
  if (!full) throw new Error(`非法文件名: ${name}`);
  return { name, raw: await readText(full) };
}

export async function writeMarkdown(kind, name, raw) {
  const full = safePath(dirOf(kind), name);
  if (!full) throw new Error(`非法文件名: ${name}`);
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('内容不能为空');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error(`内容超过 ${Math.round(MAX_BYTES / 1024)}KB 上限`);
  validateMarkdown(raw);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, raw.endsWith('\n') ? raw : raw + '\n', 'utf8');
  const rebuilt = await rebuildPosts();
  return { name, bytes: Buffer.byteLength(raw, 'utf8'), rebuilt };
}

export async function deleteMarkdown(kind, name) {
  const full = safePath(dirOf(kind), name);
  if (!full) throw new Error(`非法文件名: ${name}`);
  await fs.unlink(full);
  const rebuilt = await rebuildPosts();
  return { name, rebuilt };
}

/* ---------- playlist.json ---------- */

/** 曲库 schema:数组;netease→纯数字 id;url→合法 URL + 非空 title */
export function validatePlaylistDoc(doc) {
  if (!Array.isArray(doc)) throw new Error('playlist 必须是数组');
  if (doc.length > 500) throw new Error('曲库上限 500 首');
  doc.forEach((t, i) => {
    const at = `第 ${i + 1} 条`;
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error(`${at}: 必须是对象`);
    if (t.source === 'netease') {
      if (!/^\d{1,15}$/.test(String(t.id))) throw new Error(`${at}: netease 曲目 id 必须是纯数字`);
    } else if (t.source === 'url') {
      if (typeof t.url !== 'string' || !/^https?:\/\/.+/.test(t.url)) throw new Error(`${at}: url 必须是 http(s) 直链`);
      if (typeof t.title !== 'string' || !t.title.trim()) throw new Error(`${at}: url 曲目必须带非空 title`);
      for (const opt of ['artist', 'cover', 'lrc']) {
        if (t[opt] !== undefined && typeof t[opt] !== 'string') throw new Error(`${at}: ${opt} 必须是字符串`);
      }
    } else {
      throw new Error(`${at}: source 必须是 'netease' 或 'url'`);
    }
  });
}

export async function readPlaylist() {
  const raw = await readText(path.join(CONTENT_DIR, 'playlist.json'));
  const doc = JSON.parse(raw);
  validatePlaylistDoc(doc);
  return doc;
}

export async function writePlaylist(doc) {
  validatePlaylistDoc(doc);
  const file = path.join(CONTENT_DIR, 'playlist.json');
  await fs.writeFile(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return { count: doc.length };
}

/* ---------- projects.json ---------- */

const PROJECT_STATUSES = ['active', 'wip', 'archived'];

export function validateProjectsDoc(doc) {
  if (!Array.isArray(doc)) throw new Error('projects 必须是数组');
  if (doc.length > 100) throw new Error('项目上限 100 个');
  doc.forEach((p, i) => {
    const at = `第 ${i + 1} 个`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`${at}: 必须是对象`);
    for (const req of ['name', 'desc']) {
      if (typeof p[req] !== 'string' || !p[req].trim()) throw new Error(`${at}: ${req} 必须是非空字符串`);
    }
    if (!PROJECT_STATUSES.includes(p.status)) throw new Error(`${at}: status 必须是 ${PROJECT_STATUSES.join('/')}`);
    if (!Array.isArray(p.tech) || p.tech.length === 0 || !p.tech.every((t) => typeof t === 'string' && t.trim())) {
      throw new Error(`${at}: tech 必须是非空字符串数组`);
    }
    for (const opt of ['link', 'repo', 'year']) {
      if (p[opt] !== undefined && p[opt] !== null && typeof p[opt] !== 'string') {
        throw new Error(`${at}: ${opt} 必须是字符串`);
      }
    }
  });
}

export async function readProjects() {
  const raw = await readText(path.join(CONTENT_DIR, 'projects.json'));
  const doc = JSON.parse(raw);
  validateProjectsDoc(doc);
  return doc;
}

export async function writeProjects(doc) {
  validateProjectsDoc(doc);
  const file = path.join(CONTENT_DIR, 'projects.json');
  await fs.writeFile(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return { count: doc.length };
}

/* ---------- 重建博客产物 ---------- */

/** 写完 Markdown 后跑 build-posts,让 src/generated 保持新鲜(dev 模式立即可见)。
 *  失败不抛——写入本身已成功,产物问题在下次构建仍会暴露;返回错误消息。 */
function rebuildPosts() {
  return new Promise((resolve) => {
    const script = path.resolve(__dirname, '..', '..', 'posts', 'build-posts.mjs');
    const child = spawn(process.execPath, [script], { cwd: PROJECT_ROOT });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } }, 15000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true } : { ok: false, error: out.slice(-400) });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
  });
}
