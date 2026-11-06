<script setup lang="ts">
import { computed, ref } from 'vue';
import { PROJECTS, STATUS_LABEL, STATUS_FILTERS } from './projects';
import type { StatusFilter } from './projects';

/* 项目页(v2.3 对齐 Cecilian-Hub ProjectsBoard):
 * 药丸搜索 + 状态筛选 + 玻璃矩阵卡片(右上光晕、GitHub 角标、tag 芯片) */
const filter = ref<StatusFilter>('all');
const query = ref('');

/** 状态筛选 + 名称/描述/技术栈搜索,共用一个 computed */
const list = computed(() => {
  let arr = filter.value === 'all' ? PROJECTS : PROJECTS.filter((p) => p.status === filter.value);
  const q = query.value.trim().toLowerCase();
  if (q) {
    arr = arr.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.desc.toLowerCase().includes(q) ||
      p.tech.some((t) => t.toLowerCase().includes(q)));
  }
  return arr;
});

function countOf(f: StatusFilter): number {
  return f === 'all' ? PROJECTS.length : PROJECTS.filter((p) => p.status === f).length;
}

/** 图标徽章:项目名首字符(中文取字,英文取首字母大写) */
function iconOf(name: string): string {
  const ch = name.trim()[0] || 'V';
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
}
</script>

<template>
  <section class="page-header">
    <h1 class="page-header-title">项目</h1>
    <p class="page-header-sub">做过与正在做的东西 · 共 {{ PROJECTS.length }} 个</p>
  </section>

  <main class="page-header-main">
    <!-- 居中药丸搜索 -->
    <label class="projects-search fade-in-up">
      <svg class="projects-search-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <input v-model="query" type="text" placeholder="搜索项目名称、描述或技术栈…" autocomplete="off">
    </label>

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
        v-for="(p, i) in list"
        :key="p.name"
        class="panel-card project-card fade-in-up"
        :style="{ animationDelay: `${i * 60}ms` }"
      >
        <div class="project-head">
          <span class="project-icon" aria-hidden="true">{{ iconOf(p.name) }}</span>
          <h2 class="project-name">{{ p.name }}</h2>
          <a
            v-if="p.repo"
            class="project-github"
            :href="p.repo"
            target="_blank"
            rel="noopener"
            aria-label="GitHub 仓库"
            title="GitHub 仓库"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.379.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
            </svg>
          </a>
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
      <p class="empty-text">{{ query ? `没找到「${query}」相关的项目` : '该状态下暂无项目' }}</p>
    </div>
  </main>
</template>
