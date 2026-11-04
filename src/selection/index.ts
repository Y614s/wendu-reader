import { reactive } from 'vue'
import type { TextMap } from '../textmap'

// 选区缓存。安卓上点底部按钮会先清掉选中状态，所以：
// 只在正文出现非空选区时更新缓存；选区变空不覆盖；用完、取消或切换文档时才清除。
// 清除后系统可能晚一点才真正收起选区，这期间同一选区再次上报要忽略，否则工具栏又冒出来。

export interface CachedSelection {
  start: number
  end: number
  /** 映射层纯文本（公式为 U+FFFC） */
  plain: string
  /** 公式换回 TeX 后的文字，复制、发给 AI 用这个 */
  text: string
  /** 边界落在公式内部，已扩展到整个公式 */
  expanded: boolean
  at: number
}

export interface ToolbarClickRecord {
  button: string
  cachePresent: boolean
  liveSelection: boolean
  at: number
}

export const selectionState = reactive({
  cache: null as CachedSelection | null,
  /** 诊断页用：最近一次缓存和最近一次点工具栏时的状态 */
  lastCache: null as CachedSelection | null,
  lastClick: null as ToolbarClickRecord | null,
})

const DISMISS_MS = 800
let dismissed: { start: number; end: number; at: number } | null = null

export function clearSelectionCache(): void {
  selectionState.cache = null
}

/** 用完或放弃当前选区：清缓存、收起系统选区，工具栏随之消失 */
export function dismissSelection(): void {
  const c = selectionState.cache
  if (c) dismissed = { start: c.start, end: c.end, at: Date.now() }
  selectionState.cache = null
  document.getSelection()?.removeAllRanges()
}

function liveSelectionIn(root: Element): Range | null {
  const sel = document.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  return root.contains(range.commonAncestorContainer) ? range : null
}

/** 开始监听选区；返回取消监听的函数。 */
export function watchSelection(getMap: () => TextMap | null): () => void {
  const onChange = () => {
    const map = getMap()
    if (!map) return
    const range = liveSelectionIn(map.root)
    if (!range) {
      dismissed = null
      return
    }
    const r = map.fromRange(range)
    if (!r || r.end <= r.start) return
    if (dismissed && r.start === dismissed.start && r.end === dismissed.end && Date.now() - dismissed.at < DISMISS_MS) return
    dismissed = null
    const plain = map.text.slice(r.start, r.end)
    if (!plain.trim()) return
    const cache: CachedSelection = {
      start: r.start,
      end: r.end,
      plain,
      text: map.textWithTex(r.start, r.end),
      expanded: r.expanded,
      at: Date.now(),
    }
    selectionState.cache = cache
    selectionState.lastCache = cache
  }
  document.addEventListener('selectionchange', onChange)
  return () => document.removeEventListener('selectionchange', onChange)
}

/** 工具栏按钮被点时记下缓存和实时选区是否还在，诊断页显示 */
export function recordToolbarClick(button: string, root: Element | null): void {
  selectionState.lastClick = {
    button,
    cachePresent: selectionState.cache !== null,
    liveSelection: root ? liveSelectionIn(root) !== null : false,
    at: Date.now(),
  }
}
