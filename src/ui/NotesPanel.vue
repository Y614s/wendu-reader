<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import type { ConversationRecord, NoteRecord } from '../db'
import type { NoteGroups } from '../reader/notes'
import { renderAnswer } from '../reader/answer'
import { colorName } from '../highlight/colors'
import { prefs } from '../app/prefs'
import PendingItem from './PendingItem.vue'

// 笔记侧栏：本文的划线、批注、问答按原文顺序排列，点一下跳回原文。

const props = defineProps<{ groups: NoteGroups; focusPending?: boolean }>()
const emit = defineEmits<{
  jump: [anchorId: string]
  openAsk: [anchorId: string | null]
  editNote: [note: NoteRecord]
  exportMd: []
  changed: []
  focusInput: []
  deleteConversation: [conv: ConversationRecord]
}>()

const pendingEl = ref<HTMLElement | null>(null)

function fmt(t: number) {
  return new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function lastAnswer(c: ConversationRecord): string {
  return [...c.messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content ?? ''
}

function firstQuestion(c: ConversationRecord): string {
  const m = c.messages.find((x) => x.role === 'user')
  return c.kind === 'external' ? '（发到 App 的提问）' : (m?.display ?? m?.content ?? '')
}

onMounted(async () => {
  if (props.focusPending) {
    await nextTick()
    pendingEl.value?.scrollIntoView({ block: 'start' })
  }
})
</script>

<template>
  <section class="notes">
    <div class="panel-body">
      <div class="tools">
        <span class="muted">{{ groups.entries.length + groups.orphans.length }} 处笔记</span>
        <button class="mini" @click="emit('exportMd')">导出 md</button>
      </div>

      <template v-if="groups.pending.length">
        <h4 ref="pendingEl">待补充（{{ groups.pending.length }}）</h4>
        <div v-for="p in groups.pending" :key="p.conv.id" class="item pending">
          <button v-if="p.anchorId" class="quote" @click="emit('jump', p.anchorId)">{{ p.quote || '（原文已找不到）' }}</button>
          <div class="meta">
            发到 App · {{ fmt(p.conv.createdAt) }}
            <button class="del mini ghost" @click="emit('deleteConversation', p.conv)">删除这条</button>
          </div>
          <PendingItem :id="p.conv.id" @changed="emit('changed')" @focus-input="emit('focusInput')" />
        </div>
      </template>

      <h4 v-if="groups.entries.length">按原文顺序</h4>
      <p v-if="!groups.entries.length && !groups.orphans.length && !groups.whole.length && !groups.pending.length" class="muted">
        还没有笔记。选中文字后可以划线、写批注或提问。
      </p>
      <div v-for="e in groups.entries" :key="e.anchorId" class="item">
        <button class="quote" :class="e.highlighted ? e.color : ''" @click="emit('jump', e.anchorId)">{{ e.quote }}</button>
        <span v-if="e.highlighted" class="tag"><span class="color-dot small" :class="e.color" />{{ colorName(e.color, prefs.colorNames) }}</span>
        <div v-for="n in e.notes" :key="n.id" class="note" @click="emit('editNote', n)">
          <span class="tag" :class="n.source === 'ai' ? 'ai' : ''">{{ n.source === 'ai' ? 'AI 回答摘录' : '批注' }}</span>
          <!-- AI 回答摘录是 Markdown，按回答的样式渲染；自己写的批注按纯文本显示 -->
          <span v-if="n.source === 'ai'" class="note-text md" v-html="renderAnswer(n.text)" />
          <span v-else class="note-text">{{ n.text }}</span>
        </div>
        <button v-for="c in e.convs" :key="c.id" class="conv" @click="emit('openAsk', e.anchorId)">
          <span class="tag q">{{ c.kind === 'external' ? '发到 App' : '问答' }}</span>
          <span class="q-text">{{ firstQuestion(c) }}</span>
          <span class="a-text md" v-html="renderAnswer(lastAnswer(c).slice(0, 200))" />
        </button>
      </div>

      <template v-if="groups.orphans.length">
        <h4>原文已找不到</h4>
        <p class="muted small">文档改动后，下面这些笔记对应的原文找不到了，内容仍然保留。</p>
        <div v-for="e in groups.orphans" :key="e.anchorId" class="item orphan">
          <div class="quote static">{{ e.quote }}</div>
          <div v-for="n in e.notes" :key="n.id" class="note" @click="emit('editNote', n)">
            <span class="tag">{{ n.source === 'ai' ? 'AI 回答摘录' : '批注' }}</span>
            <span class="note-text">{{ n.text }}</span>
          </div>
          <button v-for="c in e.convs" :key="c.id" class="conv" @click="emit('openAsk', e.anchorId)">
            <span class="tag q">问答</span>
            <span class="q-text">{{ firstQuestion(c) }}</span>
          </button>
        </div>
      </template>

      <template v-if="groups.whole.length">
        <h4>整篇提问</h4>
        <button v-for="c in groups.whole" :key="c.id" class="item conv" @click="emit('openAsk', null)">
          <span class="q-text">{{ firstQuestion(c) }}</span>
          <span class="a-text md" v-html="renderAnswer(lastAnswer(c).slice(0, 200))" />
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.notes {
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
.tools {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h4 {
  margin: 16px 0 8px;
  font-size: 14px;
  color: var(--panel-title);
  font-weight: 600;
}
.item {
  margin-bottom: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-m);
  background: var(--card);
  box-shadow: var(--shadow-1);
}
.item.orphan {
  opacity: 0.85;
}
.quote {
  display: block;
  width: 100%;
  text-align: left;
  padding: 2px 0 2px 10px;
  border: none;
  border-left: 3px solid var(--border-strong);
  border-radius: 0;
  background: none;
  color: var(--fg);
  font: inherit;
  line-height: 1.6;
  white-space: pre-wrap;
  min-height: 0;
  max-height: 7.5em;
  overflow: hidden;
}
.quote.yellow {
  border-left-color: var(--dot-yellow);
}
.quote.blue {
  border-left-color: var(--dot-blue);
}
.quote.green {
  border-left-color: var(--dot-green);
}
.quote.red {
  border-left-color: var(--dot-red);
}
.color-dot.small {
  width: 9px;
  height: 9px;
  margin-right: 4px;
}
.quote.static {
  color: var(--muted);
}
.note {
  margin-top: 6px;
  font-size: 14px;
  white-space: pre-wrap;
}
.note-text.md {
  white-space: normal;
}
.note-text.md :deep(p) {
  display: inline;
  margin: 0;
}
.conv {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 0;
  min-height: 0;
  border: none;
  border-radius: 0;
  background: none;
  color: var(--fg);
  text-align: left;
  white-space: normal;
  font: inherit;
  font-size: 14px;
}
.item.conv {
  padding: 12px 14px;
  border-radius: var(--radius-m);
  background: var(--card);
}
.tag {
  display: inline-block;
  margin-right: 6px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--surface);
  color: var(--muted);
}
.tag.ai,
.tag.q {
  color: var(--accent);
}
.q-text {
  font-weight: 500;
}
.a-text {
  display: block;
  color: var(--muted);
  max-height: 4.8em;
  overflow: hidden;
}
.a-text :deep(p) {
  margin: 0.2em 0;
}
.meta .del {
  color: var(--danger);
  font-size: 12px;
}
.meta {
  font-size: 12px;
  color: var(--muted);
  margin: 4px 0;
}
.muted {
  color: var(--muted);
  font-size: 13px;
}
.small {
  font-size: 12px;
}
</style>
