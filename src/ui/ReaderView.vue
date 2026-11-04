<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { db, getSetting, setSetting, type ConversationRecord, type DocumentRecord, type NoteRecord } from '../db'
import { saveReadingPosition } from '../db/documents'
import { shouldRemindBackup } from '../db/backup'
import { appState, showToast } from '../app/store'
import { confirmDialog } from '../app/dialog'
import { navigate } from '../app/router'
import { prefs, setLastColor } from '../app/prefs'
import { resolvedTheme } from '../app/theme'
import { renderMarkdown, type CodeHighlighter } from '../reader/markdown'
import { getCodeHighlighter } from '../reader/highlighter'
import { readerState } from '../reader/state'
import { collectHeadings, headingAt, sectionStarts, type Heading } from '../reader/outline'
import { clampPosition, progressOf, scrollToPosition, topVisiblePosition } from '../reader/position'
import { buildNoteGroups } from '../reader/notes'
import { findMatches, firstMatchFrom, stepMatch, type SearchMatch } from '../reader/search'
import { renderMermaidBlocks } from '../reader/mermaid'
import type { TextMap } from '../textmap'
import { HIGHLIGHT_COLORS, colorName, type HighlightColor } from '../highlight/colors'
import { hitTest, paint, positionFromPoint, supportsCustomHighlight, type PaintItem } from '../highlight'
import {
  addHighlight,
  addNote,
  setHighlightColor,
  deleteNote,
  loadAnnotations,
  locateAnchors,
  removeHighlightsForUndo,
  restoreRemoved,
  deleteAnchorIfUnused,
  deleteConversation,
  saveAnchor,
  updateNote,
  type LocatedAnchor,
} from '../anchor/store'
import { anchorLeftBehind } from '../anchor/cleanup'
import type { AnchorRecord } from '../db'
import { clearSelectionCache, dismissSelection, recordToolbarClick, selectionState, watchSelection, type CachedSelection } from '../selection'
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
import TypographySettings from './TypographySettings.vue'
import Icon from './Icon.vue'
import { nextBar } from '../reader/chrome'

const props = defineProps<{ active: boolean }>()

const contentEl = ref<HTMLElement | null>(null)
const doc = shallowRef<DocumentRecord | null>(null)
const located = shallowRef<LocatedAnchor[]>([])
const orphans = shallowRef<AnchorRecord[]>([])
/** 有划线的锚点 → 颜色 */
const highlightAnchorIds = shallowRef<Map<string, string>>(new Map())
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
const typoMenu = ref(false)
const searchOpen = ref(false)
const searchQuery = ref('')
const searchMatches = shallowRef<SearchMatch[]>([])
const searchIndex = ref(-1)
const searchInput = ref<HTMLInputElement | null>(null)
const progress = ref(0)
const currentHeading = ref<Heading | null>(null)
const toolbarBottom = ref(0)
const barHidden = ref(false)

let map: TextMap | null = null
let highlighter: CodeHighlighter | null = null
let restorePending: number | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let flashTimer: ReturnType<typeof setTimeout> | undefined
const cleanups: (() => void)[] = []

const cache = computed(() => selectionState.cache)
const pendingCount = computed(() => conversations.value.filter((c) => c.status === 'pending').length)
const toc = computed(() => headings.value.filter((h) => h.level >= 2 && h.level <= 3))
/** 这些东西开着时顶栏必须在 */
const barPinned = computed(() => searchOpen.value || panel.value !== null || tocOpen.value || exportMenu.value || typoMenu.value)
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
    if (highlightAnchorIds.value.has(id) || noteAnchors.has(id)) {
      items.push({ anchorId: id, start: l.start, end: l.end, kind: 'highlight', color: highlightAnchorIds.value.get(id) })
    }
    if (convAnchors.has(id)) items.push({ anchorId: id, start: l.start, end: l.end, kind: 'ask' })
    if (flashId.value === id) items.push({ anchorId: id, start: l.start, end: l.end, kind: 'flash' })
  }
  searchMatches.value.forEach((m, i) => {
    items.push({ anchorId: '', start: m.start, end: m.end, kind: i === searchIndex.value ? 'searchCurrent' : 'search' })
  })
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
  highlightAnchorIds.value = new Map(ann.highlights.map((h) => [h.anchorId, h.color]))
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
  void renderDiagrams()
}

let diagramRun = 0

