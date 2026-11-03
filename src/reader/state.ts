import { reactive } from 'vue'
import type { PaintMode } from '../highlight'

/** 阅读页的运行状态，诊断页显示 */
export const readerState = reactive({
  paintMode: null as PaintMode | null,
  codeHighlight: 'pending' as 'pending' | 'loaded' | 'failed',
  anchors: 0,
  orphans: 0,
})
