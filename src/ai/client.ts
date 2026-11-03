import { SSEParser, interpretChatEvent } from './sse'
import { chatCompletionsURL, type ProviderConfig } from './providers'

// Chat Completions 流式客户端：WebView 自带的 fetch + ReadableStream，不用 Capacitor 原生 HTTP。
// 任何地方都不打印 API Key 或完整请求头。

export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatErrorKind = 'network' | 'cors' | 'auth' | 'quota' | 'not-found' | 'server' | 'stream' | 'aborted' | 'config'

export class ChatError extends Error {
  constructor(
    readonly kind: ChatErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export interface StreamStats {
  status: number | null
  firstTokenMs: number | null
  chunks: number
  totalMs: number
}

export interface StreamOptions {
  maxTokens?: number
  signal?: AbortSignal
  onDelta: (text: string) => void
}

const SUGGEST = '请检查网络，或在设置里换一个服务商。'

/** 防止服务商把 Key 原样回显在错误信息里 */
function redact(text: string, key: string): string {
  let out = text
  if (key) out = out.split(key).join('***')
  return out.replace(/\b(sk|AIza)[-\w]{8,}/g, '***').slice(0, 300)
}

function httpError(status: number, body: string): ChatError {
  const detail = body ? `（${body}）` : ''
  if (status === 401 || status === 403) return new ChatError('auth', `Key 无效或没有权限，HTTP ${status}${detail}`, status)
  if (status === 402 || status === 429) return new ChatError('quota', `额度不足或请求太频繁，HTTP ${status}${detail}`, status)
  if (status === 404) return new ChatError('not-found', `接口地址或模型名不对，HTTP 404${detail}`, status)
  return new ChatError('server', `服务商返回错误，HTTP ${status}${detail}。${SUGGEST}`, status)
}

/**
 * fetch 抛出 TypeError 时，浏览器不告诉我们是断网还是被跨域拦截。
 * 再发一个 no-cors 请求探测：能连上说明网络通、是跨域问题；连不上就是网络不通。
 */
async function classifyFetchFailure(url: string): Promise<ChatError> {
  try {
    await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' })
    return new ChatError('cors', `能连上服务商，但请求被跨域（CORS）拦截。这个服务商可能不允许在浏览器里直接调用。${SUGGEST}`)
  } catch {
    return new ChatError('network', `连不上服务商，网络不通或地址有误。${SUGGEST}`)
  }
}

/** 配置不全时返回提示，发请求前先检查 */
export function configProblem(cfg: ProviderConfig): string | null {
  if (!cfg.baseURL || cfg.baseURL.includes('{')) return '接口地址没填好，请到设置页检查。'
  if (!cfg.model) return '还没填模型名，请到设置页填写。'
  if (!cfg.apiKey) return '还没填 API Key，请到设置页填写。'
  return null
}

export async function streamChat(cfg: ProviderConfig, messages: ChatMessageInput[], opts: StreamOptions): Promise<StreamStats> {
  const problem = configProblem(cfg)
  if (problem) throw new ChatError('config', problem)

  const url = chatCompletionsURL(cfg.baseURL)
  const t0 = performance.now()
  const stats: StreamStats = { status: null, firstTokenMs: null, chunks: 0, totalMs: 0 }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: true,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: opts.signal,
    })
  } catch (e) {
    if (opts.signal?.aborted) throw new ChatError('aborted', '已停止')
    throw await classifyFetchFailure(url)
  }

  stats.status = res.status
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw httpError(res.status, redact(body, cfg.apiKey))
  }
  if (!res.body) throw new ChatError('stream', '这个环境不支持流式读取（没有 ReadableStream）。')

  let streamError: string | null = null
  let done = false
  const parser = new SSEParser((ev) => {
    const part = interpretChatEvent(ev)
    if (!part) return
    if (part.type === 'done') done = true
    else if (part.type === 'error') streamError = part.message
    else {
      if (stats.firstTokenMs === null) stats.firstTokenMs = Math.round(performance.now() - t0)
      opts.onDelta(part.text)
    }
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  try {
    while (!done && !streamError) {
      const { value, done: end } = await reader.read()
      if (end) break
      stats.chunks++
      parser.feed(decoder.decode(value, { stream: true }))
    }
    parser.feed(decoder.decode())
    parser.end()
  } catch {
    if (opts.signal?.aborted) throw new ChatError('aborted', '已停止')
    throw new ChatError('stream', `回答传到一半断开了。${SUGGEST}`)
  } finally {
    reader.cancel().catch(() => {})
  }
  if (streamError) throw new ChatError('stream', `服务商返回错误：${redact(streamError, cfg.apiKey)}`)

  stats.totalMs = Math.round(performance.now() - t0)
  return stats
}
