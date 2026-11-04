import { describe, expect, it } from 'vitest'
import { hitTest, paint, type PaintItem } from '../../src/highlight'
import { renderMarkdown } from '../../src/reader/markdown'
import { TextMap } from '../../src/textmap'

function mount(md: string): HTMLElement {
  document.body.innerHTML = `<article id="root">${renderMarkdown(md)}</article>`
  return document.getElementById('root')!
}

const MD = '红黑树是**自平衡**的二叉查找树，高度 $h$ 有上界。\n\n第二段文字。'

describe('mark 回退', () => {
  it('包裹后映射层文字不变，mark 里正好是划线的文字', () => {
    const root = mount(MD)
    const before = TextMap.build(root).text
    const start = before.indexOf('自平衡')
    const end = before.indexOf('二叉') + 2
    const map = paint(root, [{ anchorId: 'a', start, end, kind: 'highlight' }], 'mark')
    expect(map.text).toBe(before)
    const marks = Array.from(root.querySelectorAll('mark.wendu-hl'))
    expect(marks.map((m) => m.textContent).join('')).toBe('自平衡的二叉')
  })

  it('公式整体加上划线样式，不拆进公式内部', () => {
    const root = mount(MD)
    const text = TextMap.build(root).text
    const start = text.indexOf('高度')
    const end = text.indexOf('有上界') + 3
    paint(root, [{ anchorId: 'a', start, end, kind: 'highlight' }], 'mark')
    expect(root.querySelector('.katex')!.classList.contains('wendu-hl')).toBe(true)
    expect(root.querySelector('.katex mark')).toBeNull()
  })

  it('跨段落和重叠的划线都能画出；重画时先清掉旧的', () => {
    const root = mount(MD)
    const text = TextMap.build(root).text
    const items: PaintItem[] = [
      { anchorId: 'a', start: text.indexOf('上界'), end: text.indexOf('第二段') + 3, kind: 'highlight' },
      { anchorId: 'b', start: text.indexOf('有上界'), end: text.indexOf('有上界') + 3, kind: 'ask' },
    ]
    let map = paint(root, items, 'mark')
    expect(map.text).toBe(text)
    expect(root.querySelectorAll('mark.wendu-ask').length).toBeGreaterThan(0)

    map = paint(root, [], 'mark')
    expect(root.querySelector('mark')).toBeNull()
    expect(root.querySelector('.wendu-hl')).toBeNull()
    expect(map.text).toBe(text)
  })
})

describe('搜索高亮的 mark 回退', () => {
  it('和划线用不同的 class，清除搜索不动划线', () => {
    const root = mount(MD)
    const text = TextMap.build(root).text
    const hl: PaintItem = { anchorId: 'a', start: text.indexOf('自平衡'), end: text.indexOf('自平衡') + 3, kind: 'highlight' }
    const search: PaintItem = { anchorId: '', start: text.indexOf('二叉'), end: text.indexOf('二叉') + 2, kind: 'search' }
    const current: PaintItem = { anchorId: '', start: text.indexOf('第二段'), end: text.indexOf('第二段') + 3, kind: 'searchCurrent' }

    paint(root, [hl, search, current], 'mark')
    expect(root.querySelector('mark.wendu-search')!.textContent).toBe('二叉')
    expect(root.querySelector('mark.wendu-search-cur')!.textContent).toBe('第二段')

    const map = paint(root, [hl], 'mark')
    expect(root.querySelector('mark.wendu-search')).toBeNull()
    expect(root.querySelector('mark.wendu-search-cur')).toBeNull()
    expect(root.querySelector('mark.wendu-hl')!.textContent).toBe('自平衡')
    expect(map.text).toBe(text)
  })
})

describe('hitTest', () => {
  it('返回包含该位置的所有锚点', () => {
    const items: PaintItem[] = [
      { anchorId: 'a', start: 0, end: 10, kind: 'highlight' },
      { anchorId: 'b', start: 5, end: 20, kind: 'ask' },
      { anchorId: 'c', start: 30, end: 40, kind: 'highlight' },
    ]
    expect(hitTest(items, 7).map((i) => i.anchorId)).toEqual(['a', 'b'])
    expect(hitTest(items, 25)).toEqual([])
  })
})
