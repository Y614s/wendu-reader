import { db, newId, type AnchorRecord, type ConversationRecord, type DocumentRecord } from '../db'
import { locate } from '../anchor'
import { collectHeadings, sectionStarts } from '../reader/outline'
import { renderMarkdown } from '../reader/markdown'
import { TextMap } from '../textmap'
import { ChatError, streamChat, type ChatMessageInput, type StreamOptions } from './client'
import { buildContext } from './context'
import { historyForRequest } from './history'
import type { ProviderConfig } from './providers'

// 批量提问：一条一条依次问，每条的回答挂回各自的原文，结果和逐条问一样。

export const MAX_BATCH = 10

export type BatchStatus = 'done' | 'failed' | 'stopped'

export interface BatchResult<T> {
  item: T
  status: BatchStatus
  error?: string
}

/** 依次执行。一条失败不影响其他条；停止后后面的都不再发 */
export async function runBatch<T>(
  items: T[],
  run: (item: T, signal: AbortSignal) => Promise<void>,
  opts: { signal: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<BatchResult<T>[]> {
  const results: BatchResult<T>[] = []
  for (const item of items) {
    if (opts.signal.aborted) {
      results.push({ item, status: 'stopped' })
      continue
    }
    try {
      await run(item, opts.signal)
      results.push({ item, status: 'done' })
    } catch (e) {
      const stopped = opts.signal.aborted
      results.push({ item, status: stopped ? 'stopped' : 'failed', error: e instanceof Error ? e.message : String(e) })
    }
    opts.onProgress?.(results.length, items.length)
  }
  return results
}

/** 全局页没有打开文档：在内存里渲染一份，映射层和目录照常可用（不需要布局） */
function outlineOf(doc: DocumentRecord) {
  const root = document.createElement('article')
  root.innerHTML = renderMarkdown(doc.source)
  const map = TextMap.build(root)
  return { map, starts: sectionStarts(collectHeadings(map)) }
}

export interface AskAnchorOptions {
  doc: DocumentRecord
  anchor: AnchorRecord
  question: string
  budget: number
  cfg: ProviderConfig
  providerName: string
  signal?: AbortSignal
  stream?: (cfg: ProviderConfig, messages: ChatMessageInput[], opts: StreamOptions) => Promise<unknown>
}

/** 对一处原文提一个问题，接着这处最近的对话问，问答存库。失败时抛出，已收到的部分和原因都存下来 */
export async function askAnchor(o: AskAnchorOptions): Promise<void> {
  const { map, starts } = outlineOf(o.doc)
  const found = locate(map.text, o.anchor)
  const located = found.status !== 'orphan'
  const focus = located ? { start: found.start, end: found.end } : { start: 0, end: 0 }
  const quote = located ? map.textWithTex(found.start, found.end) : o.anchor.quote

  const existing = (await db.conversations.where('anchorId').equals(o.anchor.id).toArray())
    .filter((c) => c.kind === 'sidebar')
    .sort((a, b) => a.createdAt - b.createdAt)
    .at(-1)
  const req = buildContext({
    docTitle: o.doc.title,
    text: map.text,
    toTex: (a, b) => map.textWithTex(a, b),
    sectionStarts: starts,
    focus,
    quote,
    question: o.question,
    scope: 'section',
    budget: o.budget,
    history: historyForRequest(existing?.messages ?? []),
  })

  const userMsg = { role: 'user' as const, content: o.question, createdAt: Date.now() }
  const conv: ConversationRecord = existing ?? {
    id: newId(),
    docId: o.doc.id,
    anchorId: o.anchor.id,
    kind: 'sidebar',
    status: 'done',
    messages: [],
    provider: o.providerName,
    model: o.cfg.model,
    createdAt: Date.now(),
  }
  await db.conversations.put({ ...conv, messages: [...conv.messages, userMsg] })

  let answer = ''
  let error: unknown
  try {
    await (o.stream ?? streamChat)(o.cfg, req.messages, {
      signal: o.signal,
      onDelta: (t) => {
        answer += t
      },
    })
  } catch (e) {
    error = e
  }
  if (answer || error) {
    const reason = error instanceof ChatError ? error.message : error ? String(error) : undefined
    const fresh = await db.conversations.get(conv.id)
    if (fresh) {
      await db.conversations.update(conv.id, {
        messages: [...fresh.messages, { role: 'assistant', content: answer, createdAt: Date.now(), ...(reason ? { error: reason } : {}) }],
      })
    }
  }
  if (error) throw error
}
