<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import {
  useSettings, resetSettings,
  ROWS_RANGE, WIDTH_RANGE, SPEED_RANGE,
  IDLE_CHOICES, INTERVAL_CHOICES, ROTATE_CHOICES,
  READING_FONT_CHOICES, READING_LINE_CHOICES, READING_WIDTH_CHOICES,
  READING_FONT_LABEL, READING_LINE_LABEL, READING_WIDTH_LABEL,
} from './settings';
import type { ThemeName } from './settings';
import { useFavorites } from './favorites';
import { useScreensaver } from './screensaver';
import { useFocal, useOrientation, useLightbox } from './composables';
import { loadImages, isFallback } from '@/shared/apiClient';
import type { Image } from '@/shared/types';

const { settings } = useSettings();
const { favs, clearAll } = useFavorites();
const { focalStyle } = useFocal();
const { orientClass } = useOrientation();
const saver = useScreensaver();
const lb = useLightbox();

/* 预览轨道:两份相同卡片序列 + translateX(-50%) 无缝循环 */
const previewCards = [0, 1, 2, 0, 1, 2];

/* 外观区:主题三态候选(明亮为默认) */
const THEME_CHOICES: Array<{ value: ThemeName; label: string }> = [
  { value: 'light', label: '明亮' },
  { value: 'dark', label: '深色' },
  { value: 'auto', label: '跟随系统' },
];
const themeLabel = computed(() => {
  const t = settings.value.theme;
  if (t === 'dark') return '深色';
  if (t === 'light') return '明亮';
  return '跟随系统';
});

const previewStyle = computed(() => ({
  animationDuration: (12 / settings.value.speed) + 's',
  animationPlayState: settings.value.animate ? 'running' : 'paused',
}));

/** 滑杆已滑过部分的填充百分比(--pct,自绘 track 渐变用) */
function pctOf(v: number, range: { min: number; max: number }): string {
  return ((v - range.min) / (range.max - range.min)) * 100 + '%';
}

/* ---- 底部提示(恢复默认 / 清空收藏共用) ---- */
const hintVisible = ref(false);
const hintText = ref('已恢复默认设置');
let hintTimer: ReturnType<typeof setTimeout> | null = null;

function showHint(msg: string) {
  hintText.value = msg;
  hintVisible.value = true;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hintVisible.value = false; }, 2200);
}

function onReset() {
  resetSettings();
  showHint('已恢复默认设置');
}

/* ---- 我的收藏 ----
 * favs 顺序 = 收藏时间倒序;与本次拉到的图片求交集
 * (过滤图床已下架的图,LS 记录保留,图片回归后自动恢复) */
const images = ref<Image[]>([]);

/** 图床不可达回退兜底图时,收藏交集几乎必为空,需区分文案 */
const usingFallback = computed(() => isFallback(images.value));

const favImages = computed<Image[]>(() => {
  const byUrl = new Map(images.value.map((img) => [img.url, img]));
  return favs.value
    .map((url) => byUrl.get(url))
    .filter((img): img is Image => img !== undefined);
});

/** 空态文案:真没收藏 vs 有收藏但列表加载失败 */
const favsEmptyText = computed(() => {
  if (favs.value.length > 0 && usingFallback.value) {
    return '图片列表加载失败,暂无法显示收藏';
  }
  return '还没有收藏 — 打开图片点亮 ☆,它们会陈列在这里';
});

function openFav(index: number) {
  const list = favImages.value.map((img) => ({ url: img.url, name: img.name }));
  lb.open(list, index);
}

/* 清空收藏:两击确认(3 秒内再点一次生效),防误触 */
const confirmClear = ref(false);
let clearTimer: ReturnType<typeof setTimeout> | null = null;

function onClearFavs() {
  if (!confirmClear.value) {
    confirmClear.value = true;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { confirmClear.value = false; }, 3000);
    return;
  }
  if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  confirmClear.value = false;
  clearAll();
  showHint('已清空全部收藏');
}

