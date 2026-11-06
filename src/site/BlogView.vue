<script setup lang="ts">
import { computed, ref } from 'vue';
import { posts, formatDateCN, postHref } from './posts';
import { siteConfig } from './siteConfig';
import { useLightbox } from './composables';

/* ============================================================
 * 博客列表(v2.4 对齐 Cecilian-Hub 文章卡语言)
 *   卡 = 全封面铺底 + 底部黑渐变 + 标题/摘要/meta 压底;
 *   hover 封面缓慢放大 + 标题上浮 + panel-card 靛蓝泛光。
 *   #标签胶囊点击 → 本页筛选(?tag= 同步进地址栏,可分享);
 *   日期胶囊 mono 字体。无封面 → 靛蓝渐变兜底。
 * ============================================================ */

const lb = useLightbox();

/** 当前筛选标签(?tag= 初始化;筛选纯前端,replaceState 同步地址栏) */
const activeTag = ref(new URLSearchParams(window.location.search).get('tag') || '');

const list = computed(() => {
  if (!activeTag.value) return posts;
  return posts.filter((p) => p.tags.includes(activeTag.value));
});

/** 全站标签云(带计数,按文章数倒序)——空态筛选时也能看到可选项 */
const tagCloud = computed(() => {
  const count = new Map<string, number>();
  for (const p of posts) for (const t of p.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]);
});

function setTag(tag: string): void {
  activeTag.value = activeTag.value === tag ? '' : tag;
  const url = new URL(window.location.href);
  if (activeTag.value) url.searchParams.set('tag', activeTag.value);
  else url.searchParams.delete('tag');
  window.history.replaceState(null, '', url);
}

/** 封面:文章自带 → 站点默认封面(空串 = 渲染渐变兜底层) */
function coverOf(cover: string): string {
  return cover || siteConfig.defaultCover;
}

/** 点卡片封面进灯箱(与图集一致的看图体验) */
function openCover(title: string, src: string) {
  if (!src) return;
  lb.open([{ url: src, name: title }], 0);
}
</script>

<template>
  <section class="page-header">
    <h1 class="page-header-title">博客</h1>
    <p class="page-header-sub">写作、技术与生活记录 · 共 {{ posts.length }} 篇</p>
  </section>

  <main class="page-header-main">
    <!-- 标签筛选行(有标签才渲染) -->
    <div v-if="tagCloud.length" class="blog-tags" role="group" aria-label="按标签筛选">
      <button
        type="button"
        class="chip blog-tag-chip"
        :class="{ active: !activeTag }"
        @click="setTag(activeTag)"
      >全部 {{ posts.length }}</button>
      <button
        v-for="[tag, n] in tagCloud"
        :key="tag"
        type="button"
        class="chip blog-tag-chip"
        :class="{ active: activeTag === tag }"
        @click="setTag(tag)"
      ># {{ tag }} {{ n }}</button>
    </div>

    <div v-if="list.length" class="blog-list" role="list">
      <a
        v-for="p in list"
        :key="p.slug"
        class="panel-card blog-card fade-in-up"
        role="listitem"
        :href="postHref(p.slug)"
      >
        <!-- 全封面铺底层 -->
        <div class="blog-card-cover img-box" aria-hidden="true">
          <img
            v-if="coverOf(p.cover)"
            :src="coverOf(p.cover)"
            alt=""
            loading="lazy"
            decoding="async"
            @click.prevent="openCover(p.title, coverOf(p.cover))"
          >
          <div v-else class="blog-cover-fallback"></div>
        </div>
        <!-- 底部渐变压字层 -->
        <div class="blog-card-veil" aria-hidden="true"></div>

        <!-- 压底内容 -->
        <div class="blog-card-body">
          <div class="blog-card-pills">
            <span class="blog-pill blog-pill-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke-width="2"/>
                <path d="M12 8v4l3 3" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <time :datetime="p.date">{{ formatDateCN(p.date) }}</time>
            </span>
            <span class="blog-pill">约 {{ p.readingMin }} 分钟</span>
            <button
              v-for="t in p.tags"
              :key="t"
              type="button"
              class="blog-pill blog-pill-tag"
              :class="{ on: activeTag === t }"
              :title="`筛选标签「${t}」`"
              @click.prevent.stop="setTag(t)"
            ><span aria-hidden="true">#</span> {{ t }}</button>
          </div>
          <h2 class="blog-card-title">{{ p.title }}</h2>
          <p class="blog-card-excerpt">{{ p.excerpt }}</p>
        </div>
      </a>
    </div>

    <div v-else-if="activeTag" class="empty">
      <span class="empty-icon" aria-hidden="true">🏷️</span>
      <p class="empty-text">「{{ activeTag }}」标签下暂无文章</p>
      <button type="button" class="btn btn-ghost" @click="setTag(activeTag)">查看全部文章</button>
    </div>

    <div v-else class="empty">
      <span class="empty-icon" aria-hidden="true">✍️</span>
      <p class="empty-text">还没有文章 — 在 content/posts/ 放下第一篇 Markdown 吧</p>
    </div>
  </main>
</template>
