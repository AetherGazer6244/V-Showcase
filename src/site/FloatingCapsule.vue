<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { usePlayer } from './player';
import {
  CAPSULE_POS_KEY,
  parseCapsulePos,
  serializeCapsulePos,
  toFraction,
  fromFraction,
  type CapsuleFraction,
} from './capsulePos';

/* ============================================================
 * FloatingCapsule — 右下角迷你播放胶囊(v2.3,替代原全宽 PlayerBar)
 * ------------------------------------------------------------
 * 对齐 Cecilian-Hub 的 FloatingPlayer:
 *   - 旋转唱片封面(播放时转,暂停停转)+ 歌名 + 当前行歌词
 *   - 播放/暂停 + 下一曲两钮(完整控制在音乐页)
 *   - pointer 拖动(无惯性),位置 localStorage 记忆,视口内夹取
 *   - 主页隐身(不挡流动图片墙),其余页面显示 —— 由 App.vue 传 hidden
 *
 * ⚠️ 位置按「视口比例」记忆,不是绝对像素:
 *    浏览器缩放会改变视口像素尺寸(1920×1080 → 1280×720),
 *    存绝对像素会让胶囊缩放后跑到屏幕外被夹回、来回缩放还会逐步漂移。
 *    缩放时只按比例重算显示坐标,【不】把夹取后的像素写回存储值。
 * ============================================================ */

const props = defineProps<{ hidden?: boolean }>();

const player = usePlayer();
const visible = computed(() => player.index.value >= 0);

/* ---- 位置记忆 ---- */
/** 记忆值:视口比例(缩放/改窗口大小时的唯一依据) */
const frac = ref<CapsuleFraction | null>(null);
/** 当前显示坐标(像素)—— 由 frac 换算而来;null = 缺省右下角停靠(首访) */
const pos = ref<{ x: number; y: number } | null>(null);
const el = ref<HTMLElement | null>(null);
const dragging = ref(false);

function loadFrac(): CapsuleFraction | null {
  try {
    return parseCapsulePos(
      localStorage.getItem(CAPSULE_POS_KEY),
      window.innerWidth,
      window.innerHeight,
    );
  } catch {
    return null; // 隐私模式等读取失败 → 首访默认停靠
  }
}

function saveFrac(f: CapsuleFraction): void {
  try {
    localStorage.setItem(CAPSULE_POS_KEY, serializeCapsulePos(f));
  } catch { /* 隐私模式静默 */ }
}

/** 缺省停靠点:右下角 24px(Cecilian-Hub 同款) */
function defaultPos(): { x: number; y: number } {
  const rect = el.value?.getBoundingClientRect();
  const w = rect?.width ?? 224;
  const h = rect?.height ?? 56;
  return { x: window.innerWidth - w - 24, y: window.innerHeight - h - 24 };
}

/** 拖动/恢复/窗口缩放后都要夹回视口内 */
function clampToViewport(p: { x: number; y: number }): { x: number; y: number } {
  const rect = el.value?.getBoundingClientRect();
  const w = rect?.width ?? 224;
  const h = rect?.height ?? 56;
  return {
    x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - h - 8)),
  };
}

/** 按当前视口把记忆的比例换算成像素并夹回视口内 */
function posFromFrac(f: CapsuleFraction): { x: number; y: number } {
  return clampToViewport(fromFraction(f, window.innerWidth, window.innerHeight));
}

/* ---- 拖动(pointer capture;按钮区不触发) ---- */
let startPointer = { x: 0, y: 0 };
let startPos = { x: 0, y: 0 };

function onPointerDown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button')) return;
  const base = pos.value ?? defaultPos();
  pos.value = base;                       // 首次拖动把缺省停靠点落成显式坐标
  dragging.value = true;
  startPointer = { x: e.clientX, y: e.clientY };
  startPos = { ...base };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  pos.value = clampToViewport({
    x: startPos.x + (e.clientX - startPointer.x),
    y: startPos.y + (e.clientY - startPointer.y),
  });
}

function onPointerUp() {
  if (!dragging.value) return;
  dragging.value = false;
  if (!pos.value) return;
  // 只在「用户放手」这一刻写回比例;缩放/夹取不写,避免来回缩放把位置越推越偏
  const f = toFraction(pos.value.x, pos.value.y, window.innerWidth, window.innerHeight);
  frac.value = f;
  saveFrac(f);
}

function onResize() {
  // 缩放/改窗口大小:按比例重算显示坐标,记忆值保持不动
  if (frac.value) pos.value = posFromFrac(frac.value);
}

onMounted(() => {
  window.addEventListener('resize', onResize);
  const f = loadFrac();
  frac.value = f;
  if (f) pos.value = posFromFrac(f);     // 小屏恢复时夹回
});
onUnmounted(() => window.removeEventListener('resize', onResize));

const posStyle = computed(() => (
  pos.value ? { left: `${pos.value.x}px`, top: `${pos.value.y}px` } : {}
));
/** 未拖动过的缺省停靠点交给 CSS(窄屏自动让开底部固定页脚胶囊) */
const docked = computed(() => pos.value === null);

/* ---- 当前行歌词(无歌词/未唱到时给占位) ---- */
const lyricLine = computed(() => {
  const lines = player.lrcLines.value;
  const i = player.activeLrcIdx.value;
  if (i >= 0 && i < lines.length) return lines[i].text;
  return player.playing.value ? '♪ 纯享音乐 ♪' : '已暂停';
});
</script>

<template>
  <div
    v-if="visible"
    ref="el"
    class="capsule-anchor"
    :class="{ dragging, 'is-docked': docked }"
    :style="posStyle"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div class="capsule" :class="{ 'is-hidden': props.hidden }">
      <!-- 旋转唱片封面 -->
      <span class="capsule-disc" :class="{ spinning: player.playing.value }" aria-hidden="true">
        <img v-if="player.current.value?.cover" :src="player.current.value.cover" alt="">
        <span v-else class="capsule-disc-fallback">♫</span>
        <i class="capsule-disc-hole"></i>
      </span>

      <!-- 歌名 + 当前行歌词 -->
      <span class="capsule-meta">
        <span class="capsule-title">{{ player.current.value?.title }}</span>
        <span class="capsule-lyric">{{ lyricLine }}</span>
      </span>

      <!-- 控制 -->
      <span class="capsule-ops">
        <button
          class="capsule-btn capsule-btn-main"
          type="button"
          :aria-label="player.playing.value ? '暂停' : '播放'"
          @pointerdown.stop
          @click="player.toggle()"
        >{{ player.playing.value ? '❚❚' : '▶' }}</button>
        <button
          class="capsule-btn"
          type="button"
          aria-label="下一首"
          @pointerdown.stop
          @click="player.next()"
        >⏭</button>
      </span>
    </div>
  </div>
</template>
