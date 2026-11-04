import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_BYTES, isLikelyMarkdown, isTooLarge } from '../../src/platform/incoming'
import { baseURLProblem, chatCompletionsURL } from '../../src/ai/providers'

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

describe('isTooLarge', () => {
  it('上限是 5 MB，正好 5 MB 可以导入', () => {
    expect(MAX_IMPORT_BYTES).toBe(5 * 1024 * 1024)
    expect(isTooLarge(MAX_IMPORT_BYTES)).toBe(false)
    expect(isTooLarge(MAX_IMPORT_BYTES + 1)).toBe(true)
  })
})

describe('baseURLProblem', () => {
  it('https 和本机 http 可以用', () => {
    for (const u of ['https://api.deepseek.com', 'https://x.com/v1/', 'http://localhost:11434/v1', 'http://127.0.0.1:8000']) {
      expect(baseURLProblem(u), u).toBeNull()
    }
  })

  it('所有内置预设都能通过，只有占位符要用户替换', () => {
    expect(baseURLProblem('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBeNull()
    expect(baseURLProblem('https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')).toMatch(/占位符/)
  })

  it('明文 http、其他协议、带账号密码、格式不对的地址都拒绝', () => {
    expect(baseURLProblem('http://attacker.example/v1')).toMatch(/https/)
    expect(baseURLProblem('ftp://x.com')).toMatch(/https/)
    expect(baseURLProblem('https://user:pass@x.com')).toMatch(/用户名/)
    expect(baseURLProblem('api.deepseek.com')).toMatch(/格式不对/)
    expect(baseURLProblem('')).toMatch(/没填好/)
  })
})

describe('chatCompletionsURL', () => {
  it('处理末尾斜杠', () => {
    expect(chatCompletionsURL('https://api.deepseek.com')).toBe('https://api.deepseek.com/chat/completions')
    expect(chatCompletionsURL('https://api.deepseek.com/')).toBe('https://api.deepseek.com/chat/completions')
    expect(chatCompletionsURL(' https://x.com/v1// ')).toBe('https://x.com/v1/chat/completions')
  })
})
