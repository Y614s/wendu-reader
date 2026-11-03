import type { MarkdownIt, StateCore, Token } from 'markdown-it'

// Obsidian 风格提示块：
//   > [!tip] 一句话记住
//   > 正文……
// 渲染成 <blockquote class="callout callout-tip"><div class="callout-title">一句话记住</div><p>正文……</p></blockquote>
// 标题用 text 子 token 输出，内容照常转义；提示块里的文字照常可选、可划线。

const DEFAULT_TITLES: Record<string, string> = {
  note: '备注',
  abstract: '摘要',
  summary: '摘要',
  info: '信息',
  todo: '待办',
  tip: '提示',
  hint: '提示',
  important: '重要',
  success: '完成',
  question: '问题',
  faq: '问题',
  help: '帮助',
  warning: '注意',
  caution: '小心',
  attention: '注意',
  failure: '失败',
  danger: '危险',
  error: '错误',
  bug: 'Bug',
  example: '示例',
  quote: '引用',
}

const MARKER = /^\[!([A-Za-z-]+)\][+-]?[ \t]*(.*)$/

export function calloutPlugin(md: MarkdownIt): void {
  // 在行内解析之前改写 token，被拿掉的标记行不会进入正文
  md.core.ruler.before('inline', 'callout', (state: StateCore) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== 'blockquote_open') continue
      if (tokens[i + 1].type !== 'paragraph_open' || tokens[i + 2].type !== 'inline') continue
      const inline = tokens[i + 2]
      const [first, ...rest] = inline.content.split('\n')
      const m = MARKER.exec(first)
      if (!m) continue

      const type = m[1].toLowerCase()
      tokens[i].attrJoin('class', `callout callout-${type}`)
      tokens[i].attrSet('data-callout', type)

      const title = new state.Token('callout_title', 'div', 0)
      title.content = m[2].trim() || DEFAULT_TITLES[type] || type
      title.block = true

      const body = rest.join('\n')
      if (body.trim()) {
        inline.content = body
        tokens.splice(i + 1, 0, title)
      } else {
        // 只有标题、没有正文：去掉空段落
        tokens.splice(i + 1, 3, title)
      }
    }
  })

  md.renderer.rules.callout_title = (tokens: Token[], idx: number) =>
    `<div class="callout-title">${md.utils.escapeHtml(tokens[idx].content)}</div>\n`
}
