import { createApp } from 'vue'
import App from './App.vue'
import { runStartup } from './startup'
import { initTheme } from './theme'
import { initStore } from './store'
import { loadPrefs } from './prefs'
import { initServiceWorker } from '../platform/pwa'
import 'katex/dist/katex.min.css'
import '../ui/base.css'

void initTheme()
void runStartup()
void loadPrefs()
void initStore()
createApp(App).mount('#app')
initServiceWorker()
