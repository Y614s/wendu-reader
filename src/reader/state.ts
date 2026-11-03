import { reactive } from 'vue'
import type { PaintMode } from '../highlight'

/** 阅读页的运行状态，诊断页显示 */
export const readerState = reactive({
  paintMode: null as PaintMode | null,
  codeHighlight: 'pending' as 'pending' | 'loaded' | 'failed',
  anchors: 0,
  orphans: 0,
  /** 本次启动以来保存阅读位置的次数和最近一次的值 */
  positionSaves: 0,
  lastSavedPosition: null as number | null,
  restoredPosition: null as number | null,
})
