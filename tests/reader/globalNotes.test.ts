import { describe, expect, it } from 'vitest'
import { buildGlobalEntries, filterEntries, groupByDoc, isAnswered, questionEntries, type GlobalData } from '../../src/reader/globalNotes'
import type { ConversationRecord, DocumentRecord } from '../../src/db'

const doc = (id: string, title: string, tags: string[], lastReadAt: number): DocumentRecord => ({
  id,
  title,
  source: `---\ntags: [${tags.join(', ')}]\n---\n\n# ${title}`,
  hash: 'h',
  importedAt: 0,
  lastReadAt,
  readingPosition: null,
})
const anchor = (id: string, docId: string, start: number, quote: string) => ({ id, docId, docHash: 'h', quote, prefix: '', suffix: '', start, end: start + quote.length })
const hl = (anchorId: string, color: string) => ({ id: 'h' + anchorId, anchorId, color, createdAt: 0 })
const note = (anchorId: string, text: string) => ({ id: 'n' + anchorId, anchorId, text, createdAt: 0, updatedAt: 0 })
const conv = (id: string, anchorId: string, over: Partial<ConversationRecord> = {}): ConversationRecord => ({
  id,
  docId: 'a',
  anchorId,
  kind: 'sidebar',
  status: 'done',
  messages: [
    { role: 'user', content: '什么是黑高', createdAt: 0 },
    { role: 'assistant', content: '路径上的黑色节点数', createdAt: 0 },
  ],
  provider: 'p',
  model: 'm',
  createdAt: 0,
  ...over,
})

const data: GlobalData = {
  documents: [doc('a', '红黑树', ['数据结构', '树'], 1), doc('b', '哈希表', ['数据结构'], 2)],
  anchors: [
    anchor('a2', 'a', 50, '后面一句'),
    anchor('a1', 'a', 10, '含公式 ￼ 的一句'),
    anchor('b1', 'b', 5, '哈希冲突'),
    anchor('empty', 'b', 9, '什么都没留下'),
    anchor('gone', 'missing', 0, '文档已删除'),
  ],
  highlights: [hl('a1', 'red'), hl('a2', 'blue'), hl('gone', 'red')],
  notes: [note('b1', '链地址法')],
  conversations: [conv('c1', 'a1')],
}

const all = () => buildGlobalEntries(data)
const ids = (es: { anchorId: string }[]) => es.map((e) => e.anchorId)
const none = { colors: [], tag: null, keyword: '' }

describe('buildGlobalEntries', () => {
  it('只留有内容的锚点，跳过已删除文档的', () => {
    expect(ids(all()).sort()).toEqual(['a1', 'a2', 'b1'])
  })

  it('文档按最近阅读排，同一篇按原文顺序', () => {
    expect(ids(all())).toEqual(['b1', 'a1', 'a2'])
  })

  it('公式占位符显示为 [公式]，标签来自文档', () => {
    const e = all().find((x) => x.anchorId === 'a1')!
    expect(e.quote).toBe('含公式 [公式] 的一句')
    expect(e.tags).toEqual(['数据结构', '树'])
  })

  it('不认识的颜色按黄色', () => {
    const es = buildGlobalEntries({ ...data, highlights: [hl('a1', 'purple')] })
    expect(es.find((x) => x.anchorId === 'a1')!.color).toBe('yellow')
  })
})

describe('filterEntries', () => {
  it('空条件返回全部', () => {
    expect(filterEntries(all(), none)).toHaveLength(3)
  })

  it('按颜色，可以多选', () => {
    expect(ids(filterEntries(all(), { ...none, colors: ['red'] }))).toEqual(['a1'])
    expect(ids(filterEntries(all(), { ...none, colors: ['red', 'blue'] }))).toEqual(['a1', 'a2'])
  })

  it('按标签', () => {
    expect(ids(filterEntries(all(), { ...none, tag: '树' }))).toEqual(['a1', 'a2'])
  })

  it('关键词搜原文、批注和问答，忽略大小写和首尾空格', () => {
    expect(ids(filterEntries(all(), { ...none, keyword: '后面' }))).toEqual(['a2'])
    expect(ids(filterEntries(all(), { ...none, keyword: ' 链地址 ' }))).toEqual(['b1'])
    expect(ids(filterEntries(all(), { ...none, keyword: '黑色节点' }))).toEqual(['a1'])
    expect(filterEntries(all(), { ...none, keyword: '不存在' })).toEqual([])
  })

  it('条件叠加', () => {
    expect(ids(filterEntries(all(), { colors: ['blue'], tag: '树', keyword: '后面' }))).toEqual(['a2'])
    expect(filterEntries(all(), { colors: ['red'], tag: '树', keyword: '后面' })).toEqual([])
  })
})

describe('groupByDoc', () => {
  it('同一篇文档归到一组', () => {
    expect(groupByDoc(all()).map((g) => [g.docTitle, g.entries.length])).toEqual([
      ['哈希表', 1],
      ['红黑树', 2],
    ])
  })
})

describe('疑问清单', () => {
  it('只含红色划线', () => {
    expect(ids(questionEntries(all()))).toEqual(['a1'])
  })

  it('只有批注、没有划线的不算', () => {
    expect(questionEntries(buildGlobalEntries({ ...data, highlights: [] }))).toEqual([])
  })

  it('标出问过和没问过的；失败的提问和待补充都不算问过', () => {
    const base = all().find((x) => x.anchorId === 'a1')!
    expect(isAnswered(base)).toBe(true)
    expect(isAnswered({ ...base, convs: [] })).toBe(false)
    const failed = conv('f', 'a1', {
      messages: [
        { role: 'user', content: '问', createdAt: 0 },
        { role: 'assistant', content: '', error: '网络不通', createdAt: 0 },
      ],
    })
    expect(isAnswered({ ...base, convs: [failed] })).toBe(false)
    expect(isAnswered({ ...base, convs: [conv('p', 'a1', { kind: 'external', status: 'pending' })] })).toBe(false)
  })
})
