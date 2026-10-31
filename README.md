# top.qomicex.server-manager — 服务端管理插件

实现 [Qomicex.Tauri#295](https://github.com/Qomicex-Public/Qomicex.Tauri/issues/295)：在启动器里管理 Minecraft 服务端（腐竹向）。

**这是一个纯插件**——不依赖任何专用后端端点，全部功能用启动器的通用插件 API 编排。它同时是插件生态「用通用能力做复杂功能」的参考实现：启动器只提供进程管理、批量下载、分步任务上报、CF 元数据代理等通用积木，业务流程（解析整合包 → 装运行时 → 下载 mods → 隔离 client-only → 写配置 → 启动/停止/控制台）完全在本插件内。

## 功能（v0.4）

- **整合包一键开服**：
  - 资源中心安装整合包时，安装方式选「安装为服务端」（插件经 `contributes.installModes` 贡献，任何插件可贡献自己的安装方式）
  - 插件页「导入服务端 → 整合包开服」：本地 .zip（CurseForge 结构）/ .mrpack（Modrinth 结构）
  - 插件侧完整管线：解析包 → 装服务端运行时（Forge/NeoForge 先预填 `libraries/` 再执行 `--installServer`；Fabric 下 server-launcher；原版下 server.jar）→ 批量下载 mods（CurseForge 经元数据代理换直链，分发受限的记入 `.qml-server/blocked-mods.json`）→ `overrides/` 释放（自动剥前缀提到根）→ **client-only 模组自动隔离**到 `mods-client-only/`（不删可恢复）→ 生成 `eula.txt` / `server.properties` / `user_jvm_args.txt`
  - 进度经 `task.register/update/complete` 上报，与启动器下载中心的分步卡片同步可见
- **导入服务端**：本地 zip（pickFile + 解压）/ URL 下载（走启动器下载器）/ 注册已有目录；自动检测服务端 jar 与 MC 版本
- **一键启动/停止**：自动按 MC 版本选 Java（也可手动指定/添加自定义 Java/校验）；argfile 模式（forge/neo 1.17+）按 `launch.json` 组装 `java @args`；停止优先向控制台发 `stop` 优雅退出，30s 超时才强杀进程树
- **实时控制台**：stdout/stderr 游标增量流、等级着色、搜索、自动滚动、**命令输入**（`list` / `say` / `stop`…，支持 ↑↓ 历史）
- **配置管理**：server.properties 常用项表单 + 完整 raw 编辑（无损保留注释）
- **白名单**：whitelist.json 编辑 + 按玩家名经 Mojang API 查 UUID（正版服；离线服提供手填 UUID 高级模式）
- **EULA 流程**：首次启动弹窗展示协议要求 + 跳转 EULA 网站 + 8 秒倒计时确认
- **其它**：服务端异常退出系统通知（降级 toast）、打开服务器目录、启动器重启后凭 lastPid 找回仍在运行的服务端

## 依赖的启动器 API

本插件**只使用通用 API**（不含 `shell:execute`），需要 **v1.0.1-beta1.0 及以上**的启动器（该版本合入了 [PR #302](https://github.com/Qomicex-Public/Qomicex.Tauri/pull/302) 的全部插件生态能力；商店按此版本过滤兼容性，旧版启动器的插件市场里不会出现本插件）：

- 进程管理：`process.spawn/stdin/kill/alive/logs/list`
- 文件系统：`readText/readBytes/writeText/writeBytes/deleteFile`、`extractArchive`（含 `prefix`/`stripPrefix`）、`readArchiveEntry`、`renamePath`、`listDir`
- 下载与任务：`download.addBatch/batchStatus`、`task.register/update/complete/progress`
- 元数据代理：`curseforge.files`（CF `projectID:fileID` → 下载直链，API key 不出启动器）
- 对话框与系统：`pickFile`、`pickDirectory`、`getSystemInfo().dataDir`、`sendNotification`、`onLauncherExit`
- 其它：`proxyFetch`、`getPluginStrings/getLocale/getIconSvg`、扩展点 `contributes.installModes`

这些能力随本插件在启动器仓库补齐，背景与缺口分析见 [docs/api-gap-report.md](docs/api-gap-report.md)，生态设计对照见 [docs/ecosystem-design-references.md](docs/ecosystem-design-references.md)。

## 开发

```powershell
pnpm install
pnpm run build     # vite build → dist/
pnpm test          # properties 解析器单测（node --test）
pnpm run pack      # 本地签名 + 打包 release/top.qomicex.server-manager-<ver>.qplugin
```

> 依赖用 **pnpm** 管理（`qomicex publish` 内部也按 pnpm 构建）。`pnpm-workspace.yaml` 里
> `allowBuilds: esbuild: true` 是必须的——pnpm v11 默认拦截依赖构建脚本，不放行会在
> install 阶段直接 `ERR_PNPM_IGNORED_BUILDS` 退出。

打包脚本（PowerShell `scripts/pack.ps1`）先调用 `scripts/sign-local.mjs` 做本地开发签名，再用 Windows 自带 bsdtar 把 `manifest.json`（zip 根）+ `dist/` + `l10n/` + 两个签名文件压为 `.qplugin`（先 `.zip` 再改名；条目名统一正斜杠，规避 Compress-Archive 的反斜杠条目问题）。版本号缺省取 `manifest.json` 的 `version`。

## 本地开发签名（ADR-050 三级信任链）

`.qplugin` 安装默认强制验签：包内需 `signature.json`（开发者私钥签包体）+ `signature.cert.json`（根钥签发的开发者证书）。没有商店开发者证书时，用本地根钥走完整链路：

1. `npm run pack` 自动执行 `scripts/sign-local.mjs`：首次运行生成 `dev-keys/dev-root.seed` + `dev-keys/dev-key.seed`（**私钥，勿入库勿外传**，已进 .gitignore），铸造本地证书并签包，输出自验结果与本地根公钥。
2. 用打印出的根公钥设置环境变量，再启动启动器（**仅 debug 构建生效**，release 不受影响）：

   ⚠️ **dev 模式后端是独立进程**：`pnpm tauri dev` 的 Tauri 壳在 dev 下不启动后端，前端直连 `:5000` 的 axum 后端——它由 **`pnpm dev:backend`**（另一个终端）启动。环境变量必须设在**后端那个终端**，后端启动后修改变量需重启（根钥按进程缓存；验签时会向 trace 写一行实际生效的根钥，可对照排查）：

   ```powershell
   # 终端 A（后端）
   $env:QOMICEX_DEV_ROOT_PUBLIC_KEY = "<sign 输出的根公钥>"
   pnpm dev:backend

   # 终端 B（启动器壳，无需环境变量）
   pnpm tauri dev
   ```
3. 安装签名包 → 启动器完成证书验签（本地根钥）→ 包体哈希与签名校验 → 正常安装。

包内容任何一字节改动都会导致「签名哈希与包内容不匹配」拒装。`qomicex verify --package` 同样支持 `QOMICEX_DEV_ROOT_PUBLIC_KEY` 环境变量验本地签名包。

## 发布到插件商店

走正式链路（RFC 8628 设备流登录，商店根钥签发开发者证书）：

```powershell
npm run build
$env:QOMICEX_SIGN_KEY = "<开发者私钥，PKCS#8 PEM 或 raw base64 seed>"
qomicex publish            # 在本插件根目录执行
```

`publish` 会：设备流登录（打印授权 URL，浏览器确认）→ 注册公钥并获取商店证书 → 打包签名 → 上传到商店（默认 `https://plugins.qomicex.top/api/v1`，可用 `QOMICEX_STORE_API` 覆盖）。成功后 `release/` 下会存一份已签名包供复验。

## 安装与手动测试（本地开发）

1. 启动器从源码运行（需包含 PR #302 的通用 API；正式发版后可安装对应版本）
2. 设置 `$env:QOMICEX_DEV_ROOT_PUBLIC_KEY`（见上文），`pnpm dev:backend` 启动后端、`pnpm tauri dev` 启动壳
3. 设置 → 插件 → 安装插件 → 选择 `release/top.qomicex.server-manager-<ver>.qplugin` → 启用 → 重启启动器
4. 侧边栏出现「服务端管理」

### 测试清单

- [ ] **整合包开服**：资源中心选整合包 → 安装方式出现「创建实例 / 安装为服务端」→ 选服务端 → 下载中心出现 `task.register` 分步卡片 → 完成后插件列表自动出现该服务器 → 启动 → EULA → 控制台；Fabric 包的 `mods-client-only/` 应出现仅客户端模组
- [ ] 插件页「整合包开服」本地 .mrpack/.zip 同上（对话框内进度条）
- [ ] NeoForge 包：验证安装器库预填（受限网络下 `maven.neoforged.net` 不可达也能装好，`libraries/` 由批量下载预填）
- [ ] CurseForge 包含分发受限模组时：`blocked-mods.json` 有清单、toast 提示数量；手动补全后服务端可启动
- [ ] 取消：搭建中取消 → 卡片转失败/取消、插件占位条目标记失败
- [ ] 导入：本地 zip（含带顶层目录的压缩包，自动下钻）/ URL / 已有目录三种模式
- [ ] 首次访问目录时弹出 FS 授权确认（一次授权覆盖整个根目录前缀）
- [ ] Java：自动推荐（填 MC 版本后点「推荐」）、手动选择、添加自定义、校验
- [ ] EULA：首次启动弹 8 秒倒计时窗，点外链能打开协议网站，同意后 eula.txt 写入成功
- [ ] 控制台：启动后日志实时滚动、搜索/暂停自动滚动、发 `list` 有回显；等级过滤与 ↑↓ 历史
- [ ] 优雅停止：发 stop 后服务端保存退出；「强杀」按钮有红色警告
- [ ] 配置：改 max-players/difficulty 保存后重开一致；raw 编辑保留注释
- [ ] 白名单：正版名能查询添加（需外网）；手填模式可添加离线 UUID
- [ ] 异常退出通知：强杀后收到系统通知或 toast
- [ ] 重启启动器后，运行中的服务端被自动识别（PID 找回）
- [ ] 语言/主题跟随：切启动器语言与主题，插件页面文案与配色跟随

## 实现说明（对插件作者）

- 桥调用统一写成 `getApi()?.call('<方法名>', ...)` 字面形式 —— `qomicex verify` 的权限最小化扫描按 `.call('x')` 文本识别，函数式包装会让扫描失效。
- 日志流用 `process.logs` 的 seq 游标轮询（800ms）拼装，不需要 SSE。
- 全部样式使用启动器注入的主题 token（`hsl(var(--*))`）与 `@qomicex/plugin-ui` 组件，自动适配明暗主题；**Tailwind `content` 必须包含 `node_modules/@qomicex/plugin-ui/dist/**/*.js`**，否则组件类名被裁剪、Dialog 等退化为普通块。
- 服务端搭建管线写在 `src/api/setup.js`：预填安装器库（`readArchiveEntry` 读内嵌清单 → `download.addBatch` 并发下载）是受限网络下 NeoForge 能装上的关键。

## 许可证

GPL-3.0-or-later（与启动器一致），见 [LICENSE](LICENSE)。
