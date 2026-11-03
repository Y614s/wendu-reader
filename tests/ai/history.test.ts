import { describe, expect, it } from 'vitest'
import { answeredPairs, historyForRequest } from '../../src/ai/history'
import type { ChatMessage } from '../../src/db'

const T = 0
const u = (content: string, display?: string): ChatMessage => ({ role: 'user', content, display, createdAt: T })
const a = (content: string, error?: string): ChatMessage => ({ role: 'assistant', content, error, createdAt: T })

describe('对话历史', () => {
  it('失败的提问（回答为空）不进历史，不会出现连续两条 user', () => {
    const msgs = [u('第一问'), a('第一答'), u('失败的问'), a('', '网络不通'), u('第三问'), a('第三答')]
    const h = historyForRequest(msgs)
    expect(h.map((m) => m.content)).toEqual(['第一问', '第一答', '第三问', '第三答'])
    for (let i = 1; i < h.length; i++) expect(h[i].role).not.toBe(h[i - 1].role)
  })

  it('完全没有回答的提问也跳过（例如请求时 App 被关掉）', () => {
    expect(historyForRequest([u('甲'), u('乙'), a('乙的回答')]).map((m) => m.content)).toEqual(['乙', '乙的回答'])
  })

  it('中途断开、带错误但有部分内容的回答：导出保留，请求历史不带', () => {
    const msgs = [u('问'), a('答了一半', '回答传到一半断开了')]
    expect(answeredPairs(msgs)).toHaveLength(1)
    expect(historyForRequest(msgs)).toEqual([])
  })

  it('问题用界面上显示的原话，不带当时的上下文', () => {
    expect(historyForRequest([u('（很长的上下文）……我的问题：为什么', '为什么'), a('因为')])[0].content).toBe('为什么')
  })
})
