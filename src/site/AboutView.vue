<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getPage, posts, postHref, formatDateCN } from './posts';
import { siteConfig } from './siteConfig';
import { useLightbox } from './composables';
import { loadImages } from '@/shared/apiClient';

/* ============================================================
 * 关于页(v2.5 ProfileCard 化)
 *   身份卡 = 头像(靛蓝渐变环) + 站名/tagline + 统计 chips + 社交链接
 *   正文   = about.md 包 .panel-card(与博客详情卡同语言)
 *   最近动态 = 复用构建期 posts 数据的前 3 篇小卡
 * ============================================================ */
const page = computed(() => getPage('about'));

/** 最近动态:复用构建期 posts 数据,取最近 3 篇(未来可并入说说/友链动态源) */
const recent = computed(() => posts.slice(0, 3));

/** 头像缺省 → 站名首字母圆形占位 */
const avatarLetter = computed(() => (siteConfig.name.trim()[0] || 'V').toUpperCase());

/** 统计 chips:文章数 / 图库总数(懒拉,失败静默不显示) / 最近更新 */
const galleryCount = ref<number | null>(null);
const latestDate = computed(() => posts[0]?.date ?? '');

/** 社交链接 chips(siteConfig 有值才渲染) */
const socials = computed(() => {
  const s = siteConfig.social;
  const out: Array<{ label: string; href: string }> = [];
  if (s.github) out.push({ label: 'GitHub', href: s.github });
  if (s.bilibili) out.push({ label: 'Bilibili', href: s.bilibili });
  if (s.email) out.push({ label: 'Email', href: s.email.includes('@') ? `mailto:${s.email}` : s.email });
  return out;
});

onMounted(async () => {
  if (page.value) document.title = `关于 · V-Showcase`;
  try {
    const { images } = await loadImages();
    galleryCount.value = images.length;
  } catch {
    galleryCount.value = null;   // 列表不可达时隐藏图库 chip,不阻塞页面
  }
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
    <div class="about-identity panel-card fade-in-up">
      <span class="about-avatar img-box">
        <img v-if="siteConfig.avatar" :src="siteConfig.avatar" :alt="siteConfig.name">
        <span v-else class="about-avatar-letter" aria-hidden="true">{{ avatarLetter }}</span>
      </span>
      <div class="about-id-text">
        <h1 class="page-header-title">{{ siteConfig.name }}</h1>
        <p class="page-header-sub">{{ siteConfig.tagline }}</p>

        <!-- 统计 chips -->
        <div class="about-stats" role="list">
          <span class="chip" role="listitem">📝 {{ posts.length }} 篇文章</span>
          <span v-if="galleryCount !== null" class="chip" role="listitem">🖼️ {{ galleryCount }} 张图片</span>
          <span v-if="latestDate" class="chip" role="listitem">🕒 更新于 {{ formatDateCN(latestDate) }}</span>
        </div>

        <!-- 社交链接 chips -->
        <div v-if="socials.length" class="about-socials">
          <a
            v-for="s in socials"
            :key="s.label"
            class="chip about-social-chip"
            :href="s.href"
            target="_blank"
            rel="noopener"
          >{{ s.label }} ↗</a>
        </div>
      </div>
    </div>
  </section>

  <main class="page-header-main post-main">
    <template v-if="page">
      <!-- 正文卡:与博客详情页同一份卡语言 -->
      <article class="about-article panel-card" @click="onArticleClick">
        <div class="post-prose"><div v-html="page.html"></div><!-- 构建期渲染的可信产物 --></div>
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
        <a v-for="p in recent" :key="p.slug" class="about-recent-item panel-card" :href="postHref(p.slug)">
          <span class="about-recent-title">{{ p.title }}</span>
          <time class="about-recent-date" :datetime="p.date">{{ formatDateCN(p.date) }}</time>
        </a>
      </nav>
    </section>
  </main>
</template>
