import { Share } from '@capacitor/share'
import { isNativeApp } from '.'

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

/** 调起系统分享面板；都不支持时复制到剪贴板 */
export async function shareText(title: string, text: string): Promise<ShareResult> {
  try {
    if (isNativeApp()) {
      await Share.share({ title, text, dialogTitle: '发到 App' })
      return 'shared'
    }
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, text })
      return 'shared'
    }
  } catch (e) {
    // 用户关掉分享面板也会抛错，不算失败
    const msg = String((e as Error)?.message ?? e)
    if (/cancel|abort/i.test(msg) || (e as Error)?.name === 'AbortError') return 'cancelled'
  }
  return (await copyText(text)) ? 'copied' : 'failed'
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 旧 WebView 没有异步剪贴板接口
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** 读剪贴板文字；读不到或不是文字时返回 null */
export async function readClipboardText(): Promise<string | null> {
  try {
    const text = await navigator.clipboard.readText()
    return text.trim() ? text : null
  } catch {
    return null
  }
}
