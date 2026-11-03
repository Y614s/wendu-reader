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

/** 标题取 YAML 的 title，没有就取第一个一级标题，再没有就用文件名。 */
export function parseDoc(source: string, fallbackTitle: string): ParsedDoc {
  const { meta, body } = splitFrontMatter(source)
  const h1 = /^#[ \t]+(.+?)[ \t#]*$/m.exec(body)
  return { title: meta.title || h1?.[1] || fallbackTitle, body }
}

export function createMarkdown(highlight?: CodeHighlighter): MarkdownItInstance {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    highlight: highlight ? (code, lang) => highlight(code, lang) ?? '' : undefined,
  })
  md.use(mathPlugin)
  md.use(calloutPlugin)
  // 外链在 App 里会把 WebView 导走，统一新窗口打开
  const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const href = String(tokens[idx].attrGet('href') ?? '')
    if (/^https?:/i.test(href)) {
      tokens[idx].attrSet('target', '_blank')
      tokens[idx].attrSet('rel', 'noopener noreferrer')
    }
    return defaultLink(tokens, idx, opts, env, self)
  }
  return md
}

export function renderMarkdown(source: string, highlight?: CodeHighlighter): string {
  return createMarkdown(highlight).render(splitFrontMatter(source).body)
}
