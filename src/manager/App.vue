<script setup lang="ts">
import { ref, computed } from 'vue';
import FocalTab from './FocalTab.vue';
import AlbumTab from './AlbumTab.vue';
import TagTab from './TagTab.vue';
import ConfigTab from './ConfigTab.vue';
import BlogTab from './BlogTab.vue';
import MusicTab from './MusicTab.vue';
import ProjectTab from './ProjectTab.vue';
import ConfirmModal from './ConfirmModal.vue';
import UploadBoard from './UploadBoard.vue';
import { provideManagerState, useToast, syncDeploy, toast } from './api';
import {
  dirtyFiles, dirtyCount, saveAll, fileOf, FILE_LABELS, type FileKey,
} from './queue';
import { confirmAsync } from './confirm';
import { siteConfig } from '../site/siteConfig';

provideManagerState();

type TabKey = 'focal' | 'album' | 'tags' | 'blog' | 'music' | 'projects' | 'config';

const activeTab = ref<TabKey>('focal');
const t = useToast();

const subTexts: Record<TabKey, string> = {
  focal: '为每张图标记主角位置,人脸再也不会被切',
  album: '手动图集:创建图集 → 拖图片到图集。前端按图集分 section 展示',
  tags: '给图片打标签:图集页搜索与灯箱都会用到',
  blog: '写作台:Markdown 文章与页面,保存即重建产物,部署即发布',
  music: '曲库管理:网易云 ID 与直链双模式,顺序即播放列表',
  projects: '项目展示管理:状态筛选卡片,数据在 content/projects.json',
  config: '站点配置:行数/卡片宽度/拉取上限(白名单字段)',
};
const subText = computed(() => subTexts[activeTab.value]);

/* 顶栏分组头:Tab 名 */
const tabTitles: Record<TabKey, string> = {
  focal: '焦点',
  album: '图集',
  tags: '标签',
  blog: '博客',
  music: '音乐',
  projects: '项目',
  config: '配置',
};
const tabTitle = computed(() => tabTitles[activeTab.value]);

/* 侧栏导航:纯文字 + 三小节(内容 / 写作 / 站点) */
const navGroups: { name: string; items: { key: TabKey; label: string }[] }[] = [
  {
    name: '内容',
    items: [
      { key: 'focal', label: '焦点' },
      { key: 'album', label: '图集' },
      { key: 'tags', label: '标签' },
    ],
  },
  {
    name: '写作',
    items: [
      { key: 'blog', label: '博客' },
      { key: 'music', label: '音乐' },
      { key: 'projects', label: '项目' },
    ],
  },
  {
    name: '站点',
    items: [{ key: 'config', label: '配置' }],
  },
];

/* ── 前台预览:基址可编辑 + localStorage 记忆 ──
 * Manager 服务只托管 dist-manager 与 /api/*,前台是另一个服务
 * (本地 wrangler 8001 / 线上 Cloudflare Pages),所以要跳转必须显式给基址。 */
const PREVIEW_KEY = 'vshowcase.manager.previewBase';
const DEFAULT_PREVIEW = 'http://127.0.0.1:8001';

const previewBase = ref(DEFAULT_PREVIEW);
try {
  const saved = localStorage.getItem(PREVIEW_KEY);
  if (saved) previewBase.value = saved;
} catch { /* 隐私模式 / 禁用存储:用默认值即可 */ }

function onPreviewBaseChange() {
  const v = previewBase.value.trim().replace(/\/+$/, '');
  previewBase.value = v || DEFAULT_PREVIEW;
  try { localStorage.setItem(PREVIEW_KEY, previewBase.value); } catch { /* 忽略 */ }
}

/** 前台各页面路径(Cloudflare Pages 风格:无 .html 后缀) */
const previewLinks: { key: string; label: string; path: string }[] = [
  { key: 'home', label: '主页', path: '/' },
  { key: 'gallery', label: '图库', path: '/gallery' },
  { key: 'blog', label: '博客', path: '/blog' },
  { key: 'music', label: '音乐', path: '/music' },
  { key: 'projects', label: '项目', path: '/projects' },
  { key: 'about', label: '关于', path: '/about' },
];

const previewUrl = (path: string) => previewBase.value.replace(/\/+$/, '') + path;

/** 各 Tab 对应的前台页面(顶栏「打开前台」按钮) */
const tabFrontPath: Record<TabKey, string> = {
  focal: '/',
  album: '/gallery',
  tags: '/gallery',
  blog: '/blog',
  music: '/music',
  projects: '/projects',
  config: '/about',
};
const tabFrontUrl = computed(() => previewUrl(tabFrontPath[activeTab.value]));

/** 仓库外链(siteConfig.repo 同源) */
const repoUrl = siteConfig.repo;

/* ── 操作队列:统一保存 / 保存并部署 ── */
const saving = ref(false);
const deploying = ref(false);
const uploadOpen = ref(false);

async function onSaveAll() {
  if (saving.value || deploying.value) return;
  if (dirtyCount.value === 0) {
    toast('没有待保存的改动');
    return;
  }
  const names = dirtyFiles.value.map((k) => FILE_LABELS[k]).join('、');
  const ok = await confirmAsync({
    title: '保存全部改动',
    message: `将写入 ${names} 共 ${dirtyCount.value} 个数据文件。`,
  });
  if (!ok) return;
  saving.value = true;
  try {
    const saved = await saveAll();
    if (saved.length > 0) toast(`已保存 ${saved.map((k) => FILE_LABELS[k]).join('、')}`, 'success');
  } finally {
    // 保存失败抛错也必须解锁按钮,否则「保存中…」永久卡死
    saving.value = false;
  }
}

