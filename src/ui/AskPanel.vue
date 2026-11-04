<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { db, newId, type ConversationRecord, type DocumentRecord, type NoteRecord } from '../db'
import { ChatError, configProblem, streamChat, type ChatMessageInput } from '../ai/client'
import { quickPrompts, type ContextResult, type ContextScope } from '../ai/context'
import { historyForRequest } from '../ai/history'
import { prefs } from '../app/prefs'
import { getProviderConfig, getSelectedProviderId, presetOf } from '../ai/providers'
import { renderAnswer, splitAnswerBlocks } from '../reader/answer'
import { navigate } from '../app/router'
import PendingItem from './PendingItem.vue'
import Icon from './Icon.vue'

// 侧栏问：针对一处原文（anchorId 不为空）或整篇文档（anchorId 为空）提问。

const props = defineProps<{
  doc: DocumentRecord
  anchorId: string | null
  /** 选中的原文（公式已换回 TeX）；整篇提问时为 null */
  quote: string | null
  conversations: ConversationRecord[]
  notes: NoteRecord[]
  /** 由阅读页按当前文档组装上下文 */
  buildRequest: (question: string, scope: ContextScope, history: ChatMessageInput[]) => ContextResult
}>()

const emit = defineEmits<{ close: []; changed: []; focusInput: []; saveNote: [text: string]; deleteConversation: [conv: ConversationRecord] }>()

const question = ref('')
const scope = ref<ContextScope>(props.anchorId ? 'section' : 'full')
const streaming = ref(false)
const answerDraft = ref('')
const errorText = ref('')
const notice = ref('')
/** 接口还没配好，提示里给一个去设置的按钮 */
const needSetup = ref(false)
const activeId = ref<string | null>(null)
const listEl = ref<HTMLElement | null>(null)
let abort: AbortController | null = null

const shown = computed(() =>
  props.anchorId
    ? props.conversations.filter((c) => c.anchorId === props.anchorId)
    : props.conversations.filter((c) => c.anchorId === null && c.kind === 'sidebar'),
)
const presets = computed(() => quickPrompts(props.anchorId === null, prefs.quickPrompts))
const sidebarConv = computed(() => shown.value.filter((c) => c.kind === 'sidebar').at(-1) ?? null)
const savedTexts = computed(() => new Set(props.notes.filter((n) => n.anchorId === props.anchorId && n.source === 'ai').map((n) => n.text)))

watch(
  () => props.anchorId,
  () => {
    stop()
    question.value = ''
    answerDraft.value = ''
    errorText.value = ''
    notice.value = ''
    activeId.value = null
    scope.value = props.anchorId ? 'section' : 'full'
  },
)

function scrollToEnd() {
  void nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight }))
}

