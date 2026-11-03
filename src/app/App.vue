<script setup lang="ts">
import { route, navigate, type RouteName } from './router'
import { appState } from './store'
import LibraryView from '../ui/LibraryView.vue'
import ReaderView from '../ui/ReaderView.vue'
import SettingsView from '../ui/SettingsView.vue'
import DiagnosticsView from '../diagnostics/DiagnosticsView.vue'

const tabs: { name: RouteName; label: string }[] = [
  { name: 'library', label: '书架' },
  { name: 'reader', label: '阅读' },
  { name: 'settings', label: '设置' },
  { name: 'diagnostics', label: '诊断' },
]
</script>

<template>
  <div class="app">
    <nav class="topbar">
      <span class="brand">问读</span>
      <button
        v-for="t in tabs"
        :key="t.name"
        class="tab"
        :class="{ active: route === t.name }"
        @click="navigate(t.name)"
      >
        {{ t.label }}
      </button>
    </nav>
    <main class="page">
      <LibraryView v-if="route === 'library'" />
      <!-- 阅读页常驻：去其他页再回来，选区缓存、面板和渲染结果都还在 -->
      <ReaderView v-show="route === 'reader'" :active="route === 'reader'" />
      <SettingsView v-if="route === 'settings'" />
      <DiagnosticsView v-else-if="route === 'diagnostics'" />
    </main>
    <div v-if="appState.toast" class="toast">{{ appState.toast }}</div>
  </div>
</template>
