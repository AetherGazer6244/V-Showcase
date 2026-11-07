<script setup lang="ts">
import type { AlbumMeta } from '@/shared/types';

const props = defineProps<{
  album: AlbumMeta;
  count: number;
}>();

const emit = defineEmits<{
  (e: 'rename', id: string): void;
  (e: 'delete', id: string): void;
  (e: 'assign', url: string, albumId: string): void;
}>();

function onDrop(e: DragEvent) {
  const url = e.dataTransfer?.getData('text/url') || e.dataTransfer?.getData('text/plain');
  if (url) emit('assign', url, props.album.id);
}
</script>

<template>
  <div
    class="album-chip"
    :title="`拖图片到此处 = 加入「${album.name}」`"
    @dragover.prevent="$event.dataTransfer && ($event.dataTransfer.dropEffect = 'move')"
    @drop.prevent="onDrop"
  >
    <span class="album-chip-name">{{ album.name }}</span>
    <span class="album-chip-count">{{ count }}</span>
    <span class="album-chip-actions">
      <button class="album-chip-action" title="重命名" @click.stop="emit('rename', album.id)">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11.2 1.6 14.4 4.8 5.2 14H2v-3.2z" />
          <path d="M9.6 3.2 12.8 6.4" />
        </svg>
      </button>
      <button class="album-chip-action is-danger" title="删除图集" @click.stop="emit('delete', album.id)">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2.5 4.2h11M6.2 4.2V2.4h3.6v1.8M4 4.2l.7 9h6.6l.7-9M6.6 6.6v4.4M9.4 6.6v4.4" />
        </svg>
      </button>
    </span>
  </div>
</template>
