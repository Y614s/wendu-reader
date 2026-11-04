import type { AnchorRecord, ConversationRecord, DocumentRecord, HighlightRecord, NoteRecord } from '../db'
import { answeredPairs } from '../ai/history'
import { QUESTION_COLOR, normalizeColor, type HighlightColor } from '../highlight/colors'
import { MATH_CHAR } from '../textmap'
import { parseTags } from './markdown'

// 全局笔记：跨文档汇总划线、批注和问答。这一页不渲染文档，原文用锚点里存的 quote。

export interface GlobalEntry {
  docId: string
  docTitle: string
  tags: string[]
  anchorId: string
  /** 保存时的映射层位置，用来排序 */
  start: number
  quote: string
  highlighted: boolean
  color: HighlightColor
  notes: NoteRecord[]
  convs: ConversationRecord[]
}

export interface GlobalData {
  documents: DocumentRecord[]
  anchors: AnchorRecord[]
  highlights: HighlightRecord[]
  notes: NoteRecord[]
  conversations: ConversationRecord[]
}

export interface GlobalFilter {
  colors: HighlightColor[]
  tag: string | null
  keyword: string
}

export function buildGlobalEntries(data: GlobalData): GlobalEntry[] {
  const docs = new Map(data.documents.map((d) => [d.id, d]))
  const tags = new Map(data.documents.map((d) => [d.id, parseTags(d.source)]))
  const colors = new Map(data.highlights.map((h) => [h.anchorId, h.color]))
  const byAnchor = <T extends { anchorId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      if (r.anchorId) m.set(r.anchorId, [...(m.get(r.anchorId) ?? []), r])
    }
    return m
  }
  const notes = byAnchor(data.notes)
  const convs = byAnchor(data.conversations)

  const out: GlobalEntry[] = []
  for (const a of data.anchors) {
    const doc = docs.get(a.docId)
    if (!doc) continue
    const entry: GlobalEntry = {
      docId: a.docId,
      docTitle: doc.title,
      tags: tags.get(a.docId) ?? [],
      anchorId: a.id,
      start: a.start,
      quote: a.quote.split(MATH_CHAR).join('[公式]'),
      highlighted: colors.has(a.id),
      color: normalizeColor(colors.get(a.id)),
      notes: notes.get(a.id) ?? [],
      convs: convs.get(a.id) ?? [],
    }
    if (entry.highlighted || entry.notes.length || entry.convs.length) out.push(entry)
  }
  // 文档按最近阅读排，同一篇按原文顺序
  const lastRead = (id: string) => docs.get(id)?.lastReadAt ?? 0
  return out.sort((a, b) => lastRead(b.docId) - lastRead(a.docId) || a.docId.localeCompare(b.docId) || a.start - b.start)
}

function matchesKeyword(e: GlobalEntry, kw: string): boolean {
  const has = (s: string) => s.toLowerCase().includes(kw)
  return (
    has(e.quote) ||
    e.notes.some((n) => has(n.text)) ||
    e.convs.some((c) => c.messages.some((m) => has(m.display ?? m.content)))
  )
}

/** 条件可以叠加；空条件返回全部 */
export function filterEntries(entries: GlobalEntry[], f: GlobalFilter): GlobalEntry[] {
  const kw = f.keyword.trim().toLowerCase()
  return entries.filter(
    (e) =>
      (f.colors.length === 0 || f.colors.includes(e.color)) &&
      (f.tag === null || e.tags.includes(f.tag)) &&
      (kw === '' || matchesKeyword(e, kw)),
  )
}

export interface GlobalGroup {
  docId: string
  docTitle: string
  entries: GlobalEntry[]
}

export function groupByDoc(entries: GlobalEntry[]): GlobalGroup[] {
  const groups: GlobalGroup[] = []
  for (const e of entries) {
    const last = groups[groups.length - 1]
    if (last?.docId === e.docId) last.entries.push(e)
    else groups.push({ docId: e.docId, docTitle: e.docTitle, entries: [e] })
  }
  return groups
}

/** 疑问清单：所有红色划线 */
export function questionEntries(entries: GlobalEntry[]): GlobalEntry[] {
  return entries.filter((e) => e.highlighted && e.color === QUESTION_COLOR)
}

/** 这一处有没有得到过回答（待补充的不算） */
export function isAnswered(e: GlobalEntry): boolean {
  return e.convs.some((c) => c.status === 'done' && answeredPairs(c.messages).length > 0)
}
