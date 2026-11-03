<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { db, newId, type ConversationRecord, type DocumentRecord } from '../db'
import { ChatError, configProblem, streamChat } from '../ai/client'
import { buildMessages } from '../ai/context'
import { getProviderConfig, getSelectedProviderId, presetOf } from '../ai/providers'
import { renderAnswer } from '../reader/answer'
import { fillPending } from '../share'
import { readClipboardText } from '../platform/share'

// 侧栏：针对一处原文的提问和对话；或者列出本文所有待补充记录。

const props = defineProps<{
  doc: DocumentRecord
  mode: 'anchor' | 'pending'
  anchorId: string | null
  /** 选中的原文（公式已换回 TeX） */
  quote: string
  /** 附近内容，作为第一次提问的上下文 */
  nearby: string
  conversations: ConversationRecord[]
}>()

const emit = defineEmits<{ close: []; changed: []; focusInput: [] }>()

const question = ref('')
const streaming = ref(false)
const answerDraft = ref('')
const errorText = ref('')
const activeId = ref<string | null>(null)
const pasteDrafts = ref<Record<string, string>>({})
const pasteHint = ref<Record<string, string>>({})
const appNames = ref<Record<string, string>>({})
const listEl = ref<HTMLElement | null>(null)
let abort: AbortController | null = null

const shown = computed(() =>
  props.mode === 'pending'
    ? props.conversations.filter((c) => c.status === 'pending')
    : props.conversations.filter((c) => c.anchorId === props.anchorId),
)

const sidebarConv = computed(() => shown.value.filter((c) => c.kind === 'sidebar').at(-1) ?? null)

watch(
  () => props.anchorId,
  () => {
    stop()
    question.value = ''
    answerDraft.value = ''
    errorText.value = ''
    activeId.value = null
  },
)

function scrollToEnd() {
  void nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight }))
}

async function ask() {
  const q = question.value.trim()
  if (!q || streaming.value || !props.anchorId) return
  errorText.value = ''
  const providerId = await getSelectedProviderId()
  const cfg = await getProviderConfig(providerId)
  const problem = configProblem(cfg)
  if (problem) {
    // 配置不全时不建对话，问题留在输入框里
    errorText.value = problem
    return
  }

  // 接着最近一次侧栏对话问；没有就新建
  let conv = sidebarConv.value ? await db.conversations.get(sidebarConv.value.id) : undefined
  const history = (conv?.messages ?? []).filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }))
  const messages = buildMessages({ docTitle: props.doc.title, quote: props.quote, nearby: props.nearby, history, question: q })
  const userMsg = { role: 'user' as const, content: messages[messages.length - 1].content, display: q, createdAt: Date.now() }

  if (!conv) {
    conv = {
      id: newId(),
      docId: props.doc.id,
      anchorId: props.anchorId,
      kind: 'sidebar',
      status: 'done',
      messages: [userMsg],
      provider: presetOf(providerId).name,
      model: cfg.model,
      createdAt: Date.now(),
    }
    await db.conversations.add(conv)
  } else {
    conv.messages = [...conv.messages, userMsg]
    await db.conversations.update(conv.id, { messages: conv.messages })
  }
  activeId.value = conv.id
  question.value = ''
  emit('changed')

  streaming.value = true
  answerDraft.value = ''
  abort = new AbortController()
  let error: string | undefined
  try {
    await streamChat(cfg, messages, {
      signal: abort.signal,
      onDelta: (t) => {
        answerDraft.value += t
        scrollToEnd()
      },
    })
  } catch (e) {
    // 错误随回答一起存下来显示，不再单独提示
    error = e instanceof ChatError ? e.message : `请求失败：${String(e)}`
  } finally {
    streaming.value = false
    abort = null
  }
  // 中断时也保存已收到的部分，并记下原因
  if (answerDraft.value || error) {
    const fresh = await db.conversations.get(conv.id)
    if (fresh) {
      await db.conversations.update(conv.id, {
        messages: [...fresh.messages, { role: 'assistant', content: answerDraft.value, createdAt: Date.now(), ...(error ? { error } : {}) }],
      })
    }
  }
  answerDraft.value = ''
  emit('changed')
  scrollToEnd()
}

function stop() {
  abort?.abort()
}

async function pasteFromClipboard(id: string) {
  const text = await readClipboardText()
  if (text === null) {
    pasteHint.value[id] = '剪贴板是空的，或者不是文字。也可以直接在框里长按粘贴。'
    return
  }
  pasteHint.value[id] = ''
  pasteDrafts.value[id] = text
}

async function savePasted(id: string) {
  const text = (pasteDrafts.value[id] ?? '').trim()
  if (!text) {
    pasteHint.value[id] = '先粘贴回答再保存。'
    return
  }
  await fillPending(id, text, appNames.value[id]?.trim() || '其他 App')
  pasteDrafts.value[id] = ''
  emit('changed')
}

