# 启动器插件生态 API 缺口报告

> 以 issue #295「服务端管理」插件的完整开发为样本，检验 Qomicex 插件生态的 API 覆盖度。
> 结论先行：**核心链路（数据持久化、网络、UI、主题）成熟可用；但"管理一个外部程序"这一大类场景几乎完全没有 API 支撑**，本次开发被迫先在启动器侧补齐 7 组能力后才得以用正规方式实现。
> 报告分三部分：已补齐（含实现位置与用法）、仍缺（建议后续补齐）、正面清单。

## 一点五、第二轮增补（v0.2：整合包一键开服 + 资源中心安装方式扩展点）

| 能力 | 实现位置 | 说明 |
|---|---|---|
| 服务端搭建管线 | 后端 `services/server_setup.rs` + `POST /server/setup`（progress/cancel 端点） | 复用整合包解析/CF 反查/overrides/下载批处理/InstallTracker；新增服务端运行时安装（forge/neo `--installServer`、fabric server-launcher、vanilla server.jar）、client-only 过滤（jar 元数据扫描）、启动方式自描述（`.qml-server/launch.json`）。**所有插件可经 `callBackend` 复用**（`network:fetch`），进度自动进下载中心（kind='server'） |
| `contributes.installModes` UI 扩展点 | manifest 类型（`src/plugins/types.ts`）+ `src/plugins/install-modes.ts` + `ModpackInstallDialog`/`ModpackQuickInstallDialog` | 资源中心安装对话框的「安装方式」选项组：插件声明 label/icon/resourceKinds，用户选中确认后启动器调 `installMode:{id}` 方法（`registerMethod`）并附资源上下文 `{kind, source, projectId, fileId, name, gameVersion, iconUrl, path}`。通用设计——服务端搭建只是首个使用者，任何插件都能贡献自己的安装目标 |
| 安装步骤 i18n 生态通道 | `InstallStep.label`（后端，`set_step_label`）+ 前端渲染优先级（`InstallStepsList`/DownloadCenter：label > `downloads.steps.{id}` 词条 > 原始 id） | **插件/新管线的步骤命名不再依赖启动器 i18n**：管线自带 label 即可显示。随启动器发布的管线仍走 i18n（可本地化），label 通道留给外部。连带修复：i18n 缺词条时回退显示原始 key（如 `downloads.steps.parse-pack`）的体验 |
| 后端发起任务在下载中心可见 | `InstallProgress.title` + 下载中心对 SSE 未知 install 自动补卡 | 插件经后端发起的安装任务（此前只有前端发起的才有卡片）现在自动出现在下载中心，标题取管线写入的 `title` |
| 插件升级保留用户数据 | `install_from_package` 迁移 `settings.json`/`cache.json` | 此前上传升级整个替换插件目录，插件存在自己目录里的用户数据（如服务器列表）会被清空 |
| **插件自持 i18n**（根解，调研 VS Code/Chrome/JetBrains 后落地） | manifest `"l10n"` 目录 + `%key%` 解析（`src/plugins/l10n.ts` + pluginStore 加载时解析）+ 桥 `getPluginStrings`/`getLocale` | 插件贡献给宿主渲染的一切文案（菜单/安装方式/进度标题/步骤标签）自带语言包，宿主按 locale 解析——**彻底摆脱对启动器 i18n 的依赖**（此前 `InstallStep.label` 只是半解：报告者需要自己得到本地化字符串，本通道补齐）。完整调研与设计对照见 [ecosystem-design-references.md](ecosystem-design-references.md) |

## 一、本次已补齐（随本插件一起落地）

### P0-1 常驻进程管理 `process.*`（最大缺口）

