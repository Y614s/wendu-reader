import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportMarkdown, type ExportInput } from '../../src/export/markdown'
import { normalizeSource, renderMarkdown } from '../../src/reader/markdown'
import { collectHeadings } from '../../src/reader/outline'
import { TextMap } from '../../src/textmap'
import type { ConversationRecord, NoteRecord } from '../../src/db'

const SAMPLE = normalizeSource(readFileSync(resolve(process.cwd(), 'public/samples/test.md'), 'utf8'))
const T = new Date(2026, 10, 3, 10, 0).getTime()

function setup() {
  document.body.innerHTML = `<article id="root">${renderMarkdown(SAMPLE)}</article>`
  const map = TextMap.build(document.getElementById('root')!)
  const sections = collectHeadings(map)
    .filter((h) => h.level === 2)
    .map((h) => ({ title: h.title, pos: h.pos }))
  const at = (s: string, nth = 0) => {
    let i = -1
    for (let k = 0; k <= nth; k++) i = map.text.indexOf(s, i + 1)
    return { start: i, end: i + s.length }
  }
  return { map, sections, at }
}

const note = (id: string, anchorId: string, text: string, source?: 'annotation' | 'ai'): NoteRecord => ({
  id,
  anchorId,
  text,
  source,
  createdAt: T,
  updatedAt: T,
})

const conv = (over: Partial<ConversationRecord>): ConversationRecord => ({
  id: 'c',
  docId: 'd',
  anchorId: null,
  kind: 'sidebar',
  status: 'done',
  messages: [],
  provider: 'DeepSeek',
  model: '',
  createdAt: T,
  ...over,
})

describe('导出 md', () => {
  it('与预期样例逐字一致', () => {
    const { map, sections, at } = setup()
    const formula = at('红黑树的高度满足 ￼')
    const repeated = at('查找、插入和删除的时间复杂度都是对数级别。', 1)
    const display = map.segments.find((s) => s.kind === 'math' && s.display)! // 第 3 节的公式块
    const block = { start: display.start, end: display.end }
    const plain = at('红黑树是一种自平衡的二叉查找树。')

    const input: ExportInput = {
      title: '技术验证测试文档',
      source: '技术验证测试文档.md',
      date: '2026-11-03',
      sections,
      anchors: [
        { id: 'a1', start: plain.start, quote: map.textWithTex(plain.start, plain.end), highlighted: true },
        { id: 'a2', start: formula.start, quote: map.textWithTex(formula.start, formula.end), highlighted: false },
        { id: 'a3', start: repeated.start, quote: map.textWithTex(repeated.start, repeated.end), highlighted: true },
        { id: 'a4', start: block.start, quote: map.textWithTex(block.start, block.end), highlighted: false },
        { id: 'a5', start: plain.start + 2, quote: '只建了锚点、什么都没有', highlighted: false },
      ],
      orphans: [
        { id: 'o1', quote: '被删掉的一句话', highlighted: false },
        { id: 'o2', quote: '什么都没留下的空锚点', highlighted: false },
      ],
      notes: [
        note('n1', 'a1', '和 AVL 树比，旋转更少。'),
        note('n2', 'a2', '树高是对数级。', 'ai'),
        note('n3', 'o1', '原文改掉了'),
      ],
      conversations: [
        conv({
          id: 'c1',
          anchorId: 'a2',
          messages: [
            { role: 'user', content: '（带上下文的完整内容）', display: '为什么树高上界是这个数？', createdAt: T },
            { role: 'assistant', content: '因为黑高至少是树高的一半。\n\n所以 $h \\le 2\\log_2(n+1)$。', createdAt: T },
          ],
        }),
        conv({ id: 'c2', anchorId: 'a3', kind: 'external', status: 'pending', messages: [{ role: 'user', content: '分享的内容', createdAt: T }] }),
        conv({
          id: 'c3',
          anchorId: 'a4',
          kind: 'external',
          provider: 'Claude',
          messages: [
            { role: 'user', content: '分享的内容', createdAt: T },
            { role: 'assistant', content: '这是归纳法的结论。', createdAt: T },
          ],
        }),
        conv({
          id: 'c4',
          anchorId: null,
          messages: [
            { role: 'user', content: '这篇和 AVL 树那篇的主要区别是什么？', createdAt: T },
            { role: 'assistant', content: '红黑树平衡更宽松。', createdAt: T },
          ],
        }),
      ],
    }

    expect(exportMarkdown(input)).toBe(`---
title: 技术验证测试文档 · 笔记
source: 技术验证测试文档.md
exported: 2026-11-03
---

# 技术验证测试文档 · 笔记

## 1. 普通段落与重复句子

> 红黑树是一种自平衡的二叉查找树。

**批注**：和 AVL 树比，旋转更少。

## 2. 行内公式

> 红黑树的高度满足 $h \\le 2\\log_2(n+1)$

**AI 回答摘录**：树高是对数级。

**问答**（侧栏问 · DeepSeek · 2026-11-03）

- 问：为什么树高上界是这个数？
- 答：因为黑高至少是树高的一半。

  所以 $h \\le 2\\log_2(n+1)$。

## 3. 公式块

> $$n(x) \\ge 2^{bh(x)} - 1$$

**问答**（发到 App · Claude · 2026-11-03）

- 答：这是归纳法的结论。

> 查找、插入和删除的时间复杂度都是对数级别。

**待补充**（发到 App）：问题已发出，回答还没填。

## 原文已找不到的笔记

文档改动后，下面这些笔记对应的原文已经找不到了。

> 被删掉的一句话

**批注**：原文改掉了

## 整篇提问

- 问：这篇和 AVL 树那篇的主要区别是什么？
- 答：红黑树平衡更宽松。
`)
  })

  it('没有任何笔记时只有标题', () => {
    const out = exportMarkdown({ title: '空', source: '空.md', date: '2026-11-03', sections: [], anchors: [], orphans: [], notes: [], conversations: [] })
    expect(out).toBe('---\ntitle: 空 · 笔记\nsource: 空.md\nexported: 2026-11-03\n---\n\n# 空 · 笔记\n')
  })

  it('多行原文每行都加引用符号，空行保留为 >', () => {
    const out = exportMarkdown({
      title: 't',
      source: 't.md',
      date: '2026-11-03',
      sections: [],
      anchors: [{ id: 'a', start: 0, quote: '第一行\n\n第三行', highlighted: true }],
      orphans: [],
      notes: [],
      conversations: [],
    })
    expect(out).toContain('> 第一行\n>\n> 第三行')
  })
})

