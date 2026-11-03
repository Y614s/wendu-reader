import type { ConversationRecord, NoteRecord } from '../db'

// 单篇导出 md，格式按 docs/plan.md「导出与备份」里的样例：
// YAML 信息 → 按章节组织 → 原文用引用块，下面接批注、AI 回答摘录、问答、待补充 → 原文已找不到的 → 整篇提问。

export interface ExportAnchor {
  id: string
  start: number
  /** 原文（公式已换回 TeX） */
  quote: string
  highlighted: boolean
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
  orphans: { id: string; quote: string }[]
  notes: NoteRecord[]
  conversations: ConversationRecord[]
}

export function formatDate(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

function questionOf(m: ConversationRecord['messages'][number]): string {
  return (m.display ?? m.content).trim()
}

function conversationBlock(c: ConversationRecord): string | null {
  if (c.status === 'pending') return '**待补充**（发到 App）：问题已发出，回答还没填。'

  const lines: string[] = []
  if (c.kind === 'external') {
    lines.push(`**问答**（发到 App · ${c.provider || '其他 App'} · ${formatDate(c.createdAt)}）`, '')
    for (const m of c.messages) if (m.role === 'assistant' && m.content.trim()) lines.push(listItem('答', m.content))
  } else {
    lines.push(`**问答**（侧栏问 · ${c.provider}${c.model ? ' · ' + c.model : ''} · ${formatDate(c.createdAt)}）`, '')
    for (const m of c.messages) {
      if (m.role === 'user') lines.push(listItem('问', questionOf(m)))
      else if (m.role === 'assistant' && m.content.trim()) lines.push(listItem('答', m.content))
    }
  }
  return lines.length > 2 ? lines.join('\n') : null
}

function anchorBlock(quote: string, notes: NoteRecord[], convs: ConversationRecord[]): string {
  const parts = [blockquote(quote)]
  for (const n of notes) {
    const label = n.source === 'ai' ? 'AI 回答摘录' : '批注'
    parts.push(`**${label}**：${n.text.trim()}`)
  }
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
    `title: ${title}`,
    `source: ${input.source}`,
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
    out.push('', anchorBlock(a.quote, notesOf(a.id), convsOf(a.id)))
  }

  const orphans = input.orphans.filter((o) => hasContent(o.id, true))
  if (orphans.length) {
    out.push('', '## 原文已找不到的笔记', '', '文档改动后，下面这些笔记对应的原文已经找不到了。')
    for (const o of orphans) out.push('', anchorBlock(o.quote, notesOf(o.id), convsOf(o.id)))
  }

  const whole = convsOf(null).filter((c) => c.kind === 'sidebar')
  const wholeLines: string[] = []
  for (const c of whole) {
    for (const m of c.messages) {
      if (m.role === 'user') wholeLines.push(listItem('问', questionOf(m)))
      else if (m.role === 'assistant' && m.content.trim()) wholeLines.push(listItem('答', m.content))
    }
  }
  if (wholeLines.length) out.push('', '## 整篇提问', '', wholeLines.join('\n'))

  return out.join('\n') + '\n'
}
