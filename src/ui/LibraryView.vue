<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { db, type DocumentRecord } from '../db'
import { applyMigration, planMigration, type MigrationPlan } from '../anchor/migrate'
import { listDocuments, loadDocStats, type DocStats } from '../db/documents'
import { parseTags } from '../reader/markdown'
import { appState, deleteDocument, importSample, importText, openDocument, showToast } from '../app/store'
import { confirmDialog } from '../app/dialog'
import { exportOriginal } from '../export/original'
import { isLikelyMarkdown, isTooLarge } from '../platform/incoming'
import { continueDoc, percent, sortByRecent } from '../reader/library'
import Icon from './Icon.vue'

// 书架：标题、进度、划线和问答数、标签；点开即读；可以按标签筛选、导出和删除。

const docs = shallowRef<DocumentRecord[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const pasting = ref(false)
const pasteText = ref('')
const pasteName = ref('')
const stats = shallowRef<Map<string, DocStats>>(new Map())
const tagsOf = shallowRef<Map<string, string[]>>(new Map())
const activeTag = ref<string | null>(null)

const allTags = computed(() => [...new Set([...tagsOf.value.values()].flat())].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const shown = computed(() => (activeTag.value === null ? docs.value : docs.value.filter((d) => tagsOf.value.get(d.id)?.includes(activeTag.value!))))
const resume = computed(() => continueDoc(docs.value))
const menuFor = ref<string | null>(null)

function closeMenu(e: PointerEvent) {
  if (!(e.target as Element).closest?.('.menu-wrap')) menuFor.value = null
}

async function refresh() {
  docs.value = sortByRecent(await listDocuments())
  stats.value = await loadDocStats()
  tagsOf.value = new Map(docs.value.map((d) => [d.id, parseTags(d.source)]))
  if (activeTag.value !== null && !allTags.value.includes(activeTag.value)) activeTag.value = null
}

function statsText(id: string): string {
  const s = stats.value.get(id)
  const parts: string[] = []
  if (s?.highlights) parts.push(`${s.highlights} 处划线`)
  if (s?.conversations) parts.push(`${s.conversations} 条问答`)
  return parts.join(' · ')
}

function fmt(t: number) {
  return new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
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
  const ok = await confirmDialog({ title: `删除「${d.title}」？`, message: '它的划线、批注和对话会一起删除，无法恢复。', confirmText: '删除', danger: true })
  if (!ok) return
  await deleteDocument(d.id)
  showToast(`已删除「${d.title}」`)
}

// ---------- 更新为新版本（划线迁移） ----------

const updating = shallowRef<DocumentRecord | null>(null)
const updateText = ref('')
const updatePlan = shallowRef<MigrationPlan | null>(null)
const updateInput = ref<HTMLInputElement | null>(null)

function startUpdate(d: DocumentRecord) {
  updating.value = d
  updateText.value = ''
  updatePlan.value = null
}

function cancelUpdate() {
  updating.value = null
  updateText.value = ''
  updatePlan.value = null
}

/** 只计算不写库，给出「能找回几处」 */
async function previewUpdate(text: string, name: string) {
  const d = updating.value
  if (!d) return
  if (isTooLarge(text.length)) {
    showToast('文档太大了，单篇不能超过 5 MB', 4000)
    return
  }
  if (!isLikelyMarkdown(name, text)) {
    showToast('这看起来不是 Markdown，没有更新', 4000)
    return
  }
  const plan = await planMigration(db, d, text)
  if (plan.unchanged) {
    showToast('新内容和现在的一样，不用更新')
    return
  }
  updatePlan.value = plan
}

async function onUpdateFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (isTooLarge(file.size)) showToast(`「${file.name}」太大了，单篇不能超过 5 MB`, 4000)
  else await previewUpdate(await file.text(), file.name)
}

async function confirmUpdate() {
  const d = updating.value
  const plan = updatePlan.value
  if (!d || !plan) return
  try {
    await applyMigration(db, d, plan)
  } catch (e) {
    showToast(`更新失败，原有数据没有改动：${String(e)}`, 5000)
    return
  }
  showToast(plan.lost.length ? `已更新，${plan.lost.length} 处划线找不到原文，保留在「原文已找不到」` : '已更新，划线都在', 4000)
  cancelUpdate()
  appState.docsVersion++
  if (d.id === appState.currentDocId) appState.sourceVersion++
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
onMounted(() => {
  void refresh()
  document.addEventListener('pointerdown', closeMenu)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeMenu))
</script>

<template>
  <div class="library">
    <div class="page-head">
      <h2>书架</h2>
      <button @click="pasting = !pasting"><Icon name="clipboard" :size="18" />{{ pasting ? '取消粘贴' : '粘贴导入' }}</button>
      <button class="primary" @click="fileInput?.click()"><Icon name="plus" :size="18" />导入文档</button>
      <input ref="fileInput" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden @change="onFilesPicked" />
    </div>

    <!-- 确定按钮放在输入框上方：键盘弹出时会盖住下方的内容 -->
    <div v-if="pasting" class="card block">
      <div class="paste-row">
        <input v-model="pasteName" placeholder="名称（可选，文档里有标题时以文档为准）" />
        <button class="primary" :disabled="!pasteText.trim()" @click="importPasted">确定导入</button>
      </div>
      <textarea v-model="pasteText" rows="6" placeholder="把 Markdown 内容粘贴到这里" />
    </div>

    <div v-if="docs.length === 0 && !pasting" class="empty-state">
      <Icon class="big-icon" name="book" :size="56" />
      <h3>书架还是空的</h3>
      <p>导入一个 Markdown 文件开始阅读，也可以在微信等 App 里选「用其他应用打开」，再选「问读」。</p>
      <div class="row">
        <button class="primary" @click="fileInput?.click()">导入文档</button>
        <button @click="importSample">打开示例文档</button>
      </div>
    </div>

    <button v-if="resume && !updating" class="resume" @click="openDocument(resume!.id)">
      <Icon name="book" />
      <span class="resume-text">继续阅读 <strong>{{ resume.title }}</strong></span>
      <span class="resume-pct">{{ percent(resume.progress) }}%</span>
      <Icon name="arrowRight" :size="18" />
    </button>

    <div v-if="allTags.length" class="tag-bar">
      <button class="chip" :class="{ on: activeTag === null }" @click="activeTag = null">全部</button>
      <button v-for="t in allTags" :key="t" class="chip" :class="{ on: activeTag === t }" @click="activeTag = t">{{ t }}</button>
    </div>

    <div v-if="updating" class="card block">
      <strong>把「{{ updating.title }}」更新为新版本</strong>
      <template v-if="!updatePlan">
        <p class="hint">划线、批注和对话会迁移到新内容上。这不是导入新文档，书架上还是这一篇。</p>
        <div class="paste-row">
          <button class="primary" @click="updateInput?.click()">选择 md 文件</button>
          <button @click="cancelUpdate">取消</button>
        </div>
        <input ref="updateInput" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden @change="onUpdateFile" />
        <div class="paste-row between">
          <span class="hint">或者粘贴新内容：</span>
          <button :disabled="!updateText.trim()" @click="previewUpdate(updateText, 'pasted.md')">检查</button>
        </div>
        <textarea v-model="updateText" rows="5" placeholder="把新版本的 Markdown 粘贴到这里" />
      </template>
      <template v-else>
        <p class="result">能找回 <strong>{{ updatePlan.moved.length }}</strong> 处，<strong :class="{ warn: updatePlan.lost.length }">{{ updatePlan.lost.length }}</strong> 处找不到。</p>
        <p v-if="updatePlan.lost.length" class="hint">找不到的划线不会删除，保留在笔记的「原文已找不到」里。</p>
        <p class="hint">旧版原文不保留。需要的话，先点「取消」，再导出这篇的原文或备份。</p>
        <div class="paste-row">
          <button class="primary" @click="confirmUpdate">确认更新</button>
          <button @click="cancelUpdate">取消</button>
        </div>
      </template>
    </div>

    <ul class="grid">
      <li v-for="d in shown" :key="d.id" class="doc card" :class="{ current: d.id === appState.currentDocId }">
        <button class="open" @click="openDocument(d.id)">
          <span class="title">{{ d.title }}</span>
          <span class="meta">{{ statsText(d.id) || (d.progress === undefined ? '未开始' : '还没有笔记') }}</span>
          <span v-if="tagsOf.get(d.id)?.length" class="tags">
            <span v-for="t in tagsOf.get(d.id)" :key="t" class="tag">{{ t }}</span>
          </span>
          <span class="foot">
            <span class="track"><span class="fill" :style="{ width: percent(d.progress) + '%' }" /></span>
            <span class="pct">{{ percent(d.progress) }}%</span>
            <span class="date">{{ fmt(d.lastReadAt) }}</span>
          </span>
        </button>
        <span class="menu-wrap more">
          <button class="ghost dots" :aria-label="`${d.title} 的更多操作`" @click="menuFor = menuFor === d.id ? null : d.id"><Icon name="more" /></button>
          <span v-if="menuFor === d.id" class="menu">
            <button @click="(menuFor = null), startUpdate(d)">更新为新版本<small>划线迁移到新内容上</small></button>
            <button @click="(menuFor = null), exportDoc(d)">导出原文</button>
            <button class="danger" @click="(menuFor = null), remove(d)">删除</button>
          </span>
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.library {
  max-width: 1240px;
  margin: 0 auto;
  padding: 28px 32px 56px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}
.block p {
  margin: 0;
}
.paste-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.paste-row.between {
  justify-content: space-between;
}
.paste-row input {
  flex: 1;
  min-width: 0;
}
.hint {
  color: var(--muted);
  font-size: 13px;
}
.warn {
  color: var(--warn);
}
.resume {
  gap: 10px;
  justify-content: flex-start;
  width: 100%;
  min-height: 60px;
  margin-bottom: 20px;
  padding: 0 18px;
  border: none;
  background: var(--accent-soft);
  color: var(--accent);
}
.resume:active:not(:disabled) {
  background: var(--accent-soft);
}
.resume-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg);
  text-align: left;
  text-overflow: ellipsis;
}
.resume-text strong {
  font-weight: 600;
}
.tag-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.doc {
  position: relative;
  display: flex;
  padding: 0;
}
.doc.current {
  border-color: var(--border-strong);
}
.open {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 6px;
  min-height: 148px;
  padding: 18px 20px 16px;
  border: none;
  background: none;
  text-align: left;
  white-space: normal;
}
.open:active:not(:disabled) {
  background: var(--surface);
  transform: none;
}
.title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  padding-right: 32px;
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}
.meta {
  color: var(--muted);
  font-size: 13px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
}
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
  color: var(--muted);
  font-size: 12px;
}
.track {
  flex: 1;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--surface);
}
.fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
}
.more {
  position: absolute;
  top: 6px;
  right: 6px;
}
.dots {
  width: var(--tap);
  padding: 0;
  color: var(--muted);
}
.menu button.danger {
  color: var(--danger);
}
</style>
