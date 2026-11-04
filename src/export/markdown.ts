import type { ConversationRecord, NoteRecord } from '../db'
import { answeredPairs } from '../ai/history'
import { colorName, type ColorNames } from '../highlight/colors'

// 单篇导出 md，格式按 docs/plan.md「导出与备份」里的样例：
// YAML 信息 → 按章节组织 → 原文用引用块，下面接批注、AI 回答摘录、问答、待补充 → 原文已找不到的 → 整篇提问。

export interface ExportAnchor {
  id: string
  start: number
  /** 原文（公式已换回 TeX） */
  quote: string
  highlighted: boolean
  color?: string
}

export interface ExportInput {
  title: string
  source: string
  /** 导出日期 YYYY-MM-DD */
  date: string
  /** 章节标题（一、二级），按位置升序 */
  sections: { title: string; pos: number }[]
  anchors: ExportAnchor[]
  /** 原文找不到的锚点；quote 是保存时的原文 */
  orphans: { id: string; quote: string; highlighted: boolean; color?: string }[]
  /** 颜色的自定义名称 */
  colorNames?: ColorNames
  notes: NoteRecord[]
  conversations: ConversationRecord[]
}

export function formatDate(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** YAML 里的值：含冒号、井号、引号等特殊字符时加双引号，否则 Obsidian 解析会出错 */
export function yamlScalar(s: string): string {
  return /[:#[\]{}&*!|>'"%@`,]|^[-?\s]|\s$/.test(s) ? JSON.stringify(s) : s
}

function blockquote(text: string): string {
  return text
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')
}

/** 列表项里的多行内容：后续行缩进两格，保持在同一项里 */
function listItem(label: string, text: string): string {
  const [first, ...rest] = text.trim().split('\n')
  return [`- ${label}：${first}`, ...rest.map((l) => (l ? `  ${l}` : ''))].join('\n')
}

// 以这些写法开头的内容是块级语法（代码块、列表、引用、标题、公式块、表格），不能接在「**批注**：」同一行后面
const BLOCK_START = /^(```|~~~|\$\$|[-*+] |\d+[.)] |> |#{1,6} |\|)/

function noteBlock(label: string, text: string): string {
  const t = text.trim()
  return t.includes('\n') || BLOCK_START.test(t) ? `**${label}**：\n\n${t}` : `**${label}**：${t}`
}

function questionOf(m: ConversationRecord['messages'][number]): string {
  return (m.display ?? m.content).trim()
}

/** 只导出成功回答过的问答：失败、没有回答的提问跳过，不留下只有「问」的残缺记录 */
function qaLines(c: ConversationRecord): string[] {
  return answeredPairs(c.messages).flatMap((p) => [listItem('问', questionOf(p.question)), listItem('答', p.answer.content)])
}

function conversationBlock(c: ConversationRecord): string | null {
  if (c.status === 'pending') return '**待补充**（发到 App）：问题已发出，回答还没填。'

  if (c.kind === 'external') {
    // 发到 App 的提问是在别的 App 里打的，这里只有粘贴回来的回答
    const answers = c.messages.filter((m) => m.role === 'assistant' && m.content.trim()).map((m) => listItem('答', m.content))
    if (!answers.length) return null
    return [`**问答**（发到 App · ${c.provider || '其他 App'} · ${formatDate(c.createdAt)}）`, '', ...answers].join('\n')
  }

  const lines = qaLines(c)
  if (!lines.length) return null
  return [`**问答**（侧栏问 · ${c.provider}${c.model ? ' · ' + c.model : ''} · ${formatDate(c.createdAt)}）`, '', ...lines].join('\n')
}

function anchorBlock(quote: string, category: string | null, notes: NoteRecord[], convs: ConversationRecord[]): string {
  const parts = [blockquote(quote)]
  if (category) parts.push(`**分类**：${category}`)
  for (const n of notes) parts.push(noteBlock(n.source === 'ai' ? 'AI 回答摘录' : '批注', n.text))
  for (const c of convs) {
    const b = conversationBlock(c)
    if (b) parts.push(b)
  }
  return parts.join('\n\n')
}

export function exportMarkdown(input: ExportInput): string {
  const title = `${input.title} · 笔记`
  const out: string[] = [
    '---',
    `title: ${yamlScalar(title)}`,
    `source: ${yamlScalar(input.source)}`,
    `exported: ${input.date}`,
    '---',
    '',
    `# ${title}`,
  ]

  const notesOf = (id: string) => input.notes.filter((n) => n.anchorId === id).sort((a, b) => a.createdAt - b.createdAt)
  const convsOf = (id: string | null) =>
    input.conversations.filter((c) => c.anchorId === id).sort((a, b) => a.createdAt - b.createdAt)
  const hasContent = (id: string, highlighted: boolean) =>
    highlighted || notesOf(id).length > 0 || convsOf(id).some((c) => conversationBlock(c) !== null)
  const categoryOf = (a: { highlighted: boolean; color?: string }) => (a.highlighted ? colorName(a.color, input.colorNames) : null)

  let section: number | null = null
  const anchors = [...input.anchors].sort((a, b) => a.start - b.start)
  for (const a of anchors) {
    if (!hasContent(a.id, a.highlighted)) continue
    let s: number | null = null
    input.sections.forEach((sec, i) => {
      if (sec.pos <= a.start) s = i
    })
    if (s !== null && s !== section) {
      out.push('', `## ${input.sections[s].title}`)
      section = s
    }
    out.push('', anchorBlock(a.quote, categoryOf(a), notesOf(a.id), convsOf(a.id)))
  }

  // 什么都没留下的空锚点即使找不到原文也不导出
  const orphans = input.orphans.filter((o) => hasContent(o.id, o.highlighted))
  if (orphans.length) {
    out.push('', '## 原文已找不到的笔记', '', '文档改动后，下面这些笔记对应的原文已经找不到了。')
    for (const o of orphans) out.push('', anchorBlock(o.quote, categoryOf(o), notesOf(o.id), convsOf(o.id)))
  }

  const wholeLines = convsOf(null)
    .filter((c) => c.kind === 'sidebar')
    .flatMap(qaLines)
  if (wholeLines.length) out.push('', '## 整篇提问', '', wholeLines.join('\n'))

  return out.join('\n') + '\n'
}