async function onSaveDeploy() {
  if (saving.value || deploying.value) return;
  if (dirtyCount.value === 0) {
    toast('没有待部署的改动(先编辑再保存)', 'warn');
    return;
  }
  const names = dirtyFiles.value.map((k) => FILE_LABELS[k]).join('、');
  const ok = await confirmAsync({
    title: '保存并部署',
    message: `将保存 ${names} 共 ${dirtyCount.value} 个文件,并逐个推送到 GitHub 触发 Cloudflare 部署。`,
    confirmText: '保存并部署',
  });
  if (!ok) return;
  deploying.value = true;
  try {
    const saved = await saveAll();
    let okCount = 0;
    for (const key of saved as FileKey[]) {
      const msg = await syncDeploy(fileOf(key));
      if (!msg) break; // syncDeploy 内部已 toast 错误
      okCount++;
    }
    if (okCount > 0) toast(`已部署 ${okCount} 个文件,Cloudflare Pages 将自动构建`, 'success');
  } finally {
    deploying.value = false;
  }
}
</script>

<template>
  <div class="shell">
    <!-- 侧边栏:品牌 + 导航 + 前台预览 + 操作队列 -->
    <aside class="side">
      <div class="side-brand">
        <span class="side-brand-mark" aria-hidden="true">V</span>
        <span class="side-brand-text">
          <strong>管理台</strong>
          <small>V-Showcase</small>
        </span>
      </div>

      <nav class="side-nav">
        <div v-for="group in navGroups" :key="group.name" class="nav-group">
          <div class="nav-group-label">{{ group.name }}</div>
          <button
            v-for="item in group.items"
            :key="item.key"
            class="side-item"
            :class="{ 'side-item-active': activeTab === item.key }"
            @click="activeTab = item.key"
          >{{ item.label }}</button>
        </div>
      </nav>

      <!-- 前台预览:新标签打开站点页面(改完内容直接看效果) -->
      <div class="side-preview">
        <div class="side-section-head">
          <span class="side-section-title">前台预览</span>
          <span class="side-section-hint">新标签打开</span>
        </div>
        <input
          class="input side-base"
          v-model="previewBase"
          placeholder="http://127.0.0.1:8001"
          title="前台站点基址(本地预览端口 / 线上域名)"
          @change="onPreviewBaseChange"
          @keyup.enter="onPreviewBaseChange"
        >
        <div class="preview-links">
          <a
            v-for="link in previewLinks"
            :key="link.key"
            class="preview-link"
            :href="previewUrl(link.path)"
            target="_blank"
            rel="noopener"
          >
            <span>{{ link.label }}</span>
            <span class="preview-arrow" aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      <div class="side-foot">
        <div class="queue">
          <span class="queue-dot" :class="{ on: dirtyCount > 0 }" />
          <span class="queue-text">
            {{ dirtyCount > 0 ? `${dirtyFiles.map((k) => FILE_LABELS[k]).join('、')} 待保存` : '暂无待保存改动' }}
          </span>
        </div>
        <button
          class="btn btn-block"
          :disabled="saving || deploying || dirtyCount === 0"
          @click="onSaveAll"
        >{{ saving ? '保存中…' : '保存全部' }}</button>
        <button
          class="btn btn-primary btn-block"
          :disabled="saving || deploying || dirtyCount === 0"
          @click="onSaveDeploy"
        >{{ deploying ? '部署中…' : '保存并部署' }}</button>
        <button class="btn btn-ghost btn-block" @click="uploadOpen = true">上传图片</button>
        <a class="side-repo" :href="repoUrl" target="_blank" rel="noopener">
          GitHub 仓库<span class="preview-arrow" aria-hidden="true">↗</span>
        </a>
      </div>
    </aside>

    <!-- 工作区 -->
    <div class="workspace">
      <header class="bar">
        <div class="bar-head">
          <h1 class="bar-title">{{ tabTitle }}</h1>
          <span class="bar-sub">{{ subText }}</span>
        </div>
        <div class="bar-actions">
          <a class="bar-open" :href="tabFrontUrl" target="_blank" rel="noopener">
            打开前台<span class="preview-arrow" aria-hidden="true">↗</span>
          </a>
          <!-- 各 Tab 通过 <Teleport> 把操作按钮注入这里 -->
          <div id="bar-right" class="bar-right" />
        </div>
      </header>

      <main class="content">
        <!-- active prop:四个 Tab 因 v-show 同时挂载,Teleport 的顶栏按钮
             必须只在自家 Tab 激活时渲染,否则四个 Tab 的按钮全部挤进顶栏 -->
        <FocalTab :active="activeTab === 'focal'" v-show="activeTab === 'focal'" />
        <AlbumTab :active="activeTab === 'album'" v-show="activeTab === 'album'" />
        <TagTab :active="activeTab === 'tags'" v-show="activeTab === 'tags'" />
        <BlogTab v-show="activeTab === 'blog'" />
        <MusicTab v-show="activeTab === 'music'" />
        <ProjectTab v-show="activeTab === 'projects'" />
        <ConfigTab :active="activeTab === 'config'" v-show="activeTab === 'config'" />
      </main>
    </div>
  </div>

  <UploadBoard v-if="uploadOpen" @close="uploadOpen = false" />
  <ConfirmModal />

  <div class="toast" :class="[t.type.value ? 'toast-' + t.type.value : '', { hidden: !t.visible.value }]">
    {{ t.msg.value }}
  </div>
</template>
