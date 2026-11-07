<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { usePlayer } from './player';
import type { PlayMode } from './player';

/* ============================================================
 * 音乐页(v2.8「云端乐律」双卡布局)
 *   背景:当前曲目封面模糊大图 + 主题色遮罩(跟随亮/暗)
 *   左卡:黑胶唱片(播放时旋转 + 中心孔) + 曲目信息 + 进度 + 控制
 *   右卡:歌词/歌单 胶囊分段;歌词当前行靛蓝放大,其余淡出居中滚动
 *   - 歌单 Tab:药丸搜索 + 点击行即播(v2.3 逻辑沿用)
 *   - 播放模式四态:顺序/单曲/循环/随机(SVG 图标)
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

/* ---- 播放模式四态图标(16×16 stroke 路径,顺序/单曲/循环/随机) ---- */
const MODE_PATHS: Record<PlayMode, string> = {
  order: 'M2.3 8h10M9.3 4.8 12.5 8l-3.2 3.2',
  single: 'M11.6 5.5A4.3 4.3 0 1 0 12.3 8M12.3 3.3v2.2h-2.2M7.2 6.2l1-.7v5',
  loop: 'M4.2 5h7.2a2.3 2.3 0 0 1 2.3 2.3v.5M11.8 11H4.6a2.3 2.3 0 0 1-2.3-2.3v-.5M9.9 3.1l1.9 1.9-1.9 1.9M6.1 12.9l-1.9-1.9 1.9-1.9',
  shuffle: 'M2.4 4.6h2.4c1.1 0 2.1.5 2.8 1.4l2.8 3.6c.7.9 1.7 1.4 2.8 1.4h1M2.4 11h2.4c1.1 0 2.1-.5 2.8-1.4l.9-1.2M9.6 6.1l.8-1c.7-.9 1.7-1.4 2.8-1.4h1M11.9 2.5l1.9 1.9-1.9 1.9M11.9 9.7l1.9 1.9-1.9 1.9',
};
</script>

<template>
  <div class="music-page">
    <!-- 背景:当前曲目封面模糊大图 + 主题遮罩(切歌跟随) -->
    <div class="music-bg" aria-hidden="true">
      <img v-if="player.current.value?.cover" :src="player.current.value.cover" alt="">
      <div v-else class="music-bg-grad"></div>
      <div class="music-bg-veil"></div>
    </div>

    <!-- 头部:大标题 + 副标题 -->
    <section class="page-header music-hero">
      <h1 class="page-header-title">云端乐律</h1>
      <p class="page-header-sub">在代码的缝隙中寻找灵魂的共鸣</p>
      <p class="music-hero-meta">
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
        <span class="empty-icon" aria-hidden="true">♫</span>
        <p class="empty-text">曲库还是空的 — 在 Manager 音乐 Tab 或 content/playlist.json 里添加曲目</p>
        <p class="empty-hint">{ "source": "netease", "id": "歌曲ID" } 或 { "source": "url", "url": "直链", "title": "曲名" }</p>
      </div>

      <!-- 播放主体:左黑胶卡 + 右歌词/歌单卡 -->
      <div v-else-if="player.tracks.value.length" class="music-stage fade-in-up">
        <!-- 左卡:黑胶唱片 + 信息 + 进度 + 控制 -->
        <div class="music-card music-card-vinyl panel-card">
          <div class="music-vinyl" :class="{ spinning: player.playing.value }">
            <img v-if="player.current.value?.cover" :src="player.current.value.cover" alt="专辑封面">
            <span v-else class="music-vinyl-fallback" aria-hidden="true">♫</span>
            <i class="music-vinyl-grooves" aria-hidden="true"></i>
            <i class="music-vinyl-hole" aria-hidden="true"></i>
          </div>

          <div class="music-now">
            <span class="music-now-title">{{ player.current.value?.title ?? '未在播放' }}</span>
            <span class="music-now-artist">{{ player.current.value?.artist ?? '从右侧歌单选一首开始' }}</span>
          </div>

          <p v-if="player.error.value" class="music-error" role="alert">{{ player.error.value }}</p>

          <!-- 进度 -->
          <div class="music-progress">
            <span class="music-time">{{ fmtTime(player.currentTime.value) }}</span>
            <button class="music-trackbar" type="button" aria-label="播放进度" @click="onSeek">
              <span class="music-trackbar-fill" :style="{ width: progressPct + '%' }"></span>
            </button>
            <span class="music-time">{{ fmtTime(player.duration.value) }}</span>
          </div>

          <!-- 控制:模式 / 上一首 / 大播放 / 下一首 / 音量 -->
          <div class="music-controls">
            <div class="music-controls-side is-left">
              <button
                class="music-mode"
                type="button"
                :title="`播放模式:${player.MODE_LABEL[player.mode.value]}`"
                :aria-label="`播放模式:${player.MODE_LABEL[player.mode.value]}`"
                @click="player.cycleMode()"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path :d="MODE_PATHS[player.mode.value]" />
                </svg>
              </button>
              <button class="music-ctl" type="button" aria-label="上一首" @click="player.prev()">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4.4 3.4v9.2" />
                  <path class="is-fill" d="M12.8 3.8v8.4L7 8z" />
                </svg>
              </button>
            </div>

            <button
              class="music-ctl music-ctl-main"
              type="button"
              :aria-label="player.playing.value ? '暂停' : '播放'"
              @click="player.index.value < 0 ? player.playAt(0) : player.toggle()"
            >
              <svg v-if="player.playing.value" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5.6 3.4v9.2M10.4 3.4v9.2" class="is-heavy" />
              </svg>
              <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                <path class="is-fill" d="M5.4 3.4v9.2L13.2 8z" />
              </svg>
            </button>

            <div class="music-controls-side is-right">
              <button class="music-ctl" type="button" aria-label="下一首" @click="player.next()">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M11.6 3.4v9.2" />
                  <path class="is-fill" d="M3.2 3.8v8.4L9 8z" />
                </svg>
              </button>
              <label class="music-vol" title="音量">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path class="is-fill" d="M2.6 6.1v3.8h2.3l3.5 2.7V3.4L4.9 6.1z" />
                  <path d="M10.6 5.7a3.4 3.4 0 0 1 0 4.6M12.6 4a6 6 0 0 1 0 8" />
                </svg>
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
          </div>
        </div>

        <!-- 右卡:歌词 / 歌单 -->
        <div class="music-card music-card-panel panel-card">
          <div class="music-tabs" role="tablist" aria-label="歌词与歌单">
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
            >歌单 {{ player.tracks.value.length }}</button>
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

          <!-- 歌单 -->
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
  </div>
</template>
