import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { CodeHighlighter } from './markdown'

// Shiki 只打包 CLAUDE.md 列出的语言，用 JS 正则引擎，不需要加载 wasm。
// mermaid 等未列出的语言按普通代码块显示。

const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  shellscript: 'bash',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  golang: 'go',
  rs: 'rust',
}

let pending: Promise<HighlighterCore> | null = null

function load(): Promise<HighlighterCore> {
  pending ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs')],
    langs: [
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/python.mjs'),
      import('shiki/langs/java.mjs'),
      import('shiki/langs/c.mjs'),
      import('shiki/langs/cpp.mjs'),
      import('shiki/langs/go.mjs'),
      import('shiki/langs/rust.mjs'),
      import('shiki/langs/sql.mjs'),
      import('shiki/langs/bash.mjs'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/yaml.mjs'),
      import('shiki/langs/markdown.mjs'),
    ],
    engine: createJavaScriptRegexEngine(),
  })
  return pending
}

/** 返回同步的高亮函数；加载失败时返回 null，调用方按无高亮渲染。 */
export async function getCodeHighlighter(): Promise<CodeHighlighter | null> {
  try {
    const hl = await load()
    const loaded = new Set(hl.getLoadedLanguages())
    return (code, rawLang) => {
      const lang = ALIASES[rawLang.toLowerCase()] ?? rawLang.toLowerCase()
      if (!loaded.has(lang)) return null
      return hl.codeToHtml(code, { lang, theme: 'github-light' })
    }
  } catch (e) {
    console.warn('代码高亮加载失败，按普通代码块显示', e)
    return null
  }
}
