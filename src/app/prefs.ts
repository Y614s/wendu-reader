import { reactive } from 'vue'
import { getSetting, setSetting } from '../db'
import { DEFAULT_BUDGET, normalizePrompts, type CustomPrompts } from '../ai/context'
import { DEFAULT_COLOR, MAX_COLOR_NAME, normalizeColor, type ColorNames, type HighlightColor } from '../highlight/colors'

// 阅读和提问相关的偏好。主题单独在 theme.ts。

export const FONT_SIZE_MIN = 15
export const FONT_SIZE_MAX = 24
export const LINE_HEIGHTS = [
  { value: 1.6, label: '紧凑' },
  { value: 1.8, label: '标准' },
  { value: 2, label: '宽松' },
] as const
export const PAGE_WIDTHS = [
  { value: 'narrow', label: '窄', css: '640px' },
  { value: 'normal', label: '标准', css: '860px' },
  { value: 'wide', label: '宽', css: '1240px' },
] as const

export type PageWidth = (typeof PAGE_WIDTHS)[number]['value']

export const prefs = reactive({
  /** 点屏幕上下边缘翻一屏，默认关闭 */
  edgeTap: false,
  /** 上下文预算（token） */
  contextBudget: DEFAULT_BUDGET,
  fontSize: 18,
  lineHeight: 1.8 as number,
  pageWidth: 'normal' as PageWidth,
  /** 颜色的自定义名称，留空的用默认名称 */
  colorNames: {} as ColorNames,
  /** 最近一次用过的颜色，「批注」用它 */
  lastColor: DEFAULT_COLOR as HighlightColor,
  /** 自定义快捷提问；没改过的一组用默认的 */
  quickPrompts: {} as CustomPrompts,
})

/** 排版写到 CSS 变量上，正文样式直接用，改了立即生效 */
function applyTypography() {
  const s = document.documentElement.style
  s.setProperty('--reader-font-size', `${prefs.fontSize}px`)
  s.setProperty('--reader-line-height', String(prefs.lineHeight))
  s.setProperty('--reader-width', PAGE_WIDTHS.find((w) => w.value === prefs.pageWidth)?.css ?? '860px')
}

export async function loadPrefs(): Promise<void> {
  prefs.edgeTap = await getSetting('ui.edgeTap', false)
  prefs.contextBudget = await getSetting('ai.contextBudget', DEFAULT_BUDGET)
  prefs.fontSize = await getSetting('ui.fontSize', 18)
  prefs.lineHeight = await getSetting('ui.lineHeight', 1.8)
  prefs.pageWidth = await getSetting<PageWidth>('ui.pageWidth', 'normal')
  prefs.colorNames = await getSetting<ColorNames>('highlight.colorNames', {})
  prefs.lastColor = normalizeColor(await getSetting<string | null>('highlight.lastColor', null))
  prefs.quickPrompts = await getSetting<CustomPrompts>('ai.quickPrompts', {})
  applyTypography()
}

export async function setEdgeTap(on: boolean): Promise<void> {
  prefs.edgeTap = on
  await setSetting('ui.edgeTap', on)
}

export async function setContextBudget(n: number): Promise<void> {
  prefs.contextBudget = Math.max(500, Math.min(200000, Math.round(n)))
  await setSetting('ai.contextBudget', prefs.contextBudget)
}

export async function setColorName(color: HighlightColor, name: string): Promise<void> {
  const next = { ...prefs.colorNames }
  const trimmed = name.trim().slice(0, MAX_COLOR_NAME)
  if (trimmed) next[color] = trimmed
  else delete next[color]
  prefs.colorNames = next
  await setSetting('highlight.colorNames', next)
}

export async function setLastColor(color: HighlightColor): Promise<void> {
  prefs.lastColor = color
  await setSetting('highlight.lastColor', color)
}

/** 保存一组快捷提问；传 null 恢复默认 */
export async function setQuickPrompts(group: keyof CustomPrompts, list: string[] | null): Promise<void> {
  const next = { ...prefs.quickPrompts }
  if (list === null) delete next[group]
  else next[group] = normalizePrompts(list)
  prefs.quickPrompts = next
  await setSetting('ai.quickPrompts', next)
}

export async function setFontSize(n: number): Promise<void> {
  prefs.fontSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(n)))
  applyTypography()
  await setSetting('ui.fontSize', prefs.fontSize)
}

export async function setLineHeight(n: number): Promise<void> {
  prefs.lineHeight = n
  applyTypography()
  await setSetting('ui.lineHeight', n)
}

export async function setPageWidth(w: PageWidth): Promise<void> {
  prefs.pageWidth = w
  applyTypography()
  await setSetting('ui.pageWidth', w)
}
