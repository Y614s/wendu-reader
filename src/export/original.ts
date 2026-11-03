import type { DocumentRecord } from '../db'
import { safeFileName, saveTextFile, type SaveResult } from '../platform/files'

/** 导出原文：导入时保存的 md 原文（换行已统一为 LF），不含划线和笔记 */
export async function exportOriginal(doc: DocumentRecord): Promise<SaveResult> {
  return saveTextFile(`${safeFileName(doc.title)}.md`, doc.source, 'text/markdown')
}
