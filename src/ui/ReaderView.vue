<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { db, getSetting, setSetting, type ConversationRecord, type DocumentRecord, type NoteRecord } from '../db'
import { saveReadingPosition } from '../db/documents'
import { shouldRemindBackup } from '../db/backup'
import { appState, showToast } from '../app/store'
import { navigate } from '../app/router'
import { prefs } from '../app/prefs'
import { renderMarkdown, type CodeHighlighter } from '../reader/markdown'
import { getCodeHighlighter } from '../reader/highlighter'
import { readerState } from '../reader/state'
import { collectHeadings, headingAt, sectionStarts, type Heading } from '../reader/outline'
import { clampPosition, progressOf, scrollToPosition, topVisiblePosition } from '../reader/position'
import { buildNoteGroups } from '../reader/notes'
import type { TextMap } from '../textmap'
import { hitTest, paint, positionFromPoint, supportsCustomHighlight, type PaintItem } from '../highlight'
import {
  addHighlight,
  addNote,
  deleteNote,
  loadAnnotations,
  locateAnchors,
  removeHighlightAndNotes,
  deleteAnchorIfUnused,
  deleteConversation,
  saveAnchor,
  updateNote,
  type LocatedAnchor,
} from '../anchor/store'
import { anchorLeftBehind } from '../anchor/cleanup'
import type { AnchorRecord } from '../db'
import { clearSelectionCache, recordToolbarClick, selectionState, watchSelection, type CachedSelection } from '../selection'
import { buildContext, type ContextScope } from '../ai/context'
import type { ChatMessageInput } from '../ai/client'
import { sendToApp } from '../share'
import { copyText } from '../platform/share'
import { safeFileName, saveTextFile } from '../platform/files'
import { exportMarkdown, formatDate } from '../export/markdown'
import { exportOriginal } from '../export/original'
import AskPanel from './AskPanel.vue'
import NotesPanel from './NotesPanel.vue'
import NoteEditor from './NoteEditor.vue'

const props = defineProps<{ active: boolean }>()

const contentEl = ref<HTMLElement | null>(null)
const doc = shallowRef<DocumentRecord | null>(null)
const located = shallowRef<LocatedAnchor[]>([])
const orphans = shallowRef<AnchorRecord[]>([])
const highlightAnchorIds = shallowRef<Set<string>>(new Set())
const notes = shallowRef<NoteRecord[]>([])
const conversations = shallowRef<ConversationRecord[]>([])
const headings = shallowRef<Heading[]>([])
const flashId = ref<string | null>(null)

type Panel =
  | { mode: 'ask'; anchorId: string | null; quote: string | null; focus: { start: number; end: number } }
  | { mode: 'notes'; focusPending: boolean }
const panel = ref<Panel | null>(null)
const tapped = ref<{ highlightIds: string[]; anchorId: string; convAnchorId: string | null; convCount: number } | null>(null)
const editor = ref<{ anchorId: string; quote: string; note: NoteRecord | null } | null>(null)
const tocOpen = ref(false)
const exportMenu = ref(false)
const progress = ref(0)
const currentHeading = ref<Heading | null>(null)
const toolbarBottom = ref(0)

let map: TextMap | null = null
let highlighter: CodeHighlighter | null = null
let restorePending: number | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let flashTimer: ReturnType<typeof setTimeout> | undefined
const cleanups: (() => void)[] = []

const cache = computed(() => selectionState.cache)
const pendingCount = computed(() => conversations.value.filter((c) => c.status === 'pending').length)
const toc = computed(() => headings.value.filter((h) => h.level >= 2 && h.level <= 3))
const noteGroups = computed(() =>
  buildNoteGroups({
    located: located.value,
    orphans: orphans.value,
    highlighted: highlightAnchorIds.value,
    notes: notes.value,
    conversations: conversations.value,
    quoteOf: (a, b) => map?.textWithTex(a, b) ?? '',
  }),
)

