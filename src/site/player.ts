/* ============================================================
 * player — 全站常驻播放器单例(MPA 跨页续播)
 * ------------------------------------------------------------
 * 架构:
 *   - 模块级单例(同 settings/lbState 模式),PlayerBar/MusicView 共享
 *   - HTMLAudioElement 惰性创建(首次 play 才 new,空库/未交互零开销)
 *   - 曲库由 resolvePlaylist() 异步解析(netease 走 /api/music 代理)
 *
 * 跨页续播(MPA 语义,与 SPA 不同):
 *   - 每次导航都是整页加载,audio 元素随页面销毁,无法真连续
 *   - 因此「续播」= 状态三件套(曲目/进度/音量)持久化到 localStorage,
 *     新页面 init 时恢复曲目并 seek 到上次进度,但【不自动播放】
 *     (浏览器 autoplay 政策也拦);用户点播放从断点继续
 *   - BroadcastChannel 做多 tab 互斥:任一 tab 开始播放,其它 tab 暂停,
 *     防止两个页面同时出声
 *
 * 歌词轴:
 *   - parseLrc() 解析 LRC 文本([mm:ss.xx] 支持)、二分定位当前行
 *   - activeLrcIdx 随 timeupdate 更新,PlayerBar 渲染高亮行
 * ============================================================ */
import { ref, computed, readonly } from 'vue';
import { resolvePlaylist, PLAYLIST } from './playlist';
import type { Track } from './playlist';

export type PlayMode = 'order' | 'loop' | 'shuffle';

const LS_KEY = 'vshowcase.player';
const CHANNEL_NAME = 'vshowcase-player';
/** 进度持久化节流:timeupdate ~4 次/秒,localStorage 同步写不能这么频 */
const SAVE_EVERY_MS = 3000;
/** 恢复进度若接近曲尾视为听完了(不 seek 到结尾) */
const TAIL_EPSILON_SEC = 8;

/* ---------- LRC 解析(纯函数,可单测) ---------- */

export interface LrcLine {
  /** 秒 */
  t: number;
  text: string;
}

/** 解析 LRC:[mm:ss.xx] / [mm:ss] 时间标签(一行多标签支持),非歌词行(元数据)跳过 */
export function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = [];
  const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of String(lrc).split(/\r?\n/)) {
    re.lastIndex = 0;
    const tags: number[] = [];
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = re.exec(raw)) !== null) {
      if (m.index !== lastEnd) break;           // 时间标签必须连续开头,否则当普通行
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracRaw = m[3] ?? '0';
      const frac = parseInt(fracRaw, 10) / 10 ** fracRaw.length;
      tags.push(min * 60 + sec + frac);
      lastEnd = re.lastIndex;
    }
    if (tags.length === 0) continue;
    const text = raw.slice(lastEnd).trim();
    for (const t of tags) out.push({ t, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** 二分查找:当前时刻应高亮的歌词行(「已开始唱的最后一行」;-1 = 还没唱) */
export function activeLrcIndex(lines: LrcLine[], time: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= time) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

/** 下一首索引(mode 纯函数,可单测;shuffle 用随机,空/单曲返回自身) */
export function nextIndex(index: number, mode: PlayMode, len: number): number {
  if (len <= 0) return -1;
  if (len === 1) return 0;
  if (mode === 'shuffle') {
    let n = index;
    while (n === index) n = Math.floor(Math.random() * len);
    return n;
  }
  const step = mode === 'loop' ? 1 : 1;
  const next = index + step;
  if (next >= len) return mode === 'loop' ? 0 : index;  // order 停在最后一首
  return next;
}

function prevIndex(index: number, mode: PlayMode, len: number): number {
  if (len <= 0) return -1;
  if (len === 1) return 0;
  if (mode === 'shuffle') return nextIndex(index, mode, len);
  const p = index - 1;
  if (p < 0) return mode === 'loop' ? len - 1 : 0;      // order 停在第一首
  return p;
}

/* ---------- 持久化状态 ---------- */

interface SavedState {
  index: number;
  time: number;
  volume: number;
  mode: PlayMode;
  /** 保存时刻是否正在播放(恢复时仅作提示,不自动续播) */
  playing: boolean;
}

function loadSaved(): Partial<SavedState> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function saveState(s: {
  index: number; time: number; volume: number; mode: PlayMode; playing: boolean;
}): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch { /* 隐私模式等写入失败静默 */ }
}

/* ---------- 单例状态 ---------- */

const tracks = ref<Track[]>([]);
const ready = ref(false);
const failed = ref(0);
const index = ref(-1);            // -1 = 未选曲(空库/尚未播放)
const playing = ref(false);
const loading = ref(false);       // 音频缓冲中
const error = ref('');
const currentTime = ref(0);
const duration = ref(0);
const volume = ref(clamp01(loadSaved().volume ?? 0.8));
const mode = ref<PlayMode>(isValidMode(loadSaved().mode) ? loadSaved().mode as PlayMode : 'order');

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
}
function isValidMode(v: unknown): boolean {
  return v === 'order' || v === 'loop' || v === 'shuffle';
}

