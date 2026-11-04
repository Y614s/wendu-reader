// 布局分宽屏（侧栏在右）和窄屏（侧栏是底部抽屉），结果写到 <html data-layout>。
// 不用 CSS 的 orientation：竖屏弹出键盘后可视区域的高度比宽度小，会被当成横屏，布局突然变成左右分栏。
// 屏幕方向和窗口宽度都不受键盘影响。

export type Layout = 'wide' | 'narrow'

/** 窗口比这个窄时放不下左右分栏，例如分屏 */
const MIN_WIDE = 1024

export function layoutFor(windowWidth: number, orientationType: string | undefined): Layout {
  if (orientationType?.startsWith('portrait')) return 'narrow'
  return windowWidth < MIN_WIDE ? 'narrow' : 'wide'
}

function apply() {
  document.documentElement.dataset.layout = layoutFor(window.innerWidth, screen.orientation?.type)
}

export function initLayout(): void {
  apply()
  window.addEventListener('resize', apply)
  screen.orientation?.addEventListener('change', apply)
}
