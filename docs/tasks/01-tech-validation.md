# 任务 01：技术验证（最小 APK + 诊断页）

先读 `CLAUDE.md`；`docs/plan.md` 和 `docs/local.md` 存在时也读。本任务只做验证，不做完整功能：目标是用最少的代码，在测试平板上确认关键路径走得通。

## 目标

做出一个能装到平板上的最小 App 和对应的网页版，用来回答这些问题：

1. 系统 WebView 支不支持我们依赖的能力（Custom Highlight API、caretRangeFromPoint、visualViewport、IndexedDB 持久化）。
2. 选中文字 → 底部工具栏 → 划线 / 提问，这条路径在平板上是否顺畅，选区会不会丢。
3. 文本映射层和锚点能否在含公式的文档上稳定定位，重开后划线能否恢复。
4. 在 WebView 里能否直连 AI 接口并流式输出（DeepSeek 为主，百炼、Gemini 备选）。
5. GitHub Actions 能否稳定构建签名 APK，覆盖安装后数据是否保留。
6. 能否从微信「用其他应用打开」md，能否把文字分享给其他 AI App。

## 范围

要做：

- 项目骨架：Vite + Vue 3 + TS，目录结构按 `CLAUDE.md`；hash 路由（网页版部署到 Vercel 不需要配置重写规则）。
- 阅读页：打开内置测试文档 `public/samples/test.md`，或通过文件选择器导入 md；用 markdown-it + KaTeX + Shiki 渲染。
- 文本映射层和锚点：按 `CLAUDE.md` 的规则实现，并写单元测试（见下文）。
- 底部工具栏，只放三个按钮：**划线**、**侧栏问**、**发到 App**。
- 划线存入 IndexedDB，重开页面或重启 App 后恢复显示；Custom Highlight API 不可用时回退为 mark 元素包裹。
- 侧栏问：选中内容 + 问题，流式显示回答；对话存库并挂在锚点上。
- 发到 App：先建一条 `status: pending` 的待补充记录，再调起系统分享面板（App 版用 `@capacitor/share`，网页版用 `navigator.share`，都不支持时复制到剪贴板）。
- 设置页：选择服务商预设、填接口地址、模型名和 API Key。
- 诊断页（见下文）。
- 开源仓库的基础文件：`.gitignore`、`README.md` 初稿、`LICENSE`（默认 MIT，先和维护者确认）。
- Capacitor 安卓工程；注册 md 文件的打开方式（见下文）。
- GitHub Actions：测试 + 构建签名 APK 并上传为构建产物。

不做：书架、目录、主题、批注、导出、备份、四色划线、Mermaid 渲染、整篇提问。

## 服务商预设（设置页里预填，模型名不预填）

| 服务商 | 接口地址 | 说明 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | 默认预选 |
| 百炼（北京） | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | 官方推荐的业务空间专属域名，`{WorkspaceId}` 由用户替换；旧地址 `https://dashscope.aliyuncs.com/compatible-mode/v1` 另设一个预设 |
| 百炼（新加坡） | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` | 同上 |
| 百炼（弗吉尼亚） | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` | |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | |
| 自定义 | 用户自己填 | 任何兼容 Chat Completions 的接口 |

各服务商的 Key 分开保存，切换时不用重新填。

请求统一发到 `{接口地址}/chat/completions`，拼接时处理好末尾斜杠。

参考：[百炼 OpenAI Chat 接口兼容](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)，[Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)。

## 诊断页

一个页面集中展示真机才能确认的信息，底部有「复制诊断报告」按钮，生成纯文本，方便用户粘贴回来。

- 运行环境：网页版还是 App 版、User-Agent、Chromium 主版本号、App 版本号和 versionCode、页面 origin。
- 能力检测：`CSS.highlights`、`document.caretRangeFromPoint`、`window.visualViewport` 是否存在。
- 存储：`navigator.storage.persist()` 的结果、`navigator.storage.estimate()`、一个持久计数器（每次启动加一，用来确认覆盖安装和重启后数据还在）。
- 网络：对每个已配置的服务商有「测试连通」按钮，发一个很短的流式请求，显示 HTTP 状态、是否被跨域拦截、首个 token 用时、收到的数据块数量、总用时。错误信息里不能出现 API Key。
- 选区记录：最近一次选区缓存的内容、对应的映射层位置，以及点击工具栏按钮那一刻缓存是否还在。

## 从微信导入 md

- `AndroidManifest.xml` 为 `ACTION_VIEW` 和 `ACTION_SEND` 注册 intent-filter，MIME 同时接受 `text/markdown`、`text/plain`、`application/octet-stream`。微信传出的 md 常常不是标准类型，地址是 `content://` 形式。
- 收到后读取 `content://` 数据流；按文件名扩展名和内容判断是不是 md，不是就提示，不导入。
- 实现方式自选：可用维护中的社区插件，也可以在 `MainActivity` 写少量原生代码再桥接到网页层。优先少依赖，代码集中在 `src/platform/`。

## 单元测试（必须通过）

