// 阅读页顶栏的收起：往下读时收起，往回滑时出现。顶栏浮在正文上，收起不改变正文布局，阅读位置不会跳。

export interface BarState {
  hidden: boolean
  lastTop: number
}

/** 滑动小于这个距离不算改变方向，手指抖动不会让顶栏闪 */
const THRESHOLD = 8
/** 靠近开头时一直显示 */
const NEAR_TOP = 48

export function nextBar(state: BarState, top: number): BarState {
  if (top < NEAR_TOP) return { hidden: false, lastTop: top }
  const delta = top - state.lastTop
  if (Math.abs(delta) < THRESHOLD) return state
  return { hidden: delta > 0, lastTop: top }
}
