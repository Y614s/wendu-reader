// 锚点：存原文 quote + 前后各 32 字 + 映射层位置。
// 重新定位：先校验原位置；不等则全文搜索 quote，按前后文相似度和与原位置的距离选最佳；都失败标记为孤立，不删数据。

export const CONTEXT_CHARS = 32

export interface AnchorSelector {
  quote: string
  prefix: string
  suffix: string
  start: number
  end: number
}

export type LocateResult =
  | { status: 'exact' | 'moved'; start: number; end: number }
  | { status: 'orphan' }

export function createSelector(text: string, start: number, end: number): AnchorSelector {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(end, end + CONTEXT_CHARS),
    start,
    end,
  }
}

/** a 的末尾与 b 的末尾有多少字符相同 */
function commonSuffixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

export function locate(text: string, sel: AnchorSelector): LocateResult {
  const { quote } = sel
  if (!quote) return { status: 'orphan' }
  if (text.slice(sel.start, sel.end) === quote) return { status: 'exact', start: sel.start, end: sel.end }

  let best: { start: number; score: number } | null = null
  const maxContext = Math.max(1, sel.prefix.length + sel.suffix.length)
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
    const before = text.slice(Math.max(0, i - CONTEXT_CHARS), i)
    const after = text.slice(i + quote.length, i + quote.length + CONTEXT_CHARS)
    const contextScore = (commonSuffixLength(sel.prefix, before) + commonPrefixLength(sel.suffix, after)) / maxContext
    // 距离只作为前后文打平时的次要依据
    const distanceScore = 1 / (1 + Math.abs(i - sel.start) / 1000)
    const score = contextScore * 10 + distanceScore
    if (!best || score > best.score) best = { start: i, score }
  }
  if (!best) return { status: 'orphan' }
  return { status: 'moved', start: best.start, end: best.start + quote.length }
}
