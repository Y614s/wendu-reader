<script setup lang="ts">
import { onMounted, ref } from 'vue'

// 批注编辑框：新建或修改一段批注。底部抽屉形式，键盘弹出时随可视区域上移。

const props = defineProps<{ quote: string; initial: string; canDelete: boolean; bottom: number }>()
const emit = defineEmits<{ save: [text: string]; cancel: []; remove: [] }>()

const text = ref(props.initial)
const input = ref<HTMLTextAreaElement | null>(null)

onMounted(() => input.value?.focus())
</script>

<template>
  <div class="mask" @click.self="emit('cancel')">
    <div class="sheet" :style="{ marginBottom: bottom + 'px' }">
      <blockquote class="quote">{{ quote }}</blockquote>
      <textarea ref="input" v-model="text" rows="4" placeholder="写下你的想法" />
      <div class="row">
        <button v-if="canDelete" class="danger" @click="emit('remove')">删除批注</button>
        <span class="spacer" />
        <button @click="emit('cancel')">取消</button>
        <button class="primary" :disabled="!text.trim()" @click="emit('save', text.trim())">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: var(--scrim);
  animation: fade var(--dur) var(--ease);
}
.sheet {
  width: min(640px, 100%);
  padding: 20px;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
  border-radius: var(--radius-l) var(--radius-l) 0 0;
  background: var(--card);
  box-shadow: var(--shadow-3);
  animation: slide-up var(--dur) var(--ease);
}
.quote {
  margin: 0 0 12px;
  padding: 2px 12px;
  border-left: 3px solid var(--accent);
  max-height: 6em;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--muted);
  line-height: 1.6;
}
textarea {
  width: 100%;
}
.row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.spacer {
  flex: 1;
}
</style>
