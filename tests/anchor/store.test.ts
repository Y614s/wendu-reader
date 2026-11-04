import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/db'
import { addHighlight, addNote, deleteAnchorIfUnused, removeHighlightAndNotes, saveAnchor, setHighlightColor } from '../../src/anchor/store'

const doc = { id: 'd', title: 't', source: '', hash: 'h', importedAt: 0, lastReadAt: 0, readingPosition: null }

beforeEach(async () => {
  await Promise.all([db.anchors.clear(), db.highlights.clear(), db.notes.clear(), db.conversations.clear()])
})

describe('划线颜色', () => {
  it('默认黄色，可以指定颜色', async () => {
    const a = await saveAnchor(doc, '红黑树', 0, 3)
    expect((await addHighlight(a.id)).color).toBe('yellow')
    expect((await addHighlight(a.id, 'red')).color).toBe('red')
  })

  it('改颜色只改划线；只有批注的锚点补一条划线', async () => {
    const a = await saveAnchor(doc, '红黑树', 0, 3)
    await addHighlight(a.id)
    await setHighlightColor(a.id, 'blue')
    expect((await db.highlights.toArray()).map((h) => h.color)).toEqual(['blue'])

    const b = await saveAnchor(doc, '红黑树', 0, 2)
    await addNote(b.id, '批注', 'annotation')
    await setHighlightColor(b.id, 'green')
    expect(await db.highlights.where('anchorId').equals(b.id).count()).toBe(1)
    expect((await db.notes.toArray()).map((n) => n.text)).toEqual(['批注'])
  })
})

describe('删除划线与清理锚点', () => {
  it('删除划线时一起删掉批注和笔记，锚点空了也删掉', async () => {
    const a = await saveAnchor(doc, '红黑树是一种自平衡的二叉查找树。', 0, 3)
    await addHighlight(a.id)
    await addNote(a.id, '批注', 'annotation')
    await addNote(a.id, 'AI 摘录', 'ai')
    await removeHighlightAndNotes(a.id)
    expect(await db.highlights.count()).toBe(0)
    expect(await db.notes.count()).toBe(0)
    expect(await db.anchors.get(a.id)).toBeUndefined()
  })

  it('锚点上还有对话时保留锚点', async () => {
    const a = await saveAnchor(doc, '红黑树', 0, 3)
    await addHighlight(a.id)
    await db.conversations.add({
      id: 'c',
      docId: 'd',
      anchorId: a.id,
      kind: 'sidebar',
      status: 'done',
      messages: [],
      provider: '',
      model: '',
      createdAt: 0,
    })
    await removeHighlightAndNotes(a.id)
    expect(await db.anchors.get(a.id)).toBeDefined()
  })

  it('点了侧栏问却没提问：锚点没有任何内容，可以清掉；有划线的不清', async () => {
    const empty = await saveAnchor(doc, '红黑树', 0, 3)
    const used = await saveAnchor(doc, '红黑树', 0, 2)
    await addHighlight(used.id)
    expect(await deleteAnchorIfUnused(empty.id)).toBe(true)
    expect(await deleteAnchorIfUnused(used.id)).toBe(false)
    expect(await db.anchors.get(used.id)).toBeDefined()
  })
})
