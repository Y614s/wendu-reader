import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/db'
import {
  deleteApiKey,
  getProviderConfig,
  getProviderSettings,
  saveProviderSettings,
  setApiKey,
} from '../../src/ai/providers'
import { ChatError, streamChat } from '../../src/ai/client'

const KEY = 'test-key-0123456789'

describe('API Key 只写不读', () => {
  beforeEach(async () => {
    await db.settings.clear()
  })

  it('设置页读到的配置里没有 Key，只有是否已设置', async () => {
    await saveProviderSettings({ providerId: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'm' })
    await setApiKey('deepseek', KEY)
    const s = await getProviderSettings('deepseek')
    expect(s.hasKey).toBe(true)
    expect(JSON.stringify(s)).not.toContain(KEY)
    expect(Object.keys(s)).not.toContain('apiKey')
  })

  it('保存地址和模型名不会动到已有的 Key', async () => {
    await setApiKey('deepseek', KEY)
    await saveProviderSettings({ providerId: 'deepseek', baseURL: 'https://x.com', model: 'm2' })
    expect((await getProviderConfig('deepseek')).apiKey).toBe(KEY)
  })

  it('更改会覆盖旧 Key；删除后提问提示还没填 Key', async () => {
    await saveProviderSettings({ providerId: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'm' })
    await setApiKey('deepseek', KEY)
    await setApiKey('deepseek', 'new-key')
    expect((await getProviderConfig('deepseek')).apiKey).toBe('new-key')

    await deleteApiKey('deepseek')
    expect((await getProviderSettings('deepseek')).hasKey).toBe(false)
    const cfg = await getProviderConfig('deepseek')
    await expect(streamChat(cfg, [], { onDelta: () => {} })).rejects.toThrowError(new ChatError('config', '还没填 API Key，请到设置页填写。'))
  })
})
