<script setup lang="ts">
import { onMounted, ref, shallowRef, watch } from 'vue'
import type { DocumentRecord } from '../db'
import { listDocuments } from '../db/documents'
import { appState, deleteDocument, importText, openDocument, showToast } from '../app/store'
import { exportOriginal } from '../export/original'
import { isTooLarge } from '../platform/incoming'

// 最简书架：标题、导入时间、最近阅读；点开即读；可删除。完整书架（进度、标签）在第二版。

const docs = shallowRef<DocumentRecord[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const pasting = ref(false)
const pasteText = ref('')
const pasteName = ref('')

async function refresh() {
  docs.value = await listDocuments()
}

function fmt(t: number) {
  return new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  // 多选时只导入不跳转，留在书架上看结果
  for (const f of files) {
    // 先看文件大小，太大的不读进内存
    if (isTooLarge(f.size)) showToast(`「${f.name}」太大了，单篇不能超过 5 MB`, 4000)
    else await importText(await f.text(), f.name, files.length === 1)
  }
}

async function importPasted() {
  const text = pasteText.value
  if (!text.trim()) {
    showToast('先粘贴要导入的内容')
    return
  }
  // 粘贴的内容没有文件名，按 md 处理；标题按 YAML、一级标题、填写的名称依次取
  const doc = await importText(text, (pasteName.value.trim() || '粘贴的文档') + '.md')
  if (doc) {
    pasting.value = false
    pasteText.value = ''
    pasteName.value = ''
  }
}

async function remove(d: DocumentRecord) {
  if (!confirm(`删除「${d.title}」？\n\n它的划线、批注和对话会一起删除，无法恢复。`)) return
  await deleteDocument(d.id)
  showToast(`已删除「${d.title}」`)
}

/** 书架上导出的是原文；笔记在阅读页的「导出」里 */
async function exportDoc(d: DocumentRecord) {
  try {
    if ((await exportOriginal(d)) === 'downloaded') showToast(`已导出「${d.title}」`)
  } catch (e) {
    showToast(`导出失败：${String(e)}`, 4000)
  }
}

watch(() => appState.docsVersion, refresh)
onMounted(refresh)
</script>

<template>
  <div class="library">
    <div class="head">
      <h2>书架</h2>
      <button class="primary" @click="fileInput?.click()">导入 md 文件</button>
      <button @click="pasting = !pasting">{{ pasting ? '取消粘贴' : '粘贴导入' }}</button>
      <input ref="fileInput" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden @change="onFilesPicked" />
    </div>

    <!-- 确定按钮放在输入框上方：键盘弹出时会盖住下方的内容 -->
    <div v-if="pasting" class="paste">
      <div class="paste-row">
        <input v-model="pasteName" placeholder="名称（可选，文档里有标题时以文档为准）" />
        <button class="primary" :disabled="!pasteText.trim()" @click="importPasted">确定导入</button>
      </div>
      <textarea v-model="pasteText" rows="6" placeholder="把 Markdown 内容粘贴到这里" />
    </div>

    <p v-if="docs.length === 0" class="empty">书架是空的。导入一个 md 文件，或者从微信等 App 里选「用其他应用打开」→「问读」。</p>

    <ul class="list">
      <li v-for="d in docs" :key="d.id" :class="{ current: d.id === appState.currentDocId }">
        <button class="open" @click="openDocument(d.id)">
          <span class="title">{{ d.title }}</span>
          <span class="meta">导入 {{ fmt(d.importedAt) }} · 最近阅读 {{ fmt(d.lastReadAt) }}</span>
        </button>
        <button class="side-btn" @click="exportDoc(d)">导出</button>
        <button class="side-btn del" @click="remove(d)">删除</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.library {
  max-width: 820px;
  padding: 16px 24px 48px;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.head h2 {
  margin-right: auto;
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
.paste {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
}
.paste-row {
  display: flex;
  gap: 8px;
}
.paste-row input {
  flex: 1;
  min-width: 0;
}
button:disabled {
  opacity: 0.5;
}
.paste input,
.paste textarea {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
}
.empty {
  color: var(--muted);
}
.list {
  list-style: none;
  padding: 0;
  margin: 16px 0;
}
.list li {
  display: flex;
  align-items: stretch;
  gap: 8px;
  border-bottom: 1px solid var(--border);
}
.list li.current .title::before {
  content: '● ';
  color: var(--accent);
}
.open {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 4px;
  border: none;
  border-radius: 0;
  background: none;
  text-align: left;
}
.title {
  font-size: 17px;
  font-weight: 500;
}
.meta {
  font-size: 13px;
  color: var(--muted);
}
.side-btn {
  align-self: center;
}
.del {
  color: var(--danger);
}
</style>