describe('导出 md 的边界情况', () => {
  const base: ExportInput = { title: 't', source: 't.md', date: '2026-11-03', sections: [], anchors: [], orphans: [], notes: [], conversations: [] }

  it('失败的提问不导出，不留下只有「问」的记录', () => {
    const out = exportMarkdown({
      ...base,
      anchors: [{ id: 'a', start: 0, quote: '原文', highlighted: false }],
      conversations: [
        conv({
          anchorId: 'a',
          messages: [
            { role: 'user', content: '失败的问', createdAt: T },
            { role: 'assistant', content: '', error: '网络不通', createdAt: T },
            { role: 'user', content: '成功的问', createdAt: T },
            { role: 'assistant', content: '成功的答', createdAt: T },
          ],
        }),
        conv({ id: 'c2', anchorId: null, messages: [{ role: 'user', content: '整篇也失败了', createdAt: T }] }),
      ],
    })
    expect(out).not.toContain('失败的问')
    expect(out).toContain('- 问：成功的问\n- 答：成功的答')
    expect(out).not.toContain('整篇提问')
  })

  it('全部失败的对话和空锚点一起不导出', () => {
    const out = exportMarkdown({
      ...base,
      anchors: [{ id: 'a', start: 0, quote: '原文', highlighted: false }],
      orphans: [{ id: 'o', quote: '孤立的空锚点', highlighted: false }],
      conversations: [conv({ anchorId: 'a', messages: [{ role: 'user', content: '问', createdAt: T }] })],
    })
    expect(out).not.toContain('原文')
    expect(out).not.toContain('原文已找不到')
  })

  it('标题里有冒号等特殊字符时，YAML 加引号', () => {
    const out = exportMarkdown({ ...base, title: '红黑树: 性质', source: '红黑树: 性质.md' })
    expect(out).toContain('title: "红黑树: 性质 · 笔记"\nsource: "红黑树: 性质.md"')
  })

  it('多行或块级的笔记另起一行，不接在标签后面', () => {
    const out = exportMarkdown({
      ...base,
      anchors: [{ id: 'a', start: 0, quote: '原文', highlighted: true }],
      notes: [
        note('n1', 'a', '```python\nx = 1\n```', 'ai'),
        note('n2', 'a', '- 甲\n- 乙', 'ai'),
        note('n3', 'a', '一行就够了'),
      ],
    })
    expect(out).toContain('**AI 回答摘录**：\n\n```python\nx = 1\n```')
    expect(out).toContain('**AI 回答摘录**：\n\n- 甲\n- 乙')
    expect(out).toContain('**批注**：一行就够了')
  })
})
