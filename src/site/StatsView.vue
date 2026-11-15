<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { formatInt } from '@/shared/utils';
import {
  fetchStats,
  chartScale,
  loadOwnerKey,
  saveOwnerKey,
  clearOwnerKey,
  StatsError,
  type StatsData,
} from './stats';

/* ============================================================
 * 站长统计(v2.13)—— 只有站长能看的经营数据
 * ------------------------------------------------------------
 * 两道门:
 *   1. 全站密码(中间件):进站的访客都过得了
 *   2. 站长密码 OWNER_PASSWORD(本页面 + /api/stats):
 *      访客即使拿到站点密码也看不到统计数据
 * 站长密码只存 sessionStorage(关掉标签页即失效),
 * 错一次就清掉重来。
 * ============================================================ */

const data = ref<StatsData | null>(null);
const loading = ref(false);
const errorMsg = ref('');
const password = ref('');
/** 已解锁(有密钥且成功取到数) */
const unlocked = ref(false);

const scale = computed(() => chartScale(data.value?.daily ?? []));
/** 图表尺寸:每组两根柱,组宽固定,viewBox 随天数伸缩 */
const CHART_GROUP_W = 26;
const CHART_BAR_W = 9;
const CHART_H = 120;
const chartWidth = computed(() => Math.max(CHART_GROUP_W, scale.value.bars.length * CHART_GROUP_W));

