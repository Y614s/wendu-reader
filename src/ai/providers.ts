import { db, getSetting, setSetting } from '../db'

// 服务商预设只是方便填写：接口地址、模型名都可以改，模型名不预填。
// 每个服务商的配置和 Key 分开保存，切换时不用重新填。Key 永远不进日志、不进备份。

export interface ProviderPreset {
  id: string
  name: string
  baseURL: string
  hint?: string
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com' },
  {
    id: 'bailian-beijing',
    name: '百炼（北京）',
    baseURL: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    hint: '把 {WorkspaceId} 换成你的业务空间 ID',
  },
  { id: 'bailian-legacy', name: '百炼（旧地址）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  {
    id: 'bailian-singapore',
    name: '百炼（新加坡）',
    baseURL: 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    hint: '把 {WorkspaceId} 换成你的业务空间 ID',
  },
  { id: 'bailian-virginia', name: '百炼（弗吉尼亚）', baseURL: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1' },
  { id: 'gemini', name: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'custom', name: '自定义', baseURL: '', hint: '任何兼容 OpenAI Chat Completions 的接口' },
]

export const DEFAULT_PROVIDER = 'deepseek'

export interface ProviderConfig {
  providerId: string
  baseURL: string
  model: string
  apiKey: string
}

const KEY_SELECTED = 'ai.provider'
const keyConfig = (id: string) => `ai.config.${id}`
// Key 单独存一个设置项，备份时按前缀排除
export const API_KEY_PREFIX = 'ai.key.'

export function presetOf(id: string): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]
}

export async function getSelectedProviderId(): Promise<string> {
  return getSetting(KEY_SELECTED, DEFAULT_PROVIDER)
}

export async function setSelectedProviderId(id: string): Promise<void> {
  await setSetting(KEY_SELECTED, id)
}

/** 设置页用的配置：不含 Key 本身，只知道有没有设置。Key 保存后在界面上只写不读。 */
export interface ProviderSettings {
  providerId: string
  baseURL: string
  model: string
  hasKey: boolean
}

async function readKey(id: string): Promise<string> {
  return getSetting(API_KEY_PREFIX + id, '')
}

export async function getProviderSettings(id: string): Promise<ProviderSettings> {
  const saved = await getSetting<{ baseURL?: string; model?: string } | null>(keyConfig(id), null)
  return {
    providerId: id,
    baseURL: saved?.baseURL ?? presetOf(id).baseURL,
    model: saved?.model ?? '',
    hasKey: (await readKey(id)) !== '',
  }
}

/** 发请求用的完整配置（含 Key）。只给 AI 客户端用，不要拿去显示。 */
export async function getProviderConfig(id: string): Promise<ProviderConfig> {
  const { providerId, baseURL, model } = await getProviderSettings(id)
  return { providerId, baseURL, model, apiKey: await readKey(id) }
}

/** 保存接口地址和模型名，不动 Key */
export async function saveProviderSettings(s: Pick<ProviderSettings, 'providerId' | 'baseURL' | 'model'>): Promise<void> {
  await setSetting(keyConfig(s.providerId), { baseURL: s.baseURL.trim(), model: s.model.trim() })
}

export async function setApiKey(id: string, key: string): Promise<void> {
  await setSetting(API_KEY_PREFIX + id, key.trim())
}

export async function deleteApiKey(id: string): Promise<void> {
  await db.settings.delete(API_KEY_PREFIX + id)
}

/** 填了地址、模型和 Key 的服务商 */
export function isConfigured(cfg: ProviderConfig): boolean {
  return Boolean(cfg.baseURL && !cfg.baseURL.includes('{') && cfg.model && cfg.apiKey)
}

/** `{接口地址}/chat/completions`，处理好末尾斜杠 */
export function chatCompletionsURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '') + '/chat/completions'
}
