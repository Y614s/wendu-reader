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
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
  z-index: 30;
}
.sheet {
  width: min(640px, 100%);
  padding: 14px 16px;
  padding-bottom: max(14px, env(safe-area-inset-bottom));
  border-radius: 14px 14px 0 0;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.2);
}
.quote {
  margin: 0 0 10px;
  padding: 4px 10px;
  border-left: 3px solid #d4a72c;
  max-height: 6em;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--muted);
}
textarea {
  width: 100%;
  font: inherit;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
}
.row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.spacer {
  flex: 1;
}
button {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 15px;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
button.danger {
  color: var(--danger);
}
button:disabled {
  opacity: 0.5;
}
</style>
