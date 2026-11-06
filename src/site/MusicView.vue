<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { usePlayer } from './player';

/* ============================================================
 * 音乐页(v2.3 对齐 Cecilian-Hub /music)
 *   左:大圆角封面(+播放辉光)  右:当前曲目信息 + 控制 + 歌词/列表 Tab
 *   - 列表 Tab:药丸搜索 + 点击行即播
 *   - 歌词 Tab:当前行自动居中滚动(player.ts 的 parseLrc 复用)
 *   - 播放模式四态:顺序/单曲/循环/随机(MODE_GLYPH)
 * 播放状态仍由全站单例承载;迷你胶囊(FloatingCapsule)随动。
 * ============================================================ */
const player = usePlayer();

const activeTab = ref<'lyrics' | 'list'>('lyrics');
const searchQ = ref('');

/** 列表搜索:歌名/歌手包含即命中(带原索引,点击回填 playAt) */
const filteredTracks = computed(() => {
  const q = searchQ.value.trim().toLowerCase();
  const all = player.tracks.value.map((t, i) => ({ t, i }));
  if (!q) return all;
  return all.filter(({ t }) =>
    t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q));
});

/* ---- 歌词自动居中滚动 ---- */
const lyricBox = ref<HTMLElement | null>(null);

async function scrollLyricToCenter(): Promise<void> {
  await nextTick();
  const c = lyricBox.value;
  const a = c?.querySelector<HTMLElement>('.music-lrc-line.active');
  if (!c || !a) return;
  c.scrollTop = a.offsetTop - c.offsetHeight / 2 + a.offsetHeight / 2;
}

watch(() => player.activeLrcIdx.value, () => {
  if (activeTab.value === 'lyrics') void scrollLyricToCenter();
});

function switchTab(tab: 'lyrics' | 'list'): void {
  activeTab.value = tab;
  if (tab === 'lyrics') void scrollLyricToCenter();
}

/* ---- 进度/时间 ---- */
function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const progressPct = computed(() => {
  const d = player.duration.value;
  return d > 0 ? Math.min(100, (player.currentTime.value / d) * 100) : 0;
});

function onSeek(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  player.seek(ratio * (player.duration.value || 0));
}

/** 点击歌词行跳转到该句时间 */
function seekToLyric(idx: number): void {
  const line = player.lrcLines.value[idx];
  if (line) player.seek(line.t);
}
</script>

