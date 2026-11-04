import { db, newId, type AnchorRecord, type ConversationRecord, type DocumentRecord, type HighlightRecord, type NoteRecord } from '../db'
import { createSelector, locate } from '.'
import { DEFAULT_COLOR, type HighlightColor } from '../highlight/colors'

export async function saveAnchor(doc: DocumentRecord, text: string, start: number, end: number): Promise<AnchorRecord> {
  const anchor: AnchorRecord = { id: newId(), docId: doc.id, docHash: doc.hash, ...createSelector(text, start, end) }
  await db.anchors.add(anchor)
  return anchor
}

export async function addHighlight(anchorId: string, color: HighlightColor = DEFAULT_COLOR): Promise<HighlightRecord> {
  const hl: HighlightRecord = { id: newId(), anchorId, color, createdAt: Date.now() }
  await db.highlights.add(hl)
  return hl
}

/** 改一处划线的颜色；锚点上还没有划线时（只有批注）补一条 */
export async function setHighlightColor(anchorId: string, color: HighlightColor): Promise<void> {
  const n = await db.highlights.where('anchorId').equals(anchorId).modify({ color })
  if (n === 0) await addHighlight(anchorId, color)
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

// ---------- 删除与清理 ----------

/** 删除一处划线和挂在上面的批注、笔记（对话保留） */
export async function removeHighlightAndNotes(anchorId: string): Promise<void> {
  await db.transaction('rw', [db.highlights, db.notes], async () => {
    await db.highlights.where('anchorId').equals(anchorId).delete()
    await db.notes.where('anchorId').equals(anchorId).delete()
  })
  await deleteAnchorIfUnused(anchorId)
}

/** 删除一条对话（侧栏问或待补充记录）。锚点要不要一起清理由调用方决定，面板还开着时不能删 */
export async function deleteConversation(id: string): Promise<void> {
  await db.conversations.delete(id)
}

/**
 * 锚点上已经没有划线、批注和对话时删掉它。
 * 例如点了「侧栏问」却没提问就关掉，或删掉了最后一处划线；不清理的话，原文改动后它会变成空的孤立锚点。
 */
export async function deleteAnchorIfUnused(anchorId: string): Promise<boolean> {
  return db.transaction('rw', [db.anchors, db.highlights, db.notes, db.conversations], async () => {
    const used =
      (await db.highlights.where('anchorId').equals(anchorId).count()) +
      (await db.notes.where('anchorId').equals(anchorId).count()) +
      (await db.conversations.where('anchorId').equals(anchorId).count())
    if (used > 0) return false
    await db.anchors.delete(anchorId)
    return true
  })
}