// ---------- 渲染与划线 ----------

function paintItems(): PaintItem[] {
  const convAnchors = new Set(conversations.value.map((c) => c.anchorId).filter(Boolean) as string[])
  const noteAnchors = new Set(notes.value.map((n) => n.anchorId))
  const items: PaintItem[] = []
  for (const l of located.value) {
    const id = l.anchor.id
    // 有批注但没划线的锚点也画出来，否则点不到
    if (highlightAnchorIds.value.has(id) || noteAnchors.has(id)) items.push({ anchorId: id, start: l.start, end: l.end, kind: 'highlight' })
    if (convAnchors.has(id)) items.push({ anchorId: id, start: l.start, end: l.end, kind: 'ask' })
    if (flashId.value === id) items.push({ anchorId: id, start: l.start, end: l.end, kind: 'flash' })
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
  orphans.value = r.orphans
  highlightAnchorIds.value = new Set(ann.highlights.map((h) => h.anchorId))
  notes.value = ann.notes
  conversations.value = ann.conversations.sort((a, b) => a.createdAt - b.createdAt)
  readerState.anchors = ann.anchors.length
  readerState.orphans = r.orphans.length
  repaint()
}

/**
 * 打开文档、代码高亮加载完后的重渲染，都排进这条队列依次执行。
 * 两者交错时，后一个会在前一个还没恢复位置时读到顶部位置，把保存的阅读位置冲掉。
 */
let renderChain: Promise<void> = Promise.resolve()
function enqueueRender(task: () => Promise<void>): Promise<void> {
  renderChain = renderChain.then(task).catch((e) => console.warn('渲染失败', e))
  return renderChain
}

/** 调用前先设好 restorePending：替换内容会把滚动位置清零，之后就读不到原来的位置了 */
async function renderDoc() {
  if (!contentEl.value || !doc.value) return
  contentEl.value.innerHTML = renderMarkdown(doc.value.source, highlighter ?? undefined)
  map = paint(contentEl.value, [])
  headings.value = collectHeadings(map)
  await refreshAnnotations()
  if (props.active) restorePosition()
}

/** 只在页面可见时恢复位置：隐藏时量不到元素的位置 */
function restorePosition() {
  if (restorePending === null || !map || !contentEl.value) {
    onScroll()
    return
  }
  const pos = restorePending
  requestAnimationFrame(() => {
    // 期间又重新渲染过、换了要恢复的位置，以新的为准
    if (!map || !contentEl.value || restorePending !== pos) return
    restorePending = null
    scrollToPosition(map, contentEl.value, pos)
    readerState.restoredPosition = pos
    onScroll()
  })
}

async function loadDoc(id: string | null) {
  await savePositionNow()
  clearSelectionCache()
  // 换文档时忘掉上一篇的提问面板，免得点「提问」回到另一篇的原文；上一篇没留下内容的锚点顺手清掉
  const leftAnchor = lastAsk.value?.anchorId ?? null
  lastAsk.value = null
  panel.value = null
  if (leftAnchor) void deleteAnchorIfUnused(leftAnchor)
  tapped.value = null
  tocOpen.value = false
  if (!id) {
    doc.value = null
    if (contentEl.value) contentEl.value.innerHTML = ''
    return
  }
  const d = await db.documents.get(id)
  if (!d) {
    doc.value = null
    return
  }
  doc.value = d
  await nextTick()
  restorePending = clampPosition(d.readingPosition, d.source.length * 2)
  if (contentEl.value) contentEl.value.scrollTop = 0
  await renderDoc()
}

// ---------- 阅读位置、进度、目录 ----------

function currentPosition(): number | null {
  if (!map || !contentEl.value || !props.active) return null
  return topVisiblePosition(map, contentEl.value)
}

async function savePositionNow() {
  clearTimeout(saveTimer)
  // 还没恢复到上次的位置时，当前位置是临时的，不能保存
  if (restorePending !== null) return
  const pos = currentPosition()
  if (!doc.value || pos === null) return
  const el = contentEl.value!
  await saveReadingPosition(doc.value.id, pos, progressOf(el.scrollTop, el.scrollHeight, el.clientHeight))
  readerState.positionSaves++
  readerState.lastSavedPosition = pos
}

function onScroll() {
  const el = contentEl.value
  if (!el) return
  progress.value = progressOf(el.scrollTop, el.scrollHeight, el.clientHeight)
  const top = el.getBoundingClientRect().top + 24
  let cur: Heading | null = null
  for (const h of toc.value) {
    if (h.el.getBoundingClientRect().top > top) break
    cur = h
  }
  currentHeading.value = cur
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void savePositionNow(), 800)
}

