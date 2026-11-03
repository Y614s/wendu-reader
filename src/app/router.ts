import { ref, readonly } from 'vue'

// 极简 hash 路由：网页版部署到 Vercel 不需要重写规则，Capacitor 本地加载也不受影响。
// 只有四个页面，不值得引入 vue-router。阅读页打开的是「当前文档」，不放在地址里。

export type RouteName = 'library' | 'reader' | 'settings' | 'diagnostics'

const ROUTES: readonly RouteName[] = ['library', 'reader', 'settings', 'diagnostics']

export function parseHash(hash: string): RouteName {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return (ROUTES as readonly string[]).includes(name) ? (name as RouteName) : 'reader'
}

const current = ref<RouteName>(parseHash(typeof location === 'undefined' ? '' : location.hash))

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current.value = parseHash(location.hash)
  })
}

export const route = readonly(current)

export function navigate(name: RouteName): void {
  location.hash = `#/${name}`
}
