// SSE 解析（text/event-stream）。数据块可能在任意位置断开，包括一行的中间和 \r\n 之间。

export interface SSEEvent {
  event: string
  data: string
}

export class SSEParser {
  private buffer = ''
  private event = ''
  private data: string[] = []
  private pendingCR = false

  constructor(private readonly onEvent: (ev: SSEEvent) => void) {}

  feed(chunk: string): void {
    // 上一块以 \r 结尾、这一块以 \n 开头：是同一个 \r\n
    if (this.pendingCR && chunk.startsWith('\n')) chunk = chunk.slice(1)
    this.pendingCR = chunk.endsWith('\r')
    this.buffer += chunk

    let idx: number
    while ((idx = this.buffer.search(/\r\n|\r|\n/)) !== -1) {
      const line = this.buffer.slice(0, idx)
      const sepLen = this.buffer.startsWith('\r\n', idx) ? 2 : 1
      this.buffer = this.buffer.slice(idx + sepLen)
      this.line(line)
    }
  }

  /** 流结束：把没有以空行结尾的最后一个事件也发出去 */
  end(): void {
    if (this.buffer) this.line(this.buffer)
    this.buffer = ''
    this.dispatch()
  }

  private line(line: string): void {
    if (line === '') {
      this.dispatch()
      return
    }
    if (line.startsWith(':')) return // 注释，常用作保活
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') this.data.push(value)
    else if (field === 'event') this.event = value
  }

  private dispatch(): void {
    if (this.data.length > 0) this.onEvent({ event: this.event || 'message', data: this.data.join('\n') })
    this.event = ''
    this.data = []
  }
}

export type ChatStreamPart =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

/** 把一个 SSE 事件解释成 Chat Completions 流的一部分 */
export function interpretChatEvent(ev: SSEEvent): ChatStreamPart | null {
  const data = ev.data.trim()
  if (data === '[DONE]') return { type: 'done' }
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    if (ev.event === 'error') return { type: 'error', message: data || '服务商返回了错误事件' }
    return null
  }
  const obj = json as {
    error?: { message?: string } | string
    choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]
  }
  if (ev.event === 'error' || obj.error) {
    const e = obj.error
    return { type: 'error', message: (typeof e === 'string' ? e : e?.message) || '服务商返回了错误事件' }
  }
  const text = obj.choices?.[0]?.delta?.content
  return text ? { type: 'delta', text } : null
}
