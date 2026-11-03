<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { ConversationRecord, DocumentRecord } from '../db'
import { importDocument, listDocuments, loadCurrentDocument, setCurrentDocument } from '../db/documents'
import { renderMarkdown, type CodeHighlighter } from '../reader/markdown'
import { getCodeHighlighter } from '../reader/highlighter'
import { readerState } from '../reader/state'
import type { TextMap } from '../textmap'
import { hitTest, paint, positionFromPoint, supportsCustomHighlight, type PaintItem } from '../highlight'
import { addHighlight, loadAnnotations, locateAnchors, removeHighlightsOf, saveAnchor, type LocatedAnchor } from '../anchor/store'
import { clearSelectionCache, recordToolbarClick, selectionState, watchSelection, type CachedSelection } from '../selection'
import { nearbyText } from '../ai/context'
import { sendToApp } from '../share'
import { isLikelyMarkdown, listenIncomingFiles, type IncomingFile } from '../platform/incoming'
import AskPanel from './AskPanel.vue'

const contentEl = ref<HTMLElement | null>(null)
const doc = shallowRef<DocumentRecord | null>(null)
const docs = shallowRef<DocumentRecord[]>([])
const located = shallowRef<LocatedAnchor[]>([])
const highlightAnchorIds = shallowRef<Set<string>>(new Set())
const conversations = shallowRef<ConversationRecord[]>([])
const toast = ref('')
const loadError = ref('')
const panel = ref<{ mode: 'anchor' | 'pending'; anchorId: string | null; quote: string; nearby: string } | null>(null)
// 点中的位置可能同时落在几处重叠的锚点上：划线可以一起删；对话取范围最小的那一处
const tapped = ref<{ highlightIds: string[]; convAnchorId: string | null; convCount: number } | null>(null)
const toolbarBottom = ref(0)
const fileInput = ref<HTMLInputElement | null>(null)

let map: TextMap | null = null
let highlighter: CodeHighlighter | null = null
let toastTimer: ReturnType<typeof setTimeout> | undefined
const cleanups: (() => void)[] = []

const cache = computed(() => selectionState.cache)
const pendingCount = computed(() => conversations.value.filter((c) => c.status === 'pending').length)

function showToast(text: string, ms = 2500) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), ms)
}

// ---------- 渲染与划线 ----------

function paintItems(): PaintItem[] {
  const convAnchors = new Set(conversations.value.map((c) => c.anchorId).filter(Boolean) as string[])
  const items: PaintItem[] = []
  for (const l of located.value) {
    if (highlightAnchorIds.value.has(l.anchor.id)) items.push({ anchorId: l.anchor.id, start: l.start, end: l.end, kind: 'highlight' })
    if (convAnchors.has(l.anchor.id)) items.push({ anchorId: l.anchor.id, start: l.start, end: l.end, kind: 'ask' })
  }
  return items
}

function repaint() {
  if (!contentEl.value) return
  readerState.paintMode = supportsCustomHighlight() ? 'custom-highlight' : 'mark'
  map = paint(contentEl.value, paintItems(), readerState.paintMode)
}

async function refreshAnnotations() {
  if (!doc.value || !map) return
  const ann = await loadAnnotations(doc.value.id)
  const r = locateAnchors(map.text, ann.anchors)
  located.value = r.located
  highlightAnchorIds.value = new Set(ann.highlights.map((h) => h.anchorId))
  conversations.value = ann.conversations.sort((a, b) => a.createdAt - b.createdAt)
  readerState.anchors = ann.anchors.length
  readerState.orphans = r.orphans.length
  repaint()
}

async function renderDoc() {
  if (!contentEl.value || !doc.value) return
  contentEl.value.innerHTML = renderMarkdown(doc.value.source, highlighter ?? undefined)
  map = paint(contentEl.value, [])
  await refreshAnnotations()
}