- **场景**：启动/停止 Minecraft 服务端（`java -jar server.jar nogui`），实时看日志、向控制台发命令。
- **原状**：`execCommand` 一次性执行（默认 15s、上限 120s、超时杀进程树），无流式输出、无进程句柄、无 stdin、无法手动停止 —— **跑任何常驻进程都不可行**。权限目录里的 `game:process` 有名无实（无对应桥方法）。启动器自身的进程管理（spawn/日志总线/进程树 kill）全部埋在 core Rust 里，插件不可达。
- **迂回方案（未采用）**：`Start-Process -RedirectStandardOutput` + 轮询日志文件 + `taskkill` —— 需要 `shell:execute`（danger），且优雅停服（stdin 发 `stop`）完全无法实现。
- **补齐**：
  - 后端 `src-backend/qomicex-backend/src/services/plugin_process.rs` + `endpoints/plugin.rs`：`process/{id}/spawn`、`/{pid}/stdin`、`/{pid}/kill`、`/{pid}/alive`、`/{pid}/logs?after=seq`、`process/{id}/list`
  - 前端桥 `src/plugins/plugin-api.ts` + `sandbox.ts`：`process.spawn/stdin/kill/alive/logs/list`，新权限 `process:manage`（danger）
  - 设计要点：按 `plugin_id` 归属隔离（插件只能管自己拉起的进程）；stdout/stderr 逐行进 2000 行环形缓冲，`seq` 游标增量拉取（轮询式，dev HTTP 与 release QIPC 行为一致，避开 SSE 在自定义协议下不可用的问题）；进程退出后句柄保留 10 分钟供收尾；kill 复用 core 进程树终止；每插件并发上限 32。
- **本插件用法**：`process.spawn` 启动 → `process.logs` 每 800ms 游标轮询渲染控制台 → `process.stdin` 发命令/优雅 `stop` → `process.kill` 强杀 → `process.list`/`lastPid` 在插件页重载后找回进程。

### P0-2 文件/目录选择对话框 `pickFile` / `pickDirectory`

- **场景**：导入本地服务端压缩包、选择服务器根目录 / 已有服务器目录。
- **原状**：完全没有。Tauri 的 `pick_dialog` command 只有主界面可用，插件侧不可达；沙箱 iframe 里 `<input type=file>` 拿不到绝对路径。用户只能手敲路径。
- **补齐**：主窗口桥中转 invoke `pick_dialog`（该 command 本就支持 directory/filters/default_path，零 Rust 改动），新权限 `dialog:open`（normal）。

### P1-3 本地 zip 解压 `extractArchive`

- **场景**：服务端压缩包"独立免安装、导入即解压"（issue 原文）。
- **原状**：只有「下载 + extract:true」与「整合包语义的 modpack 安装」两条路，**纯本地压缩包没有解压 API**（此前唯一出路是 `execCommand` PowerShell `Expand-Archive`，还要吃 120s 超时）。
- **补齐**：`POST /plugins/files/{id}/extract`，复用整合包同款 `archive.rs::extract_archive`（zip-slip 防护 + 条目/体积上限），双路径 FS 授权合并为一次用户确认。权限挂 `filesystem:write`。

### P1-4 目录列举 `listDir`

- **场景**：导入后检测哪个是服务端 jar；判断 eula.txt/server.properties 是否存在。
- **原状**：**没有任何"看目录"的 API** —— `readText` 只能读文件内容，连"这个目录里有什么"都做不到，全得开 shell。
- **补齐**：`POST /plugins/files/{id}/list` → `[{name, isDir, size, modifiedMs}]`（目录优先排序、maxEntries 默认 1000 上限 10000、递归可选、spawn_blocking）。权限挂 `filesystem:read`。

### P1-5 `getSystemInfo` 补 `dataDir`

- **场景**：确定服务器根目录默认值（`{数据目录}/Servers`）。
- **原状**：`SystemInfoResponse` 不含数据目录；插件对自己的"家"在哪里一无所知（隐藏端点 `/settings/data-dir` 存在但文档只字未提，属于能凑合但不能叫能力）。
- **补齐**：`models.rs` SystemInfoResponse 增 `data_dir` 字段，两个 sysinfo handler 填充。

### P2-6 系统通知 `sendNotification`

- **场景**：服务端后台崩溃/退出时通知用户（不一定停留在插件页）。
- **原状**：权限 `system:notification` 存在但**唯一对应方法是 `openUrl`**；应用内 toast 无法在用户不看插件页时触达。
- **补齐**：主窗口 WebView `new Notification()`（首次触发系统授权询问），失败/被拒返回 `false` 由插件降级 toast。零新增 Rust 依赖（不动 Cargo.toml）。

### P2-7 启动器退出事件 `onLauncherExit`

