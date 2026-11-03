import { db, newId, type AnchorRecord, type ConversationRecord, type DocumentRecord, type HighlightRecord, type NoteRecord } from '../db'
import { createSelector, locate } from '.'

export const DEFAULT_COLOR = 'yellow'

export async function saveAnchor(doc: DocumentRecord, text: string, start: number, end: number): Promise<AnchorRecord> {
  const anchor: AnchorRecord = { id: newId(), docId: doc.id, docHash: doc.hash, ...createSelector(text, start, end) }
  await db.anchors.add(anchor)
  return anchor
}

export async function addHighlight(anchorId: string): Promise<HighlightRecord> {
  const hl: HighlightRecord = { id: newId(), anchorId, color: DEFAULT_COLOR, createdAt: Date.now() }
  await db.highlights.add(hl)
  return hl
}

/** 删除划线只删 highlight 记录；锚点上可能还挂着对话，保留。 */
export async function removeHighlightsOf(anchorId: string): Promise<void> {
  await db.highlights.where('anchorId').equals(anchorId).delete()
}

export interface DocAnnotations {
  anchors: AnchorRecord[]
  highlights: HighlightRecord[]
  notes: NoteRecord[]
  conversations: ConversationRecord[]
}

export async function loadAnnotations(docId: string): Promise<DocAnnotations> {
  const anchors = await db.anchors.where('docId').equals(docId).toArray()
  const ids = anchors.map((a) => a.id)
  const highlights = ids.length ? await db.highlights.where('anchorId').anyOf(ids).toArray() : []
  const notes = ids.length ? await db.notes.where('anchorId').anyOf(ids).toArray() : []
  const conversations = await db.conversations.where('docId').equals(docId).toArray()
  return { anchors, highlights, notes, conversations }
}

export interface LocatedAnchor {
  anchor: AnchorRecord
  start: number
  end: number
}

/** 把锚点定位到当前文本上；孤立的锚点单独返回，数据不删 */
export function locateAnchors(text: string, anchors: AnchorRecord[]): { located: LocatedAnchor[]; orphans: AnchorRecord[] } {
  const located: LocatedAnchor[] = []
  const orphans: AnchorRecord[] = []
  for (const anchor of anchors) {
    const r = locate(text, anchor)
    if (r.status === 'orphan') orphans.push(anchor)
    else located.push({ anchor, start: r.start, end: r.end })
  }
  return { located, orphans }
}

// ---------- 批注和笔记 ----------

export async function addNote(anchorId: string, text: string, source: 'annotation' | 'ai'): Promise<NoteRecord> {
  const now = Date.now()
  const note: NoteRecord = { id: newId(), anchorId, source, text, createdAt: now, updatedAt: now }
  await db.notes.add(note)
  return note
}

export async function updateNote(id: string, text: string): Promise<void> {
  await db.notes.update(id, { text, updatedAt: Date.now() })
}

export async function deleteNote(id: string): Promise<void> {
  await db.notes.delete(id)
}
