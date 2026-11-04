import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSelector, locate } from '../../src/anchor'
import { applyMigration, planMigration } from '../../src/anchor/migrate'
import { WenduDB, type DocumentRecord } from '../../src/db'
import { hashText } from '../../src/db/documents'
import { normalizeSource, renderMarkdown } from '../../src/reader/markdown'
import { TextMap } from '../../src/textmap'

const SAMPLE = normalizeSource(readFileSync(resolve(process.cwd(), 'public/samples/test.md'), 'utf8'))
const REPEATED = '查找、插入和删除的时间复杂度都是对数级别。'

function textOf(source: string): string {
  document.body.innerHTML = `<article id="r">${renderMarkdown(source)}</article>`
  return TextMap.build(document.getElementById('r')!).text
}

let n = 0
let db: WenduDB
let doc: DocumentRecord

async function addAnchor(id: string, quote: string, nth = 0) {
  const text = textOf(doc.source)
  let start = -1
  for (let i = 0; i <= nth; i++) start = text.indexOf(quote, start + 1)
  expect(start, quote).toBeGreaterThan(-1)
  await db.anchors.add({ id, docId: doc.id, docHash: doc.hash, ...createSelector(text, start, start + quote.length) })
}

beforeEach(async () => {
  db = new WenduDB(`migrate-${++n}`)
  doc = { id: 'd', title: '技术验证测试文档', source: SAMPLE, hash: await hashText(SAMPLE), importedAt: 0, lastReadAt: 0, readingPosition: null }
  await db.documents.add(doc)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
})

describe('划线迁移', () => {
  const PREFIX = '# 技术验证测试文档\n\n新版本在开头加了一段说明，后面所有位置都往后移。\n'
  const edited = (s: string) => s.replace('# 技术验证测试文档\n', PREFIX)

  it('预览不写数据库', async () => {
    await addAnchor('a', '红黑树是一种自平衡的二叉查找树')
    const before = await db.anchors.toArray()
    const plan = await planMigration(db, doc, edited(SAMPLE))
    expect(plan.moved).toHaveLength(1)
    expect(await db.anchors.toArray()).toEqual(before)
    expect((await db.documents.get('d'))!.source).toBe(SAMPLE)
  })

  it('确认后原文和锚点都更新，位置正确', async () => {
    await addAnchor('a', '红黑树是一种自平衡的二叉查找树')
    const plan = await planMigration(db, doc, edited(SAMPLE))
    await applyMigration(db, doc, plan)

    const d = (await db.documents.get('d'))!
    expect(d.source).toBe(edited(SAMPLE))
    expect(d.hash).toBe(plan.hash)
    const a = (await db.anchors.get('a'))!
    const text = textOf(d.source)
    expect(text.slice(a.start, a.end)).toBe('红黑树是一种自平衡的二叉查找树')
    expect(a.docHash).toBe(plan.hash)
    expect(locate(text, a).status).toBe('exact')
  })

  it('重复句子的第二处迁移后还是第二处', async () => {
    await addAnchor('a', REPEATED, 1)
    await applyMigration(db, doc, await planMigration(db, doc, edited(SAMPLE)))
    const text = textOf(edited(SAMPLE))
    expect((await db.anchors.get('a'))!.start).toBe(text.indexOf(REPEATED, text.indexOf(REPEATED) + 1))
  })

  it('含公式的锚点能找回', async () => {
    await addAnchor('a', '红黑树的高度满足 ￼')
    const plan = await planMigration(db, doc, edited(SAMPLE))
    expect(plan.lost).toEqual([])
    await applyMigration(db, doc, plan)
    const a = (await db.anchors.get('a'))!
    expect(textOf(edited(SAMPLE)).slice(a.start, a.end)).toBe('红黑树的高度满足 ￼')
  })

  it('Mermaid 图前后的锚点能找回', async () => {
    await addAnchor('before', '第一版按普通代码块显示')
    await addAnchor('after', '扩容时通常把容量翻倍')
    const plan = await planMigration(db, doc, edited(SAMPLE))
    expect(plan.lost).toEqual([])
    expect(plan.moved).toHaveLength(2)
  })

  it('原文被删掉的锚点找不到，数据不变', async () => {
    await addAnchor('keep', '红黑树是一种自平衡的二叉查找树')
    await addAnchor('gone', '一棵树如果不做平衡')
    const gone = await db.anchors.get('gone')
    const next = SAMPLE.replace('一棵树如果不做平衡，最坏情况下会退化成链表，此时操作的代价随节点数线性增长。\n', '')
    const plan = await planMigration(db, doc, next)
    expect(plan.moved.map((a) => a.id)).toEqual(['keep'])
    expect(plan.lost.map((a) => a.id)).toEqual(['gone'])
    await applyMigration(db, doc, plan)
    expect(await db.anchors.get('gone')).toEqual(gone)
  })

  it('划线、批注、对话不受影响', async () => {
    await addAnchor('a', '红黑树是一种自平衡的二叉查找树')
    await db.highlights.add({ id: 'h', anchorId: 'a', color: 'red', createdAt: 0 })
    await db.notes.add({ id: 'n', anchorId: 'a', text: '批注', createdAt: 0, updatedAt: 0 })
    await applyMigration(db, doc, await planMigration(db, doc, edited(SAMPLE)))
    expect((await db.highlights.get('h'))!.color).toBe('red')
    expect((await db.notes.get('n'))!.text).toBe('批注')
  })

  it('写入中途失败时全部回滚', async () => {
    await addAnchor('a', '红黑树是一种自平衡的二叉查找树')
    const before = await db.anchors.toArray()
    const plan = await planMigration(db, doc, edited(SAMPLE))
    vi.spyOn(db.anchors, 'bulkPut').mockRejectedValue(new Error('写入失败'))
    await expect(applyMigration(db, doc, plan)).rejects.toThrow('写入失败')
    expect((await db.documents.get('d'))!.source).toBe(SAMPLE)
    expect(await db.anchors.toArray()).toEqual(before)
  })

  it('内容没变时标记 unchanged；换行不同也算没变', async () => {
    expect((await planMigration(db, doc, SAMPLE)).unchanged).toBe(true)
    expect((await planMigration(db, doc, SAMPLE.replace(/\n/g, '\r\n'))).unchanged).toBe(true)
    expect((await planMigration(db, doc, edited(SAMPLE))).unchanged).toBe(false)
  })

  it('标题跟着新版本变', async () => {
    const plan = await planMigration(db, doc, SAMPLE.replace('title: 技术验证测试文档', 'title: 新标题'))
    expect(plan.title).toBe('新标题')
  })

  describe('阅读位置', () => {
    it('按原来的文字重新定位', async () => {
      const text = textOf(SAMPLE)
      const pos = text.indexOf('左旋操作的')
      await db.documents.update('d', { readingPosition: pos })
      doc.readingPosition = pos
      const plan = await planMigration(db, doc, edited(SAMPLE))
      expect(plan.readingPosition).toBe(textOf(edited(SAMPLE)).indexOf('左旋操作的'))
    })

    it('原来的文字没了就回到开头；没有记录时保持没有', async () => {
      doc.readingPosition = textOf(SAMPLE).indexOf('左旋操作的')
      expect((await planMigration(db, doc, '# 全新内容\n\n完全不同的文字。')).readingPosition).toBe(0)
      doc.readingPosition = null
      expect((await planMigration(db, doc, edited(SAMPLE))).readingPosition).toBeNull()
    })
  })
})
