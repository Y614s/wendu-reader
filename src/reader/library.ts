import type { DocumentRecord } from '../db'

// 书架的排序和「继续阅读」：最近读的排前面，读了一半的那篇放到最上方。

export function sortByRecent(docs: DocumentRecord[]): DocumentRecord[] {
  return [...docs].sort((a, b) => b.lastReadAt - a.lastReadAt || b.importedAt - a.importedAt)
}

/** 最近读过、还没读完的一篇；没有时返回 null */
export function continueDoc(docs: DocumentRecord[]): DocumentRecord | null {
  return sortByRecent(docs).find((d) => d.progress !== undefined && d.progress > 0 && d.progress < 0.99) ?? null
}

export function percent(progress: number | undefined): number {
  return Math.round((progress ?? 0) * 100)
}
