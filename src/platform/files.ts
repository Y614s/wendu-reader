import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNativeApp } from '.'

// 导出文件：App 版先写到缓存目录再调起系统分享面板（可以存到文件管理、发到微信、网盘等）；网页版直接下载。

export type SaveResult = 'shared' | 'downloaded' | 'cancelled'

export async function saveTextFile(fileName: string, text: string, mimeType: string): Promise<SaveResult> {
  if (isNativeApp()) {
    const { uri } = await Filesystem.writeFile({ path: fileName, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 })
    try {
      await Share.share({ title: fileName, files: [uri], dialogTitle: '保存或发送' })
      return 'shared'
    } catch (e) {
      if (/cancel/i.test(String((e as Error)?.message ?? e))) return 'cancelled'
      throw e
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}

/** 文件名里去掉系统不允许的字符 */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\n\r\t]+/g, '_').trim().slice(0, 80) || '未命名'
}
