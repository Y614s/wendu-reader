# CLAUDE.md

本文件是给 Claude Code 的项目约定。每次只做 `docs/tasks/` 里当前分配的那一个任务，不要擅自扩大范围。

维护者本地还有两个不上传的文件，存在时先读：

- `docs/plan.md`：完整的产品规格。
- `docs/local.md`：维护者的测试设备和个人设置。

不存在时，以本文件和任务文件为准。

## 项目是什么

「问读」：一个开源的安卓平板 Markdown 阅读器。核心是读、问、记在同一个界面完成：选中文字 → 划线 / 批注 / 侧栏问 AI / 发到其他 AI App → 存成笔记 → 导出。

- 目标设备：安卓平板，**横屏为主**，竖屏保证能用；手机能打开，但不专门适配。
- 形态：同一套网页代码。网页版部署在 Vercel，用于开发预览，也可作为在线体验；日常使用的是 Capacitor 打包的 APK，通过 GitHub Releases 发布。
- 任何人都能直接下载 APK 使用，或 fork 后自己构建。没有服务器、没有账号、没有统计上报；所有数据只存在用户自己的设备上，AI 接口由用户自己填 Key。
- 维护者不写代码，只在平板上验收。所以：能自动测试的一律写测试；只能真机测的，做进 App 内的诊断页，并在任务末尾给出真机验收清单。

## 固定的技术栈（不要替换）

| 部分 | 选择 |
| --- | --- |
| 框架 | Vue 3（`<script setup>` + 组合式 API）+ Vite + TypeScript |
| md 渲染 | markdown-it，`html: false` |
| 代码高亮 | Shiki，只打包这些语言：js、ts、python、java、c、cpp、go、rust、sql、bash、json、yaml、markdown |
| 公式 | KaTeX，字体随应用打包 |
| 内容净化 | DOMPurify（净化 AI 回答） |
| 本地存储 | IndexedDB + Dexie.js |
| 测试 | Vitest + happy-dom |
| 安卓 | Capacitor（`appId: app.wendu.reader`，`appName: 问读`） |
| 网页版离线 | vite-plugin-pwa |
| CI | GitHub Actions：测试、构建签名 APK、发布 Release |

Mermaid 用动态 import 按需加载，只有文档里有 mermaid 代码块时才加载。新增依赖前先想清楚能否不加；不引入任何远程加载的脚本或字体，所有资源打包进应用。

## 目录结构

```
src/
  app/          入口、路由、全局状态
  reader/       渲染管线：markdown-it、KaTeX、Shiki，输出 DOM
  textmap/      文本映射层：渲染后的 DOM ↔ 规范化纯文本
  anchor/       锚点的创建、序列化、重新定位
  selection/    选区缓存、底部工具栏
  highlight/    划线显示（Custom Highlight API，回退为 mark 元素）与点击命中
  ai/           Chat Completions 客户端、SSE 流式解析、上下文组装
  share/        发到 App、待补充记录
  db/           Dexie schema、迁移、备份与恢复
  export/       导出 md
  platform/     网页与 Capacitor 的差异封装（唯一允许直接调用 Capacitor 的地方）
  ui/           Vue 组件
  diagnostics/  诊断页
tests/          与 src 对应的单元测试
public/samples/ 测试文档
docs/tasks/     任务文件
docs/setup.md   自己构建和发布的步骤
```

## 数据模型（第一版就定，之后只加不改）

Dexie 表：