- **场景**：启动器退出前，插件做同步收尾（保存状态、提示用户其服务端的去留）。
- **原状**：无任何生命周期事件；启动器退出后插件拉起的进程直接变孤儿，插件无从知晓也无从清理。
- **补齐**：`useCloseGuard` 三个关窗收口点（closeWithGuard / onCloseRequested 放行 / unload）调用 `sandbox.ts#broadcastPluginLifecycle('launcher-exit')`，postMessage 广播到全部插件沙箱；桥侧 `__PLUGIN_API__.onLauncherExit(cb)` 注册。被动事件、免权限、尽力而为（不阻塞关窗）。

### 附：文档/工具链漂移修复

- `example-toolkit` 演示的 `httpRequest` / `executeCommand` 为过时方法名（真名 `proxyFetch` / `execCommand`，实际调用会 `Unsupported API method`）—— 本次未改示例（避免动他人目录），已写入 rules.md 第 16 条提示。
- skill 文档称 `addMenuItem` 无需权限，运行时实际要求 `ui:inject_sidebar`（`sandbox.ts:714`）—— 文档已对齐运行时。
- CLI `permissions.ts` METHOD_PERMISSIONS 表缺 `addMenuItem` / `openPluginSettings` / `registerHook` 三条 —— 已补齐（否则 verify 对这三个方法无法反推权限）。

## 二、仍缺（本次仅记录，建议排期）

> 补充实测观察（BattleArmory TACZ，约 60 mods + 355MB 包体）：自有镜像链（`modrinth.qomicex.dpdns.org`）在高峰期反复触发看门狗重试与镜像切换，表现为"速度异常/像单文件串行"——**不是管线串行**（64 worker 全并发提交，日志可见几十个 .part 并行），而是镜像站本身不稳定。**已按流量分工策略重构镜像层**（见 `services/file_mirror.rs` 模块头）：模组文件镜像链只保留 MCIM（大型公益镜像，为文件流量设计），自有 modrinth/CF 节点撤下（历史 URL 仍归一回官方）；**加载器 meta 与 installer 改走 QML-Mirror**（`mirror.shenv.top` 前缀路由，文档标注「暂不可用」的前缀不接入）+官方兜底——小文件边缘强缓存，模组文件留在官方 CDN，防止公益镜像被打爆。server 管线的 mods 下载同步改为分批（64/批）提交。遗留建议：健康探针从"全局布尔"细化为按 host 打分 + 失败熔断窗口。

| 优先级 | 缺口 | 说明与建议 |
|---|---|---|
| P1 | **通用后端 SSE 订阅通道** | `proxyFetchStream` 有 SSRF 防护拦内网、`callBackend` 是一次性请求 —— 插件收不到启动器自己的事件流（下载中心进度 `/progress/stream`、游戏日志 `/instance/{id}/logs/stream`）。本次进程日志用游标轮询绕开了，但"订阅启动器事件"作为一类通用能力仍缺失。建议：桥提供 `callBackendStream(endpoint, onChunk)`，走主窗口既有 `openStream`（QIPC 传输已支持流式）+ postMessage 转发（`proxyFetchStream` 的 chunk 转发协议可直接复用） |
| P1 | **rar / 7z 解压** | `archive.rs` 只支持 zip；服务端包也常见 rar/7z。建议引入 `sevenz-rust` / `unrar` crate，在 `extractArchive` 按扩展名分发 |
| P2 | **file-drop 事件直达插件** | 主窗口 `file-drop` 广播只有主界面收到，沙箱插件须经宿主代码 `callPlugin` 中转。建议：`buildPluginDoc` 桥脚本里加 `onFileDrop(cb)`，主窗口收到后按当前激活插件路由 |
| P2 | **剪贴板** | `clipboard:read/write` 权限存在、无方法（控制台日志复制都用不了）。建议主窗口 `navigator.clipboard` 中转 |
| P2 | **插件停用/禁用事件** | 只有退出事件；插件被用户停用时其拉起的进程同样会孤儿化（注册表还在，重启用 list 可见，但无清理钩子）。建议 `deactivatePlugin` 时广播 `plugin-deactivate` |
| P2 | **onLauncherExit 无法发异步请求** | 同步回调里不能 fetch —— "退出时顺手停服"做不到。若要支持，需要退出流程给插件一个有界的 async 窗口（如 2s），或提供"启动器退出时自动终止本插件进程"的 spawn 选项 |
| 安全 | **WASM 网关 invoke 未接权限门禁** | `src-tauri/src/plugin_gateway/server.rs` 自注释承认 invoke 未校验 manifest 权限；且插件权限门禁整体只在前端桥（后端信任前端），绕过前端直连后端 HTTP 即可越权（本机 5000 端口无鉴权）。建议后端按 plugin_id 校验权限（至少对 danger 权限类端点） |

