<script setup lang="ts">
import { onMounted } from 'vue';
import { usePlayer } from './player';

/* 音乐页:曲目单来自 playlist.ts(双曲库模式)。
 * 播放状态由全站单例 usePlayer 承载,PlayerBar 常驻底部随动。 */
const player = usePlayer();

onMounted(() => {
  /* initPlayer 在 main.ts 已全局调用;这里只是确保 ready 后视图响应式更新 */
});
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
    <div v-if="player.tracks.value.length" class="music-main">
      <div class="music-toolbar">
        <button class="btn btn-accent" type="button" @click="player.toggle()">
          {{ player.playing.value ? '⏸ 暂停' : '▶ 播放全部' }}
        </button>
        <span class="chip">{{ player.MODE_LABEL[player.mode.value] }}播放</span>
      </div>

      <ol class="track-list" role="list">
        <li
          v-for="(t, i) in player.tracks.value"
          :key="t.id"
          class="track-row"
          role="listitem"
        >
          <button
            type="button"
            class="panel-card track-card"
            :class="{ active: player.index.value === i, broken: !t.url }"
            :disabled="!t.url"
            :aria-label="`播放 ${t.title}`"
            @click="player.playAt(i)"
          >
            <span class="track-no" aria-hidden="true">
              <template v-if="player.index.value === i && player.playing.value">♪</template>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="track-cover img-box">
              <img v-if="t.cover" :src="t.cover" :alt="t.title" loading="lazy" decoding="async">
              <span v-else class="track-cover-fallback" aria-hidden="true">♫</span>
            </span>
            <span class="track-meta">
              <span class="track-title">{{ t.title }}</span>
              <span class="track-artist">{{ t.artist }}</span>
            </span>
            <span class="track-source chip">{{ t.source === 'netease' ? '网易云' : '直链' }}</span>
            <span class="track-state" aria-hidden="true">
              {{ player.index.value === i ? (player.playing.value ? '播放中' : player.loading.value ? '缓冲中' : '已暂停') : '' }}
            </span>
          </button>
        </li>
      </ol>
    </div>

    <div v-else class="empty">
      <span class="empty-icon" aria-hidden="true">🎧</span>
      <p class="empty-text">曲库还是空的 — 往 src/site/playlist.ts 的 PLAYLIST 里添加曲目</p>
      <p class="empty-hint">支持两种来源:{ source:'netease', id:'歌曲ID } 或 { source:'url', url:'音频直链', title:'曲名' }</p>
    </div>

    <p v-if="player.error.value" class="music-error" role="alert">{{ player.error.value }}</p>
  </main>
</template>