- `documents`：`id`（UUID）、`title`、`source`（md 原文）、`hash`、`importedAt`、`lastReadAt`、`readingPosition`、`progress`（可选，0～1）
- `anchors`：`id`、`docId`、`docHash`、`quote`、`prefix`、`suffix`、`start`、`end`（`start`/`end` 是映射层里的字符位置）
- `highlights`：`id`、`anchorId`、`color`（`yellow` | `blue` | `green` | `red`，不认识的值按黄色显示）、`createdAt`
- `notes`：`id`、`anchorId`、`source`（可选，`annotation` | `ai`）、`text`、`createdAt`、`updatedAt`
- `conversations`：`id`、`docId`、`anchorId`（整篇提问时为空）、`kind`（`sidebar` | `external`）、`status`（`done` | `pending`，pending 即待补充记录）、`messages`、`provider`、`model`、`createdAt`
- `settings`：键值对。API Key 也存这里，但**永远不进备份、不进日志**。能进出备份的设置走白名单（`src/db/backup.ts`），新增设置默认留在本机；AI 接口配置不进备份。

规则：
- schema 变更只能新增版本号并写迁移，不能修改已发布的版本。已经有人在用，迁移出错会丢别人的数据。
- 所有 id 用 `crypto.randomUUID()`。
- 同名文档导入时保留两份，不覆盖。更新文档内容走书架的「更新」，先预览再迁移划线，找不到的锚点保留。

## 文本映射层（最关键，必须有单元测试）

1. 遍历渲染后正文的文本节点，按文档顺序拼成规范化纯文本。
2. 每个 `.katex` 元素和 `.mermaid-block` 容器整体只算 **1 个字符**（用 U+FFFC），不进入其内部，也不读 `.katex-mathml`。
3. 块级元素之间补一个 `\n`；不做其他空白压缩，保证与 DOM 偏移可逆。
4. 同时建立"纯文本下标 → (DOM 节点, 偏移)"的映射，以及反向查询。
5. 选区边界落在公式内部时，扩展到整个 `.katex` 外层元素。
6. 定位、复制、AI 上下文、导出共用这一层；需要文本时，再把 U+FFFC 换回公式的原始 TeX 或 mermaid 代码块（从渲染时保留的源码属性中取）。

锚点：存 `quote` + 前后各 32 个字符 + `start`/`end`。重新定位顺序：先校验位置处文本是否等于 `quote`；不等则在全文搜索 `quote`，用 prefix/suffix 相似度和与原位置的距离选最佳；都失败则标记为孤立，不删数据。

## 选区与工具栏

- 只在正文内出现**非空**选区时更新缓存；选区变空不覆盖缓存。
- 打开提问面板或执行划线前，先把缓存转成锚点写入 IndexedDB。
- 取消操作、切换文档、打开面板、点正文或工具栏以外的地方时清除缓存；用完或取消时走 `dismissSelection()`。
- 工具栏按钮在 `pointerdown` 时 `preventDefault()`，只作辅助手段。
- 工具栏固定在屏幕底部；键盘弹出时用 `visualViewport` 调整位置。
- 点击命中：`document.caretRangeFromPoint` → 映射层字符位置 → 与锚点区间比较。不要遍历所有 Range 调 `getClientRects()`。

## AI 请求

- 只实现 OpenAI Chat Completions 格式（`POST {baseURL}/chat/completions`，`stream: true`），用 WebView 自带的 `fetch` + `ReadableStream` 解析 SSE，不用 Capacitor 原生 HTTP。
- 服务商预设只是方便填写；接口地址、模型名全部可改，并提供「自定义」。不写死模型名。
- 上下文按 token 预算截取，优先级：问题和选中原文（必须保留）> 附近段落 > 本节其他内容 > 其他章节和历史对话。"全文"放不下时，界面上明确提示只发送了部分内容。
- 不假设用户所在的网络环境：阅读、划线、笔记、导出备份完全离线可用；提问只依赖用户自己选的接口。连接失败时给出清楚的错误原因（网络不通、被跨域拦截、Key 无效、额度不足等），并建议检查网络或换一个服务商。
- 任何地方都不打印 API Key 或完整请求头。

## 安全与隐私

