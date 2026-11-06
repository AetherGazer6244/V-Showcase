<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { getPage, posts, postHref, formatDateCN } from './posts';
import { siteConfig } from './siteConfig';
import { useLightbox } from './composables';

/* 关于页 = 头部身份卡(siteConfig) + about.md 正文(博客管线) + 最近动态 */
const page = computed(() => getPage('about'));

/* 最近动态:复用构建期 posts 数据,取最近 3 篇(未来可并入说说/友链动态源) */
const recent = computed(() => posts.slice(0, 3));

/** 头像缺省 → 站名首字母圆形占位 */
const avatarLetter = computed(() => (siteConfig.name.trim()[0] || 'V').toUpperCase());

onMounted(() => {
  if (page.value) document.title = `关于 · V-Showcase`;
});

/** 正文图片接灯箱(与 PostView 同款事件委托) */
const lb = useLightbox();

function onArticleClick(e: Event): void {
  const target = e.target as HTMLElement;
  if (target.tagName !== 'IMG') return;
  const src = target.getAttribute('src') ?? '';
  if (!src || !/^https?:/i.test(src)) return;
  lb.open([{ url: src, name: '关于页图片' }], 0);
}
</script>

<template>
  <section class="page-header about-header">
    <div class="about-identity">
      <span class="about-avatar img-box">
        <img v-if="siteConfig.avatar" :src="siteConfig.avatar" :alt="siteConfig.name">
        <span v-else class="about-avatar-letter" aria-hidden="true">{{ avatarLetter }}</span>
      </span>
      <div class="about-id-text">
        <h1 class="page-header-title">{{ siteConfig.name }}</h1>
        <p class="page-header-sub">{{ siteConfig.tagline }}</p>
      </div>
    </div>
  </section>

  <main class="page-header-main post-main">
    <template v-if="page">
      <article class="post-prose" @click="onArticleClick">
        <div v-html="page.html"></div><!-- 构建期渲染的可信产物 -->
      </article>
    </template>
    <div v-else class="empty">
      <span class="empty-icon" aria-hidden="true">📄</span>
      <p class="empty-text">还没有关于页 — 在 content/pages/about.md 写下第一段</p>
    </div>

    <!-- 最近动态 -->
    <section v-if="recent.length" class="about-recent">
      <h2 class="about-recent-head">最近动态</h2>
      <nav class="about-recent-list" aria-label="最近文章">
        <a v-for="p in recent" :key="p.slug" class="about-recent-item" :href="postHref(p.slug)">
          <span class="about-recent-title">{{ p.title }}</span>
          <time class="about-recent-date" :datetime="p.date">{{ formatDateCN(p.date) }}</time>
        </a>
      </nav>
    </section>
  </main>
</template>
