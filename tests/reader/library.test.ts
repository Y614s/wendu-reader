import { describe, expect, it } from 'vitest'
import { continueDoc, percent, sortByRecent } from '../../src/reader/library'
import type { DocumentRecord } from '../../src/db'

function doc(id: string, lastReadAt: number, progress?: number, importedAt = 0): DocumentRecord {
  return { id, title: id, source: '', hash: '', importedAt, lastReadAt, readingPosition: null, progress }
}

describe('书架', () => {
  it('最近阅读的排在前面，时间相同时后导入的在前', () => {
    const list = [doc('a', 1), doc('b', 3), doc('c', 2), doc('d', 3, undefined, 5)]
    expect(sortByRecent(list).map((d) => d.id)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('排序不改原数组', () => {
    const list = [doc('a', 1), doc('b', 2)]
    sortByRecent(list)
    expect(list[0].id).toBe('a')
  })

  it('继续阅读取最近读了一半的', () => {
    expect(continueDoc([doc('a', 3, 1), doc('b', 2, 0.4), doc('c', 1, 0.5)])?.id).toBe('b')
  })

  it('没开始或都读完时没有继续阅读', () => {
    expect(continueDoc([doc('a', 1), doc('b', 2, 0), doc('c', 3, 1)])).toBeNull()
  })

  it('进度换算成整数百分比', () => {
    expect(percent(0.346)).toBe(35)
    expect(percent(undefined)).toBe(0)
  })
})