async function openDoc(d: DocumentRecord) {
  clearSelectionCache()
  panel.value = null
  tapped.value = null
  doc.value = d
  await setCurrentDocument(d.id)
  await nextTick()
  contentEl.value?.scrollTo({ top: 0 })
  await renderDoc()
}

async function fetchSample(): Promise<string> {
  const res = await fetch('./samples/test.md')
  if (!res.ok) throw new Error(`读取内置测试文档失败：HTTP ${res.status}`)
  return res.text()
}

// ---------- 导入 ----------

async function importText(text: string, name: string) {
  if (!isLikelyMarkdown(name, text)) {
    showToast(`「${name || '收到的内容'}」看起来不是 Markdown 文件，没有导入`, 4000)
    return
  }
  const before = new Set(docs.value.map((d) => d.title))
  const d = await importDocument(text, name)
  docs.value = await listDocuments()
  await openDoc(d)
  showToast(before.has(d.title) ? `已导入「${d.title}」，同名文档已保留两份` : `已导入「${d.title}」`)
}

async function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  for (const f of Array.from(input.files ?? [])) await importText(await f.text(), f.name)
  input.value = ''
}

async function onIncoming(file: IncomingFile) {
  if (file.error) {
    showToast(`读取文件失败：${file.error}`, 4000)
    return
  }
  await importText(file.text, file.name)
}

async function onDocSelect(e: Event) {
  const d = docs.value.find((x) => x.id === (e.target as HTMLSelectElement).value)
  if (d) await openDoc(d)
}

// ---------- 工具栏 ----------

function sectionOf(pos: number): string | null {
  if (!map || !contentEl.value) return null
  let title: string | null = null
  for (const h of Array.from(contentEl.value.querySelectorAll('h1,h2,h3'))) {
    if (map.fromDom(h, 0, 'start').pos > pos) break
    title = h.textContent?.trim() ?? null
  }
  return title
}

function takeCache(button: string): CachedSelection | null {
  recordToolbarClick(button, contentEl.value)
  const c = selectionState.cache
  if (!c) {
    showToast('选区已经丢失，请重新选中文字')
    return null
  }
  if (c.expanded) showToast('选区碰到了公式，已按整块公式处理')
  return c
}

function finishSelection() {
  clearSelectionCache()
  document.getSelection()?.removeAllRanges()
}

async function onHighlight() {
  const c = takeCache('划线')
  if (!c || !doc.value || !map) return
  const anchor = await saveAnchor(doc.value, map.text, c.start, c.end)
  await addHighlight(anchor.id)
  finishSelection()
  await refreshAnnotations()
}

async function onAsk() {
  const c = takeCache('侧栏问')
  if (!c || !doc.value || !map) return
  // 打开提问面板之前先把选区存成锚点
  const anchor = await saveAnchor(doc.value, map.text, c.start, c.end)
  panel.value = {
    mode: 'anchor',
    anchorId: anchor.id,
    quote: c.text,
    nearby: map.textWithTex(...nearbyRange(c.start, c.end)),
  }
  finishSelection()
  await refreshAnnotations()
}

function nearbyRange(start: number, end: number): [number, number] {
  const text = nearbyText(map!.text, start, end)
  const a = map!.text.lastIndexOf(text, start)
  return [a === -1 ? start : a, a === -1 ? end : a + text.length]
}

async function onSendToApp() {
  const c = takeCache('发到 App')
  if (!c || !doc.value || !map) return
  const anchor = await saveAnchor(doc.value, map.text, c.start, c.end)
  finishSelection()
  const { result } = await sendToApp({ doc: doc.value, anchorId: anchor.id, section: sectionOf(c.start), quote: c.text })
  await refreshAnnotations()
  if (result === 'copied') showToast('当前环境不支持分享，已复制到剪贴板；已建好待补充记录')
  else if (result === 'failed') showToast('分享和复制都失败了；待补充记录已建好')
  else showToast('已建好待补充记录，拿到回答后点顶部「待补充」粘贴进来')
}

function onCancel() {
  recordToolbarClick('取消', contentEl.value)
  finishSelection()
}

