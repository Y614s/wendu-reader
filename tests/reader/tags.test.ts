import { describe, expect, it } from 'vitest'
import { parseTags } from '../../src/reader/markdown'

describe('parseTags', () => {
  it('行内数组', () => {
    expect(parseTags('---\ntitle: x\ntags: [数据结构, 树]\n---\n\n正文')).toEqual(['数据结构', '树'])
  })

  it('多行列表', () => {
    expect(parseTags('---\ntags:\n  - 数据结构\n  - "树"\ndate: 2026\n---\n')).toEqual(['数据结构', '树'])
  })

  it('逗号分隔和单个标签，支持中文逗号', () => {
    expect(parseTags('---\ntags: a, b，c\n---\n')).toEqual(['a', 'b', 'c'])
    expect(parseTags('---\ntags: 单个\n---\n')).toEqual(['单个'])
  })

  it('去掉引号、空项和重复', () => {
    expect(parseTags("---\ntags: ['a', \"b\", , a]\n---\n")).toEqual(['a', 'b'])
  })

  it('没有信息块或没有 tags 时是空的', () => {
    expect(parseTags('# 标题\n\ntags: [a]')).toEqual([])
    expect(parseTags('---\ntitle: x\n---\n')).toEqual([])
    expect(parseTags('---\ntags:\n---\n')).toEqual([])
  })
})
