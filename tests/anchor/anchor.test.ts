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

  describe('从 v0.1.0 升级：Mermaid 源码以前按文字计入映射层', () => {
    // 把 mermaid 代码块改成普通代码块，就是 v0.1.0 看到的文本
    const OLD = SAMPLE.replace('```mermaid', '```text')
    const pick = (text: string, s: string) => {
      const start = text.indexOf(s)
      expect(start).toBeGreaterThan(-1)
      return createSelector(text, start, start + s.length)
    }

    it('图前、图后、紧挨着图的锚点都能找回', () => {
      const oldText = sampleText(OLD)
      const newText = sampleText()
      expect(oldText).not.toBe(newText)
      for (const s of ['扩容时通常把容量翻倍', '第一版按普通代码块显示', '这一段用来测试跨段落选区']) {
        const r = locate(newText, pick(oldText, s))
        expect(r.status, s).not.toBe('orphan')
        if (r.status !== 'orphan') expect(newText.slice(r.start, r.end)).toBe(s)
      }
    })

    it('落在 Mermaid 代码内部的锚点变成孤立，不报错、不改数据', () => {
      const sel = pick(sampleText(OLD), '父、叔染黑，祖父染红')
      const quote = sel.quote
      expect(locate(sampleText(), sel)).toEqual({ status: 'orphan' })
      expect(sel.quote).toBe(quote)
    })
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
