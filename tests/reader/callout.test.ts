import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/reader/markdown'
import { TextMap } from '../../src/textmap'

function mount(md: string): HTMLElement {
  document.body.innerHTML = `<article id="root">${renderMarkdown(md)}</article>`
  return document.getElementById('root')!
}

describe('Obsidian 提示块', () => {
  it('类型、标题、内容正确', () => {
    const root = mount('> [!tip] 一句话记住\n> 红黑树用颜色规则换来了近似平衡。')
    const bq = root.querySelector('blockquote')!
    expect(bq.classList.contains('callout')).toBe(true)
    expect(bq.classList.contains('callout-tip')).toBe(true)
    expect(bq.querySelector('.callout-title')!.textContent).toBe('一句话记住')
    expect(bq.querySelector('p')!.textContent).toBe('红黑树用颜色规则换来了近似平衡。')
    expect(bq.textContent).not.toContain('[!tip]')
  })

  it('没写标题时用类型的默认名称，大小写不敏感', () => {
    const root = mount('> [!WARNING]\n> 删除最容易写错。')
    expect(root.querySelector('.callout-warning .callout-title')!.textContent).toBe('注意')
  })

  it('只有标题没有正文', () => {
    const root = mount('> [!note] 只是一个标题')
    const bq = root.querySelector('blockquote')!
    expect(bq.querySelector('.callout-title')!.textContent).toBe('只是一个标题')
    expect(bq.querySelector('p')).toBeNull()
  })

  it('普通引用块不受影响', () => {
    const root = mount('> 普通引用 [!tip] 不在开头')
    expect(root.querySelector('blockquote')!.classList.contains('callout')).toBe(false)
  })

  it('标题里的特殊字符会被转义', () => {
    const root = mount('> [!note] <b>粗</b>\n> 正文')
    expect(root.querySelector('.callout-title')!.innerHTML).toBe('&lt;b&gt;粗&lt;/b&gt;')
  })

  it('文本映射层能拼出提示块里的文字，标题和正文分行', () => {
    const root = mount('前文。\n\n> [!tip] 一句话\n> 正文含 $h$ 公式。\n\n后文。')
    expect(TextMap.build(root).text).toBe('前文。\n一句话\n正文含 ￼ 公式。\n后文。')
  })
})
