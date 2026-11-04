import { describe, expect, it } from 'vitest'
import { findMatches, firstMatchFrom, stepMatch } from '../../src/reader/search'

describe('findMatches', () => {
  it('找到所有匹配位置', () => {
    expect(findMatches('红黑树和红黑树', '红黑树')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ])
  })

  it('忽略大小写', () => {
    expect(findMatches('AVL avl Avl', 'avl')).toHaveLength(3)
  })

  it('空关键词和空白没有结果', () => {
    expect(findMatches('文字', '')).toEqual([])
    expect(findMatches('文字', '   ')).toEqual([])
  })

  it('关键词里的正则特殊字符按普通字符处理', () => {
    expect(findMatches('a.b axb (c) [d]', 'a.b')).toEqual([{ start: 0, end: 3 }])
    expect(findMatches('(c)', '(c)')).toHaveLength(1)
    expect(findMatches('a\\b', '\\')).toHaveLength(1)
  })

  it('没有匹配时是空的', () => {
    expect(findMatches('红黑树', 'AVL')).toEqual([])
  })
})

describe('firstMatchFrom', () => {
  const m = [
    { start: 10, end: 12 },
    { start: 50, end: 52 },
  ]

  it('从当前位置往后找第一处', () => {
    expect(firstMatchFrom(m, 0)).toBe(0)
    expect(firstMatchFrom(m, 20)).toBe(1)
  })

  it('后面没有时回到第一处，没有结果时是 -1', () => {
    expect(firstMatchFrom(m, 99)).toBe(0)
    expect(firstMatchFrom([], 0)).toBe(-1)
  })
})

describe('stepMatch', () => {
  it('上一个、下一个首尾循环', () => {
    expect(stepMatch(0, 3, 1)).toBe(1)
    expect(stepMatch(2, 3, 1)).toBe(0)
    expect(stepMatch(0, 3, -1)).toBe(2)
    expect(stepMatch(0, 0, 1)).toBe(-1)
  })
})
