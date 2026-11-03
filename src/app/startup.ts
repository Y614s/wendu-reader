import { reactive } from 'vue'
import { getSetting, setSetting } from '../db'

// 启动时做的事：申请持久化存储、启动计数器加一。结果给诊断页显示。

const LAUNCH_KEY = 'diag.launchCount'

export const startupState = reactive({
  persisted: null as boolean | null,
  persistError: '',
  launchCount: null as number | null,
  dbError: '',
})

export async function runStartup(): Promise<void> {
  try {
    if (navigator.storage?.persist) startupState.persisted = await navigator.storage.persist()
    else startupState.persistError = '不支持 navigator.storage.persist'
  } catch (e) {
    startupState.persistError = String(e)
  }
  try {
    const n = (await getSetting<number>(LAUNCH_KEY, 0)) + 1
    await setSetting(LAUNCH_KEY, n)
    startupState.launchCount = n
  } catch (e) {
    startupState.dbError = String(e)
  }
}
