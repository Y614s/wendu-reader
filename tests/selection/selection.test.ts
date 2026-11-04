import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSelectionCache, dismissSelection, selectionState, watchSelection } from '../../src/selection'
import type { TextMap } from '../../src/textmap'

let root: HTMLElement
let stop: () => void

function fakeMap(): TextMap {
  return {
    root,
    text: root.textContent ?? '',
    fromRange: (r: Range) => ({ start: r.startOffset, end: r.endOffset, expanded: false }),
    textWithTex: (a: number, b: number) => (root.textContent ?? '').slice(a, b),
  } as unknown as TextMap
}

function select(a: number, b: number) {
  const range = document.createRange()
  const node = root.firstChild!
  range.setStart(node, a)
  range.setEnd(node, b)
  const sel = document.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

function emptySelection() {
  document.getSelection()!.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
}

beforeEach(() => {
  document.body.innerHTML = '<article id="r">红黑树是一种自平衡的二叉查找树</article>'
  root = document.getElementById('r')!
  clearSelectionCache()
  emptySelection()
  stop = watchSelection(() => fakeMap())
})

afterEach(() => {
  stop()
  vi.useRealTimers()
})

describe('选区缓存', () => {
  it('非空选区更新缓存', () => {
    select(0, 3)
    expect(selectionState.cache?.plain).toBe('红黑树')
  })

  it('点工具栏时选区被系统清空，缓存还在', () => {
    select(0, 3)
    emptySelection()
    expect(selectionState.cache?.plain).toBe('红黑树')
  })

  it('放弃选区后缓存清除，系统选区也收起', () => {
    select(0, 3)
    dismissSelection()
    expect(selectionState.cache).toBeNull()
    expect(document.getSelection()!.isCollapsed).toBe(true)
  })

  it('放弃后同一选区晚到的上报被忽略', () => {
    select(0, 3)
    const removeAll = vi.spyOn(document.getSelection()!, 'removeAllRanges').mockImplementation(() => {})
    dismissSelection()
    document.dispatchEvent(new Event('selectionchange'))
    expect(selectionState.cache).toBeNull()
    removeAll.mockRestore()
  })

  it('放弃后选中别的文字，工具栏正常出现', () => {
    select(0, 3)
    dismissSelection()
    select(4, 6)
    expect(selectionState.cache?.start).toBe(4)
  })

  it('选区真正变空后，重新选同一段也能出现', () => {
    select(0, 3)
    dismissSelection()
    emptySelection()
    select(0, 3)
    expect(selectionState.cache?.plain).toBe('红黑树')
  })

  it('系统一直没收起时，过一会儿重新选同一段也能出现', () => {
    vi.useFakeTimers()
    select(0, 3)
    const removeAll = vi.spyOn(document.getSelection()!, 'removeAllRanges').mockImplementation(() => {})
    dismissSelection()
    vi.advanceTimersByTime(1000)
    document.dispatchEvent(new Event('selectionchange'))
    expect(selectionState.cache?.plain).toBe('红黑树')
    removeAll.mockRestore()
  })
})
