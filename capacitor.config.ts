import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // appId 一旦发布不可更改，否则无法覆盖安装
  appId: 'app.wendu.reader',
  appName: '问读',
  webDir: 'dist',
  server: {
    // WebView 的 origin（https://localhost）决定 IndexedDB 存在哪里，改了等于丢数据。
    // 这两项就是 Capacitor 的默认值，显式写出是为了防止以后被误改。
    androidScheme: 'https',
    hostname: 'localhost',
  },
}

export default config
