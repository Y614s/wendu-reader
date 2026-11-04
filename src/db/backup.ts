import type { EntityTable } from 'dexie'
import { MAX_PROMPTS, MAX_PROMPT_LENGTH } from '../ai/context'
import { HIGHLIGHT_COLORS, MAX_COLOR_NAME } from '../highlight/colors'
import type { AnchorRecord, ConversationRecord, DocumentRecord, HighlightRecord, NoteRecord, SettingRecord, WenduDB } from '.'

// 全量备份与恢复。
// - 设置走白名单：只有下面列出的项才进出备份。API Key、AI 接口配置、诊断数据都留在本机。
//   接口地址不能跟着备份走：否则一个恶意备份就能把本机的 Key 和文档内容引到别人的服务器。
// - 恢复前先完整校验；校验失败不动现有数据。替换在一个事务里完成，中途出错整体回滚。

export const BACKUP_APP = 'wendu-reader'
export const BACKUP_FORMAT_VERSION = 1

export interface BackupTables {
  documents: DocumentRecord[]
  anchors: AnchorRecord[]
  highlights: HighlightRecord[]
  notes: NoteRecord[]
  conversations: ConversationRecord[]
  settings: SettingRecord[]
}

export interface BackupFile {
  app: typeof BACKUP_APP
  formatVersion: number
  exportedAt: number
  tables: BackupTables
}

export type RestoreMode = 'merge' | 'replace'

export class BackupError extends Error {}

const isPromptList = (v: unknown) => Array.isArray(v) && v.length <= MAX_PROMPTS && v.every((p) => typeof p === 'string' && p.length <= MAX_PROMPT_LENGTH)
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

const isNumberOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))
const isStringOrNull = (v: unknown) => v === null || typeof v === 'string'

/** 能进出备份的设置项和它们的取值校验。新增设置默认留在本机，确实要迁移时才加到这里 */
const BACKUP_SETTINGS = new Map<string, (v: unknown) => boolean>([
  ['reader.currentDocId', isStringOrNull],
  ['reader.sampleDocId', isStringOrNull],
  ['ui.theme', (v) => v === 'light' || v === 'sepia' || v === 'dark' || v === 'system'],
  ['ui.fontSize', (v) => typeof v === 'number' && v >= 15 && v <= 24],
  ['ui.lineHeight', (v) => v === 1.6 || v === 1.8 || v === 2],
  ['ui.pageWidth', (v) => v === 'narrow' || v === 'normal' || v === 'wide'],
  ['ui.edgeTap', (v) => typeof v === 'boolean'],
  ['ai.contextBudget', (v) => typeof v === 'number' && Number.isFinite(v) && v > 0],
  ['highlight.lastColor', (v) => (HIGHLIGHT_COLORS as readonly unknown[]).includes(v)],
  ['highlight.colorNames', (v) => isRecord(v) && Object.entries(v).every(([k, n]) => (HIGHLIGHT_COLORS as readonly string[]).includes(k) && typeof n === 'string' && n.length <= MAX_COLOR_NAME)],
  ['ai.quickPrompts', (v) => isRecord(v) && Object.entries(v).every(([k, l]) => (k === 'anchor' || k === 'whole') && isPromptList(l))],
  ['backup.since', isNumberOrNull],
  ['backup.lastExportAt', isNumberOrNull],
  ['backup.lastRemindedAt', isNumberOrNull],
])

function isLocalOnlySetting(key: string): boolean {
  return !BACKUP_SETTINGS.has(key)
}

export async function createBackup(db: WenduDB, now = Date.now()): Promise<BackupFile> {
  return db.transaction('r', [db.documents, db.anchors, db.highlights, db.notes, db.conversations, db.settings], async () => ({
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now,
    tables: {
      documents: await db.documents.toArray(),
      anchors: await db.anchors.toArray(),
      highlights: await db.highlights.toArray(),
      notes: await db.notes.toArray(),
      conversations: await db.conversations.toArray(),
      settings: (await db.settings.toArray()).filter((s) => !isLocalOnlySetting(s.key)),
    },
  }))
}

// ---------- 校验 ----------

type FieldType = 'string' | 'number' | 'array' | 'nullable-string' | 'nullable-number'