const current = computed<Track | null>(() => (index.value >= 0 && index.value < tracks.value.length ? tracks.value[index.value] : null));
const lrcLines = computed<LrcLine[]>(() => parseLrc(current.value?.lrc || ''));
const activeLrcIdx = ref(-1);

/* ---------- audio 元素(惰性) ---------- */

let audio: HTMLAudioElement | null = null;
let channel: BroadcastChannel | null = null;
let initialized = false;
let lastSaveAt = 0;

function ensureAudio(): HTMLAudioElement | null {
  if (audio) return audio;
  if (typeof Audio === 'undefined') return null;    // 非浏览器环境(测试)不建
  audio = new Audio();
  audio.preload = 'metadata';
  audio.volume = volume.value;
  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('loadedmetadata', () => { duration.value = audio!.duration || 0; });
  audio.addEventListener('play', () => { playing.value = true; syncBodyClass(); });
  audio.addEventListener('pause', () => { playing.value = false; syncBodyClass(); });
  audio.addEventListener('waiting', () => { loading.value = true; });
  audio.addEventListener('playing', () => { loading.value = false; error.value = ''; });
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', () => {
    if (!current.value) return;
    loading.value = false;
    playing.value = false;
    error.value = `「${current.value.title}」加载失败,试试其它曲目或直链源`;
  });
  return audio;
}

function onTimeUpdate(): void {
  if (!audio) return;
  currentTime.value = audio.currentTime;
  activeLrcIdx.value = activeLrcIndex(lrcLines.value, audio.currentTime);
  const now = Date.now();
  if (now - lastSaveAt >= SAVE_EVERY_MS) {
    lastSaveAt = now;
    persist();
  }
}

function onEnded(): void {
  const len = tracks.value.length;
  if (len === 0) return;
  const modeV = mode.value;
  if (modeV === 'order' && index.value === len - 1) {
    // 顺序模式播完最后一句:停住,回起点待播
    playing.value = false;
    if (audio) audio.currentTime = 0;
    persist();
    return;
  }
  playAt(nextIndex(index.value, modeV, len));
}

/** 播放器有活动会话(选了曲/正在播)时给 body 挂类,页脚/回顶部让位 */
function syncBodyClass(): void {
  if (typeof document === 'undefined') return;
  const has = index.value >= 0;
  document.body.classList.toggle('has-player', has);
}

function persist(): void {
  saveState({
    index: index.value,
    time: currentTime.value,
    volume: volume.value,
    mode: mode.value,
    playing: playing.value,
  });
}

function broadcast(): void {
  try {
    channel?.postMessage({ index: index.value, playing: playing.value, time: currentTime.value });
  } catch { /* 通道关闭等静默 */ }
}

/* ---------- 公开操作 ---------- */

/** 播放指定曲目(默认当前)。切曲 = 换 src + 播放 */
async function playAt(i: number): Promise<void> {
  const t = tracks.value[i];
  if (!t || !t.url) { if (t) error.value = `「${t.title}」暂无可播放地址`; return; }
  const a = ensureAudio();
  if (!a) return;
  if (index.value !== i || a.src !== t.url) {
    index.value = i;
    error.value = '';
    currentTime.value = 0;
    duration.value = 0;
    activeLrcIdx.value = -1;
    a.src = t.url;
  }
  try {
    await a.play();
    broadcast();          // 通知其它 tab 暂停(互斥)
  } catch {
    // NotAllowedError(未交互)/网络错:playing 由 pause 事件兜底
  }
  persist();
}

