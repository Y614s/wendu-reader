<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { getAppVersion, isNativeApp } from '../platform'
import { copyText } from '../platform/share'
import { startupState } from '../app/startup'
import { selectionState } from '../selection'
import { readerState } from '../reader/state'
import { swState } from '../platform/pwa'
import { PROVIDER_PRESETS, getProviderConfig, getProviderSettings, type ProviderSettings } from '../ai/providers'
import { ChatError, streamChat } from '../ai/client'

// 集中展示只能在真机上确认的信息。「复制诊断报告」生成纯文本，不含 API Key。

const version = ref('…')
const estimate = ref('…')
const copied = ref('')

const ua = navigator.userAgent
const origin = location.origin
const chromium = /Chrom(?:e|ium)\/(\d+)/.exec(ua)?.[1] ?? '未识别'
const caps = {
  'CSS.highlights': typeof CSS !== 'undefined' && 'highlights' in CSS,
  'document.caretRangeFromPoint': typeof document.caretRangeFromPoint === 'function',
  'window.visualViewport': typeof window.visualViewport !== 'undefined' && window.visualViewport !== null,
}

interface NetResult {
  running: boolean
  status: string
  cors: string
  firstToken: string
  chunks: string
  total: string
  sample: string
  error: string
}

// 只保存不含 Key 的设置；测试时才取完整配置
const providers = ref<ProviderSettings[]>([])
const net = reactive<Record<string, NetResult>>({})

function nameOf(id: string) {
  return PROVIDER_PRESETS.find((p) => p.id === id)?.name ?? id
}

async function testProvider(p: ProviderSettings) {
  const cfg = await getProviderConfig(p.providerId)
  const r: NetResult = { running: true, status: '…', cors: '…', firstToken: '…', chunks: '…', total: '…', sample: '', error: '' }
  net[cfg.providerId] = r
  const t0 = performance.now()
  try {
    const stats = await streamChat(cfg, [{ role: 'user', content: '请只回复两个字：你好' }], {
      maxTokens: 16,
      onDelta: (t) => (net[cfg.providerId].sample += t),
    })
    Object.assign(net[cfg.providerId], {
      status: String(stats.status),
      cors: '未拦截',
      firstToken: stats.firstTokenMs === null ? '没有收到内容' : `${stats.firstTokenMs} ms`,
      chunks: String(stats.chunks),
      total: `${stats.totalMs} ms`,
    })
  } catch (e) {
    const err = e instanceof ChatError ? e : new ChatError('server', String(e))
    Object.assign(net[cfg.providerId], {
      status: err.status ? String(err.status) : '无响应',
      cors: err.kind === 'cors' ? '被拦截' : err.kind === 'network' ? '无法判断（网络不通）' : '未拦截',
      firstToken: '—',
      chunks: '—',
      total: `${Math.round(performance.now() - t0)} ms`,
      error: err.message,
    })
  } finally {
    net[cfg.providerId].running = false
  }
}

function fmtTime(t: number | undefined) {
  return t ? new Date(t).toLocaleTimeString('zh-CN') : '—'
}

const lastCache = computed(() => selectionState.lastCache)
const lastClick = computed(() => selectionState.lastClick)

function yes(b: boolean) {
  return b ? '可用' : '不可用'
}

