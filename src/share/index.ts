import { db, newId, type ConversationRecord, type DocumentRecord } from '../db'
import { shareText, type ShareResult } from '../platform/share'

// 发到 App：先在本地建一条「待补充」记录，再调起分享面板。
// 回来后把复制的回答粘贴进这条记录，不依赖页面还保持原来的选中状态。

export function composeShareText(docTitle: string, section: string | null, quote: string): string {
  return [`文档：《${docTitle}》`, section ? `章节：${section}` : null, '', '原文：', quote, '', '我的问题：']
    .filter((l) => l !== null)
    .join('\n')
}

export async function sendToApp(opts: {
  doc: DocumentRecord
  anchorId: string
  section: string | null
  quote: string
}): Promise<{ record: ConversationRecord; result: ShareResult }> {
  const text = composeShareText(opts.doc.title, opts.section, opts.quote)
  const record: ConversationRecord = {
    id: newId(),
    docId: opts.doc.id,
    anchorId: opts.anchorId,
    kind: 'external',
    status: 'pending',
    messages: [{ role: 'user', content: text, createdAt: Date.now() }],
    provider: '',
    model: '',
    createdAt: Date.now(),
  }
  await db.conversations.add(record)
  const result = await shareText(opts.doc.title, text)
  return { record, result }
}

/** 把在其他 App 得到的回答填进待补充记录 */
export async function fillPending(id: string, answer: string, appName: string): Promise<void> {
  const rec = await db.conversations.get(id)
  if (!rec) return
  await db.conversations.update(id, {
    status: 'done',
    provider: appName,
    messages: [...rec.messages, { role: 'assistant', content: answer, createdAt: Date.now() }],
  })
}