function pause(): void {
  audio?.pause();
  persist();
  broadcast();
}

/** 播放/暂停;未选曲从第一首开始 */
function toggle(): void {
  if (index.value < 0) {
    if (tracks.value.length > 0) void playAt(0);
    return;
  }
  if (playing.value) pause();
  else void playAt(index.value);
}

function next(): void {
  if (tracks.value.length === 0) return;
  void playAt(nextIndex(index.value < 0 ? 0 : index.value, mode.value, tracks.value.length));
}

function prev(): void {
  if (tracks.value.length === 0) return;
  // 播放 >3s 时 prev = 回到本曲开头(播放器惯例)
  if (audio && currentTime.value > 3) { audio.currentTime = 0; return; }
  void playAt(prevIndex(index.value < 0 ? 0 : index.value, mode.value, tracks.value.length));
}

function seek(t: number): void {
  const a = ensureAudio();
  if (!a || !Number.isFinite(t)) return;
  a.currentTime = Math.min(Math.max(0, t), duration.value || t);
  currentTime.value = a.currentTime;
}

function setVolume(v: number): void {
  volume.value = clamp01(v);
  if (audio) audio.volume = volume.value;
  persist();
}

function cycleMode(): void {
  mode.value = mode.value === 'order' ? 'loop' : mode.value === 'loop' ? 'shuffle' : 'order';
  persist();
}

const MODE_LABEL: Record<PlayMode, string> = { order: '顺序', loop: '循环', shuffle: '随机' };

/* ---------- 初始化 ---------- */

/**
 * main.ts 调用一次:解析曲库 + 恢复上次会话状态。
 * 空库/代理失败都不抛错(UI 空状态兜底)。
 */
export async function initPlayer(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const saved = loadSaved();

  // BroadcastChannel 互斥:别的 tab 在播 → 本 tab 保持静默
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (e: MessageEvent) => {
        const msg = e.data as { index?: number; playing?: boolean } | null;
        if (msg && msg.playing && playing.value) {
          audio?.pause();
        }
      };
    } catch { channel = null; }
  }

  const { tracks: resolved, failed: failedCount } = await resolvePlaylist(PLAYLIST);
  tracks.value = resolved;
  failed.value = failedCount;
  ready.value = true;

  // 恢复上次曲目与进度(不自动播放;接近曲尾的进度视为听完,从头开始)
  const savedIdx = Math.round(Number(saved.index));
  if (tracks.value.length > 0 && savedIdx >= 0 && savedIdx < tracks.value.length) {
    const t = tracks.value[savedIdx];
    index.value = savedIdx;
    if (t.url) {
      const a = ensureAudio();
      if (a) {
        a.src = t.url;
        const time = Number(saved.time);
        if (Number.isFinite(time) && time > 0) {
          // loadedmetadata 后才可可靠 seek;metadata 够了先记意图
          const doSeek = () => {
            if (!audio) return;
            if (audio.duration && time >= audio.duration - TAIL_EPSILON_SEC) return;
            audio.currentTime = time;
            currentTime.value = time;
          };
          if (a.readyState >= 1) doSeek();
          else a.addEventListener('loadedmetadata', doSeek, { once: true });
        }
      }
    }
    syncBodyClass();
  }
  if (typeof document !== 'undefined') document.body.classList.toggle('has-player', index.value >= 0);
}

export function usePlayer() {
  return {
    tracks: readonly(tracks),
    ready: readonly(ready),
    failed: readonly(failed),
    index: readonly(index),
    current,
    playing: readonly(playing),
    loading: readonly(loading),
    error: readonly(error),
    currentTime: readonly(currentTime),
    duration: readonly(duration),
    volume: readonly(volume),
    mode: readonly(mode),
    MODE_LABEL,
    lrcLines,
    activeLrcIdx: readonly(activeLrcIdx),
    playAt: (i: number) => playAt(i),
    pause,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    cycleMode,
  };
}