- markdown-it 关闭原始 HTML；AI 回答渲染前经 DOMPurify 净化。
- 不引入第三方远程脚本；不加任何统计、上报、崩溃收集。
- 用户的文档和问题只发给用户自己配置的 AI 接口，不发往其他任何地方。
- 不在代码、提交、日志、备份里出现任何密钥。

## 打包、签名与发布

- `appId` 固定为 `app.wendu.reader`，一旦发布不可更改。
- 维护者的签名密钥存在 GitHub Actions Secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。keystore 文件绝不提交进仓库。
- Secrets 不全时（例如别人 fork 后、或来自 fork 的 PR），测试照常运行，签名构建步骤跳过并在日志里说明原因、指向 `docs/setup.md`。**绝不退回 debug 签名**，否则覆盖安装会失败。
- `versionCode` 用 `GITHUB_RUN_NUMBER`；`versionName` 来自 `package.json`。
- 推送 `v*` 标签（如 `v0.1.0`）时构建签名 APK，创建 GitHub Release 并附上 APK 和更新说明。
- 必须保证覆盖安装后 IndexedDB 数据保留。

## 开源相关

- `LICENSE`：默认 MIT，第一次推送前和维护者确认。
- `README.md` 面向使用者，中文为主：项目是什么、下载安装（指向 Releases）、首次配置（选服务商、填 Key）、隐私说明（数据只在本机，Key 和问题只发给你选的服务商）、自己构建（指向 `docs/setup.md`）。
- 代码、注释、文案、提交信息里不出现维护者的个人信息（设备型号、所在地等）；需要时写在 `docs/local.md`。

## 界面

- 风格是「纸墨」：暖色、书卷气。颜色、圆角、阴影、动效都用 `src/ui/base.css` 里的变量，三种主题都要有，组件里不写死颜色。
- 按钮、输入框、菜单、卡片用 base.css 的统一样式，组件里只写位置和例外。可点元素的点击区域不小于 44 × 44 像素。
- 确认用 `confirmDialog()`，不用系统弹窗。图标用 `src/ui/Icon.vue`，不引入图标库。

## Git：哪些上传、哪些留在本地

这是公开仓库。判断标准：GitHub 上只放构建、测试、使用和继续开发需要的东西；密钥、个人信息、可再生成的产物一律不上传。

- **上传**：`src/`、`tests/`、`public/`（含 `samples/test.md`，测试和打包都要用）、`android/` 中 Capacitor 要求纳入版本管理的部分、`.github/workflows/`、`package.json` 和锁文件、各类配置文件、`README.md`、`LICENSE`、`CLAUDE.md`、`docs/tasks/`、`docs/setup.md`。
- **绝不上传**：签名密钥（`*.jks`、`*.keystore`）及其密码、`.env*`、任何含 API Key 的文件、诊断报告和真机测试时导出的备份文件。
- **不上传（个人文件）**：`docs/plan.md`、`docs/local.md`。
- **不上传（可再生成）**：`node_modules/`、`dist/`、`android/app/build/`、`android/.gradle/`、`.idea/`、`.vscode/` 里的个人设置、系统垃圾文件（`.DS_Store`、`Thumbs.db`）。

做法：
- 第一次提交前先写好 `.gitignore`，再用 `git status` 检查。
- **第一次推送前，把将要上传的文件清单列给维护者确认。**之后照常提交，但新增的、不在上述规则内的文件类型要先说明。
- 一旦发现密钥、API Key 或个人信息被误提交，立即停下告诉维护者；不要只在新提交里删除，因为它仍留在历史记录里。

## 工作方式

- 提交信息用中文，格式 `类型: 描述`（如 `feat: 文本映射层支持公式整体单位`）。小步提交。
- 每个任务结束时：`npm run test` 和 `npm run build` 都通过；在回复里列出**真机验收清单**，写清楚每一项怎么测、期望看到什么。
- 遇到规格里没写清楚、且会影响数据模型或已定决策的问题，先停下来问，不要自行决定。
