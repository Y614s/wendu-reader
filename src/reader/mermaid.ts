import DOMPurify from 'dompurify'
import type { ResolvedTheme } from '../app/theme'

// Mermaid 图表。包很大，只有文档里真有 mermaid 代码块时才加载。
// 渲染器先输出带源码的占位容器（见 markdown.ts），这里再把图画进去：容器在映射层里始终是 1 个字符，
// 所以画图前后纯文本不变，划线和搜索位置都不受影响。

const MERMAID_THEME: Record<ResolvedTheme, 'default' | 'dark' | 'base'> = { light: 'default', sepia: 'base', dark: 'dark' }

// 米黄主题没有现成的配色，按 base.css 里的颜色给一套
const SEPIA_VARIABLES = {
  background: '#f6efdf',
  primaryColor: '#efe5cf',
  primaryBorderColor: '#8a5a1f',
  primaryTextColor: '#3b3024',
  secondaryColor: '#e5d8bb',
  tertiaryColor: '#f6efdf',
  lineColor: '#7a6a55',
  textColor: '#3b3024',
}

type Mermaid = (typeof import('mermaid'))['default']

let loading: Promise<Mermaid> | null = null

function load(): Promise<Mermaid> {
  loading ??= import('mermaid').then((m) => m.default)
  return loading
}

let counter = 0

function showError(block: HTMLElement): void {
  block.querySelector('.mermaid-error')?.remove()
  block.querySelector('.mermaid-diagram')?.remove()
  const p = block.ownerDocument.createElement('p')
  p.className = 'mermaid-error'
  p.textContent = '图表画不出来，这里显示原始代码'
  block.appendChild(p)
}

/**
 * 画出 root 里还没按当前主题画过的图。语法错误时保留源码并提示，不影响其他内容。
 * 页面隐藏时量不到尺寸，调用方要在可见时才调用。返回页面高度是否可能变了。
 */
export async function renderMermaidBlocks(root: Element, theme: ResolvedTheme, cancelled: () => boolean): Promise<boolean> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block')).filter((b) => b.dataset.renderedTheme !== theme)
  if (blocks.length === 0) return false

  let mermaid: Mermaid
  try {
    mermaid = await load()
  } catch (e) {
    console.warn('Mermaid 加载失败，按代码块显示', e)
    blocks.forEach(showError)
    return true
  }
  mermaid.initialize({
    startOnLoad: false,
    // strict：不执行图里的脚本和点击回调。文字标签用 SVG 文本，不用 foreignObject，净化时才能保留
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: MERMAID_THEME[theme],
    themeVariables: theme === 'sepia' ? SEPIA_VARIABLES : undefined,
  })

  for (const block of blocks) {
    if (cancelled()) return true
    const id = `wendu-mermaid-${++counter}`
    try {
      const { svg } = await mermaid.render(id, block.dataset.mermaid ?? '')
      if (cancelled()) return true
      const diagram = block.ownerDocument.createElement('div')
      diagram.className = 'mermaid-diagram'
      diagram.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
      block.querySelector('.mermaid-error')?.remove()
      block.querySelector('.mermaid-diagram')?.remove()
      block.querySelector('.mermaid-source')?.setAttribute('hidden', '')
      block.appendChild(diagram)
    } catch {
      // 语法错误：render 失败时会留下临时节点，清掉
      block.ownerDocument.getElementById(`d${id}`)?.remove()
      block.querySelector('.mermaid-source')?.removeAttribute('hidden')
      showError(block)
    }
    block.dataset.renderedTheme = theme
  }
  return true
}
