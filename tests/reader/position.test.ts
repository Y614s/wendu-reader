import { describe, expect, it } from 'vitest'
import { clampPosition, progressOf, scrollTopFor } from '../../src/reader/position'
import { collectHeadings, headingAt, sectionStarts } from '../../src/reader/outline'
import { renderMarkdown } from '../../src/reader/markdown'
import { TextMap } from '../../src/textmap'

describe('阅读位置', () => {
  it('没有记录时返回 null', () => {
    expect(clampPosition(null, 100)).toBeNull()
    expect(clampPosition(undefined, 100)).toBeNull()
    expect(clampPosition(Number.NaN, 100)).toBeNull()
  })

  it('文档变短后位置越界：夹到最后一个字符', () => {
    expect(clampPosition(500, 100)).toBe(99)
    expect(clampPosition(-3, 100)).toBe(0)
    expect(clampPosition(42.7, 100)).toBe(42)
  })

  it('空文档没有位置', () => {
    expect(clampPosition(0, 0)).toBeNull()
  })

  it('目标元素滚到容器顶部所需的 scrollTop', () => {
    // 容器顶部在视口 100px，目标在视口 700px，当前已滚动 300px
    expect(scrollTopFor(300, 700, 100, 12)).toBe(888)
    // 目标在容器上方
    expect(scrollTopFor(300, 50, 100, 12)).toBe(238)
    expect(scrollTopFor(0, 50, 100, 12)).toBe(0)
  })

  it('阅读进度', () => {
    expect(progressOf(0, 2000, 1000)).toBe(0)
    expect(progressOf(500, 2000, 1000)).toBe(0.5)
    expect(progressOf(1000, 2000, 1000)).toBe(1)
    expect(progressOf(0, 800, 1000)).toBe(1)
  })
})

describe('文档大纲', () => {
  const md = '# 标题\n\n导言。\n\n## 1. 第一节\n\n甲。\n\n### 1.1 小节\n\n乙。\n\n## 2. 第二节\n\n丙。'

  function build() {
    document.body.innerHTML = `<article id="root">${renderMarkdown(md)}</article>`
    return TextMap.build(document.getElementById('root')!)
  }

  it('标题位置与映射层一致', () => {
    const map = build()
    const hs = collectHeadings(map)
    expect(hs.map((h) => [h.level, h.title])).toEqual([
      [1, '标题'],
      [2, '1. 第一节'],
      [3, '1.1 小节'],
      [2, '2. 第二节'],
    ])
    for (const h of hs) expect(map.text.slice(h.pos, h.pos + h.title.length)).toBe(h.title)
  })

  it('按一、二级标题分节，三级标题不单独成节', () => {
    const map = build()
    const starts = sectionStarts(collectHeadings(map))
    expect(starts).toEqual([0, map.text.indexOf('1. 第一节'), map.text.indexOf('2. 第二节')])
  })

  it('找到位置所在的标题', () => {
    const map = build()
    const hs = collectHeadings(map)
    expect(headingAt(hs, map.text.indexOf('乙'))!.title).toBe('1.1 小节')
    expect(headingAt(hs, map.text.indexOf('乙'), 2)!.title).toBe('1. 第一节')
    expect(headingAt(hs, map.text.indexOf('丙'))!.title).toBe('2. 第二节')
  })
})
