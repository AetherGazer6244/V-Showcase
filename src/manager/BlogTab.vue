<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  listContent, readContent, saveContent, deleteContent,
  type ContentFileMeta,
} from './api';
import { toast } from './api';
import { confirmAsync } from './confirm';

/* 博客写作台:左侧 posts/pages 文件列表,右侧 front-matter 表单 + 正文编辑器。
 * 保存 = PUT 原文(服务端校验 + 重建 src/generated);部署走 sync-deploy。 */

const kind = ref<'posts' | 'pages'>('posts');
const files = ref<ContentFileMeta[]>([]);
const loading = ref(false);

/** 当前编辑态(拆开的 front-matter + 正文) */
const currentSlug = ref('');
const originalSlug = ref('');      // 重命名检测:slug 改动 = 新文件
const fTitle = ref('');
const fDate = ref('');
const fExcerpt = ref('');
const fCover = ref('');
const fDraft = ref(false);
const body = ref('');
const dirty = ref(false);

const newSlug = ref('');

async function refresh() {
  loading.value = true;
  try {
    const list = await listContent(kind.value);
    files.value = list ?? [];
  } finally {
    loading.value = false;
  }
}

watch(kind, () => { void refresh(); closeEditor(); });
void refresh();

/** 简易 front-matter 拆解:行式 key: value(值可带引号);够 Manager 编辑用 */
function parseFront(raw: string): { data: Record<string, string | boolean>; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return null;
  const data: Record<string, string | boolean> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let v = kv[2].trim();
    const q = /^"([\s\S]*)"$/.exec(v) || /^'([\s\S]*)'$/.exec(v);
    if (q) v = q[1];
    data[kv[1]] = v === 'true' ? true : v === 'false' ? false : v;
  }
  return { data, body: raw.slice(m[0].length) };
}

