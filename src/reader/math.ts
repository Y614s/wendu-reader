import type { MarkdownIt, StateBlock, StateInline } from 'markdown-it'
import katex from 'katex'

// 公式插件：`$...$` 行内、`$$...$$` 块级。
// 渲染结果外包一层带 data-tex 的元素，文本映射层把 U+FFFC 换回原始 TeX 时从这里取源码。

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderTex(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'html' })
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const start = state.pos
  if (src[start] !== '$' || src[start + 1] === '$') return false
  // 开头的 $ 后不能是空白，避免把「$5 和 $10」当成公式
  if (/\s/.test(src[start + 1] ?? ' ')) return false

  let end = start + 1
  while (end < state.posMax) {
    if (src[end] === '\\') {
      end += 2
      continue
    }
    if (src[end] === '$') break
    // 行内公式不跨行、不跨行内代码：否则「价格 $5 和 `a$b`」这类文字会被当成一整段公式
    if (src[end] === '\n' || src[end] === '`') return false
    end++
  }
  if (end >= state.posMax || src[end] !== '$') return false
  if (/\s/.test(src[end - 1])) return false
  if (/\d/.test(src[end + 1] ?? '')) return false

  if (!silent) {
    const token = state.push('math_inline', 'span', 0)
    token.content = src.slice(start + 1, end)
    token.markup = '$'
  }
  state.pos = end + 1
  return true
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine]
  let max = state.eMarks[startLine]
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  if (state.src.slice(pos, pos + 2) !== '$$') return false

  pos += 2
  let firstLine = state.src.slice(pos, max)
  let lastLine = ''
  let next = startLine
  let found = false

  if (firstLine.trim().endsWith('$$')) {
    // 单行写法 $$ ... $$
    firstLine = firstLine.trim().slice(0, -2)
    found = true
  }

  if (silent) return true

  while (!found) {
    next++
    if (next >= endLine) break
    pos = state.bMarks[next] + state.tShift[next]
    max = state.eMarks[next]
    if (pos < max && state.tShift[next] < state.blkIndent) break
    const line = state.src.slice(pos, max)
    if (line.trim().endsWith('$$')) {
      lastLine = line.trim().slice(0, -2)
      found = true
    }
  }
  if (!found) return false

  state.line = next + 1
  const token = state.push('math_block', 'div', 0)
  token.block = true
  token.content =
    (firstLine.trim() ? firstLine + '\n' : '') +
    state.getLines(startLine + 1, next, state.tShift[startLine], true) +
    (lastLine.trim() ? lastLine : '')
  token.map = [startLine, state.line]
  token.markup = '$$'
  return true
}

export function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'math_inline', mathInline)
  md.block.ruler.after('blockquote', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })
  md.renderer.rules.math_inline = (tokens, idx) => {
    const tex = tokens[idx].content
    return `<span class="math" data-tex="${escapeAttr(tex)}">${renderTex(tex, false)}</span>`
  }
  md.renderer.rules.math_block = (tokens, idx) => {
    const tex = tokens[idx].content.trim()
    return `<div class="math math-block" data-tex="${escapeAttr(tex)}" data-display="1">${renderTex(tex, true)}</div>\n`
  }
}
