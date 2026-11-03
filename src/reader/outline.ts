import type { TextMap } from '../textmap'

// 文档大纲：标题在映射层里的位置。目录、上下文的「本节」、导出的章节都用它。

export interface Heading {
  level: number
  title: string
  /** 标题第一个字符在映射层里的位置 */
  pos: number
  el: HTMLElement
}

export function collectHeadings(map: TextMap): Heading[] {
  const out: Heading[] = []
  for (const el of Array.from(map.root.querySelectorAll<HTMLElement>('h1,h2,h3'))) {
    out.push({
      level: Number(el.tagName[1]),
      title: el.textContent?.trim() ?? '',
      pos: map.fromDom(el, 0, 'start').pos,
      el,
    })
  }
  return out
}

/** 「节」按一、二级标题划分；返回每节的起点（第一个总是 0） */
export function sectionStarts(headings: Heading[]): number[] {
  const starts = [0, ...headings.filter((h) => h.level <= 2).map((h) => h.pos)]
  return [...new Set(starts)].sort((a, b) => a - b)
}

/** pos 所在的最近一个标题（level 不超过 maxLevel） */
export function headingAt(headings: Heading[], pos: number, maxLevel = 3): Heading | null {
  let found: Heading | null = null
  for (const h of headings) {
    if (h.level > maxLevel) continue
    if (h.pos > pos) break
    found = h
  }
  return found
}
