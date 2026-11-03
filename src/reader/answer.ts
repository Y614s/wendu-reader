import DOMPurify from 'dompurify'
import { createMarkdown } from './markdown'

// AI 回答：markdown-it（原始 HTML 已关闭）渲染后再经 DOMPurify 净化

const md = createMarkdown()

export function renderAnswer(text: string): string {
  return DOMPurify.sanitize(md.render(text), { ADD_ATTR: ['target'] })
}

/**
 * 把回答切成顶层的块（段落、列表、代码块、公式块……），每块可以单独「存为笔记」。
 * 按 markdown-it 解析出的行号切原文，代码块和列表不会被从中间拆开。
 */
export function splitAnswerBlocks(text: string): string[] {
  const lines = text.split('\n')
  const out: string[] = []
  let depth = 0
  for (const t of md.parse(text, {})) {
    if (depth === 0 && t.map) {
      const chunk = lines.slice(t.map[0], t.map[1]).join('\n').trim()
      if (chunk) out.push(chunk)
    }
    depth += t.nesting
  }
  return out
}
