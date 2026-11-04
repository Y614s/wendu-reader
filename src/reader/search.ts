// 文内搜索：在映射层纯文本里找关键词，结果是映射层位置，只用于显示，不写进数据库。

export interface SearchMatch {
  start: number
  end: number
}

/** 所有匹配处，忽略大小写；空关键词没有结果 */
export function findMatches(text: string, query: string): SearchMatch[] {
  const q = query.trim()
  if (!q) return []
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  return Array.from(text.matchAll(re), (m) => ({ start: m.index, end: m.index + m[0].length }))
}

/** 从某个位置开始的第一处，打开搜索时从当前读到的地方找起；后面没有就回到第一处 */
export function firstMatchFrom(matches: SearchMatch[], pos: number): number {
  if (matches.length === 0) return -1
  const i = matches.findIndex((m) => m.start >= pos)
  return i === -1 ? 0 : i
}

/** 上一个 / 下一个，首尾循环 */
export function stepMatch(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1
  return (current + step + count) % count
}
