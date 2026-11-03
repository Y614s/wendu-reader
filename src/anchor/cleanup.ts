// 侧栏切换时，判断哪处原文的提问面板算是「离开了」，需要检查并清理空锚点。
// 只在侧栏里切到「笔记」再切回来不算离开：没提问的那处原文要保留，点回「提问」时还能接着问。

export type PanelTarget = { mode: 'ask'; anchorId: string | null } | { mode: 'notes' } | null

/**
 * @param lastAskAnchor 最近一次打开的提问面板对应的锚点（整篇提问为 null）
 * @param next 侧栏切换后的状态
 * @returns 需要检查是否为空锚点的 id；不需要时为 null
 */
export function anchorLeftBehind(lastAskAnchor: string | null, next: PanelTarget): string | null {
  if (!lastAskAnchor) return null
  // 关闭侧栏
  if (next === null) return lastAskAnchor
  // 切到另一处原文或整篇提问
  if (next.mode === 'ask' && next.anchorId !== lastAskAnchor) return lastAskAnchor
  // 切到笔记，或回到同一处原文
  return null
}
