<script setup lang="ts">
import { setTheme, themeSetting, type ThemeSetting } from '../app/theme'
import { FONT_SIZE_MAX, FONT_SIZE_MIN, LINE_HEIGHTS, PAGE_WIDTHS, prefs, setFontSize, setLineHeight, setPageWidth } from '../app/prefs'

// 主题和排版：设置页和阅读页的「排版」浮层共用。

const themes: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '日间' },
  { value: 'sepia', label: '米黄' },
  { value: 'dark', label: '夜间' },
]
</script>

<template>
  <div class="typo">
    <div class="field">
      <span class="field-label">主题</span>
      <div class="seg">
        <button v-for="t in themes" :key="t.value" :class="{ on: themeSetting === t.value }" @click="setTheme(t.value)">{{ t.label }}</button>
      </div>
    </div>
    <div class="field">
      <span class="field-label">字号</span>
      <div class="seg">
        <button :disabled="prefs.fontSize <= FONT_SIZE_MIN" @click="setFontSize(prefs.fontSize - 1)">A−</button>
        <span class="value">{{ prefs.fontSize }}</span>
        <button :disabled="prefs.fontSize >= FONT_SIZE_MAX" @click="setFontSize(prefs.fontSize + 1)">A+</button>
      </div>
    </div>
    <div class="field">
      <span class="field-label">行距</span>
      <div class="seg">
        <button v-for="h in LINE_HEIGHTS" :key="h.value" :class="{ on: prefs.lineHeight === h.value }" @click="setLineHeight(h.value)">{{ h.label }}</button>
      </div>
    </div>
    <div class="field">
      <span class="field-label">正文宽度</span>
      <div class="seg">
        <button v-for="w in PAGE_WIDTHS" :key="w.value" :class="{ on: prefs.pageWidth === w.value }" @click="setPageWidth(w.value)">{{ w.label }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
}
.field-label {
  font-weight: 500;
}
.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.value {
  min-width: 32px;
  text-align: center;
}
button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 15px;
}
button.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
button:disabled {
  opacity: 0.4;
}
</style>
