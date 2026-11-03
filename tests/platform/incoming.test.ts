import { describe, expect, it } from 'vitest'
import { isLikelyMarkdown } from '../../src/platform/incoming'
import { chatCompletionsURL } from '../../src/ai/providers'

describe('isLikelyMarkdown', () => {
  it('md 扩展名直接接受', () => {
    expect(isLikelyMarkdown('红黑树.md', '随便什么文字')).toBe(true)
    expect(isLikelyMarkdown('notes.MARKDOWN', 'abc')).toBe(true)
  })

  it('没有扩展名或 txt 时按内容判断', () => {
    expect(isLikelyMarkdown('', '# 标题\n\n正文')).toBe(true)
    expect(isLikelyMarkdown('笔记.txt', '- 第一条\n- 第二条')).toBe(true)
    expect(isLikelyMarkdown('', '只是一句普通的话')).toBe(false)
  })

  it('其他扩展名、二进制和空内容拒绝', () => {
    expect(isLikelyMarkdown('report.pdf', '# 看起来像标题')).toBe(false)
    expect(isLikelyMarkdown('a.md', 'PK\u0003\u0004\u0000\u0000')).toBe(false)
    expect(isLikelyMarkdown('a.md', '   ')).toBe(false)
  })
})

describe('chatCompletionsURL', () => {
  it('处理末尾斜杠', () => {
    expect(chatCompletionsURL('https://api.deepseek.com')).toBe('https://api.deepseek.com/chat/completions')
    expect(chatCompletionsURL('https://api.deepseek.com/')).toBe('https://api.deepseek.com/chat/completions')
    expect(chatCompletionsURL(' https://x.com/v1// ')).toBe('https://x.com/v1/chat/completions')
  })
})
