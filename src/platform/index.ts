import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

// 网页与 Capacitor 的差异封装。项目里只有 src/platform/ 允许直接调用 Capacitor。

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

export interface AppVersionInfo {
  version: string
  build: string | null
}

export async function getAppVersion(): Promise<AppVersionInfo> {
  if (!isNativeApp()) return { version: __APP_VERSION__, build: null }
  const info = await App.getInfo()
  return { version: info.version, build: info.build }
}
