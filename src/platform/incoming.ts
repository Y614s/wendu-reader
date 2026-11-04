import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { isNativeApp } from '.'

// 从其他 App「用其他应用打开」或「分享」进来的文件。
// 原生侧（MainActivity 里的 IncomingFilePlugin）读取 content:// 数据流，这里只判断是不是 md。

export interface IncomingFile {
  name: string
  mimeType: string
  text: string
  /** 原生侧读取失败时的原因 */
  error?: string
}

interface IncomingFilePlugin {
  takePending(): Promise<{ file: IncomingFile | null }>
  addListener(event: 'fileReceived', cb: (file: IncomingFile) => void): Promise<PluginListenerHandle>
}

const Incoming = registerPlugin<IncomingFilePlugin>('IncomingFile')

/** 单篇文档上限，和原生侧 IncomingFilePlugin 一致。渲染是同步的，太大的文档会卡死页面 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

export function isTooLarge(size: number): boolean {
  return size > MAX_IMPORT_BYTES
}

const MD_EXT = /\.(md|markdown|mdown|mkd|mdx)$/i
const TEXT_EXT = /\.(txt|text)$/i

/**
 * 判断收到的内容是不是 md。微信传出的 md 常标成 octet-stream 或 text/plain，
 * 所以先看扩展名，没有扩展名时再看内容像不像文本和 Markdown。
 */
export function isLikelyMarkdown(name: string, text: string): boolean {
  if (!text.trim()) return false
  if (looksBinary(text)) return false
  if (MD_EXT.test(name)) return true
  const hasExt = /\.[A-Za-z0-9]{1,8}$/.test(name)
  if (hasExt && !TEXT_EXT.test(name)) return false
  return /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|---\s*$|\|.*\|)/m.test(text)
}

function looksBinary(text: string): boolean {
  const sample = text.slice(0, 4000)
  if (sample.includes('\u0000')) return true
  const bad = (sample.match(/�/g) ?? []).length
  return bad > sample.length * 0.02
}

/** 启动时取走等待导入的文件，并监听之后收到的文件 */
export async function listenIncomingFiles(onFile: (file: IncomingFile) => void): Promise<() => void> {
  if (!isNativeApp()) return () => {}
  try {
    const handle = await Incoming.addListener('fileReceived', onFile)
    const { file } = await Incoming.takePending()
    if (file) onFile(file)
    return () => void handle.remove()
  } catch (e) {
    console.warn('文件导入插件不可用', e)
    return () => {}
  }
}