/** 画 Mermaid 图。图比源码高或矮，画完滚回原来的字符。换文档或重新渲染后，上一轮作废 */
async function renderDiagrams() {
  const root = contentEl.value
  if (!root || !props.active) return
  const run = ++diagramRun
  const changed = await renderMermaidBlocks(root, resolvedTheme.value, () => run !== diagramRun)
  if (changed && run === diagramRun) keepPositionAfterReflow()
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
    anchorPos = pos
    scrollToPosition(map, contentEl.value, pos)
    readerState.restoredPosition = pos
    onScroll()
  })
}

async function loadDoc(id: string | null) {
  await savePositionNow()
  clearSelectionCache()
  closeSearch()
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

/**
 * 滚动停下时记住顶部的字符。字号、行距、宽度一变文字就重新换行，
 * scrollTop 不变但内容已经跑了，这时滚回这个字符，段落不会跳走。
 */
let anchorPos: number | null = null
let anchorTimer: ReturnType<typeof setTimeout> | undefined
let lastWidth = 0
let lastScrollTop = 0

function keepPositionAfterReflow() {
  clearTimeout(anchorTimer)
  if (anchorPos === null || !map || !contentEl.value || !props.active) return
  scrollToPosition(map, contentEl.value, anchorPos)
}

function onResize() {
  const w = contentEl.value?.clientWidth ?? 0
  if (w === lastWidth) return
  // 高度变化（键盘弹出）不会让文字重新换行，不用处理；宽度为 0 是页面隐藏
  const reflowed = lastWidth > 0 && w > 0
  lastWidth = w
  if (reflowed) keepPositionAfterReflow()
}

function onScroll() {
  const el = contentEl.value
  if (!el) return
  clearTimeout(anchorTimer)
  anchorTimer = setTimeout(() => {
    anchorPos = currentPosition()
  }, 150)
  progress.value = progressOf(el.scrollTop, el.scrollHeight, el.clientHeight)
  const bar = nextBar({ hidden: barHidden.value, lastTop: lastScrollTop }, el.scrollTop)
  lastScrollTop = bar.lastTop
  // 选中文字时不动顶栏，免得它滑下来盖住正在选的内容
  if (!barPinned.value && !cache.value && !tapped.value) barHidden.value = bar.hidden
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
  // 留出顶栏的高度
  el.scrollTop += h.el.getBoundingClientRect().top - el.getBoundingClientRect().top - 72
  tocOpen.value = false
}

function onVisibility() {
  if (document.visibilityState === 'hidden') void savePositionNow()
}

// ---------- 文内搜索 ----------

async function toggleSearch() {
  if (searchOpen.value) {
    closeSearch()
    return
  }
  searchOpen.value = true
  await nextTick()
  searchInput.value?.focus()
}

function closeSearch() {
  searchOpen.value = false
  searchQuery.value = ''
  if (searchMatches.value.length) {
    searchMatches.value = []
    searchIndex.value = -1
    repaint()
  }
}

/** 让当前这一处出现在屏幕上，已经看得见时不动 */
function showCurrentMatch() {
  const m = searchMatches.value[searchIndex.value]
  const el = contentEl.value
  if (!m || !map || !el) return
  const rect = map.toRange(m.start, m.end).getBoundingClientRect()
  const box = el.getBoundingClientRect()
  // 顶部有顶栏和搜索条盖着
  if (rect.top < box.top + 130 || rect.bottom > box.bottom - 8) el.scrollTop += rect.top - box.top - el.clientHeight / 3
}

function runSearch() {
  if (!map) return
  searchMatches.value = findMatches(map.text, searchQuery.value)
  searchIndex.value = firstMatchFrom(searchMatches.value, currentPosition() ?? 0)
  repaint()
  showCurrentMatch()
}

function moveSearch(step: 1 | -1) {
  if (searchMatches.value.length === 0) return
  searchIndex.value = stepMatch(searchIndex.value, searchMatches.value.length, step)
  repaint()
  showCurrentMatch()
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

async function onHighlight(color: HighlightColor) {
  const c = takeCache('划线')
  if (!c || !doc.value || !map) return
  const anchor = await saveAnchor(doc.value, map.text, c.start, c.end)
  await addHighlight(anchor.id, color)
  await setLastColor(color)
  dismissSelection()
  await refreshAnnotations()
}

async function onAnnotate() {
  const c = takeCache('批注')
  if (!c || !doc.value || !map) return
  // 批注 = 划线 + 一段文字；先存锚点和划线，取消写批注也保留划线
  const anchor = await saveAnchor(doc.value, map.text, c.start, c.end)
  await addHighlight(anchor.id, prefs.lastColor)
  dismissSelection()
  await refreshAnnotations()
  editor.value = { anchorId: anchor.id, quote: c.text, note: null }
}

async function onAsk() {
  const c = takeCache('侧栏问')
  if (!c || !doc.value || !map) return
  // 打开提问面板之前先把选区存成锚点
  const anchor = await saveAnchor(doc.value, map.text, c.start, c.end)
  panel.value = { mode: 'ask', anchorId: anchor.id, quote: c.text, focus: { start: c.start, end: c.end } }
  dismissSelection()
  await refreshAnnotations()
}

async function onSendToApp() {
  const c = takeCache('发到 App')
  if (!c || !doc.value || !map) return
  const anchor = await saveAnchor(doc.value, map.text, c.start, c.end)
  dismissSelection()
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
  dismissSelection()
  showToast((await copyText(text)) ? '已复制原文，附带文档名和章节' : '复制失败')
}

function onCancel() {
  recordToolbarClick('取消', contentEl.value)
  dismissSelection()
}

// ---------- 点击正文：已有划线、边缘翻页 ----------

function closeOverlays() {
  tocOpen.value = false
  exportMenu.value = false
  typoMenu.value = false
}

/** 点到导出菜单以外的地方时收起菜单 */
function onDocPointerDown(e: PointerEvent) {
  const target = e.target as Element
  if (!target.closest?.('.menu-wrap')) {
    exportMenu.value = false
    typoMenu.value = false
  }
  // 按在正文和工具栏以外的地方，就是不再要这个选区了
  if (selectionState.cache && !target.closest?.('.toolbar') && !contentEl.value?.contains(target)) dismissSelection()
}

function onContentClick(e: MouseEvent) {
  if (!map || !contentEl.value) return
  // 目录或菜单开着时，点正文只是把它们收起来
  if (tocOpen.value || exportMenu.value || typoMenu.value) {
    closeOverlays()
    return
  }
  const sel = document.getSelection()
  if (sel && !sel.isCollapsed) return
  // 选区已经被这一下点没了，工具栏跟着收起；这一下不再当作点击划线
  if (selectionState.cache) {
    dismissSelection()
    return
  }
  if ((e.target as Element).closest('a')) return
  const pos = positionFromPoint(map, e.clientX, e.clientY)
  const hits = pos === null ? [] : hitTest(paintItems(), pos).filter((h) => h.kind === 'highlight' || h.kind === 'ask')
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
    if (y < 0.15) {
      contentEl.value.scrollBy({ top: -page })
      return
    }
    if (y > 0.85) {
      contentEl.value.scrollBy({ top: page })
      return
    }
  }
  // 点正文中间：收起或叫出顶栏
  if (!barPinned.value) barHidden.value = !barHidden.value
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
  // 不管从哪里打开面板，底部工具栏都让位
  if (now) {
    dismissSelection()
    tapped.value = null
  }
  const left = anchorLeftBehind(lastAsk.value?.anchorId ?? null, now)
  if (now?.mode === 'ask') lastAsk.value = now
  if (left) void cleanupAnchor(left)
})

