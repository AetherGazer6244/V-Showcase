<script setup lang="ts">
/* ============================================================
 * 非主页图片蒙版背景 — 单张模糊图 + 渐变蒙版
 * ------------------------------------------------------------
 * 背景图取自主页图片墙的同一图池(loadImages 的清单,5 分钟缓存),
 * 按页面键稳定选一张:同一页面每次进都是同一张,不同页面/文章各取各的。
 *
 * 设计约束:
 *   - 只取 1 张(单张模糊铺满):多张拼贴要多下 2–4 张图,首屏太重
 *   - 复用主页墙已缓存的缩略图,站内切页几乎零额外请求
 *   - 纯装饰层:aria-hidden + pointer-events:none + z-index:-1
 *   - 不做动画:静态最省 GPU,也天然满足「减少动态效果」
 *   - 图池为空 / 全部取不到 → 什么都不渲染,页面照常是原来的底色
 *
 * ⚠ 样式在 styles/backdrop.css(全局),本页只管取图与挂层。
 * ============================================================ */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { loadImages } from '@/shared/apiClient';
import { backdropSrc, pickBackdropImage, safeBackgroundImage } from './backdrop';

const props = defineProps<{ pageKey: string }>();

/** 当前背景图地址(空串 = 暂无背景) */
const src = ref('');
/** 取图序号:只认最后一次请求,避免连续切页时旧结果覆盖新结果 */
let seq = 0;

/** 按页面键取一张背景图 */
async function load(key: string): Promise<void> {
  const mine = ++seq;
  try {
    const { images } = await loadImages();
    if (mine !== seq) return;
    src.value = backdropSrc(pickBackdropImage(images, key));
  } catch {
    // loadImages 本身不 reject,这里是双保险:取不到就什么都不显示
    if (mine === seq) src.value = '';
  }
}

watch(() => props.pageKey, (k) => { void load(k); }, { immediate: true });

/** 背景图层样式(地址非法 → 无 background-image) */
const style = computed(() => {
  const bg = safeBackgroundImage(src.value);
  return bg ? { backgroundImage: bg } : {};
});

onBeforeUnmount(() => { seq++; });
</script>

<template>
  <div v-if="src" class="page-backdrop" aria-hidden="true">
    <div class="page-backdrop-image" :style="style"></div>
  </div>
</template>
