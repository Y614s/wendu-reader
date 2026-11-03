import { beforeEach, describe, expect, it } from 'vitest'
import { MATH_CHAR, TextMap } from '../../src/textmap'
import { renderMarkdown } from '../../src/reader/markdown'

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<article id="root">${html}</article>`
  return document.getElementById('root')!
}

function mountMd(md: string): HTMLElement {
  return mount(renderMarkdown(md))
}

describe('TextMap 基本规则', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('块级元素之间补一个换行，不压缩其他空白', () => {
    const root = mountMd('# 标题\n\n第一段  两个空格。\n\n- 甲\n- 乙\n')
    const map = TextMap.build(root)
    expect(map.text).toBe('标题\n第一段  两个空格。\n甲\n乙')
  })

  it('每个公式只占 1 个字符，不读 katex 内部文字', () => {
    const root = mountMd('高度 $h \\le 2\\log_2(n+1)$ 成立')
    const map = TextMap.build(root)
    expect(map.text).toBe(`高度 ${MATH_CHAR} 成立`)
    expect(map.segments.filter((s) => s.kind === 'math')).toHaveLength(1)
  })

  it('公式块单独成行，同样只占 1 个字符', () => {
    const root = mountMd('前文：\n\n$$\nn(x) \\ge 2^{bh(x)} - 1\n$$\n\n后文。')
    const map = TextMap.build(root)
    expect(map.text).toBe(`前文：\n${MATH_CHAR}\n后文。`)
  })

  it('textWithTex 把公式换回原始 TeX', () => {
    const root = mountMd('设 $\\alpha = n/m$。\n\n$$\nx^2\n$$')
    const map = TextMap.build(root)
    expect(map.textWithTex(0, map.text.length)).toBe('设 $\\alpha = n/m$。\n$$x^2$$')
  })
})

describe('TextMap 双向转换', () => {
  it('纯文本位置 → DOM → 纯文本位置可逆', () => {
    const root = mountMd('# 标题\n\n红黑树 $h$ 是**自平衡**的。\n\n第二段 `code` 结束。')
    const map = TextMap.build(root)
    for (let pos = 0; pos <= map.text.length; pos++) {
      if (map.text[pos - 1] === '\n' || map.text[pos] === '\n') continue
      for (const side of ['start', 'end'] as const) {
        const p = map.toDom(pos, side)
        expect(map.fromDom(p.node, p.offset, side).pos, `pos=${pos} side=${side}`).toBe(pos)
      }
    }
  })

  it('toRange 得到的 DOM 文字与映射层文字一致', () => {
    const root = mountMd('红黑树是一种**自平衡**的二叉查找树。\n\n第二段文字。')
    const map = TextMap.build(root)
    const start = map.text.indexOf('自平衡')
    const end = map.text.indexOf('第二段') + 3
    const range = map.toRange(start, end)
    expect(range.toString().replace(/\n/g, '')).toBe(map.text.slice(start, end).replace(/\n/g, ''))
    expect(map.fromRange(range)).toEqual({ start, end, expanded: false })
  })

  it('元素边界的 DOM 位置也能转换', () => {
    const root = mount('<p>甲乙</p><p>丙丁</p>')
    const map = TextMap.build(root)
    expect(map.text).toBe('甲乙\n丙丁')
    expect(map.fromDom(root, 1, 'start').pos).toBe(3) // 第二个 <p> 之前
    expect(map.fromDom(root, 2, 'end').pos).toBe(5) // 末尾
    expect(map.fromDom(root.children[0], 1, 'end').pos).toBe(2) // 第一个 <p> 末尾
  })
})

describe('TextMap 公式选区', () => {
  const md = '高度满足 $h \\le 2\\log_2(n+1)$，其中 $n$ 是节点数。'

  function katexText(root: Element, index: number): Text {
    const el = root.querySelectorAll('.katex')[index]
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    return nodes[Math.floor(nodes.length / 2)]
  }

  it('只选公式内部：扩展到整个公式', () => {
    const root = mountMd(md)
    const map = TextMap.build(root)
    const inner = katexText(root, 0)
    const range = document.createRange()
    range.setStart(inner, 0)
    range.setEnd(inner, inner.data.length)
    const r = map.fromRange(range)!
    expect(r.expanded).toBe(true)
    expect(map.text.slice(r.start, r.end)).toBe(MATH_CHAR)
    expect(map.textWithTex(r.start, r.end)).toBe('$h \\le 2\\log_2(n+1)$')
  })

  it('从公式前选到公式后：公式整体计入，不扩展', () => {
    const root = mountMd(md)
    const map = TextMap.build(root)
    const start = map.text.indexOf('满足')
    const end = map.text.indexOf('，其中') + 1
    const r = map.fromRange(map.toRange(start, end))!
    expect(r).toEqual({ start, end, expanded: false })
    expect(map.textWithTex(r.start, r.end)).toBe('满足 $h \\le 2\\log_2(n+1)$，')
  })

  it('一端在公式内部、另一端在正文：只扩展那一端', () => {
    const root = mountMd(md)
    const map = TextMap.build(root)
    const range = document.createRange()
    const p = root.querySelector('p')!
    range.setStart(p.firstChild!, 0)
    range.setEnd(katexText(root, 1), 0)
    const r = map.fromRange(range)!
    expect(r.expanded).toBe(true)
    expect(map.textWithTex(r.start, r.end)).toBe('高度满足 $h \\le 2\\log_2(n+1)$，其中 $n$')
  })

  it('含公式块的段落整体选中', () => {
    const root = mountMd('前文。\n\n$$\nn(x) \\ge 2^{bh(x)} - 1\n$$\n\n后文。')
    const map = TextMap.build(root)
    const r = map.fromRange(map.toRange(0, map.text.length))!
    expect(map.textWithTex(r.start, r.end)).toBe('前文。\n$$n(x) \\ge 2^{bh(x)} - 1$$\n后文。')
  })
})