async function onDeleteConversation(conv: ConversationRecord) {
  const what = conv.status === 'pending' ? '这条待补充记录' : '这段对话'
  if (!(await confirmDialog({ title: `删除${what}？`, message: '删除后无法恢复。', confirmText: '删除', danger: true }))) return
  await deleteConversation(conv.id)
  await refreshAnnotations()
  if (conv.anchorId) await cleanupAnchor(conv.anchorId)
}

async function recolorTapped(color: HighlightColor) {
  if (!tapped.value) return
  for (const id of tapped.value.highlightIds) await setHighlightColor(id, color)
  await setLastColor(color)
  tapped.value = null
  await refreshAnnotations()
}

async function removeTappedHighlight() {
  if (!tapped.value) return
  const ids = tapped.value.highlightIds
  // 有批注或「存为笔记」的地方，划线是跟着笔记画出来的：只删划线记录的话，重画后还在
  const noteCount = notes.value.filter((n) => ids.includes(n.anchorId)).length
  const removed = await removeHighlightsForUndo(ids)
  tapped.value = null
  await refreshAnnotations()
  showToast(noteCount ? `已删除划线和 ${noteCount} 条批注` : '已删除划线', 6000, {
    label: '撤销',
    run: async () => {
      await restoreRemoved(removed)
      await refreshAnnotations()
    },
  })
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
  if (!(await confirmDialog({ title: '删除这条批注？', confirmText: '删除', danger: true }))) return
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
  if (!highlightAnchorIds.value.has(panel.value.anchorId)) await addHighlight(panel.value.anchorId, prefs.lastColor)
  await refreshAnnotations()
  showToast('已存为笔记')
}