- 文本映射层：纯文本与 DOM 偏移的双向转换；每个 `.katex` 只占 1 个字符；块级元素之间是 `\n`；选区边界落在公式内部时扩展到整个公式。
- 锚点：测试文档里有重复句子，验证重新定位时能靠前后文选中正确的那一处；原文被改掉时标记为孤立，不报错。
- SSE 解析：能处理跨数据块断开的行、`[DONE]`、空行和错误事件。

## 打包与签名

1. 维护者需要先在自己电脑上生成一次签名密钥（见文末「需要用户手动做的事」），把四个值存进仓库的 Actions Secrets。
2. 工作流：`push` 到 `main` 时运行测试，构建网页资源，`npx cap sync android`，用 Gradle 构建 release APK 并签名，上传为构建产物。
3. `versionCode` 用 `GITHUB_RUN_NUMBER`。
4. Secrets 不全时（例如别人 fork 后），测试照常运行，签名构建步骤跳过并在日志里说明原因；不要退回 debug 签名（debug 签名每次不同，会导致覆盖安装失败）。
5. 推送 `v*` 标签时创建 GitHub Release 并附上签名 APK。

## 交付物

- 能运行的代码，`npm run test` 和 `npm run build` 通过。
- `.github/workflows/android.yml`。
- `docs/setup.md`：生成密钥、配置 Secrets、连接 Vercel、打标签发布、下载安装 APK 的步骤，写给不熟悉安卓开发的人看；别人 fork 后照着它也能构建出自己的 APK。
- `README.md` 初稿和 `LICENSE`。
- 在回复里给出下面的真机验收清单，并说明每一项去哪里看结果。

## 需要维护者手动做的事

1. 在 GitHub 上新建公开仓库。推送由 Claude Code 完成，第一次推送前它会列出要上传的文件让你确认。
2. 在电脑上生成签名密钥（需要安装 JDK）：

   ```bash
   keytool -genkeypair -v -keystore wendu-release.jks -alias wendu -keyalg RSA -keysize 2048 -validity 10000
   ```

   转成 base64：macOS / Linux 用 `base64 -i wendu-release.jks | tr -d '\n'`；Windows PowerShell 用 `[Convert]::ToBase64String([IO.File]::ReadAllBytes("wendu-release.jks"))`。
3. 在仓库 Settings → Secrets and variables → Actions 里添加：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。
4. **把 `wendu-release.jks` 和密码备份到安全的地方。** 丢了就无法覆盖更新，只能卸载重装，本地数据会丢。
5. 在 Vercel 导入这个仓库，框架选 Vite。

## 真机验收清单

在测试平板上（设备见 `docs/local.md`），网页版和 App 版各测一遍（第 7、8、9 项只测 App 版）。

| # | 测什么 | 怎么测 | 期望 |
| --- | --- | --- | --- |
| 1 | WebView 能力 | 打开诊断页 | 三项能力都显示可用；记下 Chromium 版本 |
| 2 | 工具栏与选区 | 横屏长按选中一句话，看底部工具栏，点「划线」 | 工具栏不被系统菜单遮挡；划线成功，诊断页显示点击时缓存仍在 |
| 3 | 公式选区 | 依次试：只选公式内部、从公式前选到公式后、选含行内公式的整句、选含公式块的段落 | 每种都得到正确结果，或明确提示「已按整块公式处理」 |
| 4 | 划线恢复 | 划几处（包括重复句子中的第二处），关掉重开 | 划线都在原位，重复句子没有串位 |
| 5 | 侧栏问 | 选中一段，提问 | 回答逐字出现；重开后对话还在 |
| 6 | 键盘 | 在侧栏输入问题时观察 | 选中的文字和输入框都看得见 |
| 7 | 发到 App | 选中一段，点「发到 App」，分别选 Claude、豆包等 | 记下各 App 能否收到文字、是否自动填进输入框；回来后待补充记录还在 |
| 8 | 微信导入 | 在微信里打开一个 md 文件，选「用其他应用打开」 | 列表里出现「问读」，打开后正常显示 |
| 9 | 覆盖更新 | 装 A 版，划线并记下诊断页计数器；推送一次代码，装 B 版覆盖 | 划线、对话都在，计数器继续累加 |
| 10 | 网络 | 诊断页对每个服务商点「测试连通」 | 至少一个服务商在 App 版里流式通过 |

## 怎么算通过

左列必须通过；右列不通时用保底方案，不卡进度。

| 必须通过 | 允许用保底方案 |
| --- | --- |
| 正文选区、划线保存和恢复（第 2、4 项） | 虚线效果不好，改背景高亮 |
| 至少一种 AI 请求路径可用（第 10 项） | 分享失败，改复制后手动粘贴（第 7 项） |
| 覆盖安装后数据不丢（第 9 项） | 微信打开失败，先用文件选择器（第 8 项） |
| 含公式的选区给出正确结果或明确提示（第 3 项） | Custom Highlight API 不可用，改用 mark 元素包裹 |

第 10 项全部不通时，按 `docs/plan.md` 里「跨域不通时的决策顺序」处理，定下方案前不进入第一版开发。打包链路卡住时，先用网页版完成验证，APK 延后。
