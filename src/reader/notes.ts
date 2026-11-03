import type { AnchorRecord, ConversationRecord, NoteRecord } from '../db'
import type { LocatedAnchor } from '../anchor/store'

// 笔记侧栏的分组：待补充 → 按原文顺序的笔记 → 原文已找不到的 → 整篇提问

export interface NoteEntry {
  anchorId: string
  /** 映射层位置；孤立锚点为 null */
  start: number | null
  quote: string
  highlighted: boolean
  notes: NoteRecord[]
  /** 已完成的对话（待补充的单独分组） */
  convs: ConversationRecord[]
}

export interface NoteGroups {
  pending: { conv: ConversationRecord; quote: string; anchorId: string | null }[]
  entries: NoteEntry[]
  orphans: NoteEntry[]
  whole: ConversationRecord[]
}

export function buildNoteGroups(opts: {
  located: LocatedAnchor[]
  orphans: AnchorRecord[]
  highlighted: Set<string>
  notes: NoteRecord[]
  conversations: ConversationRecord[]
  /** 取原文（公式换回 TeX） */
  quoteOf: (start: number, end: number) => string
}): NoteGroups {
  const byCreated = <T extends { createdAt: number }>(a: T, b: T) => a.createdAt - b.createdAt
  const notesOf = (id: string) => opts.notes.filter((n) => n.anchorId === id).sort(byCreated)
  const doneOf = (id: string) => opts.conversations.filter((c) => c.anchorId === id && c.status === 'done').sort(byCreated)

  const entry = (anchorId: string, start: number | null, quote: string): NoteEntry | null => {
    const e = { anchorId, start, quote, highlighted: opts.highlighted.has(anchorId), notes: notesOf(anchorId), convs: doneOf(anchorId) }
    return e.highlighted || e.notes.length || e.convs.length ? e : null
  }

  const quoteById = new Map<string, string>()
  const entries: NoteEntry[] = []
  for (const l of [...opts.located].sort((a, b) => a.start - b.start)) {
    const q = opts.quoteOf(l.start, l.end)
    quoteById.set(l.anchor.id, q)
    const e = entry(l.anchor.id, l.start, q)
    if (e) entries.push(e)
  }
  const orphans: NoteEntry[] = []
  for (const a of opts.orphans) {
    quoteById.set(a.id, a.quote)
    const e = entry(a.id, null, a.quote)
    if (e) orphans.push(e)
  }

  const pending = opts.conversations
    .filter((c) => c.status === 'pending')
    .sort(byCreated)
    .map((conv) => ({ conv, anchorId: conv.anchorId, quote: conv.anchorId ? (quoteById.get(conv.anchorId) ?? '') : '' }))

  const whole = opts.conversations.filter((c) => c.anchorId === null && c.kind === 'sidebar' && c.status === 'done').sort(byCreated)
  return { pending, entries, orphans, whole }
}