/** 'MM-DD' 短日期(图表刻度与表格都用它) */
function shortDay(day: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[1]}-${m[2]}` : day;
}

/** 柱子的 y 坐标(从底部往上) */
function barY(ratio: number): number {
  const h = Math.max(0, Math.min(1, ratio)) * CHART_H;
  return CHART_H - h;
}
function barH(ratio: number): number {
  return Math.max(0, Math.min(1, ratio)) * CHART_H;
}

async function load(): Promise<void> {
  const key = loadOwnerKey();
  if (!key) {
    unlocked.value = false;
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    data.value = await fetchStats(key);
    unlocked.value = true;
  } catch (err) {
    data.value = null;
    unlocked.value = false;
    if (err instanceof StatsError && err.status === 401) {
      // 密码变了或输错了:清掉重问
      clearOwnerKey();
      errorMsg.value = err.message || '站长密码不正确';
    } else {
      errorMsg.value = err instanceof StatsError ? err.message : '统计读取失败';
    }
  } finally {
    loading.value = false;
  }
}

async function submit(): Promise<void> {
  const key = password.value.trim();
  if (!key) {
    errorMsg.value = '请输入站长密码';
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    data.value = await fetchStats(key);
    saveOwnerKey(key);
    password.value = '';
    unlocked.value = true;
  } catch (err) {
    const msg = err instanceof StatsError ? err.message : '统计读取失败';
    errorMsg.value = msg;
    if (err instanceof StatsError && err.status === 401) {
      clearOwnerKey();
      password.value = '';
    }
  } finally {
    loading.value = false;
  }
}

/** 退出统计(清掉本机保存的站长密码) */
function logout(): void {
  clearOwnerKey();
  data.value = null;
  unlocked.value = false;
  errorMsg.value = '';
}

onMounted(() => {
  document.title = '站长统计 · V-Showcase';
  void load();
});
</script>

<template>
  <section class="page-header stats-header">
    <h1 class="page-header-title">站长统计</h1>
    <p class="page-header-sub">访客与点赞数据 · 仅站长可见</p>
  </section>

  <main class="stats-main">
    <!-- 未解锁:要密码 -->
    <section v-if="!unlocked" class="panel-card stats-lock">
      <h2 class="stats-lock-title">请输入站长密码</h2>
      <p class="stats-lock-sub">与站点访问密码不同,只用于查看统计数据</p>
      <form class="stats-lock-form" @submit.prevent="submit">
        <input
          v-model="password"
          class="stats-lock-input"
          type="password"
          placeholder="站长密码"
          autocomplete="current-password"
          aria-label="站长密码"
        >
        <button class="stats-lock-btn" type="submit" :disabled="loading">
          {{ loading ? '验证中…' : '查 看' }}
        </button>
      </form>
      <p v-if="errorMsg" class="stats-lock-msg" role="alert">{{ errorMsg }}</p>
    </section>

    <!-- 已解锁:数据面板 -->
    <template v-else>
      <div class="stats-cards">
        <div class="panel-card stats-card">
          <span class="stats-card-label">总访问</span>
          <strong class="stats-card-value">{{ formatInt(data?.totals.pv ?? 0) }}</strong>
        </div>
        <div class="panel-card stats-card">
          <span class="stats-card-label">总访客</span>
          <strong class="stats-card-value">{{ formatInt(data?.totals.uv ?? 0) }}</strong>
        </div>
        <div class="panel-card stats-card">
          <span class="stats-card-label">今日访问</span>
          <strong class="stats-card-value">{{ formatInt(data?.totals.today.pv ?? 0) }}</strong>
        </div>
        <div class="panel-card stats-card">
          <span class="stats-card-label">今日访客</span>
          <strong class="stats-card-value">{{ formatInt(data?.totals.today.uv ?? 0) }}</strong>
        </div>
      </div>

      <section class="panel-card stats-panel">
        <div class="stats-panel-head">
          <h2 class="stats-panel-title">访问趋势(近 30 天)</h2>
          <div class="stats-panel-ops">
            <span class="stats-legend"><i class="stats-dot stats-dot-pv" aria-hidden="true"></i>访问</span>
            <span class="stats-legend"><i class="stats-dot stats-dot-uv" aria-hidden="true"></i>访客</span>
            <button class="stats-btn" type="button" :disabled="loading" @click="load">刷新</button>
            <button class="stats-btn stats-btn-ghost" type="button" @click="logout">退出</button>
          </div>
        </div>

        <div v-if="scale.bars.length" class="stats-chart" role="img" aria-label="每日访问与访客趋势柱状图">
          <svg :viewBox="`0 0 ${chartWidth} ${CHART_H}`" preserveAspectRatio="none" class="stats-chart-svg">
            <g v-for="(bar, i) in scale.bars" :key="bar.day">
              <rect
                class="stats-bar stats-bar-pv"
                :x="i * CHART_GROUP_W + 2"
                :y="barY(bar.pvH)"
                :width="CHART_BAR_W"
                :height="barH(bar.pvH)"
              >
                <title>{{ bar.day }} · 访问 {{ bar.pv }} · 访客 {{ bar.uv }}</title>
              </rect>
              <rect
                class="stats-bar stats-bar-uv"
                :x="i * CHART_GROUP_W + 2 + CHART_BAR_W + 2"
                :y="barY(bar.uvH)"
                :width="CHART_BAR_W"
                :height="barH(bar.uvH)"
              >
                <title>{{ bar.day }} · 访问 {{ bar.pv }} · 访客 {{ bar.uv }}</title>
              </rect>
            </g>
          </svg>
          <div class="stats-chart-axis">
            <span v-for="bar in scale.bars" :key="bar.day" class="stats-axis-tick">{{ shortDay(bar.day) }}</span>
          </div>
        </div>
        <p v-else class="empty"><span class="empty-text">还没有访问数据</span></p>
      </section>

      <div class="stats-cols">
        <section class="panel-card stats-panel">
          <h2 class="stats-panel-title">点赞排行</h2>
          <ol v-if="data?.likes.length" class="stats-likes">
            <li v-for="(like, i) in data.likes" :key="like.url" class="stats-like">
              <span class="stats-like-rank">{{ i + 1 }}</span>
              <img class="stats-like-thumb" :src="like.url" :alt="`第 ${i + 1} 名`" loading="lazy">
              <span class="stats-like-count">{{ formatInt(like.count) }} 赞</span>
            </li>
          </ol>
          <p v-else class="empty"><span class="empty-text">还没有人点赞</span></p>
        </section>

        <section class="panel-card stats-panel">
          <h2 class="stats-panel-title">每日明细</h2>
          <div v-if="data?.daily.length" class="stats-table-wrap">
            <table class="stats-table">
              <thead>
                <tr><th scope="col">日期</th><th scope="col">访问</th><th scope="col">访客</th></tr>
              </thead>
              <tbody>
                <tr v-for="d in [...data.daily].reverse()" :key="d.day">
                  <td>{{ d.day }}</td>
                  <td>{{ formatInt(d.pv) }}</td>
                  <td>{{ formatInt(d.uv) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty"><span class="empty-text">还没有访问数据</span></p>
        </section>
      </div>

      <p v-if="errorMsg" class="stats-error" role="alert">{{ errorMsg }}</p>
    </template>
  </main>
</template>
