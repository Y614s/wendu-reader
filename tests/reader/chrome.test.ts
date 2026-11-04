import { describe, expect, it } from 'vitest'
import { nextBar } from '../../src/reader/chrome'

describe('顶栏收起', () => {
  it('向下滚动收起，向上滚动出现', () => {
    const down = nextBar({ hidden: false, lastTop: 200 }, 260)
    expect(down.hidden).toBe(true)
    expect(nextBar(down, 230).hidden).toBe(false)
  })

  it('手指抖动不改变状态', () => {
    const s = { hidden: true, lastTop: 300 }
    expect(nextBar(s, 296)).toEqual(s)
    expect(nextBar(s, 305)).toEqual(s)
  })

  it('慢慢滑动累积够距离也算', () => {
    let s = { hidden: false, lastTop: 200 }
    for (const top of [203, 206, 209]) s = nextBar(s, top)
    expect(s.hidden).toBe(true)
  })

  it('回到开头一定显示', () => {
    expect(nextBar({ hidden: true, lastTop: 60 }, 40).hidden).toBe(false)
    expect(nextBar({ hidden: true, lastTop: 500 }, 0).hidden).toBe(false)
  })
})
