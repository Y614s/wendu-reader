<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  PROVIDER_PRESETS,
  baseURLProblem,
  deleteApiKey,
  getProviderSettings,
  getSelectedProviderId,
  presetOf,
  saveProviderSettings,
  setApiKey,
  setSelectedProviderId,
  type ProviderSettings,
} from '../ai/providers'
import { confirmDialog } from '../app/dialog'

// AI 接口设置。Key 只写不读：保存后界面上只显示「已设置」，不回填、不显示任何字符，只能更改或删除。

const providerId = ref('')
const form = ref<ProviderSettings | null>(null)
const saved = ref('')
// 正在输入的新 Key，只在「更改」时存在，保存或取消后立即清空
const newKey = ref('')
const editingKey = ref(false)
const urlError = ref('')

const preset = computed(() => presetOf(providerId.value))

async function load(id: string) {
  providerId.value = id
  form.value = await getProviderSettings(id)
  editingKey.value = !form.value.hasKey
  newKey.value = ''
  saved.value = ''
}

async function onProviderChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value
  await setSelectedProviderId(id)
  await load(id)
}

function flash(text: string) {
  saved.value = text
  setTimeout(() => (saved.value = ''), 2000)
}

async function save() {
  if (!form.value) return
  urlError.value = ''
  // 占位符还没替换时允许先保存，提问时会再提示；其他地址问题不让保存
  if (!form.value.baseURL.includes('{')) {
    const problem = form.value.baseURL.trim() ? baseURLProblem(form.value.baseURL) : null
    if (problem) {
      urlError.value = problem
      return
    }
  }
  await saveProviderSettings(form.value)
  await setSelectedProviderId(form.value.providerId)
  if (editingKey.value && newKey.value.trim()) {
    await setApiKey(form.value.providerId, newKey.value)
    newKey.value = ''
    form.value.hasKey = true
    editingKey.value = false
  }
  flash('已保存')
}

function startChangeKey() {
  newKey.value = ''
  editingKey.value = true
}

function cancelChangeKey() {
  newKey.value = ''
  editingKey.value = false
}

async function removeKey() {
  if (!form.value) return
  const ok = await confirmDialog({ title: `删除「${preset.value.name}」的 API Key？`, message: '删除后需要重新填写才能提问。', confirmText: '删除', danger: true })
  if (!ok) return
  await deleteApiKey(form.value.providerId)
  form.value.hasKey = false
  editingKey.value = true
  newKey.value = ''
  flash('Key 已删除')
}

function resetURL() {
  if (form.value) form.value.baseURL = preset.value.baseURL
}

onMounted(async () => load(await getSelectedProviderId()))
</script>

<template>
  <section>
    <h2>AI 接口</h2>
    <p class="muted">只支持兼容 OpenAI Chat Completions 格式的接口。Key 只保存在本机（未加密），不会进入备份，只发给你在这里填写的接口地址。</p>

    <label>
      服务商
      <select :value="providerId" @change="onProviderChange">
        <option v-for="p in PROVIDER_PRESETS" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </label>

    <template v-if="form">
      <label>
        接口地址
        <input v-model="form.baseURL" type="url" placeholder="https://…" autocomplete="off" spellcheck="false" />
        <span class="muted small">
          请求会发到「接口地址/chat/completions」。{{ preset.hint ?? '' }}
          <button v-if="preset.baseURL && form.baseURL !== preset.baseURL" class="link" @click="resetURL">恢复预设地址</button>
        </span>
      </label>
      <p v-if="form.baseURL.includes('{')" class="warn">地址里还有 { } 占位符，请替换成你自己的值。</p>
      <p v-if="urlError" class="error">{{ urlError }}</p>

      <label>
        模型名
        <input v-model="form.model" placeholder="按服务商文档填写，例如对话模型的名称" autocomplete="off" spellcheck="false" />
      </label>

      <div class="field">
        <span class="field-label">API Key</span>
        <div v-if="form.hasKey && !editingKey" class="key-row">
          <span class="key-set">已设置</span>
          <button @click="startChangeKey">更改</button>
          <button class="danger" @click="removeKey">删除</button>
        </div>
        <div v-else class="key-row">
          <input
            v-model="newKey"
            type="password"
            :placeholder="form.hasKey ? '填写新的 Key，保存后覆盖旧的' : '填写 API Key'"
            autocomplete="new-password"
            spellcheck="false"
          />
          <button v-if="form.hasKey" @click="cancelChangeKey">取消</button>
        </div>
        <span class="muted small">保存后不能再查看，只能更改或删除。</span>
      </div>

      <div class="actions">
        <button class="primary" @click="save">保存</button>
        <span class="muted">{{ saved }}</span>
      </div>
      <p class="muted small">每个服务商的设置分开保存，切换服务商不用重新填。保存后可以到「诊断」页测试连通。</p>
    </template>
  </section>
</template>

<style scoped>
label,
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 16px 0;
  font-weight: 500;
}
input,
select {
  font: inherit;
  font-weight: normal;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
}
.key-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.key-row input {
  flex: 1;
}
.key-set {
  flex: 1;
  padding: 8px 10px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--ok);
  font-weight: normal;
}
button.link {
  border: none;
  padding: 0 4px;
  color: var(--accent);
  background: none;
  font-size: inherit;
}
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.muted {
  color: var(--muted);
  font-weight: normal;
}
.small {
  font-size: 13px;
}
.error {
  color: var(--danger);
  font-size: 14px;
}
.warn {
  color: var(--warn);
  font-size: 14px;
}
</style>
