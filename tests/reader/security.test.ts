import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/reader/markdown'
import { renderAnswer } from '../../src/reader/answer'
import { loadRemoteImage } from '../../src/reader/remoteImage'
import { TextMap } from '../../src/textmap'

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<article id="root">${html}</article>`
  return document.getElementById('root')!
}

describe('外部图片', () => {
  it.each(['https://attacker.example/t.png?doc=1', 'http://attacker.example/t.png', '//attacker.example/t.png'])('%s 不自动加载', (src) => {
    const root = mount(renderMarkdown(`看图 ![说明](${src}) 结束`))
    expect(root.querySelector('img')).toBeNull()
    const ph = root.querySelector<HTMLElement>('.remote-image')!
    expect(ph.dataset.src).toBe(src)
    expect(ph.dataset.alt).toBe('说明')
  })

  it('AI 回答里的外部图片同样不加载，净化后占位还能点', () => {
    const root = mount(renderAnswer('![x](https://attacker.example/t.png)'))
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector<HTMLElement>('.remote-image')!.dataset.src).toBe('https://attacker.example/t.png')
  })

  it('占位不产生文字，映射层和没有图片时一致', () => {
    const withImg = TextMap.build(mount(renderMarkdown('前文 ![说明](https://a.example/b.png) 后文'))).text
    const without = TextMap.build(mount(renderMarkdown('前文  后文'))).text
    expect(withImg).toBe(without)
  })

  it('alt 和地址里的特殊字符会被转义', () => {
    const root = mount(renderMarkdown('![a"><img src=x>](https://a.example/b.png?x="1)'))
    expect(root.querySelector('img')).toBeNull()
  })

  it('点击后才加载，且不带来源信息', () => {
    const root = mount(renderMarkdown('![说明](https://a.example/b.png)'))
    loadRemoteImage(root.querySelector<HTMLElement>('.remote-image')!)
    const img = root.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://a.example/b.png')
    expect(img.referrerPolicy).toBe('no-referrer')
    expect(root.querySelector('.remote-image')).toBeNull()
  })

  it('加载失败时换回占位并标记，再点可以重试', () => {
    const root = mount(renderMarkdown('![说明](https://a.example/b.png)'))
    const ph = root.querySelector<HTMLElement>('.remote-image')!
    loadRemoteImage(ph)
    root.querySelector('img')!.dispatchEvent(new Event('error'))
    expect(root.querySelector('img')).toBeNull()
    const back = root.querySelector<HTMLElement>('.remote-image')!
    expect(back.dataset.failed).toBe('1')
    expect(back.dataset.src).toBe('https://a.example/b.png')

    loadRemoteImage(back)
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://a.example/b.png')
  })

  it('内联图片不发请求，照常显示', () => {
    const root = mount(renderMarkdown('![x](data:image/png;base64,iVBORw0KGgo=)'))
    expect(root.querySelector('img')).not.toBeNull()
  })
})

describe('链接白名单', () => {
  it.each(['weixin://dl/pay', 'tel:10086', 'market://details?id=x', 'intent://x#Intent;end'])('%s 只留文字，不能点', (url) => {
    for (const root of [mount(renderMarkdown(`[点我](${url})`)), mount(renderAnswer(`[点我](${url})`))]) {
      const a = root.querySelector('a')
      expect(a?.hasAttribute('href') ?? false).toBe(false)
      expect(root.textContent).toContain('点我')
    }
  })

  it('网页链接新窗口打开，邮件和页内跳转保留', () => {
    const root = mount(renderMarkdown('[网页](https://a.example) [邮件](mailto:a@b.c) [页内](#x)'))
    const [web, mail, hash] = Array.from(root.querySelectorAll('a'))
    expect(web.getAttribute('target')).toBe('_blank')
    expect(web.getAttribute('rel')).toContain('noopener')
    expect(mail.getAttribute('href')).toBe('mailto:a@b.c')
    expect(hash.getAttribute('href')).toBe('#x')
  })

  it('javascript: 链接不会出现', () => {
    const root = mount(renderMarkdown('[点我](javascript:alert(1))'))
    expect(root.querySelector('a[href^="javascript"]')).toBeNull()
  })
})
