<script setup lang="ts">
// 内联线条图标，不引入图标库。颜色跟随文字，大小用 size。

const PATHS = {
  back: 'M15 5l-7 7 7 7',
  list: 'M8.5 6H21M8.5 12H21M8.5 18H21M3 6h1.5M3 12h1.5M3 18h1.5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.8-4.8',
  ask: 'M21 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-5.3A8 8 0 1 1 21 12z',
  note: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z',
  type: 'M4 19l5.5-14h1L16 19M6 14h8M16.5 19c0-3 1-4.5 2.8-4.5 1.2 0 1.7.7 1.7 2V19',
  more: 'M4.5 12h1.5M11.25 12h1.5M18 12h1.5',
  close: 'M6 6l12 12M18 6L6 18',
  book: 'M12 6.5C10.5 5 8 4.5 4 4.5v14c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-14c-4 0-6.5.5-8 2zM12 6.5v14',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-4l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3L3 9.3l2-3.4 1.9.7a7 7 0 0 1 1.7-1l.3-2h4l.3 2a7 7 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z',
  plus: 'M12 5v14M5 12h14',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  stop: 'M7 7h10v10H7z',
  clipboard: 'M9 4h6v3H9zM9 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-3',
  export: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16v4M17 18h4',
  palette: 'M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-1.2-1-1.6-1-2.7 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
  data: 'M12 3c-4.4 0-8 1.3-8 3s3.6 3 8 3 8-1.3 8-3-3.6-3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5h.01',
} as const

export type IconName = keyof typeof PATHS

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 20 })
</script>

<template>
  <svg class="icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="PATHS[name]" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
}
</style>
