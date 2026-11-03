<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  PROVIDER_PRESETS,
  getProviderConfig,
  getSelectedProviderId,
  presetOf,
  saveProviderConfig,
  setSelectedProviderId,
  type ProviderConfig,
} from '../ai/providers'

const providerId = ref('')
const form = ref<ProviderConfig | null>(null)
const showKey = ref(false)
const saved = ref('')

const preset = computed(() => presetOf(providerId.value))

async function load(id: string) {
  providerId.value = id
  form.value = await getProviderConfig(id)
  saved.value = ''
}

async function onProviderChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value
  await setSelectedProviderId(id)
  await load(id)
}

async function save() {
  if (!form.value) return
  await saveProviderConfig(form.value)
  await setSelectedProviderId(form.value.providerId)
  saved.value = '已保存'
  setTimeout(() => (saved.value = ''), 2000)
}

function resetURL() {
  if (form.value) form.value.baseURL = preset.value.baseURL
}

onMounted(async () => load(await getSelectedProviderId()))
</script>

<template>
  <div class="settings">
    <h2>AI 接口</h2>
    <p class="muted">只支持兼容 OpenAI Chat Completions 格式的接口。Key 只保存在本机，不会进入备份，只发给你在这里填写的接口地址。</p>

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

      <label>
        模型名
        <input v-model="form.model" placeholder="按服务商文档填写，例如对话模型的名称" autocomplete="off" spellcheck="false" />
      </label>

      <label>
        API Key
        <span class="key-row">
          <input v-model="form.apiKey" :type="showKey ? 'text' : 'password'" autocomplete="off" spellcheck="false" />
          <button @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
        </span>
      </label>

      <div class="actions">
        <button class="primary" @click="save">保存</button>
        <span class="muted">{{ saved }}</span>
      </div>
      <p class="muted small">每个服务商的设置分开保存，切换服务商不用重新填。保存后可以到「诊断」页测试连通。</p>
    </template>
  </div>
</template>

<style scoped>
.settings {
  max-width: 640px;
  padding: 16px 24px 48px;
}
label {
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
}
.key-row {
  display: flex;
  gap: 8px;
}
.key-row input {
  flex: 1;
}
button {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  font-size: 15px;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
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
.warn {
  color: #9a6700;
  font-size: 14px;
}
</style>
