<script setup lang="ts">
import { ref } from 'vue'
import { fillPending } from '../share'
import { readClipboardText } from '../platform/share'

// 待补充记录：把在其他 App 得到的回答粘贴回来

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ changed: []; focusInput: [] }>()

const draft = ref('')
const appName = ref('')
const hint = ref('')

async function fromClipboard() {
  const text = await readClipboardText()
  if (text === null) {
    hint.value = '剪贴板是空的，或者不是文字。也可以直接在框里长按粘贴。'
    return
  }
  hint.value = ''
  draft.value = text
}

async function save() {
  const text = draft.value.trim()
  if (!text) {
    hint.value = '先粘贴回答再保存。'
    return
  }
  await fillPending(props.id, text, appName.value.trim() || '其他 App')
  draft.value = ''
  emit('changed')
}
</script>

<template>
  <div class="paste">
    <textarea v-model="draft" rows="4" placeholder="在其他 App 得到回答后，复制回来粘贴到这里" @focus="emit('focusInput')" />
    <div class="row">
      <input v-model="appName" class="app-name" placeholder="App 名称（可选）" />
      <button @click="fromClipboard">从剪贴板粘贴</button>
      <button class="primary" @click="save">保存</button>
    </div>
    <p v-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
textarea {
  width: 100%;
  resize: vertical;
}
.row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.app-name {
  flex: 1;
  min-width: 100px;
}
.hint {
  color: var(--muted);
  font-size: 13px;
}
</style>