/** 序列化:title/excerpt/cover 一律双引号包裹(值含冒号/井号时 YAML 不会炸) */
function serializeFront(): string {
  const lines = ['---', `title: "${fTitle.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`];
  if (fDate.value) lines.push(`date: ${fDate.value}`);
  if (fExcerpt.value) lines.push(`excerpt: "${fExcerpt.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  if (fCover.value) lines.push(`cover: ${fCover.value}`);
  if (fDraft.value) lines.push('draft: true');
  lines.push('---', '');
  return lines.join('\n') + body.value;
}

function openFile(meta: ContentFileMeta) {
  if (dirty.value && !window.confirm('当前有未保存改动,丢弃并打开其它文件?')) return;
  void (async () => {
    const raw = await readContent(kind.value, meta.slug);
    if (raw === null) return;
    const parsed = parseFront(raw) ?? { data: {}, body: raw };
    fTitle.value = String(parsed.data.title ?? meta.slug);
    fDate.value = String(parsed.data.date ?? '');
    fExcerpt.value = String(parsed.data.excerpt ?? '');
    fCover.value = String(parsed.data.cover ?? '');
    fDraft.value = parsed.data.draft === true;
    body.value = parsed.body;
    currentSlug.value = meta.slug;
    originalSlug.value = meta.slug;
    dirty.value = false;
  })();
}

function closeEditor() {
  currentSlug.value = '';
  originalSlug.value = '';
  dirty.value = false;
}

function markDirty() { dirty.value = true; }

async function onCreate() {
  const slug = newSlug.value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(slug)) {
    toast('文件名仅允许字母数字与 - _(字母开头)', 'error');
    return;
  }
  if (files.value.some((f) => f.slug === slug)) {
    toast(`已存在同名文件: ${slug}.md`, 'error');
    return;
  }
  const raw = [
    '---',
    `title: "${slug}"`,
    `date: ${new Date().toISOString().slice(0, 10)}`,
    '---',
    '',
    '',
  ].join('\n');
  if (!(await saveContent(kind.value, slug, raw))) return;
  newSlug.value = '';
  await refresh();
  openFile({ slug, title: slug, date: '', draft: false, size: 0, mtime: 0 });
  toast(`已创建 ${slug}.md`, 'success');
}

const canSave = computed(() => currentSlug.value !== '' && fTitle.value.trim() !== '');

async function onSave() {
  if (!canSave.value) { toast('需要文件名与非空标题', 'error'); return; }
  if (!(await saveContent(kind.value, currentSlug.value, serializeFront()))) return;
  dirty.value = false;
  if (originalSlug.value !== currentSlug.value) {
    // slug 改了 = 旧文件删除(改名)
    if (originalSlug.value) await deleteContent(kind.value, originalSlug.value);
    originalSlug.value = currentSlug.value;
  }
  await refresh();
  toast(`已保存 ${currentSlug.value}.md`, 'success');
}

async function onDelete() {
  if (!currentSlug.value) return;
  const ok = await confirmAsync({
    title: '删除文件',
    message: `确定删除 ${kind.value}/${currentSlug.value}.md?此操作不可撤销。`,
    confirmText: '删除',
  });
  if (!ok) return;
  if (!(await deleteContent(kind.value, currentSlug.value))) return;
  closeEditor();
  await refresh();
  toast('已删除', 'success');
}

/** 保存并部署:单文件走 sync-deploy(slug 改名时部署新文件) */
const deploying = ref(false);
async function onSaveDeploy() {
  if (!canSave.value) { toast('先保存内容', 'warn'); return; }
  deploying.value = true;
  try {
    if (dirty.value && !(await saveContent(kind.value, currentSlug.value, serializeFront()))) return;
    dirty.value = false;
    if (originalSlug.value !== currentSlug.value && originalSlug.value) {
      await deleteContent(kind.value, originalSlug.value);
      originalSlug.value = currentSlug.value;
    }
    const { syncDeploy } = await import('./api');
    const msg = await syncDeploy(`content/${kind.value}/${currentSlug.value}.md`);
    if (msg) toast(`已推送 ${currentSlug.value}.md,Cloudflare 将自动构建`, 'success');
    await refresh();
  } finally {
    deploying.value = false;
  }
}
</script>

<template>
  <div class="blogtab">
    <!-- 左:文件列表 -->
    <aside class="bt-side">
      <div class="bt-side-head">
        <div class="seg">
          <button type="button" :class="{ on: kind === 'posts' }" @click="kind = 'posts'">文章</button>
          <button type="button" :class="{ on: kind === 'pages' }" @click="kind = 'pages'">页面</button>
        </div>
      </div>
      <div class="bt-new">
        <input v-model="newSlug" class="input" placeholder="新文件名(如 my-post)" @keyup.enter="onCreate">
        <button class="btn" type="button" @click="onCreate">新建</button>
      </div>
      <ul class="bt-list">
        <li v-if="loading" class="bt-empty">加载中…</li>
        <li v-else-if="files.length === 0" class="bt-empty">暂无文件 — 用上方输入框新建</li>
        <li v-else>
          <button
            v-for="f in files"
            :key="f.slug"
            type="button"
            class="bt-item"
            :class="{ active: currentSlug === f.slug }"
            @click="openFile(f)"
          >
            <span class="bt-item-title">
              {{ f.title }}<span v-if="f.draft" class="bt-draft">草稿</span>
            </span>
            <span class="bt-item-meta">{{ f.slug }}.md · {{ Math.round(f.size / 1024 * 10) / 10 }}KB</span>
          </button>
        </li>
      </ul>
    </aside>

    <!-- 右:编辑器 -->
    <section class="bt-editor" v-if="currentSlug">
      <div class="bt-filebar">
        <input v-model="currentSlug" class="input bt-slug" aria-label="文件名" @input="markDirty">
        <span class="bt-ext">.md</span>
        <span class="bt-filebar-gap"></span>
        <button class="btn" type="button" :disabled="!canSave" @click="onSave">💾 保存</button>
        <button class="btn btn-primary" type="button" :disabled="!canSave || deploying" @click="onSaveDeploy">
          {{ deploying ? '推送中…' : '🚀 保存并部署' }}
        </button>
        <button class="btn btn-danger" type="button" @click="onDelete">🗑 删除</button>
      </div>

      <div class="bt-fields">
        <label class="bt-field bt-field-wide">
          <span>标题</span>
          <input v-model="fTitle" class="input" @input="markDirty">
        </label>
        <label class="bt-field">
          <span>日期</span>
          <input v-model="fDate" class="input" placeholder="yyyy-mm-dd" @input="markDirty">
        </label>
        <label class="bt-field">
          <span>草稿</span>
          <button type="button" class="toggle" :class="{ on: fDraft }" @click="fDraft = !fDraft; markDirty()">
            {{ fDraft ? '是' : '否' }}
          </button>
        </label>
        <label class="bt-field bt-field-wide">
          <span>摘要(空 = 自动取首段)</span>
          <input v-model="fExcerpt" class="input" @input="markDirty">
        </label>
        <label class="bt-field bt-field-wide">
          <span>封面 URL(可选)</span>
          <input v-model="fCover" class="input" placeholder="https://…" @input="markDirty">
        </label>
      </div>

      <textarea
        v-model="body"
        class="bt-body"
        spellcheck="false"
        placeholder="Markdown 正文…"
        @input="markDirty"
      ></textarea>

      <p v-if="dirty" class="bt-dirty">● 有未保存改动</p>
    </section>
    <section class="bt-editor bt-editor-empty" v-else>
      <p>从左侧选择文件,或新建一篇。</p>
      <p class="bt-hint">文章头使用 front-matter(title/date/excerpt/draft/cover),正文支持 GFM Markdown 与代码高亮。</p>
    </section>
  </div>
</template>