// ---------- 从笔记跳回原文 ----------

function jumpToAnchor(anchorId: string) {
  const l = located.value.find((x) => x.anchor.id === anchorId)
  if (!l || !map || !contentEl.value) {
    showToast('这条笔记的原文已经找不到了')
    return
  }
  // 从全局笔记页跳过来时，不再恢复上次读到的位置；图画完后也回到这里
  restorePending = null
  anchorPos = l.start
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
      color: highlightAnchorIds.value.get(l.anchor.id),
    })),
    // 孤立锚点只有保存时的纯文本，公式占位符换成文字说明
    orphans: orphans.value.map((a) => ({ id: a.id, quote: a.quote.replace(/￼/g, '[公式]'), highlighted: highlightAnchorIds.value.has(a.id), color: highlightAnchorIds.value.get(a.id) })),
    colorNames: prefs.colorNames,
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

watch(resolvedTheme, () => void renderDiagrams())

watch(barPinned, (on) => {
  if (on) barHidden.value = false
})

// 全局笔记页的跳转。排进渲染队列，保证目标文档已经打开；页面可见时才量得到位置
watch(
  () => [appState.jump, props.active] as const,
  ([jump, active]) => {
    if (!jump || !active) return
    void enqueueRender(async () => {
      await nextTick()
      appState.jump = null
      jumpToAnchor(jump.anchorId)
      if (jump.ask) openAnchorPanel(jump.anchorId)
    })
  },
)

// 文档内容被更新为新版本：重新加载，位置已由迁移写好
watch(
  () => appState.sourceVersion,
  () => void enqueueRender(() => loadDoc(appState.currentDocId)),
)

watch(
  () => [prefs.fontSize, prefs.lineHeight, prefs.pageWidth],
  () => requestAnimationFrame(keepPositionAfterReflow),
)

