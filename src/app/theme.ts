import { ref } from 'vue'
import { getSetting, setSetting } from '../db'

// 日间 / 夜间 / 跟随系统。结果写到 <html data-theme>，颜色全由 base.css 里的变量决定。

export type ThemeSetting = 'light' | 'dark' | 'system'

const KEY = 'ui.theme'
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

export const themeSetting = ref<ThemeSetting>('system')

function apply() {
  const dark = themeSetting.value === 'dark' || (themeSetting.value === 'system' && media?.matches === true)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d1117' : '#ffffff')
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
