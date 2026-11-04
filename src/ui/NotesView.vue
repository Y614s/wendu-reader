<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { db, type AnchorRecord, type DocumentRecord } from '../db'
import { appState, jumpToNote, showToast } from '../app/store'
import { prefs } from '../app/prefs'
import { buildGlobalEntries, filterEntries, groupByDoc, isAnswered, questionEntries, type GlobalEntry } from '../reader/globalNotes'
import { HIGHLIGHT_COLORS, colorName, type HighlightColor } from '../highlight/colors'
import { MAX_BATCH, askAnchor, runBatch } from '../ai/batch'
import { configProblem } from '../ai/client'
import { getProviderConfig, getSelectedProviderId, presetOf } from '../ai/providers'
import { renderAnswer } from '../reader/answer'
import { answeredPairs } from '../ai/history'

// 全局笔记页：跨文档查看划线、批注和问答；疑问清单集中看红色划线，可以逐条或批量问。

const mode = ref<'all' | 'questions'>('all')
const entries = shallowRef<GlobalEntry[]>([])
const docs = shallowRef<Map<string, DocumentRecord>>(new Map())
const anchors = shallowRef<Map<string, AnchorRecord>>(new Map())

const colors = ref<HighlightColor[]>([])
const tag = ref<string | null>(null)
const keywordInput = ref('')
const keyword = ref('')
let keywordTimer: ReturnType<typeof setTimeout> | undefined

const selected = ref<Set<string>>(new Set())
const batchQuestion = ref('解释这段')
const batchRunning = ref(false)
const batchProgress = ref('')
const batchMessage = ref('')
let batchAbort: AbortController | null = null