watch(
  () => props.active,
  (on) => {
    if (on) {
      restorePosition()
      void renderDiagrams()
      // 全局笔记页可能新增了问答
      void refreshAnnotations()
    } else {
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
  const resizer = new ResizeObserver(onResize)
  if (contentEl.value) resizer.observe(contentEl.value)
  cleanups.push(() => resizer.disconnect())
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
      <header class="doc-bar" :class="{ hidden: barHidden }">
        <button class="ghost act" aria-label="返回书架" @click="navigate('library')"><Icon name="back" /></button>
        <span class="doc-title">{{ doc?.title ?? '' }}<span v-if="currentHeading" class="cur-sec"> · {{ currentHeading.title }}</span></span>
        <template v-if="doc">
          <button v-if="pendingCount" class="chip tint" @click="panel = { mode: 'notes', focusPending: true }">待补充 {{ pendingCount }}</button>
          <button class="ghost act" :class="{ on: tocOpen }" :disabled="!toc.length" aria-label="目录" @click="tocOpen = !tocOpen"><Icon name="list" /><span class="lbl">目录</span></button>
          <button class="ghost act" :class="{ on: searchOpen }" aria-label="搜索" @click="toggleSearch"><Icon name="search" /><span class="lbl">搜索</span></button>
          <button class="ghost act" aria-label="整篇提问" @click="openWholeAsk"><Icon name="ask" /><span class="lbl">提问</span></button>
          <button class="ghost act" aria-label="本文笔记" @click="panel = { mode: 'notes', focusPending: false }"><Icon name="note" /><span class="lbl">笔记</span></button>
          <span class="menu-wrap">
            <button class="ghost act" :class="{ on: typoMenu }" aria-label="排版" @click="typoMenu = !typoMenu"><Icon name="type" /><span class="lbl">排版</span></button>
            <span v-if="typoMenu" class="menu typo-menu"><TypographySettings /></span>
          </span>
          <span class="menu-wrap">
            <button class="ghost act" :class="{ on: exportMenu }" aria-label="更多" @click="exportMenu = !exportMenu"><Icon name="more" /></button>
            <span v-if="exportMenu" class="menu">
              <button @click="onExportNotes">导出笔记（md）<small>划线、批注、问答，按章节整理</small></button>
              <button @click="onExportOriginal">导出原文（md）<small>这篇文章本身，不含笔记</small></button>
            </span>
          </span>
        </template>
      </header>
      <div class="progress"><div class="bar" :style="{ width: progress * 100 + '%' }" /></div>
      <div v-if="searchOpen" class="search-bar">
        <input
          ref="searchInput"
          v-model="searchQuery"
          type="search"
          placeholder="在本文中搜索"
          enterkeyhint="search"
          @input="runSearch"
          @keydown.enter.prevent="moveSearch($event.shiftKey ? -1 : 1)"
        />
        <span class="search-count">{{ searchMatches.length ? `第 ${searchIndex + 1} / ${searchMatches.length} 处` : searchQuery.trim() ? '没有找到' : '' }}</span>
        <button :disabled="!searchMatches.length" @click="moveSearch(-1)">上一个</button>
        <button :disabled="!searchMatches.length" @click="moveSearch(1)">下一个</button>
        <button class="ghost act" aria-label="关闭搜索" @click="closeSearch"><Icon name="close" /></button>
      </div>

      <div v-if="!doc && appState.ready" class="empty-state">
        <Icon class="big-icon" name="book" :size="56" />
        <h3>还没有打开文档</h3>
        <p>到书架选一篇，或者导入新的 Markdown 文档。</p>
        <div class="row"><button class="primary" @click="navigate('library')">去书架</button></div>
      </div>

      <div v-show="doc" class="content-wrap">
        <article ref="contentEl" class="md content" @click="onContentClick" @scroll.passive="onScroll" />
        <nav v-if="tocOpen" class="toc">
          <h4>目录</h4>
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
        <div class="segment">
          <button :class="{ on: panel.mode === 'ask' }" @click="openAskTab">提问</button>
          <button :class="{ on: panel.mode === 'notes' }" @click="panel = { mode: 'notes', focusPending: false }">笔记</button>
        </div>
        <button class="ghost act" aria-label="关闭侧栏" @click="panel = null"><Icon name="close" /></button>
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
      <span class="dots">
        <button
          v-for="c in HIGHLIGHT_COLORS"
          :key="c"
          class="dot-btn"
          :aria-label="`划线：${colorName(c, prefs.colorNames)}`"
          :title="colorName(c, prefs.colorNames)"
          @pointerdown.prevent
          @click="onHighlight(c)"
        >
          <span class="color-dot" :class="c" />
        </button>
      </span>
      <span class="sep" />
      <button @pointerdown.prevent @click="onAnnotate">批注</button>
      <button @pointerdown.prevent @click="onAsk">问 AI</button>
      <button @pointerdown.prevent @click="onSendToApp">发到 App</button>
      <button @pointerdown.prevent @click="onCopy">复制</button>
      <button class="cancel" aria-label="取消选择" @pointerdown.prevent @click="onCancel"><Icon name="close" :size="18" /></button>
    </div>

    <div v-else-if="tapped" class="toolbar" :style="{ bottom: toolbarBottom + 'px' }">
      <span v-if="tapped.highlightIds.length" class="dots">
        <button
          v-for="c in HIGHLIGHT_COLORS"
          :key="c"
          class="dot-btn"
          :aria-label="`改成：${colorName(c, prefs.colorNames)}`"
          :title="colorName(c, prefs.colorNames)"
          @click="recolorTapped(c)"
        >
          <span class="color-dot" :class="c" />
        </button>
      </span>
      <span v-if="tapped.highlightIds.length" class="sep" />
      <button v-if="tapped.highlightIds.length" @click="openEditorForTapped">{{ tappedNote ? '编辑批注' : '写批注' }}</button>
      <button v-if="tapped.convAnchorId" @click="openAnchorPanel(tapped.convAnchorId)">查看对话（{{ tapped.convCount }}）</button>
      <button v-if="tapped.highlightIds.length" @click="removeTappedHighlight">删除划线</button>
      <button class="cancel" aria-label="关闭" @click="tapped = null"><Icon name="close" :size="18" /></button>
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
  </div>
</template>

<style scoped>
.reader {
  --bar-h: 56px;
  display: flex;
  height: 100%;
  min-height: 0;
  padding-top: env(safe-area-inset-top);
}
.doc-col {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  container: doc / inline-size;
}
/* 顶栏浮在正文上：收起时正文不动，阅读位置不跳 */
.doc-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  gap: 2px;
  align-items: center;
  height: var(--bar-h);
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease);
}
.doc-bar.hidden {
  transform: translateY(-100%);
  opacity: 0;
  pointer-events: none;
}
.doc-title {
  flex: 1;
  min-width: 0;
  margin: 0 8px 0 2px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
}
.cur-sec {
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: normal;
}
.act {
  gap: 5px;
  min-width: var(--tap);
  padding: 0 10px;
  color: var(--muted);
}
.act.on {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
}
.lbl {
  font-size: 14px;
}
.typo-menu {
  width: 340px;
  padding: 4px 16px;
}
.chip.tint {
  margin-right: 6px;
}
.search-bar {
  position: absolute;
  top: calc(var(--bar-h) + 8px);
  left: 12px;
  right: 12px;
  z-index: 9;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  background: var(--card);
  box-shadow: var(--shadow-2);
  animation: pop var(--dur) var(--ease);
}
.search-bar input {
  flex: 1;
  min-width: 80px;
}
.search-count {
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}
.progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 11;
  height: 2px;
  pointer-events: none;
}
.progress .bar {
  height: 100%;
  background: var(--accent);
  transition: width 0.15s;
}
.content-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.content {
  flex: 1;
  /* 宽表格、长公式在自己内部滚动，正文只上下滚，页面不会左右晃 */
  overflow-x: hidden;
  overflow-y: auto;
  padding-block: calc(var(--bar-h) + 16px) 120px;
}
.toc {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 8;
  width: min(340px, 80%);
  overflow: auto;
  padding: calc(var(--bar-h) + 12px) 10px 16px;
  background: var(--panel-bg);
  border-right: 1px solid var(--panel-border);
  box-shadow: var(--shadow-2);
  animation: slide-toc var(--dur) var(--ease);
}
@keyframes slide-toc {
  from {
    opacity: 0;
    transform: translateX(-16px);
  }
}
.toc h4 {
  margin: 0 0 8px;
  padding: 0 12px;
  font-size: 18px;
  font-weight: 600;
}
.toc-item {
  display: block;
  width: 100%;
  height: auto;
  padding: 10px 12px;
  border: none;
  background: none;
  text-align: left;
  white-space: normal;
  line-height: 1.5;
}
.toc-item.sub {
  padding-left: 28px;
  font-size: 14px;
  color: var(--muted);
}
.toc-item.cur {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
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
  animation: slide-side var(--dur) var(--ease);
}
.panel-head {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: var(--bar-h);
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--panel-border);
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
    border-radius: var(--radius-l) var(--radius-l) 0 0;
    overflow: hidden;
    /* 抽屉浮在正文上方的感觉 */
    box-shadow: var(--shadow-3);
    z-index: 12;
    animation-name: slide-up;
  }
  .panel-head {
    padding-top: 12px;
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
  margin-bottom: max(16px, env(safe-area-inset-bottom));
  display: flex;
  gap: 0;
  align-items: center;
  /* 窄屏放不下时分两行 */
  flex-wrap: wrap;
  justify-content: center;
  width: max-content;
  max-width: calc(100vw - 16px);
  padding: 4px 8px;
  background: var(--bar-bg);
  color: var(--bar-fg);
  border-radius: 28px;
  box-shadow: var(--shadow-3);
  z-index: 20;
  user-select: none;
  -webkit-user-select: none;
  animation: rise var(--dur) var(--ease);
}
.toolbar button {
  padding: 0 14px;
  border: none;
  border-radius: 22px;
  background: transparent;
  color: var(--bar-fg);
  font-size: 15px;
}
.toolbar button:active:not(:disabled) {
  background: var(--bar-press);
}
.dots {
  display: inline-flex;
  align-items: center;
}
.toolbar .dot-btn {
  width: var(--tap);
  padding: 0;
}
.toolbar .dot-btn .color-dot {
  width: 20px;
  height: 20px;
}
.sep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--bar-muted);
  opacity: 0.4;
}
.toolbar .cancel {
  width: var(--tap);
  padding: 0;
  color: var(--bar-muted);
}
.sel-info {
  font-size: 12px;
  color: var(--bar-muted);
  padding: 0 8px 0 10px;
  white-space: nowrap;
}
/* 面板打开或竖屏时位置窄，按钮只留图标 */
@container doc (max-width: 720px) {
  .lbl,
  .cur-sec {
    display: none;
  }
  .act {
    padding: 0;
  }
  .search-bar button:not(.act) {
    padding: 0 10px;
  }
}
</style>
