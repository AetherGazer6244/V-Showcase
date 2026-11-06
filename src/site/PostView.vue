<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { findPost, formatDateCN, postHref } from './posts';
import { siteConfig } from './siteConfig';
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

/** 封面:文章自带 → 站点默认封面(空串 = 渲染渐变兜底层) */
const coverSrc = computed(() => (post.value ? post.value.cover || siteConfig.defaultCover : ''));

/** 点封面进灯箱(与列表卡/图集一致) */
function openCover(): void {
  if (!post.value || !coverSrc.value) return;
  lb.open([{ url: coverSrc.value, name: post.value.title }], 0);
}

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
    <main class="page-header-main post-main">
      <!-- 详情卡:封面卡顶 + 玻璃大卡(v2.4 对齐 Cecilian-Hub) -->
      <article class="post-card panel-card fade-in-up">
        <!-- 封面:aspect-video 卡顶,点击进灯箱;无封面 → 靛蓝渐变兜底 -->
        <div class="post-cover">
          <img
            v-if="coverSrc"
            :src="coverSrc"
            :alt="post.title"
            class="post-cover-img"
            @click="openCover"
          >
          <div v-else class="post-cover-fallback" aria-hidden="true"></div>
        </div>

        <div class="post-card-body">
          <nav class="post-breadcrumb" aria-label="面包屑">
            <a href="blog.html">← 博客</a>
          </nav>
          <h1 class="post-title">{{ post.title }}</h1>

          <!-- meta 胶囊条:日期 / 时长 / 字数 / 标签(点标签回列表筛选) -->
          <div class="post-pillbar">
            <span class="post-pill post-pill-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke-width="2"/>
                <path d="M12 8v4l3 3" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <time :datetime="post.date">{{ formatDateCN(post.date) }}</time>
            </span>
            <span class="post-pill">约 {{ post.readingMin }} 分钟</span>
            <span class="post-pill">{{ post.wordCount }} 字</span>
            <a
              v-for="t in post.tags"
              :key="t"
              class="post-pill post-pill-tag"
              :href="`blog.html?tag=${encodeURIComponent(t)}`"
              :title="`查看「${t}」标签下的文章`"
            ><span aria-hidden="true">#</span> {{ t }}</a>
          </div>

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
        </div>
      </article>
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
