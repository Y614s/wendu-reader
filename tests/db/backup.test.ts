import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WenduDB } from '../../src/db'
import { BackupError, clearAllData, createBackup, parseBackup, restoreBackup, shouldRemindBackup, REMIND_AFTER_MS } from '../../src/db/backup'

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

  it('阅读进度随备份恢复；没有进度的旧文档也能恢复；进度不合法时拒绝', async () => {
    await src.documents.update('d1', { progress: 0.42 })
    const backup = await createBackup(src)
    await restoreBackup(dst, parseBackup(JSON.stringify(backup)), 'replace')
    expect((await dst.documents.get('d1'))!.progress).toBe(0.42)

    const old = JSON.parse(JSON.stringify(backup))
    delete old.tables.documents[0].progress
    expect(() => parseBackup(JSON.stringify(old))).not.toThrow()

    const bad = JSON.parse(JSON.stringify(backup))
    bad.tables.documents[0].progress = 7
    expect(() => parseBackup(JSON.stringify(bad))).toThrowError(/「progress」/)
  })

  it('备份里没有任何 API Key 和本机诊断数据', async () => {
    const backup = await createBackup(src)
    const text = JSON.stringify(backup)
    expect(text).not.toContain('secret-key')
    expect(backup.tables.settings.some((s) => s.key.startsWith('ai.key.'))).toBe(false)
    expect(backup.tables.settings.some((s) => s.key.startsWith('diag.'))).toBe(false)
    expect(backup.tables.settings.some((s) => s.key === 'ai.config.deepseek')).toBe(false)
    expect(backup.tables.settings.some((s) => s.key === 'ai.provider')).toBe(false)
    expect(backup.tables.settings.some((s) => s.key === 'reader.currentDocId')).toBe(true)
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

describe('恶意备份', () => {
  const ATTACKER = { baseURL: 'https://attacker.example/v1', model: 'm' }

  async function maliciousBackup() {
    const b = await createBackup(src)
    b.tables.settings.push({ key: 'ai.config.deepseek', value: ATTACKER }, { key: 'ai.provider', value: 'custom' }, { key: 'ai.key.deepseek', value: 'x' })
    return parseBackup(JSON.stringify(b))
  }

  it.each(['replace', 'merge'] as const)('%s：不能改写本机的接口地址和 Key', async (mode) => {
    const local = { baseURL: 'https://api.deepseek.com', model: 'mine' }
    await dst.settings.bulkPut([
      { key: 'ai.config.deepseek', value: local },
      { key: 'ai.provider', value: 'deepseek' },
      { key: 'ai.key.deepseek', value: 'local-key' },
    ])
    await restoreBackup(dst, await maliciousBackup(), mode)
    expect((await dst.settings.get('ai.config.deepseek'))?.value).toEqual(local)
    expect((await dst.settings.get('ai.provider'))?.value).toBe('deepseek')
    expect((await dst.settings.get('ai.key.deepseek'))?.value).toBe('local-key')
  })

  it.each(['replace', 'merge'] as const)('%s：本机没有配置时也不写入备份里的接口地址', async (mode) => {
    await restoreBackup(dst, await maliciousBackup(), mode)
    expect(await dst.settings.get('ai.config.deepseek')).toBeUndefined()
    expect(await dst.settings.get('ai.provider')).toBeUndefined()
  })

  it('白名单里的设置取值不对时拒绝恢复', async () => {
    const b = await createBackup(src)
    b.tables.settings.push({ key: 'ui.theme', value: '<img>' })
    expect(() => parseBackup(JSON.stringify(b))).toThrowError(/「value」/)
  })

  it('对话消息结构不对、枚举取值不对时拒绝恢复', async () => {
    const b = await createBackup(src)
    const conv = b.tables.conversations[0]
    const withConv = (c: object) => JSON.stringify({ ...b, tables: { ...b.tables, conversations: [c] } })
    expect(() => parseBackup(withConv({ ...conv, messages: [{ role: 'user' }] }))).toThrowError(/「messages」/)
    expect(() => parseBackup(withConv({ ...conv, messages: [null] }))).toThrowError(/「messages」/)
    expect(() => parseBackup(withConv({ ...conv, messages: [{ role: 'x', content: '', createdAt: 0 }] }))).toThrowError(/「messages」/)
    expect(() => parseBackup(withConv({ ...conv, kind: 'x' }))).toThrowError(/「kind」/)
    expect(() => parseBackup(withConv({ ...conv, status: 'x' }))).toThrowError(/「status」/)
  })

  it('v0.1.0 导出的备份（设置里带接口配置）仍能恢复，只是忽略那些设置', async () => {
    const old = await createBackup(src)
    old.tables.settings.push({ key: 'ai.config.deepseek', value: { baseURL: 'https://api.deepseek.com', model: 'm' } })
    await restoreBackup(dst, parseBackup(JSON.stringify(old)), 'replace')
    expect(await dst.documents.count()).toBe(1)
    expect(await dst.settings.get('ai.config.deepseek')).toBeUndefined()
  })
})

describe('第三版的设置', () => {
  it('颜色名称、最近颜色和快捷提问随备份恢复', async () => {
    await src.settings.bulkPut([
      { key: 'highlight.colorNames', value: { red: '待查' } },
      { key: 'highlight.lastColor', value: 'red' },
      { key: 'ai.quickPrompts', value: { anchor: ['甲'] } },
    ])
    await restoreBackup(dst, parseBackup(JSON.stringify(await createBackup(src))), 'replace')
    expect((await dst.settings.get('highlight.colorNames'))?.value).toEqual({ red: '待查' })
    expect((await dst.settings.get('highlight.lastColor'))?.value).toBe('red')
    expect((await dst.settings.get('ai.quickPrompts'))?.value).toEqual({ anchor: ['甲'] })
  })

  it.each([
    ['highlight.lastColor', 'purple'],
    ['highlight.colorNames', { purple: 'x' }],
    ['highlight.colorNames', { red: 'x'.repeat(50) }],
    ['ai.quickPrompts', { anchor: 'x' }],
    ['ai.quickPrompts', { other: ['x'] }],
    ['ai.quickPrompts', { anchor: Array(9).fill('x') }],
  ])('%s 取值不合法时拒绝恢复', async (key, value) => {
    const b = await createBackup(src)
    b.tables.settings.push({ key, value })
    expect(() => parseBackup(JSON.stringify(b))).toThrowError(/「value」/)
  })

  it('划线里不认识的颜色不拒绝恢复', async () => {
    const b = await createBackup(src)
    b.tables.highlights[0].color = 'purple'
    expect(() => parseBackup(JSON.stringify(b))).not.toThrow()
  })
})

describe('清除全部数据', () => {
  it('文档、笔记、对话和所有设置（含 API Key）都清掉，只留诊断数据', async () => {
    await clearAllData(src)
    const d = await dump(src)
    expect(d.documents).toEqual([])
    expect(d.anchors).toEqual([])
    expect(d.highlights).toEqual([])
    expect(d.notes).toEqual([])
    expect(d.conversations).toEqual([])
    expect(d.settings).toEqual([{ key: 'diag.launchCount', value: 9 }])
  })

  it('清除后可以从备份完整恢复', async () => {
    const text = JSON.stringify(await createBackup(src))
    const before = await dump(src)
    await clearAllData(src)
    await restoreBackup(src, parseBackup(text), 'replace')
    const after = await dump(src)
    expect(after.documents).toEqual(before.documents)
    expect(after.notes).toEqual(before.notes)
    expect(after.conversations).toEqual(before.conversations)
    // Key 不在备份里，清除后就没有了
    expect(after.settings.some((s) => s.key.startsWith('ai.key.'))).toBe(false)
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