onMounted(async () => {
  // #favs 锚点滚动不依赖图片数据(空态也渲染),先滚再拉列表,免得干等
  if (window.location.hash === '#favs') {
    await nextTick();
    document.getElementById('favs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const { images: list } = await loadImages();
  images.value = list;
});

onUnmounted(() => {
  if (hintTimer) clearTimeout(hintTimer);
  if (clearTimer) clearTimeout(clearTimer);
});
</script>

<template>
  <section class="page-header">
    <h1 class="page-header-title">设置</h1>
    <p class="page-header-sub">调整图片墙的观感 — 偏好仅保存在本浏览器</p>
  </section>

  <main class="settings-main">
    <section class="settings-group" aria-label="外观">
      <header class="group-head">
        <span class="group-icon" aria-hidden="true">🎨</span>
        <div class="group-text">
          <p class="group-name">外观</p>
          <p class="group-sub">主题与全站动效</p>
        </div>
      </header>

      <div class="setting-row">
        <span class="setting-label" id="set-theme-label">主题</span>
        <!-- 三张迷你预览卡替代纯文字切换:缩略示意 = 底色 + 内容条 -->
        <div class="theme-cards" role="radiogroup" aria-labelledby="set-theme-label">
          <button
            v-for="t in THEME_CHOICES"
            :key="t.value"
            type="button"
            class="theme-card"
            :class="{ active: settings.theme === t.value }"
            role="radio"
            :aria-checked="settings.theme === t.value ? 'true' : 'false'"
            @click="settings.theme = t.value"
          >
            <span class="theme-thumb" :data-mode="t.value" aria-hidden="true">
              <span class="theme-thumb-nav"></span>
              <span class="theme-thumb-card"></span>
            </span>
            <span class="theme-name">{{ t.label }}</span>
          </button>
        </div>
        <output class="setting-value">{{ themeLabel }}</output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-motion-label">动效总开关</span>
        <button
          type="button"
          class="toggle"
          :class="{ on: settings.motion }"
          role="switch"
          :aria-checked="settings.motion ? 'true' : 'false'"
          aria-labelledby="set-motion-label"
          @click="settings.motion = !settings.motion"
        />
        <output class="setting-value">{{ settings.motion ? '开' : '全站静止' }}</output>
      </div>
    </section>

    <section class="settings-group" aria-label="图片墙设置">
      <header class="group-head">
        <span class="group-icon" aria-hidden="true">🖼️</span>
        <div class="group-text">
          <p class="group-name">图片墙</p>
          <p class="group-sub">行数、卡片宽度与滚动节奏</p>
        </div>
      </header>

      <div class="setting-row">
        <label class="setting-label" for="set-rows">行数</label>
        <input
          id="set-rows"
          v-model.number="settings.rows"
          type="range"
          :min="ROWS_RANGE.min"
          :max="ROWS_RANGE.max"
          step="1"
          :style="{ '--pct': pctOf(settings.rows, ROWS_RANGE) }"
        >
        <output class="setting-value">{{ settings.rows }} 行</output>
      </div>

      <div class="setting-row">
        <label class="setting-label" for="set-width">卡片宽度</label>
        <input
          id="set-width"
          v-model.number="settings.cardWidth"
          type="range"
          :min="WIDTH_RANGE.min"
          :max="WIDTH_RANGE.max"
          step="10"
          :style="{ '--pct': pctOf(settings.cardWidth, WIDTH_RANGE) }"
        >
        <output class="setting-value">{{ settings.cardWidth }} px</output>
      </div>

      <div class="setting-row">
        <label class="setting-label" for="set-speed">滚动速度</label>
        <input
          id="set-speed"
          v-model.number="settings.speed"
          type="range"
          :min="SPEED_RANGE.min"
          :max="SPEED_RANGE.max"
          step="0.25"
          :style="{ '--pct': pctOf(settings.speed, SPEED_RANGE) }"
        >
        <output class="setting-value">{{ settings.speed }}×</output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-anim-label">滚动动画</span>
        <button
          type="button"
          class="toggle"
          :class="{ on: settings.animate }"
          role="switch"
          :aria-checked="settings.animate ? 'true' : 'false'"
          aria-labelledby="set-anim-label"
          @click="settings.animate = !settings.animate"
        />
        <output class="setting-value">{{ settings.animate ? '开' : '关' }}</output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-rotate-label">内容轮换</span>
        <button
          type="button"
          class="toggle"
          :class="{ on: settings.autoRotate }"
          role="switch"
          :aria-checked="settings.autoRotate ? 'true' : 'false'"
          aria-labelledby="set-rotate-label"
          @click="settings.autoRotate = !settings.autoRotate"
        />
        <output class="setting-value">{{ settings.autoRotate ? '开' : '关' }}</output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-rotate-sec-label">轮换间隔</span>
        <div class="view-switch wrap" role="group" aria-labelledby="set-rotate-sec-label">
          <button
            v-for="s in ROTATE_CHOICES"
            :key="s"
            type="button"
            :class="{ active: settings.rotateSec === s }"
            :disabled="!settings.autoRotate"
            @click="settings.rotateSec = s"
          >{{ s }} 秒</button>
        </div>
        <output class="setting-value">
          {{ settings.autoRotate ? settings.rotateSec + ' 秒' : '关' }}
        </output>
      </div>
    </section>

    <section class="settings-group" aria-label="阅读偏好">
      <header class="group-head">
        <span class="group-icon" aria-hidden="true">📖</span>
        <div class="group-text">
          <p class="group-name">阅读偏好</p>
          <p class="group-sub">博客 / 关于页正文的排版</p>
        </div>
      </header>

      <div class="setting-row">
        <span class="setting-label" id="set-read-fs-label">正文字号</span>
        <div class="view-switch" role="group" aria-labelledby="set-read-fs-label">
          <button
            v-for="v in READING_FONT_CHOICES"
            :key="v"
            type="button"
            :class="{ active: settings.reading.fontSize === v }"
            @click="settings.reading.fontSize = v"
          >{{ READING_FONT_LABEL[v] }}</button>
        </div>
        <output class="setting-value">{{ READING_FONT_LABEL[settings.reading.fontSize] }}</output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-read-lh-label">行距</span>
        <div class="view-switch" role="group" aria-labelledby="set-read-lh-label">
          <button
            v-for="v in READING_LINE_CHOICES"
            :key="v"
            type="button"
            :class="{ active: settings.reading.lineHeight === v }"
            @click="settings.reading.lineHeight = v"
          >{{ READING_LINE_LABEL[v] }}</button>
        </div>
        <output class="setting-value">{{ READING_LINE_LABEL[settings.reading.lineHeight] }}</output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-read-w-label">阅读宽度</span>
        <div class="view-switch" role="group" aria-labelledby="set-read-w-label">
          <button
            v-for="v in READING_WIDTH_CHOICES"
            :key="v"
            type="button"
            :class="{ active: settings.reading.width === v }"
            @click="settings.reading.width = v"
          >{{ READING_WIDTH_LABEL[v] }}</button>
        </div>
        <output class="setting-value">{{ READING_WIDTH_LABEL[settings.reading.width] }}</output>
      </div>
    </section>

    <!-- 我的收藏:图片分区即时可用;「文章 / 音乐」分区为预留实现——
         未来收藏功能落地后按数据自动显隐(见 favorites 模块) -->
    <section id="favs" class="settings-group favs-group" aria-label="我的收藏">
      <header class="group-head">
        <span class="group-icon" aria-hidden="true">⭐</span>
        <div class="group-text">
          <p class="group-name">我的收藏</p>
          <p class="group-sub">已点亮的图片 · 仅本浏览器</p>
        </div>
        <span v-if="favImages.length" class="favs-count">{{ favImages.length }} 张</span>
        <div v-if="favImages.length" class="favs-actions">
          <button type="button" class="favs-btn" @click="openFav(0)">查看全部</button>
          <button type="button" class="favs-btn danger" @click="onClearFavs">
            {{ confirmClear ? '再点一次确认' : '清空' }}
          </button>
        </div>
      </header>

      <div v-if="favImages.length" class="favs-strip" role="list">
        <button
          v-for="(img, i) in favImages"
          :key="img.url"
          type="button"
          class="favs-thumb"
          role="listitem"
          :title="img.name || '查看大图'"
          @click="openFav(i)"
        >
          <div class="img-box" :class="orientClass(img.url)">
            <img
              :src="img.thumb"
              :alt="img.name || '收藏图片'"
              :style="focalStyle(img.url)"
              loading="lazy"
              decoding="async"
            >
          </div>
        </button>
      </div>
      <p v-else class="favs-empty">{{ favsEmptyText }}</p>
    </section>

    <section class="settings-group" aria-label="屏保模式">
      <header class="group-head">
        <span class="group-icon" aria-hidden="true">🌙</span>
        <div class="group-text">
          <p class="group-name">屏保模式</p>
          <p class="group-sub">闲置时的全屏轮播</p>
        </div>
      </header>

      <div class="setting-row">
        <span class="setting-label" id="set-saver-enter-label">屏保模式</span>
        <button
          type="button"
          class="favs-btn enter"
          aria-labelledby="set-saver-enter-label"
          @click="saver.show()"
        >立即进入</button>
        <output class="setting-value">全屏轮播</output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-saver-idle-label">闲置自动进入</span>
        <div class="saver-controls">
          <div class="view-switch wrap" role="group" aria-labelledby="set-saver-idle-label">
            <button
              v-for="m in IDLE_CHOICES"
              :key="m"
              type="button"
              :class="{ active: settings.screensaver.idleMin === m }"
              @click="settings.screensaver.idleMin = m"
            >{{ m === 0 ? '关' : m + ' 分' }}</button>
          </div>
        </div>
        <output class="setting-value">
          {{ settings.screensaver.idleMin === 0 ? '关' : settings.screensaver.idleMin + ' 分' }}
        </output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-saver-interval-label">换图间隔</span>
        <div class="saver-controls">
          <div class="view-switch wrap" role="group" aria-labelledby="set-saver-interval-label">
            <button
              v-for="s in INTERVAL_CHOICES"
              :key="s"
              type="button"
              :class="{ active: settings.screensaver.intervalSec === s }"
              @click="settings.screensaver.intervalSec = s"
            >{{ s }} 秒</button>
          </div>
        </div>
        <output class="setting-value">{{ settings.screensaver.intervalSec }} 秒</output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-saver-order-label">播放顺序</span>
        <div class="view-switch" role="group" aria-labelledby="set-saver-order-label">
          <button
            type="button"
            :class="{ active: settings.screensaver.order === 'random' }"
            @click="settings.screensaver.order = 'random'"
          >随机</button>
          <button
            type="button"
            :class="{ active: settings.screensaver.order === 'seq' }"
            @click="settings.screensaver.order = 'seq'"
          >顺序</button>
        </div>
        <output class="setting-value">{{ settings.screensaver.order === 'random' ? '随机' : '顺序' }}</output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-saver-kb-label">缓慢缩放</span>
        <button
          type="button"
          class="toggle"
          :class="{ on: settings.screensaver.kenBurns }"
          role="switch"
          :aria-checked="settings.screensaver.kenBurns ? 'true' : 'false'"
          aria-labelledby="set-saver-kb-label"
          @click="settings.screensaver.kenBurns = !settings.screensaver.kenBurns"
        />
        <output class="setting-value">{{ settings.screensaver.kenBurns ? '开' : '关' }}</output>
      </div>

      <p class="saver-note">任意点击、按键或滚轮退出屏保</p>
    </section>

    <section class="settings-preview" aria-label="效果预览">
      <div class="preview-track" :style="previewStyle">
        <div v-for="i in previewCards.length" :key="i" class="preview-card" />
      </div>
      <p class="preview-note">预览仅为示意,主页以真实图片效果为准</p>
    </section>

    <div class="settings-actions">
      <button type="button" class="settings-reset" @click="onReset">恢复默认</button>
      <span class="settings-hint" :class="{ show: hintVisible }">{{ hintText }}</span>
    </div>
  </main>
</template>