const allTags = computed(() => [...new Set(entries.value.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const base = computed(() => (mode.value === 'questions' ? questionEntries(entries.value) : entries.value))
const shown = computed(() =>
  filterEntries(base.value, {
    colors: mode.value === 'questions' ? [] : colors.value,
    tag: tag.value,
    keyword: keyword.value,
  }),
)
const groups = computed(() => groupByDoc(shown.value))
const unanswered = computed(() => shown.value.filter((e) => !isAnswered(e)))

async function load() {
  const [documents, anchorRows, highlights, notes, conversations] = await Promise.all([
    db.documents.toArray(),
    db.anchors.toArray(),
    db.highlights.toArray(),
    db.notes.toArray(),
    db.conversations.toArray(),
  ])
  docs.value = new Map(documents.map((d) => [d.id, d]))
  anchors.value = new Map(anchorRows.map((a) => [a.id, a]))
  entries.value = buildGlobalEntries({ documents, anchors: anchorRows, highlights, notes, conversations })
}

function onKeyword() {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(() => (keyword.value = keywordInput.value), 200)
}

function toggleColor(c: HighlightColor) {
  colors.value = colors.value.includes(c) ? colors.value.filter((x) => x !== c) : [...colors.value, c]
}

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else if (next.size >= MAX_BATCH) showToast(`每次最多 ${MAX_BATCH} 条`)
  else next.add(id)
  selected.value = next
}

function selectUnanswered() {
  selected.value = new Set(unanswered.value.slice(0, MAX_BATCH).map((e) => e.anchorId))
}

function lastAnswer(e: GlobalEntry): string {
  for (const c of [...e.convs].reverse()) {
    const pair = answeredPairs(c.messages).at(-1)
    if (pair) return pair.answer.content
  }
  return ''
}

async function startBatch() {
  const question = batchQuestion.value.trim()
  const picked = entries.value.filter((e) => selected.value.has(e.anchorId))
  if (!question || picked.length === 0) return
  batchMessage.value = ''
  const providerId = await getSelectedProviderId()
  const cfg = await getProviderConfig(providerId)
  const problem = configProblem(cfg)
  if (problem) {
    batchMessage.value = problem
    return
  }
  if (!confirm(`对 ${picked.length} 处原文依次提问「${question}」？\n\n每条都会发一次请求，消耗你的额度。`)) return

  batchRunning.value = true
  batchProgress.value = `0 / ${picked.length}`
  batchAbort = new AbortController()
  const results = await runBatch(
    picked,
    async (e, signal) => {
      const doc = docs.value.get(e.docId)
      const anchor = anchors.value.get(e.anchorId)
      if (!doc || !anchor) throw new Error('文档已删除')
      await askAnchor({ doc, anchor, question, budget: prefs.contextBudget, cfg, providerName: presetOf(providerId).name, signal })
    },
    {
      signal: batchAbort.signal,
      onProgress: (done, total) => {
        batchProgress.value = `${done} / ${total}`
        void load()
      },
    },
  )
  batchAbort = null
  batchRunning.value = false
  batchProgress.value = ''

  const count = (s: string) => results.filter((r) => r.status === s).length
  const failed = results.filter((r) => r.status === 'failed')
  batchMessage.value =
    `完成 ${count('done')} 条` +
    (failed.length ? `，失败 ${failed.length} 条（${failed[0].error}），已保持勾选，可以重试` : '') +
    (count('stopped') ? `，停止了 ${count('stopped')} 条` : '') +
    '。'
  // 没完成的保持勾选，方便重试
  selected.value = new Set(results.filter((r) => r.status !== 'done').map((r) => r.item.anchorId))
  await load()
}

function stopBatch() {
  batchAbort?.abort()
}

watch(() => appState.docsVersion, load)
onMounted(load)
onBeforeUnmount(() => {
  clearTimeout(keywordTimer)
  batchAbort?.abort()
})
</script>

<template>
  <div class="notes-page">
    <div class="head">
      <h2>笔记</h2>
      <div class="modes">
        <button :class="{ on: mode === 'all' }" @click="mode = 'all'">全部笔记</button>
        <button :class="{ on: mode === 'questions' }" @click="mode = 'questions'">疑问清单</button>
      </div>
    </div>

    <div class="filters">
      <input v-model="keywordInput" type="search" placeholder="搜索原文、批注和问答" @input="onKeyword" />
      <div v-if="mode === 'all'" class="chips">
        <button v-for="c in HIGHLIGHT_COLORS" :key="c" class="chip" :class="{ on: colors.includes(c) }" @click="toggleColor(c)">
          <span class="color-dot small" :class="c" />{{ colorName(c, prefs.colorNames) }}
        </button>
      </div>
      <div v-if="allTags.length" class="chips">
        <button class="chip" :class="{ on: tag === null }" @click="tag = null">全部标签</button>
        <button v-for="t in allTags" :key="t" class="chip" :class="{ on: tag === t }" @click="tag = t">{{ t }}</button>
      </div>
    </div>

    <div v-if="mode === 'questions'" class="batch">
      <div class="batch-row">
        <input v-model="batchQuestion" placeholder="对勾选的原文提同一个问题" :disabled="batchRunning" />
        <button v-if="batchRunning" @click="stopBatch">停止（{{ batchProgress }}）</button>
        <button v-else class="primary" :disabled="selected.size === 0 || !batchQuestion.trim()" @click="startBatch">批量问（{{ selected.size }}）</button>
      </div>
      <div class="batch-row small">
        <button v-if="!batchRunning" :disabled="unanswered.length === 0" @click="selectUnanswered">勾选没问过的</button>
        <button v-if="!batchRunning && selected.size" @click="selected = new Set()">取消勾选</button>
        <span class="muted">一条一条依次问，回答挂回各自的原文；每次最多 {{ MAX_BATCH }} 条。</span>
      </div>
      <p v-if="batchMessage" class="message">{{ batchMessage }}</p>
    </div>

    <p v-if="groups.length === 0" class="empty">
      {{ mode === 'questions' && !base.length ? '还没有疑问。读的时候用红色划线标出来，就会出现在这里。' : base.length ? '没有符合条件的笔记。' : '还没有笔记。' }}
    </p>

    <section v-for="g in groups" :key="g.docId" class="group">
      <h3>{{ g.docTitle }}</h3>
      <div v-for="e in g.entries" :key="e.anchorId" class="item">
        <label v-if="mode === 'questions'" class="check">
          <input type="checkbox" :checked="selected.has(e.anchorId)" :disabled="batchRunning" @change="toggleSelect(e.anchorId)" />
        </label>
        <div class="body">
          <button class="quote" :class="e.highlighted ? e.color : ''" @click="jumpToNote(e.docId, e.anchorId)">{{ e.quote }}</button>
          <div class="meta">
            <span v-if="e.highlighted"><span class="color-dot small" :class="e.color" />{{ colorName(e.color, prefs.colorNames) }}</span>
            <span v-if="mode === 'questions'" :class="isAnswered(e) ? 'ok' : 'muted'">{{ isAnswered(e) ? '已问过' : '没问过' }}</span>
            <button v-if="mode === 'questions'" class="ask" :disabled="batchRunning" @click="jumpToNote(e.docId, e.anchorId, true)">去问</button>
          </div>
          <div v-for="n in e.notes" :key="n.id" class="note">
            <span class="tag">{{ n.source === 'ai' ? 'AI 回答摘录' : '批注' }}</span>{{ n.text }}
          </div>
          <div v-if="lastAnswer(e)" class="answer md" v-html="renderAnswer(lastAnswer(e).slice(0, 300))" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.notes-page {
  max-width: 860px;
  margin: 0 auto;
  padding: 16px 24px 48px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.modes,
.chips,
.batch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 16px;
}
input[type='search'],
.batch-row input {
  flex: 1;
  min-width: 160px;
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}
button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  font-size: 14px;
}
button.on,
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
button:disabled {
  opacity: 0.5;
}
.chip {
  border-radius: 14px;
}
.color-dot.small {
  width: 10px;
  height: 10px;
  margin-right: 5px;
}
.batch {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  background: var(--panel-bg);
}
.batch-row.small {
  margin-top: 8px;
  font-size: 13px;
}
.message {
  margin: 8px 0 0;
  font-size: 14px;
}
.empty,
.muted {
  color: var(--muted);
}
.ok {
  color: var(--ok);
}
.group h3 {
  margin: 20px 0 8px;
  font-size: 16px;
}
.item {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.check input {
  width: 20px;
  height: 20px;
}
.body {
  flex: 1;
  min-width: 0;
}
.quote {
  display: block;
  width: 100%;
  padding: 2px 0 2px 10px;
  border: none;
  border-left: 3px solid var(--border);
  border-radius: 0;
  background: none;
  text-align: left;
  font: inherit;
  white-space: pre-wrap;
  max-height: 7.5em;
  overflow: hidden;
}
.quote.yellow {
  border-left-color: #f2c94c;
}
.quote.blue {
  border-left-color: #56a0f5;
}
.quote.green {
  border-left-color: #5cc16c;
}
.quote.red {
  border-left-color: #eb5757;
}
.meta {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 4px;
  font-size: 13px;
  color: var(--muted);
}
.meta .ask {
  padding: 2px 10px;
  color: var(--accent);
  font-size: 13px;
}
.note {
  margin-top: 6px;
  font-size: 14px;
  white-space: pre-wrap;
}
.tag {
  margin-right: 6px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
}
.answer {
  margin-top: 6px;
  max-height: 6em;
  overflow: hidden;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
}
.answer :deep(p) {
  margin: 0.2em 0;
}
</style>
