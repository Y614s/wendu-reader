import { reactive } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import { isNativeApp } from '.'

// 网页版离线：注册 Service Worker。App 版不注册（资源在本地，注册了反而多一层缓存）。

export const swState = reactive({
  status: '未注册' as string,
})

export function initServiceWorker(): void {
  if (isNativeApp()) {
    swState.status = 'App 版不使用'
    return
  }
  if (!('serviceWorker' in navigator)) {
    swState.status = '浏览器不支持'
    return
  }
  if (import.meta.env.DEV) {
    swState.status = '开发模式下不注册'
    return
  }
  registerSW({
    immediate: true,
    onRegisteredSW() {
      swState.status = navigator.serviceWorker.controller ? '已接管，可离线使用' : '已注册，下次打开起可离线使用'
    },
    onOfflineReady() {
      swState.status = '已缓存，可离线使用'
    },
    onRegisterError(e) {
      swState.status = `注册失败：${String(e)}`
    },
  })
}
