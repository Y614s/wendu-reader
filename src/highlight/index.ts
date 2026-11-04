import { TextMap } from '../textmap'
import { HIGHLIGHT_COLORS, normalizeColor, type HighlightColor } from './colors'

// 划线显示：优先用 CSS Custom Highlight API，不改动 DOM；不支持时回退为 <mark> 包裹。
// 点击命中：caretRangeFromPoint → 映射层位置 → 与锚点区间比较，不遍历 Range 调 getClientRects()。

export type PaintKind = 'highlight' | 'ask' | 'flash' | 'search' | 'searchCurrent'

export interface PaintItem {
  anchorId: string
  start: number
  end: number
  kind: PaintKind
  /** kind 为 highlight 时的颜色，默认黄色 */
  color?: string
}

const NAMES: Record<PaintKind, string> = {
  highlight: 'wendu-hl',
  ask: 'wendu-ask',
  flash: 'wendu-flash',
  search: 'wendu-search',
  searchCurrent: 'wendu-search-cur',
}

// 重叠时后面的盖住前面的：搜索结果要看得见，当前这一处最醒目
const PRIORITY: Partial<Record<PaintKind, number>> = { flash: 1, search: 2, searchCurrent: 3 }
const MARK_ATTR = 'data-wendu-mark'

const colorClass = (c: HighlightColor) => `wendu-hl-${c}`
const ALL_CLASSES = [...Object.values(NAMES), ...HIGHLIGHT_COLORS.map(colorClass)]

function classesOf(item: PaintItem): string[] {
  return item.kind === 'highlight' ? [NAMES.highlight, colorClass(normalizeColor(item.color))] : [NAMES[item.kind]]
}

export function supportsCustomHighlight(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

export type PaintMode = 'custom-highlight' | 'mark'

/**
 * 画出所有划线。mark 模式会改动 DOM，所以返回重建后的映射层，调用方必须改用返回值。
 */
export function paint(root: Element, items: PaintItem[], mode: PaintMode = supportsCustomHighlight() ? 'custom-highlight' : 'mark'): TextMap {
  if (mode === 'custom-highlight') {
    const map = TextMap.build(root)
    const register = (name: string, picked: PaintItem[], priority: number) => {
      const hl = new Highlight(...picked.filter((i) => i.end > i.start).map((i) => map.toRange(i.start, i.end)))
      hl.priority = priority
      CSS.highlights.set(name, hl)
    }
    for (const color of HIGHLIGHT_COLORS) {
      register(colorClass(color), items.filter((i) => i.kind === 'highlight' && normalizeColor(i.color) === color), 0)
    }
    for (const kind of Object.keys(NAMES) as PaintKind[]) {
      if (kind !== 'highlight') register(NAMES[kind], items.filter((i) => i.kind === kind), PRIORITY[kind] ?? 0)
    }
    return map
  }

  clearMarks(root)
  for (const item of items) {
    if (item.end > item.start) wrapWithMarks(TextMap.build(root), item)
  }
  return TextMap.build(root)
}

function clearMarks(root: Element): void {
  for (const el of Array.from(root.querySelectorAll(`[${MARK_ATTR}]`))) {
    if (el.tagName === 'MARK') {
      el.replaceWith(...Array.from(el.childNodes))
    } else {
      el.removeAttribute(MARK_ATTR)
      el.classList.remove(...ALL_CLASSES)
    }
  }
  root.normalize()
}

function wrapWithMarks(map: TextMap, item: PaintItem): void {
  const classes = classesOf(item)
  // 倒序处理：拆分后面的文本节点不会影响前面片段记录的节点
  const segs = map.segments.filter((s) => s.kind !== 'break' && s.end > item.start && s.start < item.end).reverse()
  for (const s of segs) {
    if (s.kind === 'math') {
      s.node.setAttribute(MARK_ATTR, '')
      s.node.classList.add(...classes)
      continue
    }
    if (s.kind !== 'text') continue
    const a = Math.max(item.start, s.start) - s.start
    const b = Math.min(item.end, s.end) - s.start
    let node = s.node
    if (b < node.data.length) node.splitText(b)
    if (a > 0) node = node.splitText(a)
    const mark = node.ownerDocument.createElement('mark')
    mark.className = classes.join(' ')
    mark.setAttribute(MARK_ATTR, '')
    node.replaceWith(mark)
    mark.appendChild(node)
  }
}

/** 点击位置对应的映射层字符位置；不支持 caretRangeFromPoint 时返回 null */
export function positionFromPoint(map: TextMap, x: number, y: number): number | null {
  const doc = map.root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let node: Node | null = null
  let offset = 0
  if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(x, y)
    if (r) {
      node = r.startContainer
      offset = r.startOffset
    }
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(x, y)
    if (p) {
      node = p.offsetNode
      offset = p.offset
    }
  }
  if (!node || !map.root.contains(node)) return null
  return map.fromDom(node, offset, 'start').pos
}

export function hitTest(items: PaintItem[], pos: number): PaintItem[] {
  return items.filter((i) => i.start <= pos && pos <= i.end && i.end > i.start)
}
