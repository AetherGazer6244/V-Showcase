<script setup lang="ts">
/* ============================================================
 * 上传图片工作台 — 可拖拽悬浮面板(借鉴 Hub FloatingImageTool)
 *   拖拽/点选多文件 → POST /api/upload-image(服务端代理图床)
 *   → 展示外链 + 一键复制。上传的图随后会出现在图床列表中,
 *   点「读取图片列表」即可在焦点/图集/标签中看到。
 *
 * 上传管线三道闸(对应 docs/lessons-learned.md 1.1/1.2/1.3):
 *   闸1(本文件)入队时读文件字节:
 *        · magic bytes 判定真实格式,扩展名不符 → 就地改名(不再产生伪装图)
 *        · 非图片文件 → 直接拒绝,不发请求
 *        · SHA-256 批内去重:同一批里的相同文件只传一次
 *   闸2(服务端)md5 与图床目录对账,已存在 → 不上传,直接复用外链
 *   闸3(服务端)上传后验活,确认返回的外链真能取到图片
 *   批后(本文件)外链对账:映射数 ≠ 唯一外链数 → 提示图床把不同文件映射到同一链接
 * ============================================================ */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { toast } from './api';
import { md5Hex } from './md5';
import {
  sniffFormat,
  fixFileName,
  mimeOf,
  formatLabel,
  sha256Hex,
  UPLOADABLE_FORMATS,
} from './imageGuard';

const emit = defineEmits<{ (e: 'close'): void }>();

/* ── 面板拖拽移动 ── */
const pos = ref({ x: Math.max(16, window.innerWidth - 396), y: 88 });
let dragging = false;
const dragOff = { x: 0, y: 0 };

function onHeadDown(e: MouseEvent) {
  dragging = true;
  dragOff.x = e.clientX - pos.value.x;
  dragOff.y = e.clientY - pos.value.y;
}
function onMove(e: MouseEvent) {
  if (!dragging) return;
  pos.value = {
    x: Math.max(8, Math.min(window.innerWidth - 120, e.clientX - dragOff.x)),
    y: Math.max(8, Math.min(window.innerHeight - 60, e.clientY - dragOff.y)),
  };
}
function onUp() { dragging = false; }

/* ── 上传队列 ── */
interface UpItem {
  /** 入队时的文件(格式不符时会被改名重建) */
  file: File;
  /** 入队时生成的本地预览 URL(移除/卸载时 revoke) */
  thumb: string;
  status: 'waiting' | 'uploading' | 'ok' | 'dedup' | 'fail';
  url?: string;
  error?: string;
  /** 补充说明:伪装修正 / 批内重复 / 验活未决 */
  note?: string;
  /** 内容 md5(交给服务端与图床目录对账) */
  md5?: string;
  /** 内容 SHA-256(批内去重) */
  sha?: string;
  /** 批内重复:与队列中第 N 项内容相同(0 基) */
  dupOf?: number;
}

const MAX_SIZE = 15 * 1024 * 1024;
const items = ref<UpItem[]>([]);
const busy = ref(false);
const dragOver = ref(false);

const doneCount = computed(() => items.value.filter((it) => it.status === 'ok').length);
const dedupCount = computed(() => items.value.filter((it) => it.status === 'dedup').length);
const failCount = computed(() => items.value.filter((it) => it.status === 'fail').length);

