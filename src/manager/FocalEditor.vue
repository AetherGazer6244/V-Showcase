<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { clamp01 } from '@/shared/utils';
import type { FocalPoint } from '@/shared/types';

const props = defineProps<{
  url: string;
  name: string;
  initial: FocalPoint | null;
}>();

const emit = defineEmits<{
  (e: 'apply', p: FocalPoint): void;
  (e: 'applyNext', p: FocalPoint): void;
  (e: 'nav', delta: number): void;
  (e: 'clear'): void;
  (e: 'close'): void;
}>();

const stageImg = ref<HTMLImageElement | null>(null);

const point = ref<FocalPoint>(
  props.initial ? { x: props.initial.x, y: props.initial.y } : { x: 0.5, y: 0.25 },
);

const PREVIEW_HEIGHTS = [230, 190, 140];

function setPoint(x: number, y: number) {
  point.value = { x: clamp01(x), y: clamp01(y) };
}

/** 点击坐标 → 图片归一化坐标。
 *  舞台改为「图片盒子原样展示」(不放大、不裁切):img 元素本身紧贴内容,
 *  所以直接用 img 的 rect 归一化即可,无需再算 object-fit 的留黑边。 */
function stagePointFromEvent(e: MouseEvent | TouchEvent): FocalPoint {
  const imgEl = stageImg.value;
  if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) {
    return { x: 0.5, y: 0.25 };
  }
  const rect = imgEl.getBoundingClientRect();
  const src = 'touches' in e ? e.touches[0] : e;
  return {
    x: clamp01(((src?.clientX ?? 0) - rect.left) / rect.width),
    y: clamp01(((src?.clientY ?? 0) - rect.top) / rect.height),
  };
}

/* 拖拽 */
let dragging = false;

function onStageDown(e: MouseEvent | TouchEvent) {
  dragging = true;
  const p = stagePointFromEvent(e);
  setPoint(p.x, p.y);
}

function onWindowMove(e: MouseEvent) {
  if (!dragging) return;
  const p = stagePointFromEvent(e);
  setPoint(p.x, p.y);
}

function onWindowUp() { dragging = false; }

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close');
    return;
  }
  // 数字输入框里按 ←/→ 是移动光标,不切图
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.key === 'ArrowLeft') emit('nav', -1);
  else if (e.key === 'ArrowRight') emit('nav', 1);
}

onMounted(() => {
  window.addEventListener('mousemove', onWindowMove);
  window.addEventListener('mouseup', onWindowUp);
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('mousemove', onWindowMove);
  window.removeEventListener('mouseup', onWindowUp);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="modal" role="dialog" aria-modal="true" aria-label="设置图片焦点">
    <div class="modal-mask" @click="emit('close')" />
    <div class="modal-body">
      <button class="modal-close" aria-label="关闭" @click="emit('close')">×</button>

      <div class="modal-stage">
        <div
          class="modal-stage-frame"
          @mousedown.prevent="onStageDown"
          @touchstart.prevent="onStageDown"
        >
          <div class="modal-stage-box">
            <img ref="stageImg" :src="url" alt="" crossorigin="anonymous">
            <div
              class="modal-stage-marker"
              :style="{ left: (point.x * 100) + '%', top: (point.y * 100) + '%' }"
            >
              <span class="marker-dot" />
              <span class="marker-cross-h" />
              <span class="marker-cross-v" />
            </div>
            <div class="modal-stage-hint">点击图片定位 · ←/→ 切换上/下一张</div>
          </div>
        </div>
      </div>

      <div class="modal-controls">
        <div class="ctrl-row">
          <label class="ctrl-field">
            <span class="ctrl-label">x</span>
            <input
              type="number" min="0" max="1" step="0.001"
              :value="point.x.toFixed(3)"
              @input="setPoint(Number(($event.target as HTMLInputElement).value), point.y)"
            >
          </label>
          <label class="ctrl-field">
            <span class="ctrl-label">y</span>
            <input
              type="number" min="0" max="1" step="0.001"
              :value="point.y.toFixed(3)"
              @input="setPoint(point.x, Number(($event.target as HTMLInputElement).value))"
            >
          </label>
          <button class="btn btn-small" @click="setPoint(0.5, 0.25)">↺ 默认 (0.5 / 0.25)</button>
        </div>

        <div class="ctrl-row">
          <span class="ctrl-preview-label">预览裁剪:</span>
          <div
            v-for="h in PREVIEW_HEIGHTS"
            :key="h"
            class="ctrl-preview"
            :style="{
              '--pv-x': (point.x * 100).toFixed(2) + '%',
              '--pv-y': (point.y * 100).toFixed(2) + '%',
            }"
          >
            <img :src="url" alt=""><span>{{ h }}px</span>
          </div>
        </div>

        <div class="ctrl-row ctrl-actions">
          <button class="btn" title="上一张(←)" @click="emit('nav', -1)">←</button>
          <button class="btn" title="下一张(→)" @click="emit('nav', 1)">→</button>
          <button class="btn btn-danger" @click="emit('clear')">清除该图</button>
          <span class="ctrl-spacer" />
          <button class="btn" @click="emit('close')">取消</button>
          <button class="btn btn-primary" @click="emit('apply', { x: point.x, y: point.y })">保存</button>
          <button class="btn" @click="emit('applyNext', { x: point.x, y: point.y })">存并下一张 →</button>
        </div>
      </div>

      <div class="modal-source"><span>{{ url }}</span></div>
    </div>
  </div>
</template>
