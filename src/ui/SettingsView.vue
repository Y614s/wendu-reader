<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { navigate } from '../app/router'
import { getAppVersion } from '../platform'
import Icon, { type IconName } from './Icon.vue'
import ProviderSettings from './ProviderSettings.vue'
import TypographySettings from './TypographySettings.vue'
import PromptSettings from './PromptSettings.vue'
import { prefs, setColorName, setContextBudget, setEdgeTap } from '../app/prefs'
import { DEFAULT_COLOR_NAMES, HIGHLIGHT_COLORS, MAX_COLOR_NAME } from '../highlight/colors'
import { showToast } from '../app/store'
import { confirmDialog } from '../app/dialog'
import { db, getSetting, setSetting } from '../db'
import { BackupError, clearAllData, createBackup, parseBackup, restoreBackup, REMIND_AFTER_MS, type RestoreMode } from '../db/backup'
import { getProviderSettings, PROVIDER_PRESETS } from '../ai/providers'
import { saveTextFile } from '../platform/files'
import { formatDate } from '../export/markdown'

type SectionId = 'ai' | 'reading' | 'colors' | 'prompts' | 'data' | 'about'
const sections: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'ai', label: 'AI 接口', icon: 'ask' },
  { id: 'reading', label: '阅读', icon: 'type' },
  { id: 'colors', label: '划线颜色', icon: 'palette' },
  { id: 'prompts', label: '快捷提问', icon: 'spark' },
  { id: 'data', label: '备份与数据', icon: 'data' },
  { id: 'about', label: '关于', icon: 'info' },
]
const section = ref<SectionId>('ai')
const version = ref('')

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
    const replace = restoreMode.value === 'replace'
    const ok = await confirmDialog({
      title: replace ? '用备份替换本机数据？' : '把备份合并进来？',
      message: replace
        ? `备份里有 ${summary}。\n本机现有的文档和笔记会被全部替换，无法撤销。AI 接口配置和 API Key 保留本机的。`
        : `备份里有 ${summary}。\n本机已有的同一条数据保留本机的，不会被覆盖。`,
      confirmText: replace ? '替换' : '合并',
      danger: replace,
    })
    if (!ok) return
    const r = await restoreBackup(db, backup, restoreMode.value)
    const hasKey = (await Promise.all(PROVIDER_PRESETS.map((p) => getProviderSettings(p.id)))).some((s) => s.hasKey)
    const message =
      `恢复完成：新增 ${r.added.documents} 篇文档、${r.added.highlights} 处划线、${r.added.notes} 条批注、${r.added.conversations} 条对话` +
      (r.skipped ? `；本机已有的 ${r.skipped} 条保留不变` : '') +
      '。' +
      (hasKey ? '' : '备份不含 AI 接口配置和 API Key，请在上方重新填写。')
    // 备份里的主题、预算等设置已写进数据库，重新加载让各处都按新数据显示；结果提示带到重新加载之后
    try {
      sessionStorage.setItem(RESTORE_MESSAGE_KEY, message)
    } catch {
      // 存不了就只是看不到结果提示，不影响恢复
    }
    location.reload()
  } catch (err) {
    restoreMessage.value = err instanceof BackupError ? `没有恢复：${err.message} 现有数据没有任何改动。` : `恢复失败，现有数据没有改动：${String(err)}`
  } finally {
    busy.value = false
  }
}