function fmtTime(t: number) {
  return new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

onBeforeUnmount(stop)
</script>

<template>
  <aside class="panel">
    <header class="panel-head">
      <strong>{{ mode === 'pending' ? '待补充' : '侧栏问' }}</strong>
      <button class="close" @click="emit('close')">关闭</button>
    </header>

    <div ref="listEl" class="panel-body">
      <blockquote v-if="mode === 'anchor' && quote" class="quote">{{ quote }}</blockquote>

      <p v-if="shown.length === 0 && mode === 'pending'" class="muted">本文没有待补充的记录。</p>

      <section v-for="c in shown" :key="c.id" class="conv">
        <div class="conv-meta">
          <span v-if="c.kind === 'external'">发到 App · {{ c.status === 'pending' ? '待补充' : c.provider }}</span>
          <span v-else>侧栏问 · {{ c.provider }}{{ c.model ? ' · ' + c.model : '' }}</span>
          <span>{{ fmtTime(c.createdAt) }}</span>
        </div>
        <template v-for="(m, i) in c.messages" :key="i">
          <div v-if="m.role === 'user'" class="msg user" :class="{ small: c.kind === 'external' }">{{ m.display ?? m.content }}</div>
          <div v-else-if="m.role === 'assistant'" class="msg assistant">
            <div class="md" v-html="renderAnswer(m.content)" />
            <p v-if="m.error" class="error">{{ m.error }}</p>
          </div>
        </template>
        <div v-if="streaming && activeId === c.id" class="msg assistant">
          <div class="md" v-html="renderAnswer(answerDraft || '…')" />
        </div>

        <div v-if="c.status === 'pending'" class="paste">
          <textarea v-model="pasteDrafts[c.id]" rows="4" placeholder="在其他 App 得到回答后，复制回来粘贴到这里" @focus="emit('focusInput')" />
          <div class="row">
            <input v-model="appNames[c.id]" class="app-name" placeholder="App 名称（可选）" />
            <button @click="pasteFromClipboard(c.id)">从剪贴板粘贴</button>
            <button class="primary" @click="savePasted(c.id)">保存</button>
          </div>
          <p v-if="pasteHint[c.id]" class="hint">{{ pasteHint[c.id] }}</p>
        </div>
      </section>

      <p v-if="errorText && !streaming" class="error">{{ errorText }}</p>
    </div>

    <footer v-if="mode === 'anchor'" class="panel-foot">
      <textarea
        v-model="question"
        rows="2"
        placeholder="对选中的内容提问"
        @focus="emit('focusInput')"
        @keydown.enter.ctrl.prevent="ask"
      />
      <button v-if="streaming" @click="stop">停止</button>
      <button v-else class="primary" :disabled="!question.trim()" @click="ask">发送</button>
    </footer>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--panel-bg);
}
.panel-head {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--panel-head);
  border-bottom: 1px solid var(--panel-border);
  color: #0a3069;
}
/* 竖屏抽屉顶部的把手条 */
@media (orientation: portrait) {
  .panel-head {
    padding-top: 16px;
  }
  .panel-head::before {
    content: '';
    position: absolute;
    top: 6px;
    left: 50%;
    width: 40px;
    height: 4px;
    margin-left: -20px;
    border-radius: 2px;
    background: var(--panel-border);
  }
}
.panel-body {
  flex: 1;
  overflow: auto;
  padding: 12px;
}
.quote {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-left: 3px solid var(--accent);
  background: var(--bg);
  white-space: pre-wrap;
  max-height: 30vh;
  overflow: auto;
}
.msg.user.small {
  font-size: 13px;
  max-height: 160px;
  overflow: auto;
}
.conv {
  margin-bottom: 16px;
}
.conv-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.msg {
  margin: 6px 0;
  line-height: 1.6;
}
.msg.user {
  padding: 6px 10px;
  background: var(--bg);
  border-radius: 8px;
  white-space: pre-wrap;
}
.msg.assistant .md :deep(p) {
  margin: 0.4em 0;
}
.msg.assistant .md :deep(pre) {
  overflow: auto;
}
.error {
  color: #cf222e;
  font-size: 14px;
}
.hint,
.muted {
  color: var(--muted);
  font-size: 13px;
}
.paste textarea,
.panel-foot textarea {
  width: 100%;
  font: inherit;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  resize: vertical;
}
.row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.app-name {
  flex: 1;
  min-width: 100px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.panel-foot {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 8px 12px;
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
}
button {
  padding: 8px 14px;
  white-space: nowrap;
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
button:disabled {
  opacity: 0.5;
}
.close {
  padding: 4px 10px;
}
</style>
