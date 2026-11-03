# 自己构建和发布

这份说明写给不熟悉安卓开发的人。照着做，不需要在电脑上安装 Android Studio 或 Android SDK：APK 由 GitHub Actions 在云端构建。

> 本文档会在技术验证阶段持续补充。

## 1. 生成签名密钥（只做一次）

安卓要求每个 App 用固定的密钥签名。**之后每个版本都必须用同一把密钥**，否则无法覆盖安装，只能卸载重装，本地数据会丢失。

需要先安装 JDK（例如 [Temurin](https://adoptium.net/)），然后在命令行执行：

```bash
keytool -genkeypair -v -keystore wendu-release.jks -alias wendu -keyalg RSA -keysize 2048 -validity 10000
```

按提示设置密码、填写信息。完成后得到 `wendu-release.jks`。

**把 `wendu-release.jks` 和密码备份到安全的地方。** 不要把它放进仓库目录里提交。

## 2. 把密钥转成 base64

macOS / Linux：

```bash
base64 -i wendu-release.jks | tr -d '\n'
```

Windows PowerShell：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("wendu-release.jks"))
```

复制输出的那一长串文字。

## 3. 配置 Actions Secrets

在 GitHub 仓库页面打开 Settings → Secrets and variables → Actions → New repository secret，添加四项：

| 名称 | 值 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 上一步复制的 base64 文字 |
| `ANDROID_KEYSTORE_PASSWORD` | 密钥库密码 |
| `ANDROID_KEY_ALIAS` | 别名（上面命令里是 `wendu`） |
| `ANDROID_KEY_PASSWORD` | 密钥密码（没有单独设置时与密钥库密码相同） |

四项不全时，测试照常运行，APK 构建会跳过，并在 Actions 日志里给出提示。工作流**不会**改用 debug 签名。

## 4. 下载构建出的 APK

每次推送到 `main` 分支，Actions 会运行测试并构建签名 APK：

1. 打开仓库的 Actions 页面，点最新一次「测试与安卓构建」。
2. 页面底部 Artifacts 里下载 `wendu-reader-版本号-构建号.apk`（下载的是 zip，解压得到 apk）。
3. 传到平板上安装。

构建日志的「校验签名并重命名」一步会打印签名证书的 SHA-256。每次构建都应该是同一个值；如果变了，说明密钥被换了，覆盖安装会失败。

## 5. 打标签发布

修改 `package.json` 里的 `version`（例如改成 `0.1.0`）并提交，然后推送同名标签：

```bash
git tag v0.1.0
git push origin v0.1.0
```

Actions 会构建签名 APK，自动创建 GitHub Release 并附上 APK 和更新说明。

版本号规则：`versionName` 取自 `package.json`，`versionCode` 取 Actions 的运行序号，每次构建自动递增。

## 6. 连接 Vercel（网页版预览，可选）

1. 登录 [Vercel](https://vercel.com/)，Add New → Project，导入这个仓库。
2. Framework Preset 选 Vite，其他保持默认。
3. 之后每次推送都会自动部署网页版。

网页版和 App 版是同一套代码，适合开发时快速预览；日常使用建议装 App。
