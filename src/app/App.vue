<script setup lang="ts">
import { route, navigate, type RouteName } from './router'
import ReaderView from '../ui/ReaderView.vue'
import SettingsView from '../ui/SettingsView.vue'
import DiagnosticsView from '../diagnostics/DiagnosticsView.vue'

const tabs: { name: RouteName; label: string }[] = [
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
      <ReaderView v-if="route === 'reader'" />
      <SettingsView v-else-if="route === 'settings'" />
      <DiagnosticsView v-else />
    </main>
  </div>
</template>
