<script setup lang="ts">
import { route, navigate, type RouteName } from './router'
import { appState, closeToast } from './store'
import LibraryView from '../ui/LibraryView.vue'
import ReaderView from '../ui/ReaderView.vue'
import NotesView from '../ui/NotesView.vue'
import SettingsView from '../ui/SettingsView.vue'
import DiagnosticsView from '../diagnostics/DiagnosticsView.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import Icon, { type IconName } from '../ui/Icon.vue'

const tabs: { name: RouteName; label: string; icon: IconName }[] = [
  { name: 'library', label: '书架', icon: 'book' },
  { name: 'notes', label: '笔记', icon: 'note' },
  { name: 'settings', label: '设置', icon: 'gear' },
]

async function runToastAction() {
  const action = appState.toastAction
  closeToast()
  await action?.run()
}
</script>

<template>
  <div class="app">
    <!-- 阅读时把屏幕留给正文，阅读页自己有返回书架 -->
    <nav v-if="route !== 'reader'" class="topbar">
      <span class="brand">问读</span>
      <button v-for="t in tabs" :key="t.name" class="tab" :class="{ active: route === t.name }" @click="navigate(t.name)">
        <Icon :name="t.icon" :size="18" />{{ t.label }}
      </button>
    </nav>
    <main class="page">
      <LibraryView v-if="route === 'library'" />
      <!-- 阅读页常驻：去其他页再回来，选区缓存、面板和渲染结果都还在 -->
      <ReaderView v-show="route === 'reader'" :active="route === 'reader'" />
      <NotesView v-if="route === 'notes'" />
      <SettingsView v-else-if="route === 'settings'" />
      <DiagnosticsView v-else-if="route === 'diagnostics'" />
    </main>
    <div v-if="appState.toast" class="toast" :class="{ 'has-action': appState.toastAction }">
      <span>{{ appState.toast }}</span>
      <button v-if="appState.toastAction" @click="runToastAction">{{ appState.toastAction.label }}</button>
    </div>
    <ConfirmDialog />
  </div>
</template>
