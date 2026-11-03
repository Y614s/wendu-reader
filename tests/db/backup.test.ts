import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WenduDB } from '../../src/db'
import { BackupError, createBackup, parseBackup, restoreBackup, shouldRemindBackup, REMIND_AFTER_MS } from '../../src/db/backup'

let n = 0
let src: WenduDB
let dst: WenduDB

async function seed(db: WenduDB) {
  await db.documents.add({ id: 'd1', title: '红黑树', source: '# 红黑树\n\n正文', hash: 'h1', importedAt: 1, lastReadAt: 2, readingPosition: 42 })
  await db.anchors.add({ id: 'a1', docId: 'd1', docHash: 'h1', quote: '正文', prefix: '红黑树\n', suffix: '', start: 4, end: 6 })
  await db.highlights.add({ id: 'h1', anchorId: 'a1', color: 'yellow', createdAt: 3 })
  await db.notes.add({ id: 'n1', anchorId: 'a1', source: 'annotation', text: '批注', createdAt: 4, updatedAt: 5 })
  await db.conversations.add({
    id: 'c1',
    docId: 'd1',
    anchorId: 'a1',
    kind: 'sidebar',
    status: 'done',
    messages: [{ role: 'user', content: '问', createdAt: 6 }],
    provider: 'DeepSeek',
    model: 'm',
    createdAt: 6,
  })
  await db.settings.bulkPut([
    { key: 'reader.currentDocId', value: 'd1' },
    { key: 'ai.key.deepseek', value: 'secret-key-123' },
    { key: 'ai.key.gemini', value: 'secret-key-456' },
    { key: 'diag.launchCount', value: 9 },
    { key: 'ai.config.deepseek', value: { baseURL: 'https://api.deepseek.com', model: 'm' } },
  ])
}

async function dump(db: WenduDB) {
  return {
    documents: await db.documents.toArray(),
    anchors: await db.anchors.toArray(),
    highlights: await db.highlights.toArray(),
    notes: await db.notes.toArray(),
    conversations: await db.conversations.toArray(),
    settings: await db.settings.toArray(),
  }
}

beforeEach(async () => {
  n++
  src = new WenduDB(`src-${n}`)
  dst = new WenduDB(`dst-${n}`)
  await seed(src)
})

afterEach(async () => {
  await src.delete()
  await dst.delete()
})

