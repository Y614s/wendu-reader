import type { ChatMessageInput } from './client'

// 上下文组装：按 token 预算截取。优先级：
//   问题和选中原文（必须保留）> 附近段落 > 本节其他内容 > 其他章节 > 历史对话
// 选了「全文」但放不下时返回 truncated，界面上明确提示只发送了部分内容。

export const SYSTEM_PROMPT =
  '你是一个阅读助手。用户在读一篇 Markdown 文档，会选中一段原文或针对整篇文档向你提问。请用中文、简洁地回答，可以使用 Markdown 和 $...$ 公式。'

export const MAX_PROMPTS = 8
export const MAX_PROMPT_LENGTH = 200

/** 自定义快捷提问，针对原文和整篇提问各一组；没有的一组用默认的 */
export interface CustomPrompts {
  anchor?: string[]
  whole?: string[]
}

/** 去掉空项和重复，限制条数和长度 */
export function normalizePrompts(list: string[]): string[] {
  const clean = list.map((p) => p.trim().slice(0, MAX_PROMPT_LENGTH)).filter(Boolean)
  return [...new Set(clean)].slice(0, MAX_PROMPTS)
}

/** 默认的快捷提问：平板上调键盘打字最打断阅读。整篇提问时「这段」「前文」说不通，换成适合整篇的 */
export function quickPrompts(whole: boolean, custom?: CustomPrompts): string[] {
  const own = custom?.[whole ? 'whole' : 'anchor']
  if (own) return own
  return whole
    ? ['总结全文重点', '梳理文章脉络', '说得更通俗', '举个例子', '出一道自测题']
    : ['解释这段', '举个例子', '说得更通俗', '和前文有什么关系', '出一道自测题']
}

export const DEFAULT_BUDGET = 8000
/** 附近段落：选区前后各取几段 */
const NEARBY_BLOCKS = 2

/** 近似估算：中日韩字符按 1 个 token，其他按 4 个字符 1 个 token */
export function estimateTokens(s: string): number {
  const cjk = s.match(/[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g)?.length ?? 0
  return cjk + Math.ceil((s.length - cjk) / 4)
}

export interface Block {
  start: number
  end: number
}

/** 按换行切成块（映射层里块级元素之间就是换行），去掉空块 */
export function splitBlocks(text: string): Block[] {
  const out: Block[] = []
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      if (text.slice(start, i).trim()) out.push({ start, end: i })
      start = i + 1
    }
  }
  return out
}

export type ContextScope = 'section' | 'full'

export interface ContextRequest {
  docTitle: string
  /** 映射层纯文本 */
  text: string
  /** 取一段文字并把公式换回 TeX */
  toTex: (start: number, end: number) => string
  /** 各节起点（升序，第一个是 0） */
  sectionStarts: number[]
  /** 选区；整篇提问时是阅读位置（start = end） */
  focus: { start: number; end: number }
  /** 选中的原文（公式已换回 TeX）；整篇提问时为 null */
  quote: string | null
  question: string
  scope: ContextScope
  budget: number
  /** 之前的问答，按时间顺序 */
  history: ChatMessageInput[]
}

export interface ContextResult {
  messages: ChatMessageInput[]
  /** 本次要发的文档内容（本节或全文）有没有被截掉 */
  truncated: boolean
  /** 没带上的历史消息条数 */
  omittedHistory: number
  estimatedTokens: number
}

function sectionRange(starts: number[], pos: number, textLength: number): [number, number] {
  let i = 0
  while (i + 1 < starts.length && starts[i + 1] <= pos) i++
  return [starts[i], i + 1 < starts.length ? starts[i + 1] : textLength]
}

function finalUserMessage(req: ContextRequest, context: string, truncated: boolean): string {
  const scopeName = req.scope === 'full' ? '全文' : '本节'
  const parts = [`文档：《${req.docTitle}》`]
  if (context) parts.push(`以下是文档${scopeName}的内容${truncated ? '（篇幅所限有删节，「……」处为省略）' : ''}：\n<<<\n${context}\n>>>`)
  if (req.quote !== null) parts.push(`我选中的原文：\n> ${req.quote.replace(/\n/g, '\n> ')}`)
  parts.push(`我的问题：${req.question}`)
  return parts.join('\n\n')
}

export function buildContext(req: ContextRequest): ContextResult {
  const blocks = splitBlocks(req.text)
  const [secA, secB] = sectionRange(req.sectionStarts, req.focus.start, req.text.length)
  const inScope = (b: Block) => req.scope === 'full' || (b.start >= secA && b.end <= secB)
  const scoped = blocks.filter(inScope)

  // 焦点所在块（选区覆盖的块；整篇提问时是阅读位置所在的块）
  const focusIdx = blocks.findIndex((b) => b.end >= req.focus.start)
  let focusLast = focusIdx
  blocks.forEach((b, i) => {
    if (b.start <= req.focus.end && i > focusLast) focusLast = i
  })
  const dist = (i: number) => (i < focusIdx ? focusIdx - i : i > focusLast ? i - focusLast : 0)
  const inSection = (b: Block) => b.start >= secA && b.end <= secB

  // 候选块按优先级排序：附近段落 → 本节其他 → 其他章节；同级内离焦点越近越优先
  const tier = (b: Block, i: number) => (inSection(b) && dist(i) <= NEARBY_BLOCKS ? 0 : inSection(b) ? 1 : 2)
  const candidates = blocks
    .map((b, i) => ({ b, i, tier: tier(b, i), d: dist(i) }))
    .filter((c) => inScope(c.b))
    .sort((x, y) => x.tier - y.tier || x.d - y.d || x.i - y.i)

  let used = estimateTokens(SYSTEM_PROMPT) + estimateTokens(finalUserMessage(req, '', false)) + 40
  const included = new Set<number>()
  for (const c of candidates) {
    const cost = estimateTokens(req.toTex(c.b.start, c.b.end)) + 1
    if (used + cost > req.budget) continue
    used += cost
    included.add(c.i)
  }
  const truncated = scoped.length > 0 && included.size < scoped.length

  // 按原文顺序拼接，不相邻处加省略号
  const lines: string[] = []
  let prev = -2
  for (const i of [...included].sort((a, b) => a - b)) {
    if (prev >= 0 && i !== prev + 1) lines.push('……')
    lines.push(req.toTex(blocks[i].start, blocks[i].end))
    prev = i
  }
  const user = finalUserMessage(req, lines.join('\n'), truncated)
  used = estimateTokens(SYSTEM_PROMPT) + estimateTokens(user)

  // 历史对话优先级最低：从最近的往前取，放不下就停
  const history: ChatMessageInput[] = []
  for (let i = req.history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(req.history[i].content)
    if (used + cost > req.budget) break
    used += cost
    history.unshift(req.history[i])
  }
  // 不能以助手回答开头
  while (history.length && history[0].role !== 'user') history.shift()

  return {
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: user }],
    truncated,
    omittedHistory: req.history.length - history.length,
    estimatedTokens: used,
  }
}
