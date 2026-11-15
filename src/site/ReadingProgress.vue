<script setup lang="ts">
import { computed } from 'vue';

/* ============================================================
 * 阅读进度条(v2.14)—— 文章页顶部一条细线,越往下读填得越满
 * progress: 0~1
 * ============================================================ */
const props = defineProps<{ progress: number }>();

const pct = computed(() => Math.round(Math.max(0, Math.min(1, props.progress)) * 100));
</script>

<template>
  <div
    class="reading-progress"
    role="progressbar"
    aria-label="阅读进度"
    :aria-valuenow="pct"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div class="reading-progress-bar" :style="{ width: pct + '%' }"></div>
  </div>
</template>
