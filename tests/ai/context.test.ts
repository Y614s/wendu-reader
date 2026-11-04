import { describe, expect, it } from 'vitest'
import { MAX_PROMPTS, MAX_PROMPT_LENGTH, buildContext, estimateTokens, normalizePrompts, quickPrompts, splitBlocks, type ContextRequest } from '../../src/ai/context'

// 三节，每节三段；每段 100 个汉字左右，方便估算
const para = (tag: string) => `${tag}` + '内容'.repeat(50)
const SECTIONS = ['一', '二', '三'].map((s) => [`第${s}节`, para(`${s}A`), para(`${s}B`), para(`${s}C`)])
const TEXT = SECTIONS.map((s) => s.join('\n')).join('\n')
const STARTS = SECTIONS.map((_, i) => TEXT.indexOf(`第${['一', '二', '三'][i]}节`))

function req(over: Partial<ContextRequest> = {}): ContextRequest {
  const focusStart = TEXT.indexOf('二B')
  return {
    docTitle: '测试',
    text: TEXT,
    toTex: (a, b) => TEXT.slice(a, b),
    sectionStarts: STARTS,
    focus: { start: focusStart, end: focusStart + 5 },
    quote: '二B内容内',
    question: '这段说了什么？',
    scope: 'section',
    budget: 100000,
    history: [],
    ...over,
  }
}

const userMsg = (r: ReturnType<typeof buildContext>) => r.messages[r.messages.length - 1].content

describe('estimateTokens', () => {
  it('中文按字计，其他按 4 个字符 1 个', () => {
    expect(estimateTokens('红黑树')).toBe(3)
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('红黑 tree')).toBe(2 + 2)
  })
})

describe('quickPrompts', () => {
  it('针对原文和整篇提问各有一组，整篇时不出现「这段」「前文」', () => {
    expect(quickPrompts(false)).toEqual(['解释这段', '举个例子', '说得更通俗', '和前文有什么关系', '出一道自测题'])
    const whole = quickPrompts(true)
    expect(whole).toHaveLength(5)
    expect(whole.join()).not.toMatch(/这段|前文/)
  })
})

describe('自定义快捷提问', () => {
  it('自定义的优先，另一组仍用默认的，空数组表示不显示', () => {
    expect(quickPrompts(false, { anchor: ['甲'] })).toEqual(['甲'])
    expect(quickPrompts(true, { anchor: ['甲'] })).toEqual(quickPrompts(true))
    expect(quickPrompts(false, { anchor: [] })).toEqual([])
  })

  it('去掉空项和重复，限制条数和长度', () => {
    expect(normalizePrompts([' 甲 ', '', '甲', '乙'])).toEqual(['甲', '乙'])
    expect(normalizePrompts(Array.from({ length: 20 }, (_, i) => String(i)))).toHaveLength(MAX_PROMPTS)
    expect(normalizePrompts(['字'.repeat(500)])[0]).toHaveLength(MAX_PROMPT_LENGTH)
  })
})

describe('splitBlocks', () => {
  it('按换行切块，跳过空块', () => {
    expect(splitBlocks('甲\n\n乙\n ')).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 4 },
    ])
  })
})

describe('buildContext', () => {
  it('预算足够：本节全部带上，不带其他节', () => {
    const r = buildContext(req())
    const u = userMsg(r)
    for (const t of ['第二节', '二A', '二B', '二C']) expect(u).toContain(t)
    for (const t of ['一A', '三A']) expect(u).not.toContain(t)
    expect(r.truncated).toBe(false)
    expect(u).toContain('我选中的原文：\n> 二B内容内')
    expect(u).toContain('我的问题：这段说了什么？')
  })

  it('全文且预算足够：所有节都带上，按原文顺序', () => {
    const u = userMsg(buildContext(req({ scope: 'full' })))
    const order = ['一A', '二A', '二B', '三C'].map((t) => u.indexOf(t))
    expect(order.every((x) => x >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('预算不够：先丢其他章节里离选区最远的，保留本节，并标记截断', () => {
    const r = buildContext(req({ scope: 'full', budget: 700 }))
    const u = userMsg(r)
    for (const t of ['二A', '二B', '二C']) expect(u).toContain(t)
    // 紧挨着本节的一C、三A 还能放下，最远的一A、三C 被丢掉
    expect(u).toContain('一C')
    expect(u).not.toContain('一A')
    expect(u).not.toContain('三C')
    expect(r.truncated).toBe(true)
    expect(u).toContain('有删节')
  })

  it('预算更紧：只剩附近段落，离焦点远的先丢', () => {
    const r = buildContext(req({ budget: 380 }))
    const u = userMsg(r)
    expect(u).toContain('二B')
    expect(r.truncated).toBe(true)
  })

  it('预算小到放不下任何段落：问题和选中原文仍然保留', () => {
    const r = buildContext(req({ budget: 10 }))
    const u = userMsg(r)
    expect(u).toContain('我选中的原文：\n> 二B内容内')
    expect(u).toContain('我的问题：这段说了什么？')
    expect(u).not.toContain('<<<')
    expect(r.truncated).toBe(true)
  })

  it('历史对话优先级最低：预算紧时先丢旧的，且不以回答开头', () => {
    const history = [
      { role: 'user' as const, content: '第一问' + '字'.repeat(200) },
      { role: 'assistant' as const, content: '第一答' + '字'.repeat(200) },
      { role: 'user' as const, content: '第二问' },
      { role: 'assistant' as const, content: '第二答' },
    ]
    const full = buildContext(req({ history }))
    expect(full.messages.map((m) => m.content.slice(0, 3))).toEqual(['你是一', '第一问', '第一答', '第二问', '第二答', '文档：'])

    const tight = buildContext(req({ history, budget: estimateTokens(userMsg(full)) + 120 }))
    expect(tight.messages.map((m) => m.content.slice(0, 3))).toEqual(['你是一', '第二问', '第二答', '文档：'])
    expect(tight.omittedHistory).toBe(2)
  })

  it('整篇提问：没有选中原文，本节按阅读位置取', () => {
    const pos = TEXT.indexOf('三A')
    const u = userMsg(buildContext(req({ quote: null, focus: { start: pos, end: pos } })))
    expect(u).not.toContain('我选中的原文')
    expect(u).toContain('三A')
    expect(u).not.toContain('二A')
  })

  it('不相邻的段落之间加省略号', () => {
    const r = buildContext(req({ scope: 'full', budget: 700 }))
    expect(userMsg(r)).toMatch(/……/)
  })
})
