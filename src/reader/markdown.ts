import MarkdownIt, { type MarkdownIt as MarkdownItInstance } from 'markdown-it'
import { calloutPlugin } from './callout'
import { mathPlugin } from './math'

// 渲染管线：md 原文 → HTML 字符串。原始 HTML 一律关闭。
// 代码高亮通过 highlight 回调注入，测试里可以不传，保持同步、无外部依赖。

export type CodeHighlighter = (code: string, lang: string) => string | null

export interface ParsedDoc {
  title: string
  body: string
}

/** 导入时统一换行符：Windows 或微信传来的文件可能是 CRLF，统一后锚点位置在各端一致。 */
export function normalizeSource(source: string): string {
  return source.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

/** 拆出开头的 YAML 信息块。只取 title，其他字段第一版不用。 */
export function splitFrontMatter(source: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source)
  if (!m) return { meta: {}, body: source }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return { meta, body: source.slice(m[0].length) }
}

/**
 * 从开头的 YAML 信息块解析标签，用到时才算，不存进数据库。
 * 支持 tags: [a, b]、tags: a, b、tags: a，以及多行列表写法。
 */
export function parseTags(source: string): string[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source)
  if (!m) return []
  const lines = m[1].split(/\r?\n/)
  const i = lines.findIndex((l) => /^tags\s*:/.test(l))
  if (i === -1) return []
  const clean = (s: string) => s.trim().replace(/^['"]|['"]$/g, '').trim()
  const inline = lines[i].replace(/^tags\s*:/, '').trim()
  let tags: string[]
  if (inline) {
    tags = inline.replace(/^\[|\]$/g, '').split(/[,，]/).map(clean)
  } else {
    tags = []
    for (const line of lines.slice(i + 1)) {
      const item = /^\s*-\s+(.*)$/.exec(line)
      if (!item) break
      tags.push(clean(item[1]))
    }
  }
  return [...new Set(tags.filter(Boolean))]
}

/** 标题取 YAML 的 title，没有就取第一个一级标题，再没有就用文件名。 */
export function parseDoc(source: string, fallbackTitle: string): ParsedDoc {
  const { meta, body } = splitFrontMatter(source)
  const h1 = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body)
  return { title: meta.title || h1?.[1] || fallbackTitle, body }
}

/** 允许打开的链接：网页、邮件、页内跳转 */
const SAFE_LINK = /^(https?:|mailto:|#)/i
/** 会发起网络请求的地址，含 // 开头的协议相对地址 */
const REMOTE_URL = /^(https?:)?\/\//i

export function createMarkdown(highlight?: CodeHighlighter): MarkdownItInstance {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    highlight: highlight ? (code, lang) => highlight(code, lang) ?? '' : undefined,
  })
  md.use(mathPlugin)
  md.use(calloutPlugin)
  // 文档和 AI 回答都走这里，内容都不可信：
  // 其他 scheme（weixin:、tel: 等）在 App 里会直接调起别的 App，去掉 href 只留文字
  const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const token = tokens[idx]
    const href = String(token.attrGet('href') ?? '')
    if (!SAFE_LINK.test(href)) {
      token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'href')
      token.attrSet('title', '不支持打开这种链接')
    } else if (/^https?:/i.test(href)) {
      // 外链在 App 里会把 WebView 导走，统一新窗口打开
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
    }
    return defaultLink(tokens, idx, opts, env, self)
  }
  // Mermaid 代码块输出成带源码的容器，由 mermaid.ts 画图。容器在映射层里只占 1 个字符；
  // AI 回答不画图，容器里的源码就是普通代码块
  const defaultFence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const token = tokens[idx]
    if (token.info.trim().split(/\s+/)[0].toLowerCase() !== 'mermaid') return defaultFence(tokens, idx, opts, env, self)
    const src = token.content.replace(/\n$/, '')
    const esc = md.utils.escapeHtml(src)
    return `<div class="mermaid-block" data-mermaid="${esc}"><pre class="mermaid-source"><code>${esc}</code></pre></div>\n`
  }
  // 外部图片不自动加载：打开文档就发请求，图片服务器能看到 IP 和打开时间。
  // 占位的文字由 CSS 显示，不产生文本节点，文本映射层和锚点位置不受影响。
  const defaultImage = md.renderer.rules.image ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))
  md.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx]
    const src = String(token.attrGet('src') ?? '')
    if (!REMOTE_URL.test(src)) return defaultImage(tokens, idx, opts, env, self)
    const alt = self.renderInlineAsText(token.children ?? [], opts, env)
    const esc = md.utils.escapeHtml
    return `<span class="remote-image" role="button" tabindex="0" data-src="${esc(src)}" data-alt="${esc(alt)}"></span>`
  }
  return md
}

export function renderMarkdown(source: string, highlight?: CodeHighlighter): string {
  return createMarkdown(highlight).render(splitFrontMatter(source).body)
}
