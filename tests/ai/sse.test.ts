import { describe, expect, it } from 'vitest'
import { SSEParser, interpretChatEvent, type SSEEvent } from '../../src/ai/sse'

function parse(chunks: string[]): SSEEvent[] {
  const events: SSEEvent[] = []
  const p = new SSEParser((e) => events.push(e))
  for (const c of chunks) p.feed(c)
  p.end()
  return events
}

const delta = (s: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`

describe('SSEParser', () => {
  it('解析完整事件', () => {
    expect(parse([delta('你好') + 'data: [DONE]\n\n'])).toEqual([
      { event: 'message', data: JSON.stringify({ choices: [{ delta: { content: '你好' } }] }) },
      { event: 'message', data: '[DONE]' },
    ])
  })

  it('一行在数据块中间断开', () => {
    const full = delta('红黑树') + delta('是平衡树')
    for (let cut = 1; cut < full.length; cut++) {
      const events = parse([full.slice(0, cut), full.slice(cut)])
      expect(events.map((e) => interpretChatEvent(e))).toEqual([
        { type: 'delta', text: '红黑树' },
        { type: 'delta', text: '是平衡树' },
      ])
    }
  })

  it('逐字符喂入也能正确解析', () => {
    const full = delta('甲') + delta('乙') + 'data: [DONE]\n\n'
    const events = parse(full.split(''))
    expect(events.map((e) => interpretChatEvent(e))).toEqual([
      { type: 'delta', text: '甲' },
      { type: 'delta', text: '乙' },
      { type: 'done' },
    ])
  })

  it('\\r\\n 换行，且 \\r 和 \\n 分在两个数据块', () => {
    const events = parse(['data: a\r', '\n\r', '\ndata: b\r\n\r\n'])
    expect(events.map((e) => e.data)).toEqual(['a', 'b'])
  })

  it('忽略注释行和多余空行，多行 data 用换行连接', () => {
    const events = parse([': keep-alive\n\n\n\ndata: 第一行\ndata: 第二行\n\n'])
    expect(events).toEqual([{ event: 'message', data: '第一行\n第二行' }])
  })

  it('流末尾没有空行时也发出最后一个事件', () => {
    expect(parse(['data: [DONE]']).map((e) => e.data)).toEqual(['[DONE]'])
  })
})

describe('interpretChatEvent', () => {
  it('识别 [DONE]', () => {
    expect(interpretChatEvent({ event: 'message', data: '[DONE]' })).toEqual({ type: 'done' })
  })

  it('识别 event: error 事件', () => {
    expect(interpretChatEvent({ event: 'error', data: '{"error":{"message":"额度不足"}}' })).toEqual({
      type: 'error',
      message: '额度不足',
    })
    expect(interpretChatEvent({ event: 'error', data: 'upstream timeout' })).toEqual({
      type: 'error',
      message: 'upstream timeout',
    })
  })

  it('识别 data 里带 error 字段的错误', () => {
    expect(interpretChatEvent({ event: 'message', data: '{"error":{"message":"Invalid key"}}' })).toEqual({
      type: 'error',
      message: 'Invalid key',
    })
  })

  it('空 delta、role 片段和无法解析的数据不产生输出', () => {
    expect(interpretChatEvent({ event: 'message', data: '{"choices":[{"delta":{"role":"assistant"}}]}' })).toBeNull()
    expect(interpretChatEvent({ event: 'message', data: '{"choices":[{"delta":{"content":""}}]}' })).toBeNull()
    expect(interpretChatEvent({ event: 'message', data: 'not json' })).toBeNull()
  })
})
