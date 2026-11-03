import { reactive } from 'vue'
import { getSetting, setSetting } from '../db'
import { DEFAULT_BUDGET } from '../ai/context'

// 阅读和提问相关的偏好。主题单独在 theme.ts。

export const prefs = reactive({
  /** 点屏幕上下边缘翻一屏，默认关闭 */
  edgeTap: false,
  /** 上下文预算（token） */
  contextBudget: DEFAULT_BUDGET,
})

export async function loadPrefs(): Promise<void> {
  prefs.edgeTap = await getSetting('ui.edgeTap', false)
  prefs.contextBudget = await getSetting('ai.contextBudget', DEFAULT_BUDGET)
}

export async function setEdgeTap(on: boolean): Promise<void> {
  prefs.edgeTap = on
  await setSetting('ui.edgeTap', on)
}

export async function setContextBudget(n: number): Promise<void> {
  prefs.contextBudget = Math.max(500, Math.min(200000, Math.round(n)))
  await setSetting('ai.contextBudget', prefs.contextBudget)
}