/** 入队:读字节 → 校验格式 → 改名 → 批内去重 */
async function addFiles(list: FileList | File[] | null | undefined) {
  if (!list) return;
  for (const f of Array.from(list)) {
    if (f.size === 0) {
      toast(`跳过空文件:${f.name}`, 'warn');
      continue;
    }
    if (f.size > MAX_SIZE) {
      toast(`跳过超过 15MB 的文件:${f.name}`, 'warn');
      continue;
    }
    let buf: ArrayBuffer;
    try {
      buf = await f.arrayBuffer();
    } catch {
      toast(`读取失败:${f.name}`, 'error');
      continue;
    }
    const bytes = new Uint8Array(buf);

    // 闸1a:以文件头字节判定真实格式(不信扩展名,也不信浏览器给的 MIME)
    const format = sniffFormat(bytes);
    if (!UPLOADABLE_FORMATS.includes(format)) {
      toast(`跳过非图片文件(实际为${formatLabel(format)}):${f.name}`, 'warn');
      continue;
    }

    // 闸1b:名实不符 → 就地改名,顺带纠正 MIME(根治 webp 伪装 .jpg)
    const fixed = fixFileName(f.name, format);
    const file = fixed.changed
      ? new File([buf], fixed.name, { type: mimeOf(format), lastModified: f.lastModified })
      : f;

    const item: UpItem = {
      file,
      thumb: URL.createObjectURL(file),
      status: 'waiting',
      md5: md5Hex(bytes),
    };
    if (fixed.changed) {
      item.note = `名实不符,已按真实格式(${formatLabel(format)})改名`;
    }

    // 闸1c:批内去重(同内容只传一次)
    const sha = await sha256Hex(buf);
    if (sha) {
      item.sha = sha;
      const sameIdx = items.value.findIndex((it) => it.sha === sha);
      if (sameIdx >= 0) {
        item.dupOf = sameIdx;
        item.note = item.note
          ? `${item.note} · 批内重复(与第 ${sameIdx + 1} 张相同)`
          : `批内重复(与第 ${sameIdx + 1} 张相同)`;
      }
    }

    items.value.push(item);
  }
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files) void addFiles(input.files);
  input.value = '';
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  void addFiles(e.dataTransfer?.files);
}

async function uploadAll() {
  if (busy.value) return;
  const pending = items.value.filter((it) => it.status === 'waiting' || it.status === 'fail');
  if (pending.length === 0) {
    toast('没有待上传的文件');
    return;
  }
  busy.value = true;
  /** 服务端返回过外链的记录(批内重复复用不算,那是同一个文件) */
  const mappedUrls: string[] = [];

  for (const it of items.value) {
    if (it.status === 'ok' || it.status === 'uploading' || it.status === 'dedup') continue;

    // 批内重复:直接复用同批已传好的结果,不发请求
    if (typeof it.dupOf === 'number') {
      const src = items.value[it.dupOf];
      if (src && (src.status === 'ok' || src.status === 'dedup') && src.url) {
        it.url = src.url;
        it.status = 'ok';
        it.note = `批内重复,复用第 ${it.dupOf + 1} 张的结果`;
        continue;
      }
      if (src && src.status === 'fail') {
        it.status = 'fail';
        it.error = '同批的那张重复文件上传失败';
        continue;
      }
    }

    it.status = 'uploading';
    it.error = undefined;
    try {
      const fd = new FormData();
      fd.append('file', it.file);
      const headers: Record<string, string> = {};
      if (it.md5) headers['x-image-md5'] = it.md5;
      const r = await fetch('/api/upload-image', { method: 'POST', body: fd, headers });
      const json = await r.json() as {
        ok?: boolean;
        dedup?: boolean;
        data?: { url?: string; name?: string };
        error?: string;
        verifyNote?: string;
      };
      if (!json.ok || !json.data?.url) throw new Error(json.error || 'HTTP ' + r.status);
      it.url = json.data.url;
      it.status = json.dedup ? 'dedup' : 'ok';
      if (json.dedup) {
        it.note = '图床已有同内容图片,未重复上传';
      } else if (json.verifyNote) {
        it.note = json.verifyNote;
      }
      mappedUrls.push(json.data.url);
    } catch (err) {
      it.status = 'fail';
      it.error = err instanceof Error ? err.message : String(err);
    }
  }

  busy.value = false;

  // 批后对账:映射数 ≠ 唯一外链数 → 图床把不同文件映射到了同一链接
  // (lessons-learned 1.2 的「distinct(url) vs count(记录)」对账)
  const uniq = mappedUrls.length ? new Set(mappedUrls).size : 0;
  let msg = `上传完成:成功 ${doneCount.value}、复用 ${dedupCount.value}、失败 ${failCount.value}`;
  let warn = failCount.value > 0;
  if (mappedUrls.length > uniq) {
    msg += `;⚠ ${mappedUrls.length} 条只对应 ${uniq} 个外链(图床把不同文件映射到同一链接,请人工核对)`;
    warn = true;
  }
  toast(msg, warn ? 'warn' : 'success');
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast('已复制外链', 'success');
  } catch {
    toast('复制失败,请手动复制', 'error');
  }
}

