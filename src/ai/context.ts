import type { ChatMessageInput } from './client'

// 上下文组装。技术验证阶段只带「选中原文 + 附近段落」，按字符预算截取；
// 完整的 token 预算和本节/全文切换在第一版做。

export const SYSTEM_PROMPT =
  '你是一个阅读助手。用户在读一篇 Markdown 文档，会选中一段原文向你提问。请用中文、简洁地回答，可以使用 Markdown 和 $...$ 公式。'

const NEARBY_BUDGET = 1500

/** 选区前后的段落，优先保证选中原文完整，附近内容按预算截取 */
export function nearbyText(fullText: string, start: number, end: number, budget = NEARBY_BUDGET): string {
  const half = Math.floor(budget / 2)
  let a = Math.max(0, start - half)
  let b = Math.min(fullText.length, end + half)
  // 尽量从段落边界开始和结束
  const pa = fullText.lastIndexOf('\n', start)
  if (pa >= a) a = pa + 1
  const pb = fullText.indexOf('\n', end)
  if (pb !== -1 && pb <= b) b = pb
  return fullText.slice(a, b)
}

export function buildMessages(opts: {
  docTitle: string
  quote: string
  nearby: string
  history: ChatMessageInput[]
  question: string
}): ChatMessageInput[] {
  const first = opts.history.length === 0
  const userContent = first
    ? `文档：《${opts.docTitle}》\n\n附近内容：\n${opts.nearby}\n\n我选中的原文：\n> ${opts.quote.replace(/\n/g, '\n> ')}\n\n我的问题：${opts.question}`
    : opts.question
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...opts.history, { role: 'user', content: userContent }]
}
