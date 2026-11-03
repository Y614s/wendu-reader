// 文本映射层：渲染后的正文 DOM ↔ 规范化纯文本。
// 定位、复制、AI 上下文、导出都走这一层，规则见 CLAUDE.md「文本映射层」。

/** 公式在纯文本里的占位字符 */
export const MATH_CHAR = '￼'

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI',
  'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD',
  'TR', 'UL',
])

// 这些容器里不会直接出现正文文字，它们之间的纯空白文本节点只是 HTML 排版产生的换行
const CONTAINER_TAGS = new Set([
  'ARTICLE', 'BLOCKQUOTE', 'DIV', 'DL', 'OL', 'SECTION', 'TABLE', 'TBODY', 'TFOOT', 'THEAD', 'TR', 'UL',
])

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'])

export type Segment =
  | { kind: 'text'; start: number; end: number; node: Text }
  | { kind: 'math'; start: number; end: number; node: Element; tex: string; display: boolean }
  | { kind: 'break'; start: number; end: number }

export interface DomPoint {
  node: Node
  offset: number
}

export interface TextRange {
  start: number
  end: number
  /** 选区边界落在公式内部、被扩展到整个公式 */
  expanded: boolean
}

function isMath(el: Element): boolean {
  return el.classList.contains('katex')
}

function texOf(el: Element): { tex: string; display: boolean } {
  const host = el.closest('[data-tex]')
  return {
    tex: host?.getAttribute('data-tex') ?? '',
    display: host?.getAttribute('data-display') === '1' || el.parentElement?.classList.contains('katex-display') === true,
  }
}

/** 包含该节点的 .katex 元素（节点在公式内部时） */
function mathAncestor(node: Node, root: Node): Element | null {
  let cur: Node | null = node
  while (cur && cur !== root) {
    if (cur.nodeType === Node.ELEMENT_NODE && isMath(cur as Element)) return cur as Element
    cur = cur.parentNode
  }
  return null
}

export class TextMap {
  readonly text: string
  readonly segments: readonly Segment[]
  readonly root: Element

  private constructor(root: Element, text: string, segments: Segment[]) {
    this.root = root
    this.text = text
    this.segments = segments
  }

