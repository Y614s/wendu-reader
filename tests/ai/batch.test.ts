import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { askAnchor, runBatch } from '../../src/ai/batch'
import { ChatError } from '../../src/ai/client'
import { createSelector } from '../../src/anchor'
import { db, type AnchorRecord, type DocumentRecord } from '../../src/db'
import { renderMarkdown } from '../../src/reader/markdown'
import { TextMap } from '../../src/textmap'

describe('runBatch', () => {
  const opts = () => ({ signal: new AbortController().signal })

  it('串行执行，上一条结束才开始下一条', async () => {
    const log: string[] = []
    await runBatch(
      ['甲', '乙'],
      async (x) => {
        log.push(`开始${x}`)
        await Promise.resolve()
        log.push(`结束${x}`)
      },
      opts(),
    )
    expect(log).toEqual(['开始甲', '结束甲', '开始乙', '结束乙'])
  })

  it('中途失败不影响其他条，失败的记下原因', async () => {
    const r = await runBatch(
      [1, 2, 3],
      async (x) => {
        if (x === 2) throw new Error('网络不通')
      },
      opts(),
    )
    expect(r.map((x) => x.status)).toEqual(['done', 'failed', 'done'])
    expect(r[1].error).toBe('网络不通')
  })

  it('停止后不再发后面的，已完成的保留', async () => {
    const ctrl = new AbortController()
    const ran: number[] = []
    const r = await runBatch(
      [1, 2, 3, 4],
      async (x) => {
        ran.push(x)
        if (x === 2) {
          ctrl.abort()
          throw new Error('已停止')
        }
      },
      { signal: ctrl.signal },
    )
    expect(ran).toEqual([1, 2])
    expect(r.map((x) => x.status)).toEqual(['done', 'stopped', 'stopped', 'stopped'])
  })

  it('报告进度', async () => {
    const seen: string[] = []
    await runBatch([1, 2], async () => {}, { ...opts(), onProgress: (d, t) => seen.push(`${d}/${t}`) })
    expect(seen).toEqual(['1/2', '2/2'])
  })
})

describe('askAnchor', () => {
  const source = '# 标题\n\n## 第一节\n\n红黑树的高度 $h$ 有上界。\n\n## 第二节\n\n另一节的内容。'
  const doc: DocumentRecord = { id: 'd', title: '红黑树', source, hash: 'h', importedAt: 0, lastReadAt: 0, readingPosition: null }
  const cfg = { providerId: 'x', baseURL: 'https://x.com', model: 'm', apiKey: 'k' }
  let anchor: AnchorRecord

  beforeEach(async () => {
    await Promise.all([db.anchors.clear(), db.conversations.clear()])
    document.body.innerHTML = `<article id="r">${renderMarkdown(source)}</article>`
    const map = TextMap.build(document.getElementById('r')!)
    const start = map.text.indexOf('红黑树')
    anchor = { id: 'a', docId: 'd', docHash: 'h', ...createSelector(map.text, start, map.text.indexOf('有上界')) }
    await db.anchors.add(anchor)
  })

  const base = () => ({ doc, anchor, question: '解释这段', budget: 8000, cfg, providerName: 'P' })

  it('用上下文提问，回答存到这处原文上，公式换回 TeX', async () => {
    let sent = ''
    await askAnchor({
      ...base(),
      stream: async (_c, messages, opts) => {
        sent = messages[messages.length - 1].content
        opts.onDelta('回答')
      },
    })
    expect(sent).toContain('$h$')
    expect(sent).toContain('我的问题：解释这段')
    expect(sent).toContain('第一节')
    expect(sent).not.toContain('另一节的内容')
    const convs = await db.conversations.where('anchorId').equals('a').toArray()
    expect(convs).toHaveLength(1)
    expect(convs[0].provider).toBe('P')
    expect(convs[0].messages.map((m) => [m.role, m.content])).toEqual([
      ['user', '解释这段'],
      ['assistant', '回答'],
    ])
  })

  it('再问一次接着同一段对话，带上历史', async () => {
    await askAnchor({ ...base(), stream: async (_c, _m, o) => o.onDelta('第一次') })
    let count = 0
    await askAnchor({
      ...base(),
      question: '再说说',
      stream: async (_c, m, o) => {
        count = m.length
        o.onDelta('第二次')
      },
    })
    const convs = await db.conversations.toArray()
    expect(convs).toHaveLength(1)
    expect(convs[0].messages).toHaveLength(4)
    expect(count).toBe(4) // 系统提示 + 上一轮问答 + 这次的问题
  })

  it('失败时抛出，并把已收到的部分和原因存下来', async () => {
    await expect(
      askAnchor({
        ...base(),
        stream: async (_c, _m, o) => {
          o.onDelta('答了一半')
          throw new ChatError('stream', '断开了')
        },
      }),
    ).rejects.toThrow('断开了')
    const m = (await db.conversations.toArray())[0].messages
    expect(m[1]).toMatchObject({ content: '答了一半', error: '断开了' })
  })

  it('原文找不到时用保存的原文提问，不报错', async () => {
    await db.anchors.clear()
    const gone = { ...anchor, quote: '已被删掉的一句', start: 999, end: 1006 }
    let sent = ''
    await askAnchor({
      ...base(),
      anchor: gone,
      stream: async (_c, m) => {
        sent = m[m.length - 1].content
      },
    })
    expect(sent).toContain('已被删掉的一句')
  })
})
