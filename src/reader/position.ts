import type { TextMap } from '../textmap'
import { positionFromPoint } from '../highlight'

// 阅读位置：存映射层里屏幕顶部第一个可见字符的位置，恢复时滚到它所在的那一行。
// 用文字位置而不是像素，换字号、换屏幕方向后也能回到同一段。

/** 文档内容变了、位置越界时夹到合法范围；没有记录时返回 null */
export function clampPosition(pos: number | null | undefined, textLength: number): number | null {
  if (pos === null || pos === undefined || !Number.isFinite(pos)) return null
  if (textLength <= 0) return null
  return Math.max(0, Math.min(Math.floor(pos), textLength - 1))
}

/** 让 targetTop 处的内容出现在容器顶部（留一点边距）所需的 scrollTop */
export function scrollTopFor(currentScrollTop: number, targetTop: number, containerTop: number, margin = 12): number {
  return Math.max(0, currentScrollTop + (targetTop - containerTop) - margin)
}

/** 阅读进度 0–1 */
export function progressOf(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const max = scrollHeight - clientHeight
  if (max <= 0) return 1
  return Math.max(0, Math.min(1, scrollTop / max))
}

/** 容器顶部第一个可见字符的位置。顶部正好落在段落间隙时往下多试几处 */
export function topVisiblePosition(map: TextMap, container: HTMLElement): number | null {
  const box = container.getBoundingClientRect()
  const style = getComputedStyle(container)
  const x = box.left + parseFloat(style.paddingLeft || '0') + 4
  for (let dy = 4; dy < Math.min(box.height, 240); dy += 12) {
    const pos = positionFromPoint(map, x, box.top + dy)
    if (pos !== null) return pos
  }
  return null
}

export function scrollToPosition(map: TextMap, container: HTMLElement, pos: number): void {
  const p = clampPosition(pos, map.text.length)
  if (p === null) return
  const rect = map.toRange(p, Math.min(p + 1, map.text.length)).getBoundingClientRect()
  if (rect.top === 0 && rect.height === 0) return
  container.scrollTop = scrollTopFor(container.scrollTop, rect.top, container.getBoundingClientRect().top)
}
