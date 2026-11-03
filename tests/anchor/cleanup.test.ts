import { describe, expect, it } from 'vitest'
import { anchorLeftBehind } from '../../src/anchor/cleanup'

describe('侧栏切换时清理空锚点的时机', () => {
  it('切到笔记不算离开，切回同一处原文也不算', () => {
    expect(anchorLeftBehind('a', { mode: 'notes' })).toBeNull()
    expect(anchorLeftBehind('a', { mode: 'ask', anchorId: 'a' })).toBeNull()
  })

  it('关闭侧栏、换到另一处原文或整篇提问时，检查上一处原文', () => {
    expect(anchorLeftBehind('a', null)).toBe('a')
    expect(anchorLeftBehind('a', { mode: 'ask', anchorId: 'b' })).toBe('a')
    expect(anchorLeftBehind('a', { mode: 'ask', anchorId: null })).toBe('a')
  })

  it('上一次是整篇提问或还没打开过时，不需要清理', () => {
    expect(anchorLeftBehind(null, null)).toBeNull()
    expect(anchorLeftBehind(null, { mode: 'ask', anchorId: 'b' })).toBeNull()
  })
})
