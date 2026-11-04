<script setup lang="ts">
import { activeDialog, answerDialog } from '../app/dialog'
</script>

<template>
  <div v-if="activeDialog" class="mask" role="presentation" @click.self="answerDialog(false)">
    <div class="dialog" role="alertdialog" aria-modal="true" :aria-label="activeDialog.title">
      <h3>{{ activeDialog.title }}</h3>
      <p v-if="activeDialog.message">{{ activeDialog.message }}</p>
      <div class="row">
        <button @click="answerDialog(false)">{{ activeDialog.cancelText ?? '取消' }}</button>
        <button :class="activeDialog.danger ? 'danger-fill' : 'primary'" @click="answerDialog(true)">{{ activeDialog.confirmText ?? '确定' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--scrim);
  animation: fade var(--dur) var(--ease);
}
.dialog {
  width: min(440px, 100%);
  max-height: 80vh;
  overflow: auto;
  padding: 24px;
  border-radius: var(--radius-l);
  background: var(--card);
  box-shadow: var(--shadow-3);
  animation: pop var(--dur) var(--ease);
}
h3 {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 20px;
  font-weight: 600;
}
p {
  margin: 12px 0 0;
  color: var(--muted);
  line-height: 1.7;
  white-space: pre-line;
}
.row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
</style>