function removeItem(i: number) {
  const it = items.value[i];
  if (!it || it.status === 'uploading') return;
  URL.revokeObjectURL(it.thumb);
  items.value.splice(i, 1);
}

function clearDone() {
  const keep: UpItem[] = [];
  for (const it of items.value) {
    if (it.status === 'ok' || it.status === 'dedup') URL.revokeObjectURL(it.thumb);
    else keep.push(it);
  }
  items.value = keep;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', onUp);
  window.removeEventListener('keydown', onKeydown);
  for (const it of items.value) URL.revokeObjectURL(it.thumb);
});
</script>

<template>
  <Teleport to="body">
    <div class="modal">
      <div class="modal-mask" @click="emit('close')" />
      <div class="upload-board" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
        <div class="upload-head" @mousedown.prevent="onHeadDown">
          <h2 class="modal-title">上传图片到图床</h2>
          <button class="upload-head-close" aria-label="关闭" @click="emit('close')">×</button>
        </div>

        <!-- 拖放区 -->
        <div
          class="upload-drop"
          :class="{ 'is-over': dragOver }"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="onDrop"
        >
          <p class="upload-drop-main">把图片拖到这里,或</p>
          <label class="btn btn-primary upload-pick">
            选择文件
            <input type="file" accept="image/*" multiple hidden @change="onPick">
          </label>
          <p class="upload-drop-sub">支持 png / jpg / webp / gif / avif,单张 ≤ 15MB</p>
          <p class="upload-drop-sub">上传前自动核对真实格式、跳过重复图,传完再验一次链接</p>
        </div>

        <!-- 队列列表 -->
        <div v-if="items.length" class="upload-list">
          <div
            v-for="(it, i) in items"
            :key="`${it.file.name}-${it.file.lastModified}-${i}`"
            class="upload-item"
            :class="'is-' + it.status"
          >
            <img :src="it.thumb" alt="" class="upload-thumb">
            <div class="upload-item-main">
              <div class="upload-item-name" :title="it.file.name">{{ it.file.name }}</div>
              <div class="upload-item-status">
                <template v-if="it.status === 'waiting'">等待上传</template>
                <template v-else-if="it.status === 'uploading'">上传中…</template>
                <template v-else-if="it.status === 'ok' || it.status === 'dedup'">
                  <span class="upload-item-url" :title="it.url">{{ it.url }}</span>
                </template>
                <template v-else>✗ {{ it.error }}</template>
              </div>
              <div v-if="it.note" class="upload-item-note">{{ it.note }}</div>
            </div>
            <div class="upload-item-actions">
              <button
                v-if="(it.status === 'ok' || it.status === 'dedup') && it.url"
                class="btn btn-small"
                title="复制外链"
                @click="copyUrl(it.url!)"
              >复制</button>
              <button class="btn btn-small btn-ghost" title="移除" @click="removeItem(i)">×</button>
            </div>
          </div>
        </div>
        <div v-else class="upload-empty">队列是空的 — 拖几张图进来试试</div>

        <div class="upload-foot ctrl-row">
          <button class="btn btn-ghost btn-small" :disabled="doneCount + dedupCount === 0" @click="clearDone">清除已完成</button>
          <span class="ctrl-spacer" />
          <button class="btn btn-primary btn-small" :disabled="busy || items.length === 0" @click="uploadAll">
            {{ busy ? '上传中…' : `开始上传${items.length ? '(' + items.length + ')' : ''}` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
