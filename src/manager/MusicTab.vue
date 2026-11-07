<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  loadPlaylist, savePlaylist, syncDeploy, toast,
  type MTrack,
} from './api';

/* 音乐写作台:曲库表格(双模式),保存写 content/playlist.json。
 * 站点端由 playlist.ts 类型化装载,netease 详情运行时经 /api/music 补全。 */

const tracks = ref<MTrack[]>([]);
const loading = ref(false);
const dirty = ref(false);
const deploying = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    const data = await loadPlaylist();
    tracks.value = data ?? [];
  } finally {
    loading.value = false;
  }
});

function addTrack(source: 'netease' | 'url') {
  tracks.value.push(source === 'netease' ? { source, id: '' } : { source, url: '', title: '', artist: '' });
  dirty.value = true;
}

function removeTrack(i: number) {
  tracks.value.splice(i, 1);
  dirty.value = true;
}

function markDirty() { dirty.value = true; }

function move(i: number, delta: number) {
  const j = i + delta;
  if (j < 0 || j >= tracks.value.length) return;
  const [t] = tracks.value.splice(i, 1);
  tracks.value.splice(j, 0, t);
  dirty.value = true;
}

async function onSave() {
  if (!(await savePlaylist(tracks.value))) return;
  dirty.value = false;
  toast(`曲库已保存(${tracks.value.length} 首),部署后生效`, 'success');
}

async function onSaveDeploy() {
  deploying.value = true;
  try {
    if (!(await savePlaylist(tracks.value))) return;
    dirty.value = false;
    const msg = await syncDeploy('content/playlist.json');
    if (msg) toast('曲库已推送,Cloudflare 将自动构建', 'success');
  } finally {
    deploying.value = false;
  }
}
</script>

<template>
  <div class="musictab">
    <div class="mt-bar">
      <button class="btn" type="button" @click="addTrack('netease')">+ 网易云曲目</button>
      <button class="btn" type="button" @click="addTrack('url')">+ 直链曲目</button>
      <span class="mt-bar-gap"></span>
      <button class="btn" type="button" :disabled="loading" @click="onSave">保存</button>
      <button class="btn btn-primary" type="button" :disabled="loading || deploying" @click="onSaveDeploy">
        {{ deploying ? '推送中…' : '保存并部署' }}
      </button>
    </div>

    <p class="mt-hint">
      网易云曲目只填歌曲 ID,歌名/封面/歌词由 /api/music 代理运行时补全;
      直链曲目自备音频地址(标题必填)。顺序 = 播放列表顺序。
    </p>

    <div v-if="loading" class="mt-empty">加载中…</div>
    <div v-else-if="tracks.length === 0" class="mt-empty">曲库为空 — 点击上方按钮添加曲目</div>

    <table v-else class="mt-table">
      <thead>
        <tr>
          <th style="width: 34px">#</th>
          <th style="width: 90px">来源</th>
          <th>ID / 音频直链</th>
          <th style="width: 22%">标题</th>
          <th style="width: 16%">歌手</th>
          <th style="width: 110px">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(t, i) in tracks" :key="i">
          <td class="mt-no">{{ i + 1 }}</td>
          <td><span class="chip">{{ t.source === 'netease' ? '网易云' : '直链' }}</span></td>
          <td>
            <input
              v-if="t.source === 'netease'"
              v-model="t.id"
              class="input"
              placeholder="歌曲 ID(纯数字)"
              @input="markDirty"
            >
            <input
              v-else
              v-model="t.url"
              class="input"
              placeholder="https://…/song.mp3"
              @input="markDirty"
            >
          </td>
          <td>
            <input
              v-if="t.source === 'url'"
              v-model="t.title"
              class="input"
              placeholder="必填"
              @input="markDirty"
            >
            <span v-else class="mt-auto">代理补全</span>
          </td>
          <td>
            <input
              v-if="t.source === 'url'"
              v-model="t.artist"
              class="input"
              placeholder="可选"
              @input="markDirty"
            >
            <span v-else class="mt-auto">代理补全</span>
          </td>
          <td class="mt-ops">
            <button class="icon-btn" type="button" title="上移" :disabled="i === 0" @click="move(i, -1)">↑</button>
            <button class="icon-btn" type="button" title="下移" :disabled="i === tracks.length - 1" @click="move(i, 1)">↓</button>
            <button class="icon-btn icon-btn-danger" type="button" title="删除" @click="removeTrack(i)">×</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="dirty" class="mt-dirty">● 有未保存改动</p>
  </div>
</template>
