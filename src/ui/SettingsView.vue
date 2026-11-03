<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ProviderSettings from './ProviderSettings.vue'
import { setTheme, themeSetting, type ThemeSetting } from '../app/theme'
import { prefs, setContextBudget, setEdgeTap } from '../app/prefs'
import { appState, showToast } from '../app/store'
import { db, getSetting, setSetting } from '../db'
import { loadCurrentDocument } from '../db/documents'
import { BackupError, clearAllData, createBackup, parseBackup, restoreBackup, REMIND_AFTER_MS, type RestoreMode } from '../db/backup'
import { getProviderSettings, PROVIDER_PRESETS } from '../ai/providers'
import { saveTextFile } from '../platform/files'
import { formatDate } from '../export/markdown'

const themes: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '日间' },
  { value: 'dark', label: '夜间' },
]

const budgetInput = ref(prefs.contextBudget)
const lastExportAt = ref<number | null>(null)
const restoreInput = ref<HTMLInputElement | null>(null)
const restoreMode = ref<RestoreMode>('merge')
const busy = ref(false)
const restoreMessage = ref('')

function fmt(t: number) {
  return new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function saveBudget() {
  await setContextBudget(Number(budgetInput.value) || 0)
  budgetInput.value = prefs.contextBudget
  showToast(`上下文预算：${prefs.contextBudget} token`)
}

async function exportBackup() {
  busy.value = true
  try {
    const backup = await createBackup(db)
    const r = await saveTextFile(`问读备份-${formatDate(backup.exportedAt)}.json`, JSON.stringify(backup), 'application/json')
    if (r !== 'cancelled') {
      await setSetting('backup.lastExportAt', backup.exportedAt)
      lastExportAt.value = backup.exportedAt
      showToast('备份已导出（不含 API Key）')
    }
  } catch (e) {
    showToast(`导出备份失败：${String(e)}`, 5000)
  } finally {
    busy.value = false
  }
}

function pickRestore(mode: RestoreMode) {
  restoreMode.value = mode
  restoreMessage.value = ''
  restoreInput.value?.click()
}

async function onRestoreFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = true
  try {
    // 先完整读取和校验，校验通过才动数据库
    const backup = parseBackup(await file.text())
    const t = backup.tables
    const summary = `${t.documents.length} 篇文档、${t.highlights.length} 处划线、${t.notes.length} 条批注、${t.conversations.length} 条对话`
    const warn =
      restoreMode.value === 'replace'
        ? `用备份替换本机数据？\n\n备份里有 ${summary}。\n本机现有的文档和笔记会被全部替换，无法撤销。`
        : `把备份合并进来？\n\n备份里有 ${summary}。\n本机已有的同一条数据保留本机的，不会被覆盖。`
    if (!confirm(warn)) return
    const r = await restoreBackup(db, backup, restoreMode.value)
    const doc = await loadCurrentDocument(async () => '')
    appState.currentDocId = doc?.id ?? null
    appState.docsVersion++
    const hasKey = (await Promise.all(PROVIDER_PRESETS.map((p) => getProviderSettings(p.id)))).some((s) => s.hasKey)
    restoreMessage.value =
      `恢复完成：新增 ${r.added.documents} 篇文档、${r.added.highlights} 处划线、${r.added.notes} 条批注、${r.added.conversations} 条对话` +
      (r.skipped ? `；本机已有的 ${r.skipped} 条保留不变` : '') +
      '。' +
      (hasKey ? '' : '备份里不含 API Key，请在上方重新填写。')
  } catch (err) {
    restoreMessage.value = err instanceof BackupError ? `没有恢复：${err.message} 现有数据没有任何改动。` : `恢复失败，现有数据没有改动：${String(err)}`
  } finally {
    busy.value = false
  }
}

