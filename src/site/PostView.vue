<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { findPost, formatDateCN, postHref } from './posts';
import { useLightbox } from './composables';

/* slug 来源优先级:
 * 1. 生产环境生成的静态页注入 window.__POST_SLUG__
 * 2. 开发模式 post.html?slug= 查询参数
 * 3. 都没有 → 视为未命中,回博客列表 */
const slug = window.__POST_SLUG__
  || new URLSearchParams(window.location.search).get('slug')
  || '';

const post = computed(() => findPost(slug));

const lb = useLightbox();

/* ---- TOC ----
 * 桌面端右侧悬浮(≥1100px),移动端文章顶部折叠(details)。
 * activeId 由 IntersectionObserver 观察标题位置得出。 */
const activeId = ref('');
let tocObserver: IntersectionObserver | null = null;

function setupTocObserver(): void {
  tocObserver?.disconnect();
  tocObserver = null;
  if (!post.value || post.value.toc.length === 0) return;
  const headings = Array.from(document.querySelectorAll('.post-prose h2[id], .post-prose h3[id]'));
  if (!headings.length) return;
  tocObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        activeId.value = (e.target as HTMLElement).id;
        break;
      }
    }
  }, { rootMargin: '-80px 0px -70% 0px' });
  headings.forEach((h) => tocObserver!.observe(h));
}

/* ---- 回到顶部 ---- */
const showTop = ref(false);
function onScroll(): void {
  showTop.value = window.scrollY > 400;
}
function backTop(): void {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---- 正文图片接灯箱:事件委托,点击 img → 打开该文全部图片 ---- */
const articleImages = computed(() => {
  if (!post.value) return [];
  const holder = document.createElement('div');
  holder.innerHTML = post.value.html;
  return Array.from(holder.querySelectorAll('img')).map((img) => ({
    url: img.getAttribute('src') ?? '',
    name: img.getAttribute('alt') || post.value!.title,
  })).filter((i) => i.url && /^https?:/i.test(i.url));
});

function onArticleClick(e: Event): void {
  const target = e.target as HTMLElement;
  if (target.tagName !== 'IMG') return;
  const src = target.getAttribute('src') ?? '';
  const idx = articleImages.value.findIndex((i) => i.url === src);
  if (idx >= 0) lb.open(articleImages.value, idx);
}

onMounted(() => {
  // 未命中 slug(直接访问兜底壳)→ 回列表
  if (!post.value) {
    window.location.replace('blog.html');
    return;
  }
  document.title = `${post.value.title} · V-Showcase`;
  setupTocObserver();
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});

onUnmounted(() => {
  tocObserver?.disconnect();
  window.removeEventListener('scroll', onScroll);
});

watch(() => post.value?.slug, () => setupTocObserver());
</script>

<template>
  <template v-if="post">
    <section class="page-header post-header">
      <nav class="post-breadcrumb" aria-label="面包屑">
        <a href="blog.html">← 博客</a>
      </nav>
      <h1 class="page-header-title post-title">{{ post.title }}</h1>
      <p class="page-header-sub post-meta">
        <time :datetime="post.date">{{ formatDateCN(post.date) }}</time>
        <span class="blog-meta-dot" aria-hidden="true">·</span>
        <span>约 {{ post.readingMin }} 分钟</span>
        <span class="blog-meta-dot" aria-hidden="true">·</span>
        <span>{{ post.wordCount }} 字</span>
      </p>
    </section>

    <main class="page-header-main post-main">
      <!-- 移动端目录:文章顶部折叠 -->
      <details v-if="post.toc.length" class="post-toc-details">
        <summary>目录</summary>
        <nav class="post-toc-list" aria-label="文章目录">
          <a
            v-for="t in post.toc"
            :key="t.id"
            :href="`#${t.id}`"
            :class="[`toc-d${t.depth}`, { active: activeId === t.id }]"
          >{{ t.text }}</a>
        </nav>
      </details>

      <article
        class="post-prose"
        @click="onArticleClick"
      ><!-- html 由构建期渲染(marked + highlight.js),可信产物 -->
        <div v-html="post.html"></div>
      </article>

      <!-- 上一篇 / 下一篇 -->
      <nav v-if="post.prev || post.next" class="post-sibling" aria-label="相邻文章">
        <a v-if="post.next" class="panel-card sibling-card" :href="postHref(post.next.slug)">
          <span class="sibling-label">← 更新一篇</span>
          <span class="sibling-title">{{ post.next.title }}</span>
        </a>
        <span v-else class="sibling-spacer" aria-hidden="true"></span>
        <a v-if="post.prev" class="panel-card sibling-card right" :href="postHref(post.prev.slug)">
          <span class="sibling-label">更早一篇 →</span>
          <span class="sibling-title">{{ post.prev.title }}</span>
        </a>
        <span v-else class="sibling-spacer" aria-hidden="true"></span>
      </nav>
    </main>

    <!-- 桌面端悬浮目录 -->
    <aside v-if="post.toc.length" class="post-toc-float" aria-label="文章目录">
      <p class="post-toc-head">目录</p>
      <a
        v-for="t in post.toc"
        :key="t.id"
        :href="`#${t.id}`"
        :class="[`toc-d${t.depth}`, { active: activeId === t.id }]"
      >{{ t.text }}</a>
    </aside>

    <!-- 回到顶部 -->
    <transition name="top-fade">
      <button v-if="showTop" class="back-top" type="button" aria-label="回到顶部" @click="backTop">↑</button>
    </transition>
  </template>
</template>