function jumpToHeading(h: Heading) {
  const el = contentEl.value
  if (!el) return
  el.scrollTop += h.el.getBoundingClientRect().top - el.getBoundingClientRect().top - 8
  tocOpen.value = false
}

function onVisibility() {
  if (document.visibilityState === 'hidden') void savePositionNow()
}

// ---------- 工具栏 ----------

function sectionOf(pos: number): string | null {
  return headingAt(headings.value, pos)?.title ?? null
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

async function onAnnotate() {
  const c = takeCache('批注')
  if (!c || !doc.value || !map) return
  // 批注 = 划线 + 一段文字；先存锚点和划线，取消写批注也保留划线
  const anchor = await saveAnchor(doc.value, map.text, c.start, c.end)
  await addHighlight(anchor.id)
  finishSelection()
  await refreshAnnotations()
  editor.value = { anchorId: anchor.id, quote: c.text, note: null }
}

async function onAsk() {
  const c = takeCache('侧栏问')
  if (!c || !doc.value || !map) return
  // 打开提问面板之前先把选区存成锚点
  const anchor = await saveAnchor(doc.value, map.text, c.start, c.end)
  panel.value = { mode: 'ask', anchorId: anchor.id, quote: c.text, focus: { start: c.start, end: c.end } }
  finishSelection()
  await refreshAnnotations()
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

async function onCopy() {
  const c = takeCache('复制')
  if (!c || !doc.value) return
  const section = sectionOf(c.start)
  const text = `${c.text}\n\n——《${doc.value.title}》${section ? ' · ' + section : ''}`
  finishSelection()
  showToast((await copyText(text)) ? '已复制原文，附带文档名和章节' : '复制失败')
}

function onCancel() {
  recordToolbarClick('取消', contentEl.value)
  finishSelection()
}

// ---------- 点击正文：已有划线、边缘翻页 ----------

function closeOverlays() {
  tocOpen.value = false
  exportMenu.value = false
}

/** 点到导出菜单以外的地方时收起菜单 */
function onDocPointerDown(e: PointerEvent) {
  if (exportMenu.value && !(e.target as Element).closest?.('.menu-wrap')) exportMenu.value = false
}

function onContentClick(e: MouseEvent) {
  if (!map || !contentEl.value) return
  // 目录或菜单开着时，点正文只是把它们收起来
  if (tocOpen.value || exportMenu.value) {
    closeOverlays()
    return
  }
  const sel = document.getSelection()
  if (sel && !sel.isCollapsed) return
  if ((e.target as Element).closest('a')) return
  const pos = positionFromPoint(map, e.clientX, e.clientY)
  const hits = pos === null ? [] : hitTest(paintItems(), pos).filter((h) => h.kind !== 'flash')
  if (hits.length) {
    const asks = hits.filter((h) => h.kind === 'ask').sort((a, b) => a.end - a.start - (b.end - b.start))
    const convAnchorId = asks[0]?.anchorId ?? null
    const hl = hits.filter((h) => h.kind === 'highlight').sort((a, b) => a.end - a.start - (b.end - b.start))
    tapped.value = {
      highlightIds: hl.map((h) => h.anchorId),
      anchorId: (hl[0] ?? hits[0]).anchorId,
      convAnchorId,
      convCount: convAnchorId ? conversations.value.filter((c) => c.anchorId === convAnchorId).length : 0,
    }
    return
  }
  if (tapped.value) {
    tapped.value = null
    return
  }
  if (prefs.edgeTap) {
    const box = contentEl.value.getBoundingClientRect()
    const y = (e.clientY - box.top) / box.height
    const page = contentEl.value.clientHeight - 48
    if (y < 0.15) contentEl.value.scrollBy({ top: -page })
    else if (y > 0.85) contentEl.value.scrollBy({ top: page })
  }
}

const tappedNote = computed(() =>
  tapped.value ? (notes.value.find((n) => n.anchorId === tapped.value!.anchorId && n.source !== 'ai') ?? null) : null,
)

function quoteOfAnchor(anchorId: string): string {
  const l = located.value.find((x) => x.anchor.id === anchorId)
  if (l && map) return map.textWithTex(l.start, l.end)
  return orphans.value.find((a) => a.id === anchorId)?.quote ?? ''
}

function openEditorForTapped() {
  if (!tapped.value) return
  editor.value = { anchorId: tapped.value.anchorId, quote: quoteOfAnchor(tapped.value.anchorId), note: tappedNote.value }
  tapped.value = null
}

function openAnchorPanel(anchorId: string | null) {
  if (anchorId === null) {
    openWholeAsk()
    return
  }
  const l = located.value.find((x) => x.anchor.id === anchorId)
  panel.value = {
    mode: 'ask',
    anchorId,
    quote: quoteOfAnchor(anchorId),
    focus: l ? { start: l.start, end: l.end } : { start: 0, end: 0 },
  }
  tapped.value = null
}

function openWholeAsk() {
  const pos = currentPosition() ?? 0
  panel.value = { mode: 'ask', anchorId: null, quote: null, focus: { start: pos, end: pos } }
}

// 记住最近一次打开的提问面板：切到「笔记」再点回「提问」时回到那处原文，而不是变成整篇提问
type AskPanelState = Extract<Panel, { mode: 'ask' }>
const lastAsk = shallowRef<AskPanelState | null>(null)

function openAskTab() {
  if (lastAsk.value) panel.value = lastAsk.value
  else openWholeAsk()
}

function askAnchorOf(p: Panel | null): string | null {
  return p?.mode === 'ask' ? p.anchorId : null
}

/** 离开某处原文的提问面板时，如果什么都没留下（没提问、没划线），清掉这个锚点 */
async function cleanupAnchor(anchorId: string) {
  if (askAnchorOf(panel.value) === anchorId) return
  if (await deleteAnchorIfUnused(anchorId)) {
    if (lastAsk.value?.anchorId === anchorId) lastAsk.value = null
    await refreshAnnotations()
  }
}

// 切到「笔记」再切回来不算离开；关闭侧栏、换到另一处原文或整篇提问时才检查空锚点
watch(panel, (now) => {
  const left = anchorLeftBehind(lastAsk.value?.anchorId ?? null, now)
  if (now?.mode === 'ask') lastAsk.value = now
  if (left) void cleanupAnchor(left)
})

async function onDeleteConversation(conv: ConversationRecord) {
  const what = conv.status === 'pending' ? '这条待补充记录' : '这段对话'
  if (!confirm(`删除${what}？删除后无法恢复。`)) return
  await deleteConversation(conv.id)
  await refreshAnnotations()
  if (conv.anchorId) await cleanupAnchor(conv.anchorId)
}

async function removeTappedHighlight() {
  if (!tapped.value) return
  const ids = tapped.value.highlightIds
  // 有批注或「存为笔记」的地方，划线是跟着笔记画出来的：只删划线记录的话，重画后还在
  const noteCount = notes.value.filter((n) => ids.includes(n.anchorId)).length
  if (noteCount && !confirm(`这处划线上有 ${noteCount} 条批注或笔记，会一起删除。确定删除？`)) return
  for (const id of ids) await removeHighlightAndNotes(id)
  tapped.value = null
  await refreshAnnotations()
}

// ---------- 批注 ----------

async function saveEditor(text: string) {
  if (!editor.value) return
  if (editor.value.note) await updateNote(editor.value.note.id, text)
  else await addNote(editor.value.anchorId, text, 'annotation')
  editor.value = null
  await refreshAnnotations()
}

async function removeEditorNote() {
  if (!editor.value?.note) return
  if (!confirm('删除这条批注？')) return
  await deleteNote(editor.value.note.id)
  editor.value = null
  await refreshAnnotations()
}

function editNote(n: NoteRecord) {
  editor.value = { anchorId: n.anchorId, quote: quoteOfAnchor(n.anchorId), note: n }
}

async function saveAnswerAsNote(text: string) {
  if (panel.value?.mode !== 'ask' || !panel.value.anchorId) return
  await addNote(panel.value.anchorId, text, 'ai')
  // 存为笔记也算划线，原文上能看到
  if (!highlightAnchorIds.value.has(panel.value.anchorId)) await addHighlight(panel.value.anchorId)
  await refreshAnnotations()
  showToast('已存为笔记')
}

// ---------- 从笔记跳回原文 ----------

function jumpToAnchor(anchorId: string) {
  const l = located.value.find((x) => x.anchor.id === anchorId)
  if (!l || !map || !contentEl.value) return
  const el = contentEl.value
  const rect = map.toRange(l.start, l.end).getBoundingClientRect()
  const box = el.getBoundingClientRect()
  el.scrollTop += rect.top - box.top - el.clientHeight / 3
  flashId.value = anchorId
  repaint()
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashId.value = null
    repaint()
  }, 1500)
}

