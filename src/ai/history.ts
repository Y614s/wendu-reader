import type { ChatMessage } from '../db'
import type { ChatMessageInput } from './client'

// 对话记录 → 一问一答。请求失败时记录里会留下「有问无答」或「答案为空、带错误原因」的消息，
// 直接拿去当历史会出现连续两条 user 消息，部分接口会报 400；导出时也会出现只有问没有答的残缺记录。

export interface QAPair {
  question: ChatMessage
  answer: ChatMessage
}

/** 后面跟着有内容回答的提问才算一对；没有回答或回答为空的提问跳过 */
export function answeredPairs(messages: ChatMessage[]): QAPair[] {
  const pairs: QAPair[] = []
  for (let i = 0; i < messages.length; i++) {
    const q = messages[i]
    if (q.role !== 'user') continue
    const a = messages[i + 1]
    if (a?.role === 'assistant' && a.content.trim()) {
      pairs.push({ question: q, answer: a })
      i++
    }
  }
  return pairs
}

/** 发请求用的历史：只带完整成功的问答，问题用界面上显示的原话（不带当时的上下文） */
export function historyForRequest(messages: ChatMessage[]): ChatMessageInput[] {
  return answeredPairs(messages)
    .filter((p) => !p.answer.error)
    .flatMap((p) => [
      { role: 'user' as const, content: p.question.display ?? p.question.content },
      { role: 'assistant' as const, content: p.answer.content },
    ])
}
