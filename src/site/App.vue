<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, onMounted } from 'vue';
import type { Component } from 'vue';
import { useErrorBanner } from './composables';
import { useVisit } from './visit';
import { initScreensaver } from './screensaver';
import { spaView, spaSlug, initSpaNav } from './spa';
import { formatInt } from '@/shared/utils';
import Lightbox from './Lightbox.vue';
import ScreensaverOverlay from './ScreensaverOverlay.vue';
import FloatingCapsule from './FloatingCapsule.vue';

/* 视图标识:初始来自入口 HTML 内联脚本;站内导航由 spa.ts 就地切换,
 * 不再整页加载 → player.ts 的 audio 单例跨页存活 = 音乐不断播。
 * viewKey 含 slug:post→post 直接换文章时强制重挂(PostView setup 同步读 slug) */
const view = spaView;
const viewKey = computed(() => view.value + (spaSlug.value ? `:${spaSlug.value}` : ''));

/* chunk 加载失败(弱网 / 发版瞬间旧 chunk 已被删)的可交互兜底:
 * 自动重试两次,仍失败给出「刷新重试」按钮,而不是永远白屏 */
const ViewLoadError = defineComponent({
  setup() {
    return () => h('div', { class: 'view-load-error' }, [
      h('p', '页面加载失败,请检查网络后重试'),
      h('button', { type: 'button', onClick: () => window.location.reload() }, '刷新重试'),
    ]);
  },
});

/* 视图按需加载:各页面共用一个入口,静态 import 会让 404.html(只有两行字)
 * 也下载并执行全站代码。异步组件把它拆成独立 chunk,各页只下自己那份。 */
function lazyView(loader: () => Promise<Component>) {
  return defineAsyncComponent({
    loader,
    delay: 150,
    errorComponent: ViewLoadError,
    onError(_error, retry, fail, attempts) {
      if (attempts <= 2) retry();
      else fail();
    },
  });
}

const views = {
  home: lazyView(() => import('./HomeView.vue')),
  blog: lazyView(() => import('./BlogView.vue')),
  post: lazyView(() => import('./PostView.vue')),
  gallery: lazyView(() => import('./GalleryView.vue')),
  music: lazyView(() => import('./MusicView.vue')),
  projects: lazyView(() => import('./ProjectsView.vue')),
  about: lazyView(() => import('./AboutView.vue')),
  settings: lazyView(() => import('./SettingsView.vue')),
  notfound: lazyView(() => import('./NotFoundView.vue')),
} as const;
type ViewKey = keyof typeof views;

const currentView = computed(() => views[(view.value as ViewKey) in views ? (view.value as ViewKey) : 'notfound']);

/* 灯箱与屏保是全站常驻层(任意页面都能唤起),保持静态引入。
 * FloatingCapsule 同理:迷你播放胶囊常驻右下角(无曲目时自隐藏,
 * 主页隐身但不销毁 —— 跨页续播状态在 player.ts 单例里)。 */
/* ⚠ 教训(docs/lessons-learned 3.4):改 import 块时逐个确认模板组件
 * 「import 还在」——生产构建缺 import 会静默渲染成未知元素,零警告。 */

/* 导航:顶栏 6 项主导航;「关于」只在底部胶囊区(2026-11 改版决策)。
 * 链接一律根绝对路径:文章页在 /posts/<slug>/ 子目录下,相对路径
 * (如 blog.html)会被解析成 /posts/<slug>/blog.html → 404(2026-11 修复) */
const navItems = [
  { href: '/', key: 'home', text: '主页' },
  { href: '/blog.html', key: 'blog', text: '博客' },
  { href: '/gallery.html', key: 'gallery', text: '图集' },
  { href: '/music.html', key: 'music', text: '音乐' },
  { href: '/projects.html', key: 'projects', text: '项目' },
  { href: '/settings.html', key: 'settings', text: '设置' },
] as const;

function isActive(key: (typeof navItems)[number]['key']): boolean {
  return view.value === key;
}

const banner = useErrorBanner();
const visit = useVisit();

onMounted(() => {
  visit.track();
  initScreensaver();
  /* SPA 站内导航:切页回调里补记 PV(与旧整页加载语义一致) */
  initSpaNav(() => void visit.trackView());
});
</script>

<template>
  <header class="navbar">
    <div><a class="navbar-title" href="/"><span class="navbar-logo" aria-hidden="true">V</span><span class="navbar-wordmark">Showcase</span></a></div>
    <nav class="navbar-nav" aria-label="主导航">
      <a
        v-for="item in navItems"
        :key="item.key"
        :href="item.href"
        class="navbar-link"
        :class="{ active: isActive(item.key) }"
      >{{ item.text }}</a>
    </nav>
  </header>

  <div v-if="banner.visible.value" class="error-banner" :class="{ 'is-fading': banner.fading.value }" role="alert">
    <span class="error-banner-msg">{{ banner.msg.value }}</span>
    <button class="error-banner-close" type="button" aria-label="关闭通知" @click="banner.dismiss()">×</button>
  </div>

  <component :is="currentView" :key="viewKey" />

  <footer class="site-footer">
    <div class="footer-capsule">
      <!-- 胶囊头 logo 钮:任意页面一键回主页 -->
      <a class="dock-home" href="/" aria-label="回到主页" title="回到主页"></a>
      <span class="footer-dot" aria-hidden="true">·</span>
      <!-- 「关于」入口只在底部胶囊区(顶栏不含) -->
      <a class="footer-link" :class="{ active: view === 'about' }" href="/about.html">关于</a>
      <!-- 退出登录:清会话 cookie → 回登录页(密码登录 v2.9.0,公共电脑必备) -->
      <span class="footer-dot" aria-hidden="true">·</span>
      <a class="footer-link" href="/api/logout" title="退出登录">退出</a>
      <template v-if="visit.totals.value">
        <span class="footer-dot" aria-hidden="true">·</span>
        <span class="footer-stats">
          {{ formatInt(visit.totals.value.pv) }} 次照亮 · {{ formatInt(visit.totals.value.uv) }} 位旅人
          <span class="footer-tip" role="tooltip">
            今日 {{ formatInt(visit.totals.value.today.pv) }} 次照亮 · {{ formatInt(visit.totals.value.today.uv) }} 位旅人
          </span>
        </span>
      </template>
      <span class="footer-dot" aria-hidden="true">·</span>
      <a class="footer-link" href="https://github.com/AetherGazer6244/V-Showcase" target="_blank" rel="noopener">GitHub</a>
    </div>
  </footer>

  <Lightbox />
  <ScreensaverOverlay />
  <FloatingCapsule :hidden="view === 'home'" />
</template>