describe('备份与恢复', () => {
  it('导出再恢复到空数据库：文档、锚点、划线、批注、对话、阅读位置全部一致', async () => {
    const text = JSON.stringify(await createBackup(src))
    await restoreBackup(dst, parseBackup(text), 'replace')
    const a = await dump(src)
    const b = await dump(dst)
    expect(b.documents).toEqual(a.documents)
    expect(b.documents[0].readingPosition).toBe(42)
    expect(b.anchors).toEqual(a.anchors)
    expect(b.highlights).toEqual(a.highlights)
    expect(b.notes).toEqual(a.notes)
    expect(b.conversations).toEqual(a.conversations)
  })

  it('备份里没有任何 API Key 和本机诊断数据', async () => {
    const backup = await createBackup(src)
    const text = JSON.stringify(backup)
    expect(text).not.toContain('secret-key')
    expect(backup.tables.settings.some((s) => s.key.startsWith('ai.key.'))).toBe(false)
    expect(backup.tables.settings.some((s) => s.key.startsWith('diag.'))).toBe(false)
    expect(backup.tables.settings.some((s) => s.key === 'ai.config.deepseek')).toBe(true)
  })

  it('替换：保留本机的 Key，其余换成备份里的', async () => {
    await dst.documents.add({ id: 'old', title: '旧', source: 'x', hash: 'x', importedAt: 0, lastReadAt: 0, readingPosition: null })
    await dst.settings.put({ key: 'ai.key.deepseek', value: 'local-key' })
    await restoreBackup(dst, parseBackup(JSON.stringify(await createBackup(src))), 'replace')
    expect(await dst.documents.get('old')).toBeUndefined()
    expect((await dst.settings.get('ai.key.deepseek'))?.value).toBe('local-key')
    expect(await dst.settings.get('ai.key.gemini')).toBeUndefined()
  })

  it('合并：同 id 保留本机数据，新的加进来', async () => {
    await dst.documents.add({ id: 'd1', title: '本机改过的标题', source: 'x', hash: 'x', importedAt: 0, lastReadAt: 0, readingPosition: 7 })
    await dst.documents.add({ id: 'mine', title: '只在本机', source: 'y', hash: 'y', importedAt: 0, lastReadAt: 0, readingPosition: null })
    const r = await restoreBackup(dst, parseBackup(JSON.stringify(await createBackup(src))), 'merge')
    expect((await dst.documents.get('d1'))!.title).toBe('本机改过的标题')
    expect(await dst.documents.get('mine')).toBeDefined()
    expect(await dst.anchors.get('a1')).toBeDefined()
    expect(r.added.documents).toBe(0)
    expect(r.skipped).toBeGreaterThanOrEqual(1)
  })

  describe('坏文件不动现有数据', () => {
    async function expectRejectedAndUnchanged(text: string, message: RegExp) {
      const before = await dump(src)
      expect(() => parseBackup(text)).toThrowError(BackupError)
      expect(() => parseBackup(text)).toThrowError(message)
      expect(await dump(src)).toEqual(before)
    }

    it('不是 JSON', async () => {
      await expectRejectedAndUnchanged('{这不是 json', /不是有效的 JSON/)
    })

    it('不是问读的备份', async () => {
      await expectRejectedAndUnchanged('{"hello":1}', /不是问读的备份/)
    })

    it('版本号不认识', async () => {
      const b = await createBackup(src)
      await expectRejectedAndUnchanged(JSON.stringify({ ...b, formatVersion: 99 }), /只认识 1/)
    })

    it('缺表、缺字段、字段类型不对、id 重复', async () => {
      const b = await createBackup(src)
      const { notes: _notes, ...noNotes } = b.tables
      await expectRejectedAndUnchanged(JSON.stringify({ ...b, tables: noNotes }), /缺少「notes」/)

      const badDoc = { ...b.tables.documents[0], title: undefined }
      await expectRejectedAndUnchanged(JSON.stringify({ ...b, tables: { ...b.tables, documents: [badDoc] } }), /「title」/)

      const badAnchor = { ...b.tables.anchors[0], start: '4' }
      await expectRejectedAndUnchanged(JSON.stringify({ ...b, tables: { ...b.tables, anchors: [badAnchor] } }), /「start」/)

      const dup = [b.tables.highlights[0], b.tables.highlights[0]]
      await expectRejectedAndUnchanged(JSON.stringify({ ...b, tables: { ...b.tables, highlights: dup } }), /重复/)
    })

    it('写入中途出错时整体回滚，原有数据不变', async () => {
      await seed(dst)
      const before = await dump(dst)
      const b = parseBackup(JSON.stringify(await createBackup(src)))
      // 让最后一张表写入失败：设置项主键重复
      b.tables.settings = [...b.tables.settings, { key: 'diag.launchCount', value: 1 }]
      b.tables.conversations = [b.tables.conversations[0], { ...b.tables.conversations[0] }]
      await expect(restoreBackup(dst, b, 'replace')).rejects.toThrow()
      expect(await dump(dst)).toEqual(before)
    })
  })
})

describe('备份提醒', () => {
  const day = 24 * 60 * 60 * 1000
  const since = 0

  it('不到 7 天不提醒', () => {
    expect(shouldRemindBackup(6 * day, null, since, null)).toBe(false)
    expect(shouldRemindBackup(10 * day, 5 * day, since, null)).toBe(false)
  })

  it('超过 7 天提醒一次，这一轮超期里不再重复', () => {
    expect(shouldRemindBackup(8 * day, null, since, null)).toBe(true)
    expect(shouldRemindBackup(9 * day, null, since, 8 * day)).toBe(false)
  })

  it('备份后重新计时；再次超期会再提醒', () => {
    const lastExport = 20 * day
    expect(shouldRemindBackup(lastExport + REMIND_AFTER_MS + day, lastExport, since, 8 * day)).toBe(true)
  })
})