const REQUIRED: Record<keyof BackupTables, Record<string, FieldType>> = {
  documents: { id: 'string', title: 'string', source: 'string', hash: 'string', importedAt: 'number', lastReadAt: 'number', readingPosition: 'nullable-number' },
  anchors: { id: 'string', docId: 'string', docHash: 'string', quote: 'string', prefix: 'string', suffix: 'string', start: 'number', end: 'number' },
  highlights: { id: 'string', anchorId: 'string', color: 'string', createdAt: 'number' },
  notes: { id: 'string', anchorId: 'string', text: 'string', createdAt: 'number', updatedAt: 'number' },
  conversations: { id: 'string', docId: 'string', anchorId: 'nullable-string', kind: 'string', status: 'string', messages: 'array', provider: 'string', model: 'string', createdAt: 'number' },
  settings: { key: 'string' },
}

function typeOk(v: unknown, t: FieldType): boolean {
  switch (t) {
    case 'string':
      return typeof v === 'string'
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
    case 'array':
      return Array.isArray(v)
    case 'nullable-string':
      return v === null || v === undefined || typeof v === 'string'
    case 'nullable-number':
      return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v))
  }
}

/** 表字段以外的校验：枚举取值、对话消息的结构、设置项的值。格式不对的数据进库后会让界面渲染出错 */
function checkRow(table: keyof BackupTables, row: Record<string, unknown>, i: number): void {
  const fail = (field: string) => new BackupError(`「${table}」第 ${i + 1} 条数据的「${field}」缺失或格式不对。`)
  if (table === 'documents' && row.progress !== undefined && !(typeof row.progress === 'number' && row.progress >= 0 && row.progress <= 1)) throw fail('progress')
  if (table === 'notes' && row.source !== undefined && row.source !== 'annotation' && row.source !== 'ai') throw fail('source')
  if (table === 'settings') {
    const check = BACKUP_SETTINGS.get(row.key as string)
    if (check && !check(row.value)) throw fail('value')
  }
  if (table === 'conversations') {
    if (row.kind !== 'sidebar' && row.kind !== 'external') throw fail('kind')
    if (row.status !== 'done' && row.status !== 'pending') throw fail('status')
    for (const m of row.messages as Record<string, unknown>[]) {
      const ok =
        m !== null &&
        typeof m === 'object' &&
        (m.role === 'system' || m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        typeOk(m.createdAt, 'number') &&
        typeOk(m.display, 'nullable-string') &&
        typeOk(m.error, 'nullable-string')
      if (!ok) throw fail('messages')
    }
  }
}

/** 解析并完整校验备份文件；任何问题都抛出 BackupError，说明原因 */
export function parseBackup(text: string): BackupFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupError('文件不是有效的 JSON，可能已损坏或不是问读的备份文件。')
  }
  const obj = data as Partial<BackupFile> | null
  if (!obj || typeof obj !== 'object' || obj.app !== BACKUP_APP) throw new BackupError('这不是问读的备份文件。')
  if (obj.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupError(`备份格式版本是 ${String(obj.formatVersion)}，当前版本只认识 ${BACKUP_FORMAT_VERSION}。请把 App 更新到最新版再恢复。`)
  }
  if (!obj.tables || typeof obj.tables !== 'object') throw new BackupError('备份文件缺少数据部分。')

  for (const table of Object.keys(REQUIRED) as (keyof BackupTables)[]) {
    const rows = (obj.tables as Partial<BackupTables>)[table]
    if (!Array.isArray(rows)) throw new BackupError(`备份文件缺少「${table}」数据。`)
    const keyField = table === 'settings' ? 'key' : 'id'
    const seen = new Set<string>()
    rows.forEach((row, i) => {
      if (!row || typeof row !== 'object') throw new BackupError(`「${table}」第 ${i + 1} 条数据格式不对。`)
      for (const [field, type] of Object.entries(REQUIRED[table])) {
        if (!typeOk((row as unknown as Record<string, unknown>)[field], type)) {
          throw new BackupError(`「${table}」第 ${i + 1} 条数据的「${field}」缺失或格式不对。`)
        }
      }
      checkRow(table, row as unknown as Record<string, unknown>, i)
      const k = (row as unknown as Record<string, string>)[keyField]
      if (seen.has(k)) throw new BackupError(`「${table}」里有重复的 ${keyField}：${k}。`)
      seen.add(k)
    })
  }
  return {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
    tables: obj.tables as BackupTables,
  }
}

