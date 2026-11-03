import { getSetting, setSetting } from '../db'

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

export async function getProviderConfig(id: string): Promise<ProviderConfig> {
  const saved = await getSetting<{ baseURL?: string; model?: string } | null>(keyConfig(id), null)
  return {
    providerId: id,
    baseURL: saved?.baseURL ?? presetOf(id).baseURL,
    model: saved?.model ?? '',
    apiKey: await getSetting(API_KEY_PREFIX + id, ''),
  }
}

export async function saveProviderConfig(cfg: ProviderConfig): Promise<void> {
  await setSetting(keyConfig(cfg.providerId), { baseURL: cfg.baseURL.trim(), model: cfg.model.trim() })
  await setSetting(API_KEY_PREFIX + cfg.providerId, cfg.apiKey.trim())
}

/** 填了地址、模型和 Key 的服务商 */
export function isConfigured(cfg: ProviderConfig): boolean {
  return Boolean(cfg.baseURL && !cfg.baseURL.includes('{') && cfg.model && cfg.apiKey)
}

/** `{接口地址}/chat/completions`，处理好末尾斜杠 */
export function chatCompletionsURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '') + '/chat/completions'
}
