<script setup lang="ts">
import { computed, ref } from 'vue';
import { PROJECTS, STATUS_LABEL, STATUS_FILTERS } from './projects';
import type { StatusFilter } from './projects';

/* 项目页:状态筛选 + 卡片栅格(纯静态数据,无网络) */
const filter = ref<StatusFilter>('all');

const list = computed(() => (
  filter.value === 'all' ? PROJECTS : PROJECTS.filter((p) => p.status === filter.value)
));

function countOf(f: StatusFilter): number {
  return f === 'all' ? PROJECTS.length : PROJECTS.filter((p) => p.status === f).length;
}
</script>

<template>
  <section class="page-header">
    <h1 class="page-header-title">项目</h1>
    <p class="page-header-sub">做过与正在做的东西 · 共 {{ PROJECTS.length }} 个</p>
  </section>

  <main class="page-header-main">
    <div class="projects-filter" role="group" aria-label="状态筛选">
      <button
        v-for="f in STATUS_FILTERS"
        :key="f"
        type="button"
        class="chip"
        :class="{ active: filter === f }"
        :aria-pressed="filter === f"
        @click="filter = f"
      >{{ f === 'all' ? '全部' : STATUS_LABEL[f] }} {{ countOf(f) }}</button>
    </div>

    <div v-if="list.length" class="project-grid">
      <article
        v-for="p in list"
        :key="p.name"
        class="panel-card project-card"
      >
        <div class="project-head">
          <h2 class="project-name">{{ p.name }}</h2>
          <span class="chip" :class="`project-status-${p.status}`">{{ STATUS_LABEL[p.status] }}</span>
        </div>
        <p class="project-desc">{{ p.desc }}</p>
        <p class="project-tech">
          <span v-for="t in p.tech" :key="t" class="chip">{{ t }}</span>
        </p>
        <div class="project-foot">
          <span class="project-year">{{ p.year }}</span>
          <span class="project-links">
            <a v-if="p.link" class="btn btn-ghost" :href="p.link" target="_blank" rel="noopener">访问</a>
            <a v-if="p.repo" class="btn btn-ghost" :href="p.repo" target="_blank" rel="noopener">GitHub</a>
          </span>
        </div>
      </article>
    </div>

    <div v-else class="empty">
      <span class="empty-icon" aria-hidden="true">🗂️</span>
      <p class="empty-text">该状态下暂无项目</p>
    </div>
  </main>
</template>
