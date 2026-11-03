import Dexie, { type EntityTable } from 'dexie'

// 数据模型见 CLAUDE.md「数据模型」。schema 只能新增版本并写迁移，不能改已发布的版本。

export interface DocumentRecord {
  id: string
  title: string
  source: string
  hash: string
  importedAt: number
  lastReadAt: number
  readingPosition: number | null
}

export interface AnchorRecord {
  id: string
  docId: string
  docHash: string
  quote: string
  prefix: string
  suffix: string
  start: number
  end: number
}

export interface HighlightRecord {
  id: string
  anchorId: string
  color: string
  createdAt: number
}

export interface NoteRecord {
  id: string
  anchorId: string
  /** 自己写的批注，或从 AI 回答里存的笔记。任务 02 新增，旧数据没有时按批注处理 */
  source?: 'annotation' | 'ai'
  text: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  /** 实际发给服务商的内容（第一条用户消息里带着原文和附近内容） */
  content: string
  /** 界面上显示的用户问题；没有时显示 content */
  display?: string
  createdAt: number
  /** 回答出错或被中断时记下原因，界面上提示 */
  error?: string
}

export interface ConversationRecord {
  id: string
  docId: string
  anchorId: string | null
  kind: 'sidebar' | 'external'
  status: 'done' | 'pending'
  messages: ChatMessage[]
  provider: string
  model: string
  createdAt: number
}

export interface SettingRecord {
  key: string
  value: unknown
}

export class WenduDB extends Dexie {
  documents!: EntityTable<DocumentRecord, 'id'>
  anchors!: EntityTable<AnchorRecord, 'id'>
  highlights!: EntityTable<HighlightRecord, 'id'>
  notes!: EntityTable<NoteRecord, 'id'>
  conversations!: EntityTable<ConversationRecord, 'id'>
  settings!: EntityTable<SettingRecord, 'key'>

  constructor(name = 'wendu') {
    super(name)
    this.version(1).stores({
      documents: 'id, title, importedAt, lastReadAt',
      anchors: 'id, docId',
      highlights: 'id, anchorId',
      notes: 'id, anchorId',
      conversations: 'id, docId, anchorId, status',
      settings: 'key',
    })
  }
}

export const db = new WenduDB()

export function newId(): string {
  return crypto.randomUUID()
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row ? (row.value as T) : fallback
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}