const report = computed(() => {
  const lines = [
    '问读 诊断报告',
    `时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '【运行环境】',
    `形态：${isNativeApp() ? 'App 版' : '网页版'}`,
    `版本：${version.value}`,
    `Chromium 主版本：${chromium}`,
    `origin：${origin}`,
    `User-Agent：${ua}`,
    '',
    '【能力检测】',
    ...Object.entries(caps).map(([k, v]) => `${k}：${yes(v)}`),
    `划线显示方式：${readerState.paintMode === 'mark' ? 'mark 元素（回退）' : readerState.paintMode ?? '—'}`,
    `代码高亮：${readerState.codeHighlight}`,
    '',
    '【存储】',
    `persist()：${startupState.persisted === null ? startupState.persistError || '—' : startupState.persisted}`,
    `estimate()：${estimate.value}`,
    `启动计数器：${startupState.launchCount ?? startupState.dbError ?? '—'}`,
    `本文锚点：${readerState.anchors}，孤立：${readerState.orphans}`,
    `阅读位置：保存 ${readerState.positionSaves} 次，最近 ${readerState.lastSavedPosition ?? '—'}，恢复到 ${readerState.restoredPosition ?? '—'}`,
    `Service Worker：${swState.status}`,
    '',
    '【网络】',
    ...providers.value.map((p) => {
      const r = net[p.providerId]
      if (!r) return `${nameOf(p.providerId)}（${p.model}）：未测试`
      return `${nameOf(p.providerId)}（${p.model}）：HTTP ${r.status}；跨域 ${r.cors}；首个 token ${r.firstToken}；数据块 ${r.chunks}；总用时 ${r.total}${r.error ? '；错误：' + r.error : ''}`
    }),
    '',
    '【选区】',
    lastCache.value
      ? `最近一次缓存：${fmtTime(lastCache.value.at)}，位置 ${lastCache.value.start}–${lastCache.value.end}，${lastCache.value.plain.length} 字${lastCache.value.expanded ? '，已按整块公式处理' : ''}，内容：${lastCache.value.text.slice(0, 80)}`
      : '最近一次缓存：无',
    lastClick.value
      ? `最近一次点工具栏：「${lastClick.value.button}」${fmtTime(lastClick.value.at)}，缓存${lastClick.value.cachePresent ? '还在' : '已丢失'}，实时选区${lastClick.value.liveSelection ? '还在' : '已清空'}`
      : '最近一次点工具栏：无',
  ]
  return lines.join('\n')
})

async function copyReport() {
  copied.value = (await copyText(report.value)) ? '已复制，可以粘贴回对话里' : '复制失败，请长按下方文字手动复制'
}

onMounted(async () => {
  const v = await getAppVersion()
  version.value = v.build ? `${v.version}（versionCode ${v.build}）` : v.version
  try {
    const est = await navigator.storage?.estimate?.()
    estimate.value = est ? `已用 ${((est.usage ?? 0) / 1024).toFixed(0)} KB / 配额 ${((est.quota ?? 0) / 1024 / 1024).toFixed(0)} MB` : '不支持'
  } catch (e) {
    estimate.value = String(e)
  }
  const all = await Promise.all(PROVIDER_PRESETS.map((p) => getProviderSettings(p.id)))
  providers.value = all.filter((p) => p.hasKey && p.model && p.baseURL && !p.baseURL.includes('{'))
})
</script>

<template>
  <div class="diag">
    <div class="head">
      <h2>诊断</h2>
      <button class="primary" @click="copyReport">复制诊断报告</button>
      <span class="muted">{{ copied }}</span>
    </div>

    <section>
      <h3>运行环境</h3>
      <dl>
        <dt>形态</dt>
        <dd>{{ isNativeApp() ? 'App 版' : '网页版' }}</dd>
        <dt>版本</dt>
        <dd>{{ version }}</dd>
        <dt>Chromium 主版本</dt>
        <dd>{{ chromium }}</dd>
        <dt>origin</dt>
        <dd>{{ origin }}</dd>
        <dt>User-Agent</dt>
        <dd class="mono">{{ ua }}</dd>
      </dl>
    </section>

    <section>
      <h3>能力检测</h3>
      <dl>
        <template v-for="(v, k) in caps" :key="k">
          <dt class="mono">{{ k }}</dt>
          <dd :class="v ? 'ok' : 'bad'">{{ yes(v) }}</dd>
        </template>
        <dt>划线显示方式</dt>
        <dd>{{ readerState.paintMode === 'mark' ? 'mark 元素（回退）' : readerState.paintMode ?? '—' }}</dd>
      </dl>
    </section>

    <section>
      <h3>存储</h3>
      <dl>
        <dt>navigator.storage.persist()</dt>
        <dd>{{ startupState.persisted === null ? startupState.persistError || '…' : startupState.persisted ? '已获准持久化' : '未获准（可能被系统清理）' }}</dd>
        <dt>navigator.storage.estimate()</dt>
        <dd>{{ estimate }}</dd>
        <dt>启动计数器（每次启动加一，覆盖安装后应继续累加）</dt>
        <dd class="big">{{ startupState.launchCount ?? (startupState.dbError || '…') }}</dd>
        <dt>阅读位置（本次启动以来）</dt>
        <dd>
          保存 {{ readerState.positionSaves }} 次，最近一次 {{ readerState.lastSavedPosition ?? '—' }}；打开文档时恢复到
          {{ readerState.restoredPosition ?? '—' }}
        </dd>
        <dt>Service Worker（网页版离线）</dt>
        <dd>{{ swState.status }}</dd>
      </dl>
    </section>

    <section>
      <h3>网络</h3>
      <p v-if="providers.length === 0" class="muted">还没有配置好的服务商。请先到「设置」填写接口地址、模型名和 Key。</p>
      <div v-for="p in providers" :key="p.providerId" class="net">
        <div class="net-head">
          <strong>{{ nameOf(p.providerId) }}</strong>
          <span class="muted">{{ p.model }}</span>
          <button :disabled="net[p.providerId]?.running" @click="testProvider(p)">
            {{ net[p.providerId]?.running ? '测试中…' : '测试连通' }}
          </button>
        </div>
        <dl v-if="net[p.providerId]" class="net-result">
          <dt>HTTP 状态</dt>
          <dd>{{ net[p.providerId].status }}</dd>
          <dt>跨域</dt>
          <dd :class="net[p.providerId].cors === '被拦截' ? 'bad' : ''">{{ net[p.providerId].cors }}</dd>
          <dt>首个 token 用时</dt>
          <dd>{{ net[p.providerId].firstToken }}</dd>
          <dt>数据块数量</dt>
          <dd>{{ net[p.providerId].chunks }}</dd>
          <dt>总用时</dt>
          <dd>{{ net[p.providerId].total }}</dd>
          <dt>收到的回答</dt>
          <dd>{{ net[p.providerId].sample || '—' }}</dd>
        </dl>
        <p v-if="net[p.providerId]?.error" class="bad">{{ net[p.providerId].error }}</p>
      </div>
    </section>

    <section>
      <h3>选区记录</h3>
      <dl>
        <dt>最近一次选区缓存</dt>
        <dd v-if="lastCache">
          {{ fmtTime(lastCache.at) }} · 位置 {{ lastCache.start }}–{{ lastCache.end }} · {{ lastCache.plain.length }} 字
          <span v-if="lastCache.expanded" class="warn">· 已按整块公式处理</span>
          <div class="sel-text">{{ lastCache.text }}</div>
        </dd>
        <dd v-else class="muted">无</dd>
        <dt>最近一次点工具栏按钮的那一刻</dt>
        <dd v-if="lastClick">
          「{{ lastClick.button }}」{{ fmtTime(lastClick.at) }} · 缓存
          <span :class="lastClick.cachePresent ? 'ok' : 'bad'">{{ lastClick.cachePresent ? '还在' : '已丢失' }}</span>
          · 实时选区 {{ lastClick.liveSelection ? '还在' : '已被系统清空' }}
        </dd>
        <dd v-else class="muted">无</dd>
      </dl>
    </section>

    <section>
      <h3>报告预览</h3>
      <pre class="report">{{ report }}</pre>
    </section>
  </div>
</template>

<style scoped>
.diag {
  max-width: 820px;
  padding: 16px 24px 48px;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
h3 {
  margin: 24px 0 8px;
  font-size: 16px;
}
dt {
  color: var(--muted);
  font-size: 13px;
}
dd {
  margin: 0 0 10px;
}
.mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 13px;
  word-break: break-all;
}
.big {
  font-size: 24px;
  font-weight: 600;
}
.ok {
  color: var(--ok);
}
.bad {
  color: var(--danger);
}
.warn {
  color: var(--warn);
}
.muted {
  color: var(--muted);
}
.net {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.net-head {
  display: flex;
  gap: 10px;
  align-items: center;
}
.net-head button {
  margin-left: auto;
}
.net-result {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 12px;
  margin: 10px 0 0;
}
.net-result dd {
  margin: 0;
}
.sel-text {
  margin-top: 4px;
  padding: 6px 10px;
  background: var(--surface);
  border-radius: 6px;
  white-space: pre-wrap;
  max-height: 120px;
  overflow: auto;
}
.report {
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--surface);
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  user-select: text;
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
</style>
