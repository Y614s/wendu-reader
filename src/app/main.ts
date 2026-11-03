import { createApp } from 'vue'
import App from './App.vue'
import { runStartup } from './startup'
import 'katex/dist/katex.min.css'
import '../ui/base.css'

void runStartup()
createApp(App).mount('#app')
