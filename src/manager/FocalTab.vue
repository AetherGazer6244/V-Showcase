<script setup lang="ts">
import { ref, computed, reactive, watchEffect, onMounted, onUnmounted } from 'vue';
import FocalEditor from './FocalEditor.vue';
import type { FocalPoint, Orientation, OrientationsDoc } from '@/shared/types';
import {
  useManagerState, loadFocalPoints, saveFocalPoints, loadImagesShared,
  loadOrientations, saveOrientations,
  runAi, toast,
} from './api';
import type { MImage } from './api';
import { registerSaver, setDirty } from './queue';
import { confirmAsync } from './confirm';

/** App 同时挂载四个 Tab,只有 active 的才有资格把按钮 Teleport 到顶栏 */
defineProps<{ active: boolean }>();

const LS_FOCAL_KEY = 'vshowcase.focal.local';

const state = useManagerState();

/* ── 数据 ── */
const staticFocal = ref<Record<string, FocalPoint>>({});
/** 本会话编辑(LS 持久化);键存在 = dirty */
const lsFocal = reactive<Record<string, FocalPoint>>({});
/** 本次会话中显式清除的 url(保存时要从静态里删掉) */
const focalRemoved = ref(new Set<string>());

function readLs(): Record<string, FocalPoint> {
  try { return JSON.parse(localStorage.getItem(LS_FOCAL_KEY) || '{}'); }
  catch { return {}; }
}

function persistLs() {
  localStorage.setItem(LS_FOCAL_KEY, JSON.stringify(lsFocal));
}

async function reloadFocal() {
  staticFocal.value = await loadFocalPoints();
  Object.keys(lsFocal).forEach((k) => delete lsFocal[k]);
  for (const [k, v] of Object.entries(readLs())) lsFocal[k] = v;
  focalRemoved.value = new Set();
}

function mergedPoint(url: string): FocalPoint | null {
  return lsFocal[url] ?? staticFocal.value[url] ?? null;
}

const dirtyCount = computed(() => Object.keys(lsFocal).length + focalRemoved.value.size);
const removedCount = computed(() => focalRemoved.value.size);

/* ── 方向标记(与焦点同 Tab 管理;独立数据文件 orientations.ts) ── */
const LS_ORIENT_KEY = 'vshowcase.orient.local';
const staticOrient = ref<OrientationsDoc>({});
const lsOrient = reactive<OrientationsDoc>({});
/** 本次会话显式归零的 url(保存时要从静态里删掉) */
const orientRemoved = ref(new Set<string>());

function readOrientLs(): OrientationsDoc {
  try { return JSON.parse(localStorage.getItem(LS_ORIENT_KEY) || '{}'); }
  catch { return {}; }
}

function persistOrientLs() {
  localStorage.setItem(LS_ORIENT_KEY, JSON.stringify(lsOrient));
}

async function reloadOrient() {
  staticOrient.value = await loadOrientations();
  Object.keys(lsOrient).forEach((k) => delete lsOrient[k]);
  for (const [k, v] of Object.entries(readOrientLs())) lsOrient[k] = v;
  orientRemoved.value = new Set();
}

/** 该图当前生效的旋转角(会话覆盖 > 静态 > 0) */
function mergedOrient(url: string): Orientation {
  if (url in lsOrient) return lsOrient[url];
  return (staticOrient.value[url] as Orientation) ?? 0;
}

const orientTotal = computed(() => {
  const s = new Set([...Object.keys(staticOrient.value), ...Object.keys(lsOrient)]);
  for (const u of orientRemoved.value) s.delete(u);
  return s.size;
});
const orientDirtyCount = computed(() => Object.keys(lsOrient).length + orientRemoved.value.size);

/** 批量标记旋转角;0 = 复位(删除静态标记) */
function applyBatchOrient(deg: Orientation) {
  let n = 0;
  for (const url of selected.value) {
    if (mergedOrient(url) === deg) continue;
    if (deg === 0) {
      delete lsOrient[url];
      if (staticOrient.value[url]) orientRemoved.value.add(url);
    } else {
      lsOrient[url] = deg;
      orientRemoved.value.delete(url);
    }
    n++;
  }
  persistOrientLs();
  const label = deg === 0 ? '复位' : `旋转 ${deg}°`;
  toast(n ? `已为 ${n} 张图标记${label}(未保存)` : `所选图片本就是 ${label}`, n ? 'success' : 'warn');
}