  static build(root: Element): TextMap {
    const segments: Segment[] = []
    let text = ''
    let pendingBreak = false

    const append = (seg: Segment, chars: string) => {
      if (pendingBreak && text.length > 0 && !text.endsWith('\n')) {
        segments.push({ kind: 'break', start: text.length, end: text.length + 1 })
        text += '\n'
      }
      pendingBreak = false
      seg.start = text.length
      seg.end = text.length + chars.length
      segments.push(seg)
      text += chars
    }

    const walk = (node: Node) => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child as Text
          const data = t.data
          if (!data) continue
          if (/^\s*$/.test(data) && CONTAINER_TAGS.has((node as Element).tagName ?? '')) continue
          if (/^\s*$/.test(data) && node === root) continue
          append({ kind: 'text', start: 0, end: 0, node: t }, data)
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child as Element
          if (SKIP_TAGS.has(el.tagName)) continue
          if (isMath(el)) {
            const { tex, display } = texOf(el)
            append({ kind: 'math', start: 0, end: 0, node: el, tex, display }, MATH_CHAR)
            continue
          }
          const block = BLOCK_TAGS.has(el.tagName)
          if (block) pendingBreak = true
          walk(el)
          if (block) pendingBreak = true
        }
      }
    }
    walk(root)
    return new TextMap(root, text, segments)
  }

  /** 二分查找：第一个 end > pos 的片段下标 */
  private indexAfter(pos: number): number {
    let lo = 0
    let hi = this.segments.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.segments[mid].end > pos) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  /**
   * 纯文本下标 → DOM 位置。
   * side='start' 时落在下一个片段的开头，side='end' 时落在上一个片段的末尾，
   * 这样换行和公式两侧的边界都不会多选或少选。
   */
  toDom(pos: number, side: 'start' | 'end'): DomPoint {
    const segs = this.segments
    if (segs.length === 0) return { node: this.root, offset: 0 }
    pos = Math.max(0, Math.min(pos, this.text.length))

    if (side === 'start') {
      for (let i = this.indexAfter(pos); i < segs.length; i++) {
        const s = segs[i]
        if (s.kind === 'text') return { node: s.node, offset: Math.max(0, pos - s.start) }
        if (s.kind === 'math') return before(s.node)
      }
      return this.toDom(pos, 'end')
    }

    for (let i = Math.min(this.indexAfter(pos - 1), segs.length - 1); i >= 0; i--) {
      const s = segs[i]
      if (s.kind === 'text' && s.start < pos) return { node: s.node, offset: Math.min(pos, s.end) - s.start }
      if (s.kind === 'math' && s.end <= pos) return after(s.node)
    }
    return this.toDom(pos, 'start')
  }

  /** DOM 位置 → 纯文本下标。落在公式内部时按 side 扩展到公式的一侧。 */
  fromDom(node: Node, offset: number, side: 'start' | 'end'): { pos: number; inMath: boolean } {
    const math = mathAncestor(node, this.root)
    if (math) {
      const seg = this.segments.find((s) => s.kind === 'math' && s.node === math)
      if (seg) return { pos: side === 'start' ? seg.start : seg.end, inMath: true }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const seg = this.segments.find((s) => s.kind === 'text' && s.node === node)
      if (seg) return { pos: seg.start + Math.min(offset, seg.end - seg.start), inMath: false }
      // 未计入映射的空白文本节点：按它所在位置处理
      return { pos: this.positionBefore(node), inMath: false }
    }

    const child = node.childNodes[offset]
    if (child) return { pos: this.positionBefore(child), inMath: false }
    return { pos: this.positionAfterSubtree(node), inMath: false }
  }

  /** 位于 ref 节点（含其子树）之前的字符数 */
  private positionBefore(ref: Node): number {
    for (const s of this.segments) {
      if (s.kind === 'break') continue
      if (s.node === ref || ref.contains(s.node) || ref.compareDocumentPosition(s.node) & Node.DOCUMENT_POSITION_FOLLOWING) {
        return s.start
      }
    }
    return this.text.length
  }

  /** 位于 container 子树之后的第一个字符位置（即子树内最后一个片段的末尾） */
  private positionAfterSubtree(container: Node): number {
    let pos: number | null = null
    for (const s of this.segments) {
      if (s.kind === 'break') continue
      if (container === s.node || container.contains(s.node)) pos = s.end
      else if (pos !== null) break
      else if (container.compareDocumentPosition(s.node) & Node.DOCUMENT_POSITION_FOLLOWING) return s.start
    }
    return pos ?? this.text.length
  }

  /** DOM Range → 纯文本区间。边界在公式内部时扩展到整个公式。 */
  fromRange(range: Range): TextRange | null {
    if (!this.root.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== this.root) return null
    const a = this.fromDom(range.startContainer, range.startOffset, 'start')
    const b = this.fromDom(range.endContainer, range.endOffset, 'end')
    const start = Math.min(a.pos, b.pos)
    const end = Math.max(a.pos, b.pos)
    return { start, end, expanded: a.inMath || b.inMath }
  }

  toRange(start: number, end: number): Range {
    const doc = this.root.ownerDocument
    const range = doc.createRange()
    const a = this.toDom(start, 'start')
    const b = this.toDom(end, 'end')
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset)
    return range
  }

  mathAt(pos: number): Extract<Segment, { kind: 'math' }> | null {
    const s = this.segments[this.indexAfter(pos)]
    return s && s.kind === 'math' && s.start === pos ? s : null
  }

  /** 取一段文字，公式换回原始 TeX（行内 $…$，块级 $$…$$）。 */
  textWithTex(start: number, end: number): string {
    let out = ''
    for (let i = start; i < end; i++) {
      const ch = this.text[i]
      if (ch !== MATH_CHAR) {
        out += ch
        continue
      }
      const m = this.mathAt(i)
      if (!m) out += ch
      else out += m.display ? `$$${m.tex}$$` : `$${m.tex}$`
    }
    return out
  }
}

function before(node: Node): DomPoint {
  const parent = node.parentNode!
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) }
}

function after(node: Node): DomPoint {
  const p = before(node)
  return { node: p.node, offset: p.offset + 1 }
}