## 三、正面清单（这次开发体验好的部分）

- **`callBackend` 通道**：`network:fetch` 一个权限直达全部后端 REST —— Java 的 list/recommended/custom/validate 端点覆盖完整，本插件的 Java 选择没有写一行探测代码。
- **FS 授权模型**：按前缀一次确认、持久化（`plugin-fs-auth.json`），服务器根目录授权一次后所有子路径放行，体验和安全平衡得好。
- **settings/cache**：插件私有键值 + TTL 缓存，白名单 UUID 查询结果缓存直接可用。
- **主题 token 体系**：iframe 自动注入 CSS 变量，插件零成本跟随明暗主题。
- **qomicex verify 的权限最小化扫描**：真实有效（本次它先后抓出 13 个"声明未用"和 1 个"用而未声明"，全部是实打实的问题）。扫描按 `.call('方法名')` 文本匹配 —— **插件作者写桥封装时请保持 `getApi()?.call('<名字>', ...)` 字面形式**，否则扫描失效（已写入 README）。
- **隐藏的好端点**：`/settings/open-folder`（打开本地目录，相对路径自动补数据目录根）—— 文档没提但很实用，本次用于"打开服务器目录"。（教训：最初臆造成 `/system/open-folder` 被 404 打脸——callBackend 无端点清单，路由以 `endpoints/*.rs` 的 router() 为准。）

## 四、改动清单（启动器仓库，未提交）

| 文件 | 改动 |
|---|---|
| `src-backend/.../services/plugin_process.rs` | 新增：常驻进程服务（~330 行） |
| `src-backend/.../services/mod.rs` | +1 行模块声明 |
| `src-backend/.../state.rs` | +字段/初始化 `plugin_processes` |
| `src-backend/.../endpoints/plugin.rs` | +8 路由 + 处理器 + DTO（process 6 个 / files extract+list） |
| `src-backend/.../models.rs` / `endpoints/system.rs` | SystemInfoResponse + `dataDir` |
| `src/plugins/plugin-api.ts` | 桥类型与实现：process.* / pickFile / pickDirectory / extractArchive / listDir / sendNotification |
| `src/plugins/sandbox.ts` | METHOD_PERMISSIONS + 方法分发 + 生命周期广播 + iframe 桥脚本 onLauncherExit |
| `src/hooks/useCloseGuard.ts` | 三个关窗收口点广播 launcher-exit |
| `packages/plugin-ui/src/plugins.ts` | PERMISSION_CATALOG + `process:manage`(danger) + `dialog:open`(normal) |
| `qomicex-tauri-i18n/src/*/plugins.ts` ×7 | 两个权限名的 7 语言文案 |
| `packages/qomicex-cli/src/lib/permissions.ts` | 目录 + METHOD_PERMISSIONS 对齐（补 3 个漂移条目 + 10 个新方法） |
| `packages/qomicex-cli/skills/qomicex-plugin/{plugin-api,permissions,rules}.md` | 新 API 文档 + 漂移修复 |
| `src-backend/.../services/plugin_signature.rs` | `effective_root_public_key()`：debug 构建允许 `QOMICEX_DEV_ROOT_PUBLIC_KEY` 覆盖商店根钥（release 不受影响），本地开发签名走完整 ADR-050 链 |
| `packages/qomicex-cli/src/commands/verify.ts` | verify 同样支持 dev 根钥覆盖 |
| `src-backend/.../services/server_setup.rs` + `endpoints/server_setup.rs` | 服务端搭建管线（vanilla/fabric/forge/neo + client-only 过滤 + launch.json） |
| `src/plugins/install-modes.ts` + `types.ts` + `ModpackInstallDialog`/`ModpackQuickInstallDialog` + i18n | `contributes.installModes` 扩展点 |

验证：`cargo check --locked -p qomicex-backend` ✅（隔离 target 目录）、启动器前端 `tsc --noEmit` ✅、CLI `tsc` ✅。