// ---------- 侧栏问的上下文 ----------

function buildRequest(question: string, scope: ContextScope, history: ChatMessageInput[]) {
  const p = panel.value
  const m = map!
  return buildContext({
    docTitle: doc.value?.title ?? '',
    text: m.text,
    toTex: (a, b) => m.textWithTex(a, b),
    sectionStarts: sectionStarts(headings.value),
    focus: p?.mode === 'ask' ? p.focus : { start: 0, end: 0 },
    quote: p?.mode === 'ask' ? p.quote : null,
    question,
    scope,
    budget: prefs.contextBudget,
    history,
  })
}

// ---------- 导出 ----------

async function exportNotes() {
  if (!doc.value || !map) return
  const m = map
  const text = exportMarkdown({
    title: doc.value.title,
    source: `${doc.value.title}.md`,
    date: formatDate(Date.now()),
    sections: headings.value.filter((h) => h.level === 2).map((h) => ({ title: h.title, pos: h.pos })),
    anchors: located.value.map((l) => ({
      id: l.anchor.id,
      start: l.start,
      quote: m.textWithTex(l.start, l.end),
      highlighted: highlightAnchorIds.value.has(l.anchor.id),
    })),
    // 孤立锚点只有保存时的纯文本，公式占位符换成文字说明
    orphans: orphans.value.map((a) => ({ id: a.id, quote: a.quote.replace(/￼/g, '[公式]'), highlighted: highlightAnchorIds.value.has(a.id) })),
    notes: notes.value,
    conversations: conversations.value,
  })
  try {
    const r = await saveTextFile(`${safeFileName(doc.value.title)} · 笔记.md`, text, 'text/markdown')
    if (r === 'downloaded') showToast('已导出笔记')
  } catch (e) {
    showToast(`导出失败：${String(e)}`, 4000)
  }
}

