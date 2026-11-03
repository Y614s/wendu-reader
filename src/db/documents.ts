import { db, getSetting, newId, setSetting, type DocumentRecord } from '.'
import { normalizeSource, parseDoc } from '../reader/markdown'

const CURRENT_DOC_KEY = 'reader.currentDocId'
const SAMPLE_DOC_KEY = 'reader.sampleDocId'

export async function hashText(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // 非安全上下文没有 subtle，用 FNV-1a 兜底（只用于判断文档是否变过）
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return 'fnv-' + (h >>> 0).toString(16)
}

/** 导入一篇文档。同名文档保留两份，不覆盖。 */
export async function importDocument(rawSource: string, fileName: string): Promise<DocumentRecord> {
  const source = normalizeSource(rawSource)
  const { title } = parseDoc(source, fileName.replace(/\.(md|markdown|mdown|txt)$/i, '') || '未命名')
  const now = Date.now()
  const doc: DocumentRecord = {
    id: newId(),
    title,
    source,
    hash: await hashText(source),
    importedAt: now,
    lastReadAt: now,
    readingPosition: null,
  }
  await db.documents.add(doc)
  return doc
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  return db.documents.orderBy('importedAt').reverse().toArray()
}

export async function setCurrentDocument(id: string): Promise<void> {
  await setSetting(CURRENT_DOC_KEY, id)
  await db.documents.update(id, { lastReadAt: Date.now() })
}

export async function clearCurrentDocument(): Promise<void> {
  await db.settings.delete(CURRENT_DOC_KEY)
}

/**
 * 当前文档。只在第一次启动时导入内置测试文档；用户删掉它以后不再自动导回来。
 * 没有当前文档时返回 null，由界面引导去书架。
 */
export async function loadCurrentDocument(fetchSample: () => Promise<string>): Promise<DocumentRecord | null> {
  const id = await getSetting<string | null>(CURRENT_DOC_KEY, null)
  const doc = id ? await db.documents.get(id) : undefined
  if (doc) return doc

  const sampleId = await getSetting<string | null>(SAMPLE_DOC_KEY, null)
  if (sampleId !== null) return null
  const text = await fetchSample()
  // 读不到内置文档时不导入空文档，下次启动再试
  if (!text.trim()) return null
  const sample = await importDocument(text, 'test.md')
  await setSetting(SAMPLE_DOC_KEY, sample.id)
  await setCurrentDocument(sample.id)
  return sample
}

/** 删除文档，连同它的锚点、划线、批注和对话一起删，放在一个事务里 */
export async function deleteDocument(id: string): Promise<void> {
  await db.transaction('rw', [db.documents, db.anchors, db.highlights, db.notes, db.conversations, db.settings], async () => {
    const anchorIds = (await db.anchors.where('docId').equals(id).primaryKeys()) as string[]
    if (anchorIds.length) {
      await db.highlights.where('anchorId').anyOf(anchorIds).delete()
      await db.notes.where('anchorId').anyOf(anchorIds).delete()
    }
    await db.anchors.where('docId').equals(id).delete()
    await db.conversations.where('docId').equals(id).delete()
    await db.documents.delete(id)
    if ((await getSetting<string | null>(CURRENT_DOC_KEY, null)) === id) await db.settings.delete(CURRENT_DOC_KEY)
  })
}

export async function saveReadingPosition(id: string, pos: number): Promise<void> {
  await db.documents.update(id, { readingPosition: pos, lastReadAt: Date.now() })
}
