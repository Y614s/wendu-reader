/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// 内容安全策略，纵深防御：渲染链路万一出现注入，注入的脚本也跑不起来。
// - connect-src 要放行 https：AI 接口是用户自己填的，http 只放行本机调试。
// - img-src 放行 https：外部图片默认不加载，用户点了才加载那一张。
// - style-src 要 unsafe-inline：KaTeX 和 Shiki 都用内联样式。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/**
 * 只在正式构建时加（开发时 Vite 的热更新要用内联脚本）。放在 <head> 最前面。
 * 旧 WebView 上 Capacitor 把桥接脚本内联插到 <head> 紧后面，排在这个标签之前，CSP 对它不生效，
 * 所以不会拦住 Capacitor；新 WebView 用 addDocumentStartJavaScript 注入，也不受 CSP 影响。
 */
function cspPlugin(): Plugin {
  return {
    name: 'wendu-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  }
}

export default defineConfig({
  // 相对路径：同一份构建产物既能部署到 Vercel，也能被 Capacitor 从本地加载
  base: './',
  plugins: [
    vue(),
    cspPlugin(),
    // 网页版离线：预缓存所有资源（含 KaTeX 字体、Shiki 语言包和测试文档）。
    // 只在网页版注册 Service Worker（见 src/platform/pwa.ts），App 版资源本来就在本地。
    VitePWA({
      injectRegister: false,
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff,woff2,ttf,md,svg,png,ico}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
})
