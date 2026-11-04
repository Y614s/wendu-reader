<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MAX_PROMPTS, MAX_PROMPT_LENGTH, normalizePrompts, quickPrompts, type CustomPrompts } from '../ai/context'
import { prefs, setQuickPrompts } from '../app/prefs'

// 自定义快捷提问：针对原文和整篇提问各一组。

const props = defineProps<{ group: keyof CustomPrompts; title: string }>()

const whole = computed(() => props.group === 'whole')
const list = ref<string[]>([])

function reload() {
  list.value = [...quickPrompts(whole.value, prefs.quickPrompts)]
}

watch(() => prefs.quickPrompts, reload, { immediate: true })

async function save() {
  // 输入过程中保留空行；保存时才清理
  await setQuickPrompts(props.group, normalizePrompts(list.value))
}

function add() {
  if (list.value.length < MAX_PROMPTS) list.value.push('')
}

async function remove(i: number) {
  list.value.splice(i, 1)
  await save()
}

async function move(i: number, step: -1 | 1) {
  const j = i + step
  ;[list.value[i], list.value[j]] = [list.value[j], list.value[i]]
  await save()
}

async function reset() {
  await setQuickPrompts(props.group, null)
}
</script>

<template>
  <div class="prompts">
    <span class="field-label">{{ title }}</span>
    <div v-for="(_, i) in list" :key="i" class="row">
      <input v-model="list[i]" :maxlength="MAX_PROMPT_LENGTH" placeholder="快捷提问的内容" @change="save" />
      <button :disabled="i === 0" aria-label="上移" @click="move(i, -1)">↑</button>
      <button :disabled="i === list.length - 1" aria-label="下移" @click="move(i, 1)">↓</button>
      <button class="danger" @click="remove(i)">删除</button>
    </div>
    <p v-if="list.length === 0" class="muted">没有快捷提问，侧栏里不显示按钮。</p>
    <div class="actions">
      <button :disabled="list.length >= MAX_PROMPTS" @click="add">添加一条</button>
      <button @click="reset">恢复默认</button>
    </div>
  </div>
</template>

<style scoped>
.prompts {
  margin: 16px 0;
}
.field-label {
  font-weight: 500;
}
.row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.row input {
  flex: 1;
  min-width: 0;
  font: inherit;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
button {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  font-size: 14px;
}
button.danger {
  color: var(--danger);
}
button:disabled {
  opacity: 0.4;
}
.muted {
  color: var(--muted);
  font-size: 13px;
}
</style>