async function ask() {
  const q = question.value.trim()
  if (!q || streaming.value) return
  errorText.value = ''
  notice.value = ''
  needSetup.value = false
  const providerId = await getSelectedProviderId()
  const cfg = await getProviderConfig(providerId)
  const problem = configProblem(cfg)
  if (problem) {
    // 配置不全时不建对话，问题留在输入框里
    errorText.value = problem
    needSetup.value = true
    return
  }

  // 接着最近一次侧栏对话问；没有就新建
  let conv = sidebarConv.value ? await db.conversations.get(sidebarConv.value.id) : undefined
  // 历史只带问题和回答本身；文档内容每次按预算重新组装
  const history: ChatMessageInput[] = historyForRequest(conv?.messages ?? [])
  const req = props.buildRequest(q, scope.value, history)
  if (req.truncated) notice.value = scope.value === 'full' ? '全文过长，本次只发送了部分内容。' : '本节过长，本次只发送了部分内容。'
  if (req.omittedHistory > 0) notice.value += `较早的 ${req.omittedHistory} 条对话没有带上。`

  const userMsg = { role: 'user' as const, content: q, createdAt: Date.now() }
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
    await streamChat(cfg, req.messages, {
      signal: abort.signal,
      onDelta: (t) => {
        answerDraft.value += t
        scrollToEnd()
      },
    })
  } catch (e) {
    // 错误随回答一起存下来显示
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

/** 点一下直接发送，不用调键盘 */
function askPreset(text: string) {
  if (streaming.value) return
  question.value = text
  void ask()
}

function stop() {
  abort?.abort()
}

function fmtTime(t: number) {
  return new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

onBeforeUnmount(stop)
</script>

<template>
  <section class="ask">
    <div ref="listEl" class="panel-body">
      <blockquote v-if="quote" class="quote">{{ quote }}</blockquote>
      <p v-else class="muted">对整篇文档提问，不针对某一段原文。</p>

      <section v-for="c in shown" :key="c.id" class="conv">
        <div class="conv-meta">
          <span v-if="c.kind === 'external'">发到 App · {{ c.status === 'pending' ? '待补充' : c.provider }}</span>
          <span v-else>侧栏问 · {{ c.provider }}{{ c.model ? ' · ' + c.model : '' }}</span>
          <span>
            {{ fmtTime(c.createdAt) }}
            <button class="del-conv mini ghost" :disabled="streaming && activeId === c.id" @click="emit('deleteConversation', c)">删除</button>
          </span>
        </div>
        <template v-for="(m, i) in c.messages" :key="i">
          <div v-if="m.role === 'user'" class="msg user" :class="{ small: c.kind === 'external' }">{{ m.display ?? m.content }}</div>
          <div v-else-if="m.role === 'assistant'" class="msg assistant">
            <div v-for="(b, j) in splitAnswerBlocks(m.content)" :key="j" class="answer-block">
              <div class="md" v-html="renderAnswer(b)" />
              <template v-if="anchorId">
                <span v-if="savedTexts.has(b)" class="saved">已存为笔记</span>
                <button v-else class="chip tint save-note" @click="emit('saveNote', b)">存为笔记</button>
              </template>
            </div>
            <p v-if="m.error" class="error">{{ m.error }}</p>
          </div>
        </template>
        <div v-if="streaming && activeId === c.id" class="msg assistant">
          <div class="md" v-html="renderAnswer(answerDraft || '…')" />
        </div>
        <PendingItem v-if="c.status === 'pending'" :id="c.id" @changed="emit('changed')" @focus-input="emit('focusInput')" />
      </section>

      <p v-if="notice" class="notice">{{ notice }}</p>
      <div v-if="errorText && !streaming" class="error-box">
        <p class="error">{{ errorText }}</p>
        <button v-if="needSetup" class="primary" @click="navigate('settings')">去设置 AI 接口</button>
      </div>
    </div>

    <footer class="panel-foot">
      <div class="scope">
        <span class="muted">上下文</span>
        <button class="chip" :class="{ on: scope === 'section' }" @click="scope = 'section'">本节</button>
        <button class="chip" :class="{ on: scope === 'full' }" @click="scope = 'full'">全文</button>
      </div>
      <div v-if="presets.length" class="presets">
        <button v-for="p in presets" :key="p" class="chip tint" :disabled="streaming" @click="askPreset(p)">{{ p }}</button>
      </div>
      <div class="input-row">
        <textarea
          v-model="question"
          rows="2"
          :placeholder="anchorId ? '对选中的内容提问' : '对整篇文档提问'"
          @focus="emit('focusInput')"
          @keydown.enter.ctrl.prevent="ask"
        />
        <button v-if="streaming" class="send" aria-label="停止" @click="stop"><Icon name="stop" /></button>
        <button v-else class="primary send" aria-label="发送" :disabled="!question.trim()" @click="ask"><Icon name="arrowUp" /></button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.ask {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.panel-body {
  flex: 1;
  overflow: auto;
  padding: 14px;
}
.quote {
  margin: 0 0 14px;
  padding: 2px 12px;
  border-left: 3px solid var(--accent);
  color: var(--muted);
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 30vh;
  overflow: auto;
}
.conv {
  margin-bottom: 18px;
}
.del-conv {
  color: var(--danger);
  font-size: 12px;
}
.conv-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.msg {
  margin: 8px 0;
  line-height: 1.65;
}
.msg.user {
  width: fit-content;
  max-width: 88%;
  margin-left: auto;
  padding: 8px 12px;
  border-radius: var(--radius-m) var(--radius-m) 4px var(--radius-m);
  background: var(--accent-soft);
  white-space: pre-wrap;
}
.msg.user.small {
  font-size: 13px;
  max-height: 160px;
  overflow: auto;
}
.msg.assistant {
  padding: 10px 14px;
  border-radius: var(--radius-m);
  background: var(--card);
  box-shadow: var(--shadow-1);
}
.msg.assistant .md {
  font-size: 16px;
  line-height: 1.7;
}
.answer-block {
  position: relative;
}
.answer-block .md :deep(p) {
  margin: 0.4em 0;
}
.answer-block .md :deep(pre) {
  overflow: auto;
}
.save-note,
.saved {
  margin: 4px 0;
  font-size: 12px;
}
.saved {
  display: inline-block;
  color: var(--ok);
}
.error-box {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 14px;
  line-height: 1.6;
}
.notice {
  color: var(--warn);
  font-size: 14px;
}
.muted {
  color: var(--muted);
  font-size: 13px;
}
.panel-foot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 14px;
  padding-bottom: max(10px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--panel-border);
}
.scope {
  display: flex;
  gap: 6px;
  align-items: center;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
textarea {
  flex: 1;
  resize: none;
}
.send {
  width: var(--tap);
  padding: 0;
  border-radius: 50%;
}
</style>
