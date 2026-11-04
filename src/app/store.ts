import { reactive } from 'vue'
import { navigate } from './router'
import type { DocumentRecord } from '../db'
import {
  clearCurrentDocument,
  deleteDocument as dbDeleteDocument,
  importDocument,
  listDocuments,
  loadCurrentDocument,
  setCurrentDocument,
} from '../db/documents'
import { isLikelyMarkdown, isTooLarge, listenIncomingFiles, type IncomingFile } from '../platform/incoming'

// 全局状态：当前文档、书架列表、全局提示。书架、阅读页和从其他 App 传进来的文件都走这里。

export const appState = reactive({
  ready: false,
  currentDocId: null as string | null,
  /** 书架列表变化时加一，书架页据此刷新 */
  docsVersion: 0,
  /** 文档内容被更新时加一，阅读页据此重新渲染 */
  sourceVersion: 0,
  toast: '',
  /** 提示条上的操作，例如「撤销」 */
  toastAction: null as { label: string; run: () => void | Promise<void> } | null,
  /** 全局笔记页要跳到的原文；阅读页处理完清空。ask 表示跳过去后打开提问面板 */
  jump: null as { anchorId: string; ask: boolean } | null,
})

let toastTimer: ReturnType<typeof setTimeout> | undefined

export function showToast(text: string, ms = 2500, action: { label: string; run: () => void | Promise<void> } | null = null): void {
  appState.toast = text
  appState.toastAction = action
  clearTimeout(toastTimer)
  toastTimer = setTimeout(closeToast, ms)
}

export function closeToast(): void {
  clearTimeout(toastTimer)
  appState.toast = ''
  appState.toastAction = null
}

async function fetchSample(): Promise<string> {
  const res = await fetch('./samples/test.md')
  if (!res.ok) throw new Error(`读取内置测试文档失败：HTTP ${res.status}`)
  return res.text()
}

export async function openDocument(id: string): Promise<void> {
  await setCurrentDocument(id)
  appState.currentDocId = id
  navigate('reader')
}

/** 导入一段 md 文本；不像 md 时提示并返回 null */
export async function importText(text: string, name: string, open = true): Promise<DocumentRecord | null> {
  if (isTooLarge(text.length)) {
    showToast('文档太大了，单篇不能超过 5 MB', 4000)
    return null
  }
  if (!isLikelyMarkdown(name, text)) {
    showToast(`「${name || '收到的内容'}」看起来不是 Markdown，没有导入`, 4000)
    return null
  }
  const titles = new Set((await listDocuments()).map((d) => d.title))
  const doc = await importDocument(text, name)
  appState.docsVersion++
  showToast(titles.has(doc.title) ? `已导入「${doc.title}」，同名文档已保留两份` : `已导入「${doc.title}」`)
  if (open) await openDocument(doc.id)
  return doc
}

/** 书架空着时，打开内置的示例文档看看 */
export async function importSample(): Promise<void> {
  try {
    await importText(await fetchSample(), 'sample.md')
  } catch (e) {
    showToast(String(e), 4000)
  }
}

/** 从全局笔记页跳到某篇文档的某处原文 */
export async function jumpToNote(docId: string, anchorId: string, ask = false): Promise<void> {
  appState.jump = { anchorId, ask }
  await openDocument(docId)
}

export async function deleteDocument(id: string): Promise<void> {
  await dbDeleteDocument(id)
  if (appState.currentDocId === id) {
    appState.currentDocId = null
    await clearCurrentDocument()
  }
  appState.docsVersion++
}

async function onIncoming(file: IncomingFile): Promise<void> {
  if (file.error) {
    showToast(`读取文件失败：${file.error}`, 4000)
    return
  }
  await importText(file.text, file.name)
}

export async function initStore(): Promise<void> {
  try {
    const doc = await loadCurrentDocument(fetchSample)
    appState.currentDocId = doc?.id ?? null
  } catch (e) {
    showToast(String(e), 5000)
  }
  appState.ready = true
  await listenIncomingFiles((f) => void onIncoming(f))
}
