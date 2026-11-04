import type { AnchorRecord, DocumentRecord, WenduDB } from '../db'
import { hashText } from '../db/documents'
import { normalizeSource, parseDoc, renderMarkdown } from '../reader/markdown'
import { TextMap } from '../textmap'
import { createSelector, locate } from '.'

// 文档改版后的划线迁移。分两步：planMigration 只计算不写库，用来预览「能找回几处」；
// 确认后 applyMigration 在一个事务里写入。找不到的锚点保持原样，显示在「原文已找不到」，数据不删。

export interface MigrationPlan {
  source: string
  hash: string
  title: string
  /** 新内容和现在完全一样 */
  unchanged: boolean
  /** 能找回的锚点，已换成新位置和新的前后文 */
  moved: AnchorRecord[]
  /** 找不到的锚点，不改 */
  lost: AnchorRecord[]
  readingPosition: number | null
}

/** 在内存里渲染一份取映射层文本，和阅读页看到的一致 */
function textOf(source: string): string {
  const root = document.createElement('article')
  root.innerHTML = renderMarkdown(source)
  return TextMap.build(root).text
}

export async function planMigration(db: WenduDB, doc: DocumentRecord, rawSource: string): Promise<MigrationPlan> {
  const source = normalizeSource(rawSource)
  const hash = await hashText(source)
  const anchors = await db.anchors.where('docId').equals(doc.id).toArray()
  const plan: MigrationPlan = {
    source,
    hash,
    title: parseDoc(source, doc.title).title,
    unchanged: hash === doc.hash,
    moved: [],
    lost: [],
    readingPosition: doc.readingPosition,
  }

  const text = textOf(source)
  for (const a of anchors) {
    const r = locate(text, a)
    if (r.status === 'orphan') plan.lost.push(a)
    else plan.moved.push({ ...a, ...createSelector(text, r.start, r.end), docHash: hash })
  }

  // 阅读位置按原来那里的文字重新定位，找不到时回到开头
  if (doc.readingPosition !== null) {
    const oldText = textOf(doc.source)
    const pos = Math.min(doc.readingPosition, Math.max(0, oldText.length - 1))
    const found = locate(text, createSelector(oldText, pos, Math.min(pos + 24, oldText.length)))
    plan.readingPosition = found.status === 'orphan' ? 0 : found.start
  }
  return plan
}

export async function applyMigration(db: WenduDB, doc: DocumentRecord, plan: MigrationPlan): Promise<void> {
  await db.transaction('rw', [db.documents, db.anchors], async () => {
    await db.documents.update(doc.id, { source: plan.source, hash: plan.hash, title: plan.title, readingPosition: plan.readingPosition })
    await db.anchors.bulkPut(plan.moved)
  })
}