async function onExportOriginal() {
  exportMenu.value = false
  if (!doc.value) return
  try {
    if ((await exportOriginal(doc.value)) === 'downloaded') showToast('已导出原文')
  } catch (e) {
    showToast(`导出失败：${String(e)}`, 4000)
  }
}

async function onExportNotes() {
  exportMenu.value = false
  await exportNotes()
}

// ---------- 键盘与可视区域 ----------

function onViewportChange() {
  const vv = window.visualViewport
  if (!vv) return
  // 键盘弹出时，可视区域底部到布局视口底部的距离
  toolbarBottom.value = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  if (panel.value?.mode === 'ask') keepAnchorVisible()
}

function keepAnchorVisible() {
  const p = panel.value
  if (p?.mode !== 'ask' || !p.anchorId || !map || !contentEl.value) return
  const l = located.value.find((x) => x.anchor.id === p.anchorId)
  if (!l) return
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

// ---------- 备份提醒 ----------

async function checkBackupReminder() {
  const now = Date.now()
  let since = await getSetting<number | null>('backup.since', null)
  if (since === null) {
    since = now
    await setSetting('backup.since', now)
  }
  const last = await getSetting<number | null>('backup.lastExportAt', null)
  const reminded = await getSetting<number | null>('backup.lastRemindedAt', null)
  if (shouldRemindBackup(now, last, since, reminded)) {
    await setSetting('backup.lastRemindedAt', now)
    showToast(last ? '距上次备份已超过 7 天，建议到「设置」导出一次备份' : '还没有备份过，建议到「设置」导出一次备份', 6000)
  }
}

// ---------- 生命周期 ----------

watch(
  () => appState.currentDocId,
  (id) => void enqueueRender(() => loadDoc(id)),
)

watch(
  () => props.active,
  (on) => {
    if (on) restorePosition()
    else {
      closeOverlays()
      void savePositionNow()
    }
  },
)

onMounted(async () => {
  cleanups.push(watchSelection(() => map))
  window.visualViewport?.addEventListener('resize', onViewportChange)
  window.visualViewport?.addEventListener('scroll', onViewportChange)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onVisibility)
  document.addEventListener('pointerdown', onDocPointerDown)
  cleanups.push(() => document.removeEventListener('pointerdown', onDocPointerDown))
  cleanups.push(() => {
    window.visualViewport?.removeEventListener('resize', onViewportChange)
    window.visualViewport?.removeEventListener('scroll', onViewportChange)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onVisibility)
  })

  if (appState.currentDocId) void enqueueRender(() => loadDoc(appState.currentDocId))

  // 代码高亮异步加载，好了再按当前位置重渲染一次；锚点按文字定位，不受影响
  const hl = await getCodeHighlighter()
  readerState.codeHighlight = hl ? 'loaded' : 'failed'
  if (hl) {
    await enqueueRender(async () => {
      highlighter = hl
      if (!doc.value) return
      // 上一次的位置可能还没来得及恢复（页面隐藏、或恢复排在下一帧），这时沿用它，不要拿当前的顶部位置覆盖
      restorePending = restorePending ?? currentPosition() ?? clampPosition(doc.value.readingPosition, Infinity)
      await renderDoc()
    })
  }

  void checkBackupReminder()
})

