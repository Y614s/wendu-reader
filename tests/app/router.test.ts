import { describe, expect, it } from 'vitest'
import { parseHash } from '../../src/app/router'

describe('parseHash', () => {
  it('识别已知页面', () => {
    expect(parseHash('#/settings')).toBe('settings')
    expect(parseHash('#/diagnostics')).toBe('diagnostics')
    expect(parseHash('#settings')).toBe('settings')
    expect(parseHash('#/library')).toBe('library')
  })

  it('未知或空 hash 回到阅读页', () => {
    expect(parseHash('')).toBe('reader')
    expect(parseHash('#/')).toBe('reader')
    expect(parseHash('#/nope')).toBe('reader')
  })

  it('忽略子路径和查询参数', () => {
    expect(parseHash('#/settings/abc')).toBe('settings')
    expect(parseHash('#/diagnostics?x=1')).toBe('diagnostics')
  })
})
