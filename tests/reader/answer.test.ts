import { describe, expect, it } from 'vitest'
import { renderAnswer, splitAnswerBlocks } from '../../src/reader/answer'

describe('splitAnswerBlocks', () => {
  it('按顶层块切分，列表和代码块保持完整', () => {
    const text = '第一段。\n\n- 甲\n- 乙\n\n```python\nx = 1\n\ny = 2\n```\n\n$$\nx^2\n$$\n\n最后一段\n接着一行。'
    expect(splitAnswerBlocks(text)).toEqual(['第一段。', '- 甲\n- 乙', '```python\nx = 1\n\ny = 2\n```', '$$\nx^2\n$$', '最后一段\n接着一行。'])
  })

  it('空回答没有块', () => {
    expect(splitAnswerBlocks('')).toEqual([])
    expect(splitAnswerBlocks('  \n\n')).toEqual([])
  })
})

describe('renderAnswer', () => {
  it('原始 HTML 不会被执行', () => {
    const html = renderAnswer('<img src=x onerror=alert(1)> **粗**')
    expect(html).not.toContain('<img')
    expect(html).toContain('<strong>粗</strong>')
  })
})