onBeforeUnmount(() => {
  void savePositionNow()
  cleanups.forEach((f) => f())
  clearTimeout(flashTimer)
})
</script>

<template>
  <div class="reader" :class="{ 'with-panel': panel }">
    <div class="doc-col">
      <div class="doc-bar">
        <button :disabled="!doc || !toc.length" @click="tocOpen = !tocOpen">目录</button>
        <span class="doc-title">{{ doc?.title ?? '' }}<span v-if="currentHeading" class="cur-sec"> · {{ currentHeading.title }}</span></span>
        <button v-if="doc" @click="openWholeAsk">整篇提问</button>
        <button v-if="doc" @click="panel = { mode: 'notes', focusPending: false }">笔记</button>
        <span v-if="doc" class="menu-wrap">
          <button @click="exportMenu = !exportMenu">导出</button>
          <span v-if="exportMenu" class="menu">
            <button @click="onExportNotes">导出笔记（md）<small>划线、批注、问答，按章节整理</small></button>
            <button @click="onExportOriginal">导出原文（md）<small>这篇文章本身，不含笔记</small></button>
          </span>
        </span>
        <button v-if="pendingCount" class="pending" @click="panel = { mode: 'notes', focusPending: true }">待补充 {{ pendingCount }}</button>
      </div>
      <div class="progress"><div class="bar" :style="{ width: progress * 100 + '%' }" /></div>

      <div v-if="!doc && appState.ready" class="empty">
        <p>还没有打开文档。</p>
        <button class="primary" @click="navigate('library')">去书架</button>
      </div>

      <div class="content-wrap">
        <article ref="contentEl" class="md content" @click="onContentClick" @scroll.passive="onScroll" />
        <nav v-if="tocOpen" class="toc">
          <button
            v-for="(h, i) in toc"
            :key="i"
            class="toc-item"
            :class="{ sub: h.level === 3, cur: currentHeading === h }"
            @click="jumpToHeading(h)"
          >
            {{ h.title }}
          </button>
        </nav>
      </div>
    </div>

    <aside v-if="panel && doc" class="side">
      <header class="panel-head">
        <div class="panel-tabs">
          <button :class="{ on: panel.mode === 'ask' }" @click="openAskTab">提问</button>
          <button :class="{ on: panel.mode === 'notes' }" @click="panel = { mode: 'notes', focusPending: false }">笔记</button>
        </div>
        <button class="close" @click="panel = null">关闭</button>
      </header>
      <AskPanel
        v-if="panel.mode === 'ask'"
        :key="panel.anchorId ?? 'whole'"
        :doc="doc"
        :anchor-id="panel.anchorId"
        :quote="panel.quote"
        :conversations="conversations"
        :notes="notes"
        :build-request="buildRequest"
        @changed="refreshAnnotations"
        @delete-conversation="onDeleteConversation"
        @focus-input="onFocusInput"
        @save-note="saveAnswerAsNote"
      />
      <NotesPanel
        v-else
        :groups="noteGroups"
        :focus-pending="panel.focusPending"
        @jump="jumpToAnchor"
        @open-ask="openAnchorPanel"
        @edit-note="editNote"
        @export-md="exportNotes"
        @changed="refreshAnnotations"
        @delete-conversation="onDeleteConversation"
        @focus-input="onFocusInput"
      />
    </aside>

    <div v-if="cache" class="toolbar" :style="{ bottom: toolbarBottom + 'px' }" @pointerdown.prevent>
      <span class="sel-info">{{ cache.plain.length }} 字{{ cache.expanded ? ' · 含整块公式' : '' }}</span>
      <button @pointerdown.prevent @click="onHighlight">划线</button>
      <button @pointerdown.prevent @click="onAnnotate">批注</button>
      <button @pointerdown.prevent @click="onAsk">侧栏问</button>
      <button @pointerdown.prevent @click="onSendToApp">发到 App</button>
      <button @pointerdown.prevent @click="onCopy">复制</button>
      <button class="cancel" @pointerdown.prevent @click="onCancel">✕</button>
    </div>

    <div v-else-if="tapped" class="toolbar" :style="{ bottom: toolbarBottom + 'px' }">
      <button v-if="tapped.highlightIds.length" @click="openEditorForTapped">{{ tappedNote ? '编辑批注' : '写批注' }}</button>
      <button v-if="tapped.convAnchorId" @click="openAnchorPanel(tapped.convAnchorId)">查看对话（{{ tapped.convCount }}）</button>
      <button v-if="tapped.highlightIds.length" @click="removeTappedHighlight">删除划线</button>
      <button class="cancel" @click="tapped = null">✕</button>
    </div>

    <NoteEditor
      v-if="editor"
      :quote="editor.quote"
      :initial="editor.note?.text ?? ''"
      :can-delete="editor.note !== null"
      :bottom="toolbarBottom"
      @save="saveEditor"
      @cancel="editor = null"
      @remove="removeEditorNote"
    />
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
  padding: 6px 16px;
}
.doc-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 500;
}
.cur-sec {
  color: var(--muted);
  font-weight: normal;
}
.doc-bar button,
.empty button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 15px;
  white-space: nowrap;
}
.doc-bar button:disabled {
  opacity: 0.4;
}
.menu-wrap {
  position: relative;
}
.menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  padding: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  z-index: 15;
}
.doc-bar .menu button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: none;
  text-align: left;
}
.menu small {
  color: var(--muted);
  font-size: 12px;
}
.doc-bar .pending {
  border-color: var(--warn);
  color: var(--warn);
}
.empty button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.progress {
  height: 3px;
  background: var(--border);
}
.progress .bar {
  height: 100%;
  background: var(--accent);
  transition: width 0.15s;
}
.empty {
  padding: 32px;
  color: var(--muted);
}
.content-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.content {
  flex: 1;
  overflow: auto;
  padding: 16px 32px 120px;
}
.toc {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(320px, 80%);
  overflow: auto;
  padding: 8px 0;
  background: var(--panel-bg);
  border-right: 1px solid var(--panel-border);
  box-shadow: 4px 0 16px rgba(0, 0, 0, 0.15);
  z-index: 5;
}
.toc-item {
  display: block;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: none;
  color: var(--fg);
  text-align: left;
  font-size: 15px;
}
.toc-item.sub {
  padding-left: 32px;
  font-size: 14px;
  color: var(--muted);
}
.toc-item.cur {
  color: var(--accent);
  font-weight: 600;
  background: var(--panel-head);
}
.side {
  display: flex;
  flex-direction: column;
  width: 40%;
  max-width: 520px;
  min-width: 320px;
  min-height: 0;
  background: var(--panel-bg);
  border-left: 1px solid var(--panel-border);
  box-shadow: -2px 0 8px rgba(31, 35, 40, 0.08);
}
.panel-head {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: var(--panel-head);
  border-bottom: 1px solid var(--panel-border);
}
.panel-tabs {
  display: flex;
  gap: 4px;
}
.panel-head button {
  padding: 4px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--panel-title);
  font-size: 15px;
}
.panel-tabs button.on {
  background: var(--bg);
  border-color: var(--panel-border);
  font-weight: 600;
}
.panel-head .close {
  border-color: var(--panel-border);
  background: var(--bg);
  color: var(--fg);
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
    border-left: none;
    border-top: 1px solid var(--panel-border);
    border-radius: 14px 14px 0 0;
    overflow: hidden;
    /* 抽屉浮在正文上方的感觉 */
    box-shadow: 0 -4px 16px rgba(31, 35, 40, 0.18);
    z-index: 1;
  }
  .panel-head {
    padding-top: 16px;
  }
  /* 顶部的把手条 */
  .panel-head::before {
    content: '';
    position: absolute;
    top: 6px;
    left: 50%;
    width: 40px;
    height: 4px;
    margin-left: -20px;
    border-radius: 2px;
    background: var(--panel-border);
  }
}
.toolbar {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: max(12px, env(safe-area-inset-bottom));
  display: flex;
  gap: 2px;
  align-items: center;
  max-width: calc(100vw - 16px);
  padding: 6px;
  background: var(--bar-bg);
  color: var(--bar-fg);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  z-index: 20;
  user-select: none;
  -webkit-user-select: none;
}
.toolbar button {
  padding: 10px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--bar-fg);
  font-size: 16px;
  white-space: nowrap;
}
.toolbar button:active {
  background: rgba(255, 255, 255, 0.15);
}
.toolbar .cancel {
  padding: 10px 12px;
  color: var(--bar-muted);
}
.sel-info {
  font-size: 12px;
  color: var(--bar-muted);
  padding: 0 6px;
  white-space: nowrap;
}
</style>
