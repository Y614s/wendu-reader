// 外部图片：渲染时只放占位（见 markdown.ts），点一下才加载那一张。
// 正文和 AI 回答都有占位，所以在 document 上统一处理。

export function loadRemoteImage(el: HTMLElement): void {
  const src = el.dataset.src
  if (!src) return
  const img = el.ownerDocument.createElement('img')
  // 不把「从哪个页面来」告诉图片服务器；要在设 src 之前设好，图片请求一赋值就发出去了
  img.referrerPolicy = 'no-referrer'
  img.alt = el.dataset.alt ?? ''
  img.src = src
  el.replaceWith(img)
}

export function initRemoteImages(): void {
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.remote-image')
      if (!el) return
      // 捕获阶段处理并拦下：这次点击是加载图片，不算点正文
      e.stopPropagation()
      loadRemoteImage(el)
    },
    true,
  )
}
