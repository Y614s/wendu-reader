import { describe, expect, it } from 'vitest'
import { layoutFor } from '../../src/app/layout'

describe('布局', () => {
  it('横屏够宽时左右分栏', () => {
    expect(layoutFor(1366, 'landscape-primary')).toBe('wide')
  })

  it('竖屏一定是抽屉，再宽也是', () => {
    expect(layoutFor(1060, 'portrait-primary')).toBe('narrow')
  })

  it('横屏分屏变窄时用抽屉', () => {
    expect(layoutFor(800, 'landscape-primary')).toBe('narrow')
  })

  it('取不到屏幕方向时按宽度判断', () => {
    expect(layoutFor(1366, undefined)).toBe('wide')
    expect(layoutFor(800, undefined)).toBe('narrow')
  })
})