// ---------- 点击已有划线 ----------

function onContentClick(e: MouseEvent) {
  if (!map) return
  const sel = document.getSelection()
  if (sel && !sel.isCollapsed) return
  const pos = positionFromPoint(map, e.clientX, e.clientY)
  const hits = pos === null ? [] : hitTest(paintItems(), pos)
  if (hits.length === 0) {
    tapped.value = null
    return
  }
  const asks = hits.filter((h) => h.kind === 'ask').sort((a, b) => a.end - a.start - (b.end - b.start))
  const convAnchorId = asks[0]?.anchorId ?? null
  tapped.value = {
    highlightIds: hits.filter((h) => h.kind === 'highlight').map((h) => h.anchorId),
    convAnchorId,
    convCount: convAnchorId ? conversations.value.filter((c) => c.anchorId === convAnchorId).length : 0,
  }
}

function openAnchorPanel(anchorId: string) {
  const l = located.value.find((x) => x.anchor.id === anchorId)
  if (!l || !map) return
  panel.value = { mode: 'anchor', anchorId, quote: map.textWithTex(l.start, l.end), nearby: map.textWithTex(...nearbyRange(l.start, l.end)) }
  tapped.value = null
}

async function removeTappedHighlight() {
  if (!tapped.value) return
  for (const id of tapped.value.highlightIds) await removeHighlightsOf(id)
  tapped.value = null
  await refreshAnnotations()
}

// ---------- 键盘与可视区域 ----------

function onViewportChange() {
  const vv = window.visualViewport
  if (!vv) return
  // 键盘弹出时，可视区域底部到布局视口底部的距离
  toolbarBottom.value = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  if (panel.value?.mode === 'anchor') keepAnchorVisible()
}

function keepAnchorVisible() {
  const l = located.value.find((x) => x.anchor.id === panel.value?.anchorId)
  if (!l || !map || !contentEl.value) return
  const rect = map.toRange(l.start, l.end).getBoundingClientRect()
  const box = contentEl.value.getBoundingClientRect()
  const visibleBottom = Math.min(box.bottom, window.visualViewport ? window.visualViewport.height + window.visualViewport.offsetTop : box.bottom)
  if (rect.top < box.top || rect.bottom > visibleBottom) {
    contentEl.value.scrollBy({ top: rect.top - box.top - (visibleBottom - box.top) / 3 })
  }
}

function onFocusInput() {
  // 等键盘弹出、视口变化后再调整
  setTimeout(keepAnchorVisible, 350)
}

// ---------- 生命周期 ----------

onMounted(async () => {
  cleanups.push(watchSelection(() => map))
  window.visualViewport?.addEventListener('resize', onViewportChange)
  window.visualViewport?.addEventListener('scroll', onViewportChange)
  cleanups.push(() => {
    window.visualViewport?.removeEventListener('resize', onViewportChange)
    window.visualViewport?.removeEventListener('scroll', onViewportChange)
  })

  try {
    doc.value = await loadCurrentDocument(fetchSample)
    docs.value = await listDocuments()
    await nextTick()
    await renderDoc()
  } catch (e) {
    loadError.value = String(e)
  }

  // 代码高亮异步加载，好了再重渲染一次；锚点按文字定位，不受影响
  highlighter = await getCodeHighlighter()
  readerState.codeHighlight = highlighter ? 'loaded' : 'failed'
  if (highlighter && doc.value) await renderDoc()

  cleanups.push(await listenIncomingFiles((f) => void onIncoming(f)))
})

onBeforeUnmount(() => {
  cleanups.forEach((f) => f())
  clearTimeout(toastTimer)
})
</script>

