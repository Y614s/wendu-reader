import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSelector, locate } from '../../src/anchor'
import { normalizeSource, renderMarkdown } from '../../src/reader/markdown'
import { TextMap } from '../../src/textmap'

const SAMPLE = normalizeSource(readFileSync(resolve(process.cwd(), 'public/samples/test.md'), 'utf8'))
const REPEATED = '查找、插入和删除的时间复杂度都是对数级别。'

function sampleText(source = SAMPLE): string {
  document.body.innerHTML = `<article id="root">${renderMarkdown(source)}</article>`
  return TextMap.build(document.getElementById('root')!).text
}

describe('锚点重新定位', () => {
  it('测试文档里确实有重复句子', () => {
    const text = sampleText()
    const first = text.indexOf(REPEATED)
    expect(first).toBeGreaterThan(-1)
    expect(text.indexOf(REPEATED, first + 1)).toBeGreaterThan(first)
  })

  it('位置未变时直接命中', () => {
    const text = sampleText()
    const start = text.indexOf(REPEATED)
    const sel = createSelector(text, start, start + REPEATED.length)
    expect(locate(text, sel)).toEqual({ status: 'exact', start, end: start + REPEATED.length })
  })

  it('文档前面插入内容后，靠前后文找回重复句子中的第二处', () => {
    const text = sampleText()
    const second = text.indexOf(REPEATED, text.indexOf(REPEATED) + 1)
    const sel = createSelector(text, second, second + REPEATED.length)

    const edited = sampleText(SAMPLE.replace('# 技术验证测试文档', '# 技术验证测试文档\n\n新加的一段开头说明，让后面所有位置都往后移。'))
    const result = locate(edited, sel)
    const expected = edited.indexOf(REPEATED, edited.indexOf(REPEATED) + 1)
    expect(result).toEqual({ status: 'moved', start: expected, end: expected + REPEATED.length })
  })

  it('原位置被别的重复句子占据时，仍按前后文选中正确的那一处', () => {
    const text = sampleText()
    const first = text.indexOf(REPEATED)
    const sel = createSelector(text, first, first + REPEATED.length)
    // 删掉第 1 节里重复句子之前的一段，第一处前移；偏移恰好让原位置落在别处
    const edited = sampleText(SAMPLE.replace('红黑树是一种自平衡的二叉查找树。它在每个节点上多存一位颜色信息，用颜色规则限制树的高度。\n\n', ''))
    const result = locate(edited, sel)
    expect(result.status).toBe('moved')
    if (result.status !== 'orphan') {
      expect(edited.slice(result.start, result.end)).toBe(REPEATED)
      expect(edited.slice(result.end, result.end + 10)).toBe(text.slice(first + REPEATED.length, first + REPEATED.length + 10))
    }
  })

  it('原文被改掉时标记为孤立，不报错', () => {
    const text = sampleText()
    const start = text.indexOf(REPEATED)
    const sel = createSelector(text, start, start + REPEATED.length)
    const edited = sampleText(SAMPLE.split(REPEATED).join('复杂度是对数级。'))
    expect(locate(edited, sel)).toEqual({ status: 'orphan' })
  })

  it('前后文各存 32 个字符', () => {
    const text = sampleText()
    const start = text.indexOf(REPEATED)
    const sel = createSelector(text, start, start + REPEATED.length)
    expect(sel.prefix).toHaveLength(32)
    expect(sel.suffix).toHaveLength(32)
    expect(sel.quote).toBe(REPEATED)
  })
})