// ---------- 恢复 ----------

export interface RestoreResult {
  added: Record<keyof BackupTables, number>
  /** 合并时本机已有、被跳过的条数 */
  skipped: number
}

export async function restoreBackup(db: WenduDB, backup: BackupFile, mode: RestoreMode): Promise<RestoreResult> {
  const t = backup.tables
  const settings = t.settings.filter((s) => !isLocalOnlySetting(s.key))
  const added = { documents: 0, anchors: 0, highlights: 0, notes: 0, conversations: 0, settings: 0 }
  let skipped = 0

  await db.transaction('rw', [db.documents, db.anchors, db.highlights, db.notes, db.conversations, db.settings], async () => {
    if (mode === 'replace') {
      // 本机的 Key、AI 接口配置和诊断数据保留，其余全部换成备份里的
      const keep = (await db.settings.toArray()).filter((s) => isLocalOnlySetting(s.key))
      await Promise.all([db.documents.clear(), db.anchors.clear(), db.highlights.clear(), db.notes.clear(), db.conversations.clear(), db.settings.clear()])
      await db.documents.bulkAdd(t.documents)
      await db.anchors.bulkAdd(t.anchors)
      await db.highlights.bulkAdd(t.highlights)
      await db.notes.bulkAdd(t.notes)
      await db.conversations.bulkAdd(t.conversations)
      await db.settings.bulkAdd([...settings, ...keep])
      added.documents = t.documents.length
      added.anchors = t.anchors.length
      added.highlights = t.highlights.length
      added.notes = t.notes.length
      added.conversations = t.conversations.length
      added.settings = settings.length
      return
    }

    // 合并：同一个 id 本机已有时保留本机的
    const mergeTable = async <R extends { id: string }>(table: EntityTable<R, 'id'>, rows: R[]) => {
      const existing = await table.bulkGet(rows.map((r) => r.id) as Parameters<typeof table.bulkGet>[0])
      const fresh = rows.filter((_, i) => existing[i] === undefined)
      skipped += rows.length - fresh.length
      if (fresh.length) await table.bulkAdd(fresh)
      return fresh.length
    }
    added.documents = await mergeTable(db.documents, t.documents)
    added.anchors = await mergeTable(db.anchors, t.anchors)
    added.highlights = await mergeTable(db.highlights, t.highlights)
    added.notes = await mergeTable(db.notes, t.notes)
    added.conversations = await mergeTable(db.conversations, t.conversations)
    const existingSettings = await db.settings.bulkGet(settings.map((s) => s.key))
    const freshSettings = settings.filter((_, i) => existingSettings[i] === undefined)
    skipped += settings.length - freshSettings.length
    if (freshSettings.length) await db.settings.bulkAdd(freshSettings)
    added.settings = freshSettings.length
  })
  return { added, skipped }
}

// ---------- 清除全部数据 ----------

/**
 * 清除全部数据，相当于重新安装：文档、锚点、划线、批注、对话和所有设置（包括 API Key）。
 * 只保留诊断数据（diag.*），启动计数器继续累加，方便确认是不是同一次安装。
 */
export async function clearAllData(db: WenduDB): Promise<void> {
  await db.transaction('rw', [db.documents, db.anchors, db.highlights, db.notes, db.conversations, db.settings], async () => {
    const keep = (await db.settings.toArray()).filter((s) => s.key.startsWith('diag.'))
    await Promise.all([db.documents.clear(), db.anchors.clear(), db.highlights.clear(), db.notes.clear(), db.conversations.clear(), db.settings.clear()])
    if (keep.length) await db.settings.bulkAdd(keep)
  })
}

// ---------- 备份提醒 ----------

export const REMIND_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 是否该提醒备份：距上次备份（从没备份过则从开始使用算起）超过 7 天，
 * 并且这一轮超期里还没提醒过。
 */
export function shouldRemindBackup(now: number, lastExportAt: number | null, since: number, lastRemindedAt: number | null): boolean {
  const base = lastExportAt ?? since
  const due = base + REMIND_AFTER_MS
  if (now < due) return false
  return lastRemindedAt === null || lastRemindedAt < due
}