<template>
  <section class="page-header">
    <h1 class="page-header-title">音乐</h1>
    <p class="page-header-sub">
      <template v-if="player.ready.value && player.tracks.value.length">
        双曲库模式 · 共 {{ player.tracks.value.length }} 首
        <template v-if="player.failed.value > 0"> · {{ player.failed.value }} 首加载失败</template>
      </template>
      <template v-else-if="player.ready.value">曲库待填充 · 支持网易云 ID 与直链双模式</template>
      <template v-else>曲库加载中…</template>
    </p>
  </section>

  <main class="page-header-main">
    <!-- 空库 -->
    <div v-if="player.ready.value && player.tracks.value.length === 0" class="empty fade-in-up">
      <span class="empty-icon" aria-hidden="true">🎧</span>
      <p class="empty-text">曲库还是空的 — 在 Manager 音乐 Tab 或 content/playlist.json 里添加曲目</p>
      <p class="empty-hint">{ "source": "netease", "id": "歌曲ID" } 或 { "source": "url", "url": "直链", "title": "曲名" }</p>
    </div>

    <!-- 播放主体 -->
    <div v-else-if="player.tracks.value.length" class="music-stage fade-in-up">
      <!-- 左:大封面 -->
      <div class="music-cover-col">
        <div class="music-cover" :class="{ playing: player.playing.value }">
          <img v-if="player.current.value?.cover" :src="player.current.value.cover" alt="封面">
          <span v-else class="music-cover-fallback" aria-hidden="true">♫</span>
        </div>
        <p v-if="player.error.value" class="music-error" role="alert">{{ player.error.value }}</p>
      </div>

      <!-- 右:当前曲目 + 控制 + Tab -->
      <div class="music-panel panel-card">
        <div class="music-now">
          <span class="music-now-title">{{ player.current.value?.title ?? '未在播放' }}</span>
          <span class="music-now-artist">{{ player.current.value?.artist ?? '从右侧列表选一首开始' }}</span>
        </div>

        <!-- 进度 -->
        <div class="music-progress">
          <span class="music-time">{{ fmtTime(player.currentTime.value) }}</span>
          <button class="music-trackbar" type="button" aria-label="播放进度" @click="onSeek">
            <span class="music-trackbar-fill" :style="{ width: progressPct + '%' }"></span>
          </button>
          <span class="music-time">{{ fmtTime(player.duration.value) }}</span>
        </div>

        <!-- 控制:模式 / 上一首 / 播放 / 下一首 / 音量 -->
        <div class="music-controls">
          <button
            class="music-mode"
            type="button"
            :title="`播放模式:${player.MODE_LABEL[player.mode.value]}`"
            :aria-label="`播放模式:${player.MODE_LABEL[player.mode.value]}`"
            @click="player.cycleMode()"
          >
            <span aria-hidden="true">{{ player.MODE_GLYPH[player.mode.value] }}</span>
            <span class="music-mode-label">{{ player.MODE_LABEL[player.mode.value] }}</span>
          </button>
          <button class="music-ctl" type="button" aria-label="上一首" @click="player.prev()">⏮</button>
          <button
            class="music-ctl music-ctl-main"
            type="button"
            :aria-label="player.playing.value ? '暂停' : '播放'"
            @click="player.index.value < 0 ? player.playAt(0) : player.toggle()"
          >{{ player.playing.value ? '❚❚' : player.loading.value ? '…' : '▶' }}</button>
          <button class="music-ctl" type="button" aria-label="下一首" @click="player.next()">⏭</button>
          <label class="music-vol" title="音量">
            <span aria-hidden="true">🔈</span>
            <input
              class="music-vol-range"
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

        <!-- Tab:歌词 / 列表 -->
        <div class="music-tabs" role="tablist" aria-label="歌词与列表">
          <button
            type="button"
            class="music-tab"
            role="tab"
            :class="{ on: activeTab === 'lyrics' }"
            :aria-selected="activeTab === 'lyrics'"
            @click="switchTab('lyrics')"
          >歌词</button>
          <button
            type="button"
            class="music-tab"
            role="tab"
            :class="{ on: activeTab === 'list' }"
            :aria-selected="activeTab === 'list'"
            @click="switchTab('list')"
          >列表 {{ player.tracks.value.length }}</button>
        </div>

        <!-- 歌词 -->
        <div v-show="activeTab === 'lyrics'" ref="lyricBox" class="music-lyrics" aria-live="polite">
          <template v-if="player.lrcLines.value.length">
            <button
              v-for="(l, i) in player.lrcLines.value"
              :key="(l.t || 0) + '-' + i"
              type="button"
              class="music-lrc-line"
              :class="{ active: player.activeLrcIdx.value === i }"
              @click="seekToLyric(i)"
            >{{ l.text }}</button>
          </template>
          <p v-else class="music-lrc-none">这首曲目暂无歌词 ♪</p>
        </div>

        <!-- 列表 -->
        <div v-show="activeTab === 'list'" class="music-list">
          <label class="music-search">
            <svg class="music-search-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
              <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <input v-model="searchQ" type="text" placeholder="搜索歌名或歌手…" autocomplete="off">
          </label>
          <div class="music-rows">
            <button
              v-for="{ t, i } in filteredTracks"
              :key="t.id"
              type="button"
              class="music-row"
              :class="{ active: player.index.value === i, broken: !t.url }"
              :disabled="!t.url"
              @click="player.playAt(i)"
            >
              <span class="music-row-no" aria-hidden="true">
                {{ player.index.value === i && player.playing.value ? '♪' : i + 1 }}
              </span>
              <span class="music-row-cover img-box">
                <img v-if="t.cover" :src="t.cover" :alt="t.title" loading="lazy" decoding="async">
                <span v-else class="music-row-cover-fb" aria-hidden="true">♫</span>
              </span>
              <span class="music-row-meta">
                <span class="music-row-title">{{ t.title }}</span>
                <span class="music-row-artist">{{ t.artist }}</span>
              </span>
              <span class="music-row-src">{{ t.source === 'netease' ? '网易云' : '直链' }}</span>
            </button>
            <p v-if="filteredTracks.length === 0" class="music-lrc-none">没找到「{{ searchQ }}」相关的歌曲</p>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