function buildMergedOrient(): OrientationsDoc {
  const merged: OrientationsDoc = { ...staticOrient.value };
  for (const url of orientRemoved.value) delete merged[url];
  for (const [url, v] of Object.entries(lsOrient)) merged[url] = v;
  return merged;
}

async function saveOrientCore(): Promise<boolean> {
  if (orientDirtyCount.value === 0) return true;
  const count = await saveOrientations(buildMergedOrient());
  if (count == null) return false;
  toast(`已写入 viewer 的 orientations.ts(${count} 项)`, 'success');
  await reloadOrient();
  return true;
}

registerSaver('orient', saveOrientCore);
watchEffect(() => setDirty('orient', orientDirtyCount.value > 0));

/* ── 读取图片列表(单飞共享:四个 Tab 同时挂载,只发一次代理请求) ── */
async function fetchImages() {
  const { list } = await loadImagesShared();
  state.images.value = list;
  state.imagesLoaded.value = true;
}

/* ── 网格视图模式:裁剪+焦点 / 完整图 ── */
const LS_VIEW_KEY = 'vshowcase.focal.viewmode';
type ViewMode = 'crop' | 'full';

function readView(): ViewMode {
  try { return localStorage.getItem(LS_VIEW_KEY) === 'full' ? 'full' : 'crop'; }
  catch { return 'crop'; }
}

const viewMode = ref<ViewMode>(readView());

function toggleView() {
  viewMode.value = viewMode.value === 'crop' ? 'full' : 'crop';
  try { localStorage.setItem(LS_VIEW_KEY, viewMode.value); } catch { /* 隐私模式 */ }
}

/* ── 网格密度三档(小/中/大) ── */
const LS_ICON_KEY = 'vshowcase.focal.icon';
type IconSize = 's' | 'm' | 'l';
const ICON_PX: Record<IconSize, string> = { s: '96px', m: '132px', l: '200px' };
const ICON_LABEL: Record<IconSize, string> = { s: '小格', m: '中格', l: '大格' };

function readIcon(): IconSize {
  try {
    const v = localStorage.getItem(LS_ICON_KEY);
    return v === 's' || v === 'l' ? v : 'm';
  } catch { return 'm'; }
}

const iconSize = ref<IconSize>(readIcon());

function cycleIcon() {
  const order: IconSize[] = ['s', 'm', 'l'];
  iconSize.value = order[(order.indexOf(iconSize.value) + 1) % order.length];
  try { localStorage.setItem(LS_ICON_KEY, iconSize.value); } catch { /* 隐私模式 */ }
}

/* ── 筛选:全部 / 未设焦点 / 已设焦点 ── */
type FilterMode = 'all' | 'unset' | 'set';
const FILTER_LABEL: Record<FilterMode, string> = { all: '全部', unset: '未设焦点', set: '已设焦点' };

const filterMode = ref<FilterMode>('all');

function cycleFilter() {
  const order: FilterMode[] = ['all', 'unset', 'set'];
  filterMode.value = order[(order.indexOf(filterMode.value) + 1) % order.length];
}

const shownImages = computed(() => {
  if (filterMode.value === 'all') return state.images.value;
  const wantSet = filterMode.value === 'set';
  return state.images.value.filter((img) => !!mergedPoint(img.url) === wantSet);
});

const unsetCount = computed(() => state.images.value.filter((img) => !mergedPoint(img.url)).length);

/* ── 多选批量(按横竖预填 / 清除) ── */
const selectMode = ref(false);
const selected = ref(new Set<string>());

function toggleSelectMode() {
  selectMode.value = !selectMode.value;
  if (!selectMode.value) selected.value = new Set();
}

function toggleSelect(url: string) {
  const next = new Set(selected.value);
  if (next.has(url)) next.delete(url); else next.add(url);
  selected.value = next;
}

function selectAllUnset() {
  const next = new Set(selected.value);
  for (const img of state.images.value) if (!mergedPoint(img.url)) next.add(img.url);
  selected.value = next;
}

function clearSelection() {
  selected.value = new Set();
}

function tileClick(img: MImage) {
  if (selectMode.value) toggleSelect(img.url);
  else openEditor(img);
}

/** 按横竖的预设焦点:竖图(人像构图)主体偏上,放 1/3;横图居中;方图/未知偏上 0.4 */
const PRESETS: Record<string, FocalPoint> = {
  portrait: { x: 0.5, y: 0.33 },
  landscape: { x: 0.5, y: 0.5 },
  square: { x: 0.5, y: 0.4 },
};

