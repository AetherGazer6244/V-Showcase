<script setup lang="ts">
import { computed } from 'vue';
import { posts, formatDateCN, postHref } from './posts';
import { siteConfig } from './siteConfig';
import { useLightbox } from './composables';

/* 列表数据 = 构建期 posts.json(已按日期倒序),零网络请求 */

const list = computed(() => posts);

const lb = useLightbox();

/** 封面:文章自带 → 站点默认封面 → 琥珀渐变占位(都缺则为空,渲染渐变块) */
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
    <p class="page-header-sub">写作、技术与生活记录 · 共 {{ list.length }} 篇</p>
  </section>

  <main class="page-header-main">
    <div v-if="list.length" class="blog-list" role="list">
      <a
        v-for="p in list"
        :key="p.slug"
        class="panel-card blog-card"
        role="listitem"
        :href="postHref(p.slug)"
      >
        <div class="blog-card-cover img-box">
          <img
            v-if="coverOf(p.cover)"
            :src="coverOf(p.cover)"
            :alt="p.title"
            loading="lazy"
            decoding="async"
            @click.prevent="openCover(p.title, coverOf(p.cover))"
          >
          <div v-else class="blog-cover-fallback" aria-hidden="true"></div>
        </div>
        <div class="blog-card-body">
          <h2 class="blog-card-title">{{ p.title }}</h2>
          <p class="blog-card-meta">
            <time :datetime="p.date">{{ formatDateCN(p.date) }}</time>
            <span class="blog-meta-dot" aria-hidden="true">·</span>
            <span>约 {{ p.readingMin }} 分钟</span>
            <span class="blog-meta-dot" aria-hidden="true">·</span>
            <span>{{ p.wordCount }} 字</span>
          </p>
          <p class="blog-card-excerpt">{{ p.excerpt }}</p>
        </div>
      </a>
    </div>

    <div v-else class="empty">
      <span class="empty-icon" aria-hidden="true">✍️</span>
      <p class="empty-text">还没有文章 — 在 content/posts/ 放下第一篇 Markdown 吧</p>
    </div>
  </main>
</template>