async function clearAll() {
  const backupHint = lastExportAt.value ? `上次备份是 ${fmt(lastExportAt.value)}，之后的改动会丢失。` : '你还没有导出过备份，清除后数据无法找回。'
  if (!confirm(`清除全部数据？\n\n所有文档、划线、批注、对话和设置（包括 API Key）都会被删除。\n${backupHint}`)) return
  if (!confirm('再确认一次：真的要清除全部数据吗？此操作无法撤销。')) return
  busy.value = true
  try {
    await clearAllData(db)
    // 重新加载，和刚安装时一样：内置测试文档会重新导入，主题等设置回到默认
    location.reload()
  } catch (e) {
    busy.value = false
    showToast(`清除失败，数据没有改动：${String(e)}`, 5000)
  }
}

onMounted(async () => {
  lastExportAt.value = await getSetting<number | null>('backup.lastExportAt', null)
})
</script>

<template>
  <div class="settings">
    <ProviderSettings />

    <section>
      <h2>阅读</h2>
      <div class="field">
        <span class="field-label">主题</span>
        <div class="seg">
          <button v-for="t in themes" :key="t.value" :class="{ on: themeSetting === t.value }" @click="setTheme(t.value)">{{ t.label }}</button>
        </div>
      </div>
      <label class="check">
        <input type="checkbox" :checked="prefs.edgeTap" @change="setEdgeTap(($event.target as HTMLInputElement).checked)" />
        点屏幕上下边缘翻一屏
      </label>
      <div class="field">
        <span class="field-label">提问时的上下文预算（token）</span>
        <div class="row">
          <input v-model.number="budgetInput" type="number" min="500" step="1000" />
          <button @click="saveBudget">保存</button>
        </div>
        <span class="muted small">发给 AI 的原文按这个预算截取，大约等于同样数量的汉字。「全文」放不下时会提示只发送了部分内容。</span>
      </div>
    </section>

    <section>
      <h2>备份与恢复</h2>
      <p>
        上次备份：<strong>{{ lastExportAt ? fmt(lastExportAt) : '还没有备份过' }}</strong>
        <span v-if="lastExportAt && Date.now() - lastExportAt > REMIND_AFTER_MS" class="warn">（超过 7 天了）</span>
      </p>
      <p class="muted small">备份包含所有文档、划线、批注、对话和设置，<strong>不含 API Key</strong>。数据只在本机，换设备或重装前请先备份。</p>
      <div class="row">
        <button class="primary" :disabled="busy" @click="exportBackup">导出备份</button>
        <button :disabled="busy" @click="pickRestore('merge')">从备份恢复（合并）</button>
        <button :disabled="busy" class="danger" @click="pickRestore('replace')">从备份恢复（替换）</button>
      </div>
      <input ref="restoreInput" type="file" accept=".json,application/json" hidden @change="onRestoreFile" />
      <p class="muted small">合并：同一条数据本机已有时保留本机的。替换：本机的文档和笔记全部换成备份里的，API Key 保留。</p>
      <p v-if="restoreMessage" class="result">{{ restoreMessage }}</p>
    </section>

    <section>
      <h2>清除数据</h2>
      <p class="muted small">删除本机所有文档、划线、批注、对话和设置（包括 API Key），相当于重新安装。无法撤销，清除前请先导出备份。</p>
      <button class="danger" :disabled="busy" @click="clearAll">清除全部数据</button>
    </section>
  </div>
</template>

<style scoped>
.settings {
  max-width: 640px;
  padding: 16px 24px 48px;
}
section + section {
  margin-top: 32px;
  border-top: 1px solid var(--border);
}
.field,
.check {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 16px 0;
}
.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.check input {
  width: 20px;
  height: 20px;
}
.field-label {
  font-weight: 500;
}
.seg {
  display: flex;
  gap: 6px;
}
.seg button.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
input[type='number'] {
  width: 140px;
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
}
button {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 15px;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
button.danger {
  color: var(--danger);
}
button:disabled {
  opacity: 0.5;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 13px;
}
.warn {
  color: var(--warn);
}
.result {
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--surface);
}
</style>
