import DOMPurify from 'dompurify'
import { createMarkdown } from './markdown'

// AI 回答：markdown-it（原始 HTML 已关闭）渲染后再经 DOMPurify 净化

const md = createMarkdown()

export function renderAnswer(text: string): string {
  return DOMPurify.sanitize(md.render(text), { ADD_ATTR: ['target'] })
}
