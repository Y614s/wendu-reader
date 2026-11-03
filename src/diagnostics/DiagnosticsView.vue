<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getAppVersion, isNativeApp } from '../platform'

// 骨架阶段先显示运行环境，确认网页版和 App 版都能打开；其余诊断项后续补齐
const version = ref('…')

onMounted(async () => {
  const v = await getAppVersion()
  version.value = v.build ? `${v.version}（versionCode ${v.build}）` : v.version
})
</script>

<template>
  <div class="diag">
    <h2>诊断</h2>
    <dl>
      <dt>运行环境</dt>
      <dd>{{ isNativeApp() ? 'App 版' : '网页版' }}</dd>
      <dt>版本</dt>
      <dd>{{ version }}</dd>
    </dl>
  </div>
</template>

<style scoped>
.diag {
  padding: 16px 24px;
}
dt {
  color: var(--muted);
  font-size: 13px;
}
dd {
  margin: 0 0 12px;
}
</style>