function presetFor(img: MImage | undefined): FocalPoint {
  const w = img?.width || 0;
  const h = img?.height || 0;
  if (!w || !h) return PRESETS.square;
  if (h > w) return PRESETS.portrait;
  if (w > h) return PRESETS.landscape;
  return PRESETS.square;
}

function applyBatchPreset() {
  const byUrl = new Map(state.images.value.map((i) => [i.url, i]));
  for (const url of selected.value) {
    lsFocal[url] = presetFor(byUrl.get(url));
    focalRemoved.value.delete(url);
  }
  persistLs();
  const n = selected.value.size;
  clearSelection();
  toast(`已按横竖为 ${n} 张图预填焦点(保存并部署后生效)`, 'success');
}

function applyBatchClear() {
  let n = 0;
  for (const url of selected.value) {
    if (mergedPoint(url)) {
      delete lsFocal[url];
      focalRemoved.value.add(url);
      n++;
    }
  }
  persistLs();
  clearSelection();
  toast(n ? `已清除 ${n} 张图的焦点(未保存)` : '所选图片本就未设焦点', n ? 'success' : 'warn');
}

/* ── 单图编辑器 ── */
const editing = ref<MImage | null>(null);
const editingInitial = ref<FocalPoint | null>(null);

function openEditor(img: MImage) {
  editing.value = img;
  editingInitial.value = mergedPoint(img.url);
}

/** 在当前筛选列表内前后切换编辑(←/→ 或编辑器按钮);过滤后的列表让"只标未设"时能连续行进 */
function openEditorAt(delta: number) {
  if (!editing.value) return;
  const list = shownImages.value;
  const idx = list.findIndex((i) => i.url === editing.value!.url);
  if (idx === -1 || list.length === 0) return;
  openEditor(list[(idx + delta + list.length) % list.length]);
}

function applyPoint(p: FocalPoint, advance = false) {
  if (!editing.value) return;
  lsFocal[editing.value.url] = p;
  focalRemoved.value.delete(editing.value.url);
  persistLs();
  if (advance) openEditorAt(1);
  else editing.value = null;
  toast('已保存到当前会话', 'success');
}

function clearPoint() {
  if (!editing.value) return;
  const url = editing.value.url;
  delete lsFocal[url];
  focalRemoved.value.add(url);
  persistLs();
  editing.value = null;
  toast('已从本次会话中清除', 'success');
}

/* ── 保存到 viewer(操作队列批量调用,无确认) ── */
function buildMerged(): Record<string, FocalPoint> {
  const merged: Record<string, FocalPoint> = { ...staticFocal.value };
  for (const url of focalRemoved.value) delete merged[url];
  for (const [url, p] of Object.entries(lsFocal)) merged[url] = p;
  return merged;
}

async function saveFocalCore(): Promise<boolean> {
  if (dirtyCount.value === 0) return true;
  const count = await saveFocalPoints(buildMerged());
  if (count == null) return false;
  toast(`已写入 viewer 的 focalPoints.ts(${count} 项)`, 'success');
  await reloadFocal();
  return true;
}

registerSaver('focal', saveFocalCore);
watchEffect(() => setDirty('focal', dirtyCount.value > 0));

/* ── 导出 JSON ── */
const exportOpen = ref(false);
const exportText = ref('');

function openExport() {
  exportText.value = `export const FOCAL_POINTS = ${JSON.stringify(buildMerged(), null, 2)};\n`;
  exportOpen.value = true;
}

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value);
    toast('已复制到剪贴板', 'success');
  } catch {
    toast('复制失败,请手动全选复制', 'error');
  }
}

