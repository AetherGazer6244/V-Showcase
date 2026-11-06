<script setup lang="ts">
import { computed, ref } from 'vue';
import { usePlayer } from './player';

/* 全站常驻播放条:有活动会话(选了曲)才显示。
 * 进度条/歌词面板/音量/播放模式,跨页续播逻辑在 player.ts。 */
const player = usePlayer();

const visible = computed(() => player.index.value >= 0);
const showLrc = ref(false);

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* 进度条点击跳转:click x / width → 秒 */
function onSeek(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  player.seek(ratio * (player.duration.value || 0));
}

const progressPct = computed(() => {
  const d = player.duration.value;
  return d > 0 ? Math.min(100, (player.currentTime.value / d) * 100) : 0;
});

/* 歌词窗口:当前行上下各 2 行 */
const lrcWindow = computed(() => {
  const lines = player.lrcLines.value;
  if (lines.length === 0) return [];
  const cur = player.activeLrcIdx.value;
  const from = Math.max(0, Math.min(cur - 2, lines.length - 5));
  return lines.slice(from, from + 5).map((l, i) => ({ text: l.text, active: from + i === cur }));
});

const hasLrc = computed(() => player.lrcLines.value.length > 0);
</script>

<template>
  <div v-if="visible" class="player-bar" role="region" aria-label="播放条">
    <!-- 歌词面板 -->
    <div v-if="showLrc && hasLrc" class="player-lrc" aria-live="polite">
      <p
        v-for="(l, i) in lrcWindow"
        :key="(l.text || '·') + i"
        class="lrc-line"
        :class="{ active: l.active }"
      >{{ l.text || '♪' }}</p>
    </div>
    <p v-else-if="showLrc" class="player-lrc player-lrc-none">这首曲目暂无歌词</p>

    <div class="player-main">
      <!-- 曲目信息 -->
      <div class="player-track">
        <span class="player-cover img-box">
          <img v-if="player.current.value?.cover" :src="player.current.value.cover" alt="" loading="lazy">
          <span v-else class="player-cover-fallback" aria-hidden="true">♫</span>
        </span>
        <span class="player-names">
          <span class="player-title">{{ player.current.value?.title }}</span>
          <span class="player-artist">{{ player.current.value?.artist }}</span>
        </span>
      </div>

      <!-- 控制 + 进度 -->
      <div class="player-center">
        <div class="player-controls">
          <button class="player-btn" type="button" aria-label="上一首" @click="player.prev()">⏮</button>
          <button
            class="player-btn player-btn-main"
            type="button"
            :aria-label="player.playing.value ? '暂停' : '播放'"
            @click="player.toggle()"
          >{{ player.playing.value ? '⏸' : player.loading.value ? '…' : '▶' }}</button>
          <button class="player-btn" type="button" aria-label="下一首" @click="player.next()">⏭</button>
        </div>
        <div class="player-progress">
          <span class="player-time">{{ fmtTime(player.currentTime.value) }}</span>
          <button
            class="player-trackbar"
            type="button"
            aria-label="播放进度"
            @click="onSeek"
          >
            <span class="player-trackbar-fill" :style="{ width: progressPct + '%' }"></span>
          </button>
          <span class="player-time">{{ fmtTime(player.duration.value) }}</span>
        </div>
      </div>

      <!-- 模式 / 歌词 / 音量 -->
      <div class="player-side">
        <button
          class="player-btn player-mode"
          type="button"
          :aria-label="`播放模式:${player.MODE_LABEL[player.mode.value]}`"
          :title="`播放模式:${player.MODE_LABEL[player.mode.value]}`"
          @click="player.cycleMode()"
        >{{ player.mode.value === 'order' ? '→' : player.mode.value === 'loop' ? '∞' : '⤨' }}</button>
        <button
          v-if="hasLrc"
          class="player-btn player-lrc-btn"
          :class="{ on: showLrc }"
          type="button"
          aria-label="歌词"
          aria-pressed="false"
          title="歌词"
          @click="showLrc = !showLrc"
        >词</button>
        <label class="player-vol">
          <span aria-hidden="true">🔈</span>
          <input
            class="player-vol-range"
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="player.volume.value"
            aria-label="音量"
            @input="player.setVolume(Number(($event.target as HTMLInputElement).value))"
          >
        </label>
      </div>
    </div>
  </div>
</template>