<template>
  <div class="reader" :class="{ 'with-panel': panel }">
    <div class="doc-col">
      <div class="doc-bar">
        <select class="doc-select" :value="doc?.id" @change="onDocSelect">
          <option v-for="d in docs" :key="d.id" :value="d.id">
            {{ d.title }}（{{ new Date(d.importedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}）
          </option>
        </select>
        <button @click="fileInput?.click()">导入 md</button>
        <input ref="fileInput" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden @change="onFilesPicked" />
        <button v-if="pendingCount" class="pending" @click="panel = { mode: 'pending', anchorId: null, quote: '', nearby: '' }">
          待补充 {{ pendingCount }}
        </button>
      </div>
      <p v-if="loadError" class="load-error">{{ loadError }}</p>
      <article ref="contentEl" class="md content" @click="onContentClick" />
    </div>

    <AskPanel
      v-if="panel && doc"
      class="side"
      :doc="doc"
      :mode="panel.mode"
      :anchor-id="panel.anchorId"
      :quote="panel.quote"
      :nearby="panel.nearby"
      :conversations="conversations"
      @close="panel = null"
      @changed="refreshAnnotations"
      @focus-input="onFocusInput"
    />

    <div v-if="cache" class="toolbar" :style="{ bottom: toolbarBottom + 'px' }" @pointerdown.prevent>
      <span class="sel-info">已选 {{ cache.plain.length }} 字{{ cache.expanded ? ' · 含整块公式' : '' }}</span>
      <button @pointerdown.prevent @click="onHighlight">划线</button>
      <button @pointerdown.prevent @click="onAsk">侧栏问</button>
      <button @pointerdown.prevent @click="onSendToApp">发到 App</button>
      <button class="cancel" @pointerdown.prevent @click="onCancel">✕</button>
    </div>

    <div v-else-if="tapped" class="toolbar" :style="{ bottom: toolbarBottom + 'px' }">
      <button v-if="tapped.convAnchorId" @click="openAnchorPanel(tapped.convAnchorId)">查看对话（{{ tapped.convCount }}）</button>
      <button v-if="tapped.highlightIds.length" @click="removeTappedHighlight">删除划线</button>
      <button class="cancel" @click="tapped = null">✕</button>
    </div>

    <div v-if="toast" class="toast" :style="{ bottom: toolbarBottom + 72 + 'px' }">{{ toast }}</div>
  </div>
</template>

<style scoped>
.reader {
  display: flex;
  height: 100%;
  min-height: 0;
}
.doc-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.doc-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
}
.doc-select {
  flex: 1;
  min-width: 0;
  max-width: 420px;
  padding: 6px;
  font-size: 15px;
}
.doc-bar button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  font-size: 15px;
}
.doc-bar .pending {
  border-color: #bf8700;
  color: #9a6700;
}
.load-error {
  color: #cf222e;
  padding: 0 16px;
}
.content {
  flex: 1;
  overflow: auto;
  padding: 16px 32px 120px;
}
.side {
  width: 40%;
  max-width: 520px;
  min-width: 320px;
  border-left: 1px solid var(--border);
}
/* 竖屏：面板变成底部抽屉 */
@media (orientation: portrait) {
  .reader.with-panel {
    flex-direction: column;
  }
  .reader.with-panel .doc-col {
    flex: 1 1 45%;
  }
  .side {
    width: 100%;
    max-width: none;
    min-width: 0;
    flex: 1 1 55%;
    min-height: 0;
    border-left: none;
    border-top: 1px solid var(--border);
  }
}
.toolbar {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: max(12px, env(safe-area-inset-bottom));
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 6px;
  background: #24292f;
  color: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  z-index: 20;
  user-select: none;
  -webkit-user-select: none;
}
.toolbar button {
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font-size: 16px;
}
.toolbar button:active {
  background: rgba(255, 255, 255, 0.15);
}
.toolbar .cancel {
  padding: 10px 12px;
  color: #afb8c1;
}
.sel-info {
  font-size: 12px;
  color: #afb8c1;
  padding: 0 8px;
}
.toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  max-width: 90vw;
  padding: 8px 14px;
  background: rgba(36, 41, 47, 0.92);
  color: #fff;
  border-radius: 8px;
  font-size: 14px;
  z-index: 21;
  pointer-events: none;
}
</style>