function downloadExport() {
  const blob = new Blob([exportText.value], { type: 'application/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'focalPoints.ts';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── AI 批量分析 ── */
const aiOpen = ref(false);
const aiLog = ref('');
const aiRunning = ref(false);
const aiProgress = ref<{ cur: number; total: number } | null>(null);

async function startAi() {
  const total = state.images.value.length;
  const ok = await confirmAsync({
    title: 'AI 批量分析',
    message: `将启动 Node 工具逐张检测人脸并写回 viewer 的 focalPoints.ts(共 ${total} 张,已有焦点的自动跳过)。`
      + '首次运行需下载模型(~6MB),可能需要几分钟。',
    confirmText: '开始分析',
  });
  if (!ok) return;

  aiOpen.value = true;
  aiLog.value = '';
  aiRunning.value = true;
  aiProgress.value = null;

  await runAi('max', {
    onLog: (text) => { aiLog.value += text; },
    onProgress: (cur, total) => { aiProgress.value = { cur, total }; },
    onDone: async (ok, code) => {
      aiLog.value += '\n\n' + (ok ? '✓ 完成' : '✗ 失败 code=' + code);
      aiRunning.value = false;
      if (ok) {
        await reloadFocal();
        toast('AI 分析完成,已自动重载', 'success');
      }
    },
  });
}

/* ── Esc 关闭弹窗 / 退出多选 ── */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (editing.value) return; // 编辑器自行处理
  if (aiRunning.value) return;
  if (selectMode.value) {
    toggleSelectMode();
    return;
  }
  exportOpen.value = false;
  aiOpen.value = false;
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  await Promise.all([reloadFocal(), reloadOrient()]);
  await fetchImages();
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <!-- 操作按钮(传送到顶栏;保存/部署统一走侧栏操作队列) -->
  <Teleport v-if="active" to="#bar-right">
    <button class="btn" @click="fetchImages">↻ 读取图片列表</button>
    <button
      class="btn"
      :title="viewMode === 'crop' ? '当前:裁剪预览(能看到焦点落在哪、脸有没有被切)。点击切换成完整图。' : '当前:完整图。点击切换成裁剪预览。'"
      @click="toggleView"
    >{{ viewMode === 'crop' ? '裁剪预览' : '完整图' }}</button>
    <button
      class="btn"
      :title="`网格密度(当前:${ICON_LABEL[iconSize]}),点击切换`"
      @click="cycleIcon"
    >◻ {{ ICON_LABEL[iconSize] }}</button>
    <button
      class="btn"
      :title="`筛选(当前:${FILTER_LABEL[filterMode]}),点击切换`"
      @click="cycleFilter"
    >{{ FILTER_LABEL[filterMode] }}</button>
    <button
      class="btn"
      :class="selectMode ? 'btn-primary' : ''"
      :title="selectMode ? '退出多选(Esc)' : '进入多选:批量按横竖预填焦点 / 批量清除'"
      @click="toggleSelectMode"
    >{{ selectMode ? '多选中' : '多选' }}</button>
    <button class="btn btn-primary" title="用 face-api 检测人脸,自动填充缺失的焦点" @click="startAi">AI 批量分析</button>
    <button class="btn btn-ghost" @click="openExport">导出 JSON</button>
  </Teleport>

  <!-- 状态条 -->
  <section class="status">
    <div class="status-item">
      <span class="status-label">静态焦点</span>
      <span class="status-value">{{ Object.keys(staticFocal).length }} 项</span>
    </div>
    <div class="status-item">
      <span class="status-label">本次编辑</span>
      <span class="status-value">{{ Object.keys(lsFocal).length }} 项</span>
    </div>
    <div class="status-item">
      <span class="status-label">未设焦点</span>
      <span class="status-value">{{ unsetCount }} 张</span>
    </div>
    <div class="status-item">
      <span class="status-label">未保存</span>
      <span class="status-value">{{ dirtyCount }} 项(含清除 {{ removedCount }})</span>
    </div>
    <div class="status-item">
      <span class="status-label">方向标记</span>
      <span class="status-value">{{ orientTotal }} 项{{ orientDirtyCount ? ` (改 ${orientDirtyCount})` : '' }}</span>
    </div>
    <div v-if="aiRunning && aiProgress" class="status-progress">
      <div class="status-progress-bar">
        <div
          class="status-progress-fill"
          :style="{ width: (aiProgress.cur / aiProgress.total * 100) + '%' }"
        />
      </div>
      <span class="status-progress-label">{{ aiProgress.cur }} / {{ aiProgress.total }}</span>
    </div>
    <div v-else-if="aiRunning" class="status-progress">
      <div class="status-progress-bar"><div class="status-progress-fill" style="width: 0%" /></div>
      <span class="status-progress-label">启动中...</span>
    </div>
  </section>

  <!-- 焦点网格 -->
  <main
    class="grid tab-pane"
    :class="viewMode === 'crop' ? 'is-crop' : 'is-full'"
    :style="{ '--icon': ICON_PX[iconSize] }"
  >
    <div v-if="!state.imagesLoaded.value" class="empty">点击右上"读取图片列表"开始</div>
    <div v-else-if="shownImages.length === 0" class="empty">当前筛选({{ FILTER_LABEL[filterMode] }})下没有图片</div>
    <div
      v-for="(img, i) in shownImages"
      :key="img.url"
      class="tile"
      :class="{ 'is-selected': selectMode && selected.has(img.url) }"
      @click="tileClick(img)"
    >
      <div class="tile-frame">
        <span
          class="tile-badge"
          :class="mergedPoint(img.url) ? 'tile-badge-static' : 'tile-badge-empty'"
          :title="mergedPoint(img.url) ? '已设焦点' : '未设'"
        >{{ mergedPoint(img.url) ? '●' : '○' }}</span>
        <span v-if="mergedOrient(img.url)" class="tile-orient" title="已标记旋转(保存并部署后生效)">{{ mergedOrient(img.url) }}°</span>
        <span v-if="selectMode && selected.has(img.url)" class="tile-check">✓</span>
        <img
          :src="img.thumb || img.url"
          :alt="img.name"
          :class="(() => { const v = mergedOrient(img.url); return v ? 'orient-' + v : ''; })()"
          :style="(() => {
            const p = mergedPoint(img.url);
            return p ? { '--tile-x': (p.x*100).toFixed(1)+'%', '--tile-y': (p.y*100).toFixed(1)+'%' } : {};
          })()"
          loading="lazy"
          decoding="async"
        >
      </div>
      <div class="tile-name" :title="img.name">{{ img.name || ('#' + (i + 1)) }}</div>
    </div>
  </main>

  <!-- 多选批量操作条 -->
  <div v-if="selectMode" class="batch-bar">
    <span class="batch-count">已选 {{ selected.size }} / {{ shownImages.length }}</span>
    <button class="btn" @click="selectAllUnset">全选未设({{ unsetCount }})</button>
    <button class="btn btn-primary" :disabled="!selected.size" title="竖图 y=0.33 / 横图 y=0.5 / 方图 y=0.4,之后可单张微调" @click="applyBatchPreset">按横竖预填焦点</button>
    <button class="btn btn-danger" :disabled="!selected.size" @click="applyBatchClear">清除焦点</button>
    <span class="batch-sep" />
    <button class="btn" :disabled="!selected.size" title="标记显示时顺时针旋转 90°(图床剥 EXIF 的横躺图转正)" @click="applyBatchOrient(90)">↻ 90°</button>
    <button class="btn" :disabled="!selected.size" @click="applyBatchOrient(180)">↻ 180°</button>
    <button class="btn" :disabled="!selected.size" @click="applyBatchOrient(270)">↻ 270°</button>
    <button class="btn" :disabled="!selected.size" title="删除方向标记(恢复原始姿态)" @click="applyBatchOrient(0)">0° 复位</button>
    <button class="btn btn-ghost" @click="toggleSelectMode">退出多选</button>
  </div>

  <!-- 单图编辑器 -->
  <FocalEditor
    v-if="editing"
    :url="editing.url"
    :name="editing.name"
    :initial="editingInitial"
    @apply="(p) => applyPoint(p)"
    @apply-next="(p) => applyPoint(p, true)"
    @nav="openEditorAt"
    @clear="clearPoint"
    @close="editing = null"
  />

  <!-- 导出 JSON -->
  <div v-if="exportOpen" class="modal" role="dialog" aria-modal="true" aria-label="导出焦点配置">
    <div class="modal-mask" @click="exportOpen = false" />
    <div class="modal-body modal-body-small">
      <button class="modal-close" aria-label="关闭" @click="exportOpen = false">×</button>
      <h2 class="modal-title">导出焦点配置</h2>
      <textarea :value="exportText" class="export-text" readonly />
      <div class="ctrl-row ctrl-actions">
        <button class="btn" @click="copyExport">复制到剪贴板</button>
        <button class="btn" @click="downloadExport">下载 focalPoints.ts</button>
        <span class="ctrl-spacer" />
        <button class="btn" @click="exportOpen = false">关闭</button>
      </div>
    </div>
  </div>

  <!-- AI 日志 -->
  <div v-if="aiOpen" class="modal" role="dialog" aria-modal="true" aria-label="AI 分析日志">
    <div class="modal-mask" @click="!aiRunning && (aiOpen = false)" />
    <div class="modal-body modal-body-small">
      <button class="modal-close" aria-label="关闭" :disabled="aiRunning" @click="aiOpen = false">×</button>
      <h2 class="modal-title">AI 焦点批量分析日志</h2>
      <pre class="ai-log">{{ aiLog }}</pre>
      <div class="ctrl-row ctrl-actions">
        <span class="ctrl-spacer" />
        <button class="btn" @click="aiOpen = false">关闭</button>
      </div>
    </div>
  </div>
</template>