async function clearAll() {
  const backupHint = lastExportAt.value ? `上次备份是 ${fmt(lastExportAt.value)}，之后的改动会丢失。` : '你还没有导出过备份，清除后数据无法找回。'
  const first = await confirmDialog({ title: '清除全部数据？', message: `所有文档、划线、批注、对话和设置（包括 API Key）都会被删除。\n${backupHint}`, confirmText: '继续', danger: true })
  if (!first) return
  const second = await confirmDialog({ title: '真的要清除吗？', message: '这是最后一次确认，此操作无法撤销。', confirmText: '清除全部数据', danger: true })
  if (!second) return
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

const RESTORE_MESSAGE_KEY = 'wendu.restoreMessage'

onMounted(async () => {
  try {
    const msg = sessionStorage.getItem(RESTORE_MESSAGE_KEY)
    if (msg) {
      restoreMessage.value = msg
      section.value = 'data'
      sessionStorage.removeItem(RESTORE_MESSAGE_KEY)
    }
  } catch {
    // 读不到上次恢复的结果提示，忽略
  }
  lastExportAt.value = await getSetting<number | null>('backup.lastExportAt', null)
  const v = await getAppVersion()
  version.value = v.build ? `${v.version}（${v.build}）` : v.version
})
</script>

<template>
  <div class="settings">
    <nav class="side-nav">
      <button v-for="s in sections" :key="s.id" class="ghost" :class="{ active: section === s.id }" @click="section = s.id">
        <Icon :name="s.icon" :size="18" />{{ s.label }}
      </button>
    </nav>

    <div class="pane">
      <ProviderSettings v-if="section === 'ai'" />

      <section v-else-if="section === 'reading'">
        <h2>阅读</h2>
        <TypographySettings />
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

      <section v-else-if="section === 'colors'">
        <h2>划线颜色</h2>
        <p class="muted small">名称用在笔记页和导出里，留空用默认名称。红色划线会进疑问清单。</p>
        <div v-for="c in HIGHLIGHT_COLORS" :key="c" class="color-row">
          <span class="color-dot" :class="c" />
          <input
            :value="prefs.colorNames[c] ?? ''"
            :placeholder="DEFAULT_COLOR_NAMES[c]"
            :maxlength="MAX_COLOR_NAME"
            @change="setColorName(c, ($event.target as HTMLInputElement).value)"
          />
        </div>
      </section>

      <section v-else-if="section === 'prompts'">
        <h2>快捷提问</h2>
        <p class="muted small">显示在侧栏输入框上方，点一下直接发送。</p>
        <PromptSettings group="anchor" title="针对选中的原文" />
        <PromptSettings group="whole" title="针对整篇文档" />
      </section>

      <template v-else-if="section === 'data'">
        <section>
          <h2>备份与恢复</h2>
          <p>
            上次备份：<strong>{{ lastExportAt ? fmt(lastExportAt) : '还没有备份过' }}</strong>
            <span v-if="lastExportAt && Date.now() - lastExportAt > REMIND_AFTER_MS" class="warn">（超过 7 天了）</span>
          </p>
          <p class="muted small">备份包含所有文档、划线、批注、对话和阅读设置，<strong>不含 API Key 和 AI 接口配置</strong>，换设备后要重新填写。数据只在本机，换设备或重装前请先备份。只恢复自己导出的备份。</p>
          <div class="row">
            <button class="primary" :disabled="busy" @click="exportBackup">导出备份</button>
            <button :disabled="busy" @click="pickRestore('merge')">从备份恢复（合并）</button>
            <button :disabled="busy" class="danger" @click="pickRestore('replace')">从备份恢复（替换）</button>
          </div>
          <input ref="restoreInput" type="file" accept=".json,application/json" hidden @change="onRestoreFile" />
          <p class="muted small">合并：同一条数据本机已有时保留本机的。替换：本机的文档和笔记全部换成备份里的，API Key 和 AI 接口配置保留。</p>
          <p v-if="restoreMessage" class="result">{{ restoreMessage }}</p>
        </section>

        <section class="danger-zone">
          <h2>清除数据</h2>
          <p class="muted small">删除本机所有文档、划线、批注、对话和设置（包括 API Key），相当于重新安装。无法撤销，清除前请先导出备份。</p>
          <button class="danger" :disabled="busy" @click="clearAll">清除全部数据</button>
        </section>
      </template>

      <section v-else>
        <h2>关于问读</h2>
        <p>版本 {{ version }}</p>
        <p class="muted small">开源的安卓平板 Markdown 阅读器。文档和笔记只存在这台设备上，问题只发给你自己配置的 AI 接口，没有账号和统计。</p>
        <h3>诊断</h3>
        <p class="muted small">接口连不上、选区或划线不正常时，用它测试连通并生成报告。报告不含 API Key。</p>
        <button @click="navigate('diagnostics')">打开诊断页</button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: grid;
  grid-template-columns: 220px minmax(0, 680px);
  gap: 48px;
  justify-content: center;
  padding: 28px 32px 56px;
}
.side-nav {
  position: sticky;
  top: 28px;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.side-nav button {
  justify-content: flex-start;
  gap: 10px;
  color: var(--muted);
}
.side-nav button.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.pane :deep(h2) {
  margin: 0 0 12px;
  font-size: 26px;
  font-weight: 600;
}
.pane h3 {
  margin: 28px 0 4px;
  font-size: 18px;
  font-weight: 600;
}
.danger-zone {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}
.color-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 10px 0;
}
.color-row .color-dot {
  width: 20px;
  height: 20px;
}
.color-row input {
  width: 200px;
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
  gap: 10px;
  min-height: var(--tap);
}
.field-label {
  font-weight: 500;
}
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
input[type='number'] {
  width: 160px;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 13px;
  line-height: 1.7;
}
.warn {
  color: var(--warn);
}
.result {
  padding: 10px 14px;
  border-radius: var(--radius-m);
  background: var(--surface);
}
:root[data-layout='narrow'] .settings {
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
}
:root[data-layout='narrow'] .side-nav {
  position: static;
  flex-direction: row;
  overflow-x: auto;
}
:root[data-layout='narrow'] .side-nav button {
  flex: none;
  gap: 6px;
}
</style>
