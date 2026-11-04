import { ref } from 'vue'
import { getSetting, setSetting } from '../db'

// 日间 / 米黄 / 夜间 / 跟随系统。结果写到 <html data-theme>，颜色全由 base.css 里的变量决定。

export type ThemeSetting = 'light' | 'sepia' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'sepia' | 'dark'

const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#fbf7ef', sepia: '#eadfc8', dark: '#1b1815' }

const KEY = 'ui.theme'
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

export const themeSetting = ref<ThemeSetting>('system')
/** 实际生效的主题；Mermaid 等需要知道颜色的地方用它 */
export const resolvedTheme = ref<ResolvedTheme>('light')

function apply() {
  const t: ResolvedTheme = themeSetting.value === 'system' ? (media?.matches ? 'dark' : 'light') : themeSetting.value
  resolvedTheme.value = t
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[t])
}

export async function initTheme(): Promise<void> {
  apply()
  media?.addEventListener('change', apply)
  themeSetting.value = await getSetting<ThemeSetting>(KEY, 'system')
  apply()
}

export async function setTheme(t: ThemeSetting): Promise<void> {
  themeSetting.value = t
  apply()
  await setSetting(KEY, t)
}
