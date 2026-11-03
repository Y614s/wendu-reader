/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  // 相对路径：同一份构建产物既能部署到 Vercel，也能被 Capacitor 从本地加载
  base: './',
  plugins: [
    vue(),
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
