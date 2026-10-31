# 插件生态设计参考：成熟生态的机制对照与 Qomicex 落地方案

> 调研对象：VS Code、Chrome (WebExtensions)、JetBrains IntelliJ 三个成熟插件生态。
> 动机：开发 server-manager 插件过程中发现若干"补丁式"能力（步骤文案裸 key、manifest 文案硬编码、无头插件常驻挂载），本文对照成熟设计给出根解，并标注落地状态。

## 一、三大生态的核心机制

### 1. 插件文案：插件自持 i18n，宿主提供解析通道

三个生态**无一例外**：插件显示字符串由插件自带的 locale 包提供，宿主只在渲染时解析——插件永远不需要（也不能）修改宿主的 i18n。

| 生态 | 包结构 | manifest 引用语法 | 运行时 API |
|---|---|---|---|
| VS Code | `l10n/bundle.l10n.json`（默认）+ `bundle.l10n.<locale>.json`；manifest 声明 `"l10n": "./l10n"` | `%key%`（contributes 里 commands 的 title/category 等宿主渲染的字符串） | `vscode.l10n.t("Hello {name}", ...)` |
| Chrome | `_locales/<locale>/messages.json`；manifest 声明 `"default_locale"` | `__MSG_key__`（manifest 的 name/description 等） | `chrome.i18n.getMessage("key")` |
| JetBrains | `<resource-bundle>messages.MyBundle</resource-bundle>`（plugin.xml 声明）；`.properties` 按语言后缀 | `%key`（扩展点属性如 displayName） | `DynamicBundle.getMessage()` |

**共同点**：宿主在**加载/渲染时**解析引用；locale 包缺失的 key 回退默认语言包；再缺失回退引用原文（可诊断）；运行时 API 让插件自己的 UI 也用同一份包。

### 2. 声明式扩展点 + 惰性激活（VS Code）

- `contributes`（commands/views/menus/walkthroughs…）全部**静态声明**在 manifest——宿主注册 UI、渲染菜单**不需要运行插件代码**；
- `activationEvents`（`onCommand:`/`onView:`…）声明何时激活插件；1.74+ 起 `contributes.commands` 自动隐式激活——**用户触发才加载**，声明式入口的显示与插件运行状态解耦；
- 启示：宿主渲染的每一样东西都应是数据（manifest），不是插件运行时行为。

### 3. 进度上报：宿主提供通道，报告者自带文案

- VS Code `window.withProgress({ location, title, cancellable }, task => progress.report({ message, increment }))`——**title/message 由插件传入**（插件已用自己的 l10n 本地化），宿主只负责在 Notification/状态栏/视图渲染；`ProgressLocation` 决定呈现位置（通知/窗口/侧栏视图）；
- JetBrains `Task.Backgroundable` + `ProgressIndicator` 同构；
- 启示：进度系统的"文案归属"与"视图"分离——下载中心只是视图，title/步骤名的归属者是发起者（内置管线→启动器 i18n；插件→插件 l10n）。

## 二、Qomicex 现状 → 正解对照

| 问题（现状） | 成熟生态做法 | Qomicx 落地 |
|---|---|---|
| 步骤文案 `downloads.steps.{id}` 命名空间被启动器 i18n 独占，插件管线步骤只能裸 key | 进度 title/message 由报告者传入 | ✅ `InstallStep.label` + 渲染优先级（label > 词条 > id）；内置管线补 i18n 词条，插件管线传 label |
| manifest 文案硬编码（`label: '安装为服务端'`），换语言不变 | `%key%` / `__MSG_key__` + 插件 locale 包 | ✅ **本轮落地**：manifest `"l10n"` 目录 + `%key%` 解析（加载时按启动器 locale，回退默认包→原文） |
| 插件运行时 UI 无本地化通道 | `vscode.l10n.t` / `chrome.i18n.getMessage` | ✅ **本轮落地**：桥 `call('getPluginStrings')` 返回合并包 + `call('getLocale')`；免权限（自持有数据） |
| 无头功能（installModes 方法）要求插件常驻挂载（我打的 hidden-mount 补丁） | activationEvents 声明式入口 + 按需激活 | ⚠️ 已按"声明了 installModes/hooks → 常驻隐藏挂载"策略落地；正解是激活事件机制（见"建议排期"） |
| 插件长任务只能轮询 + toast | `withProgress` 通道 | ⚠️ 未做（见"建议排期"） |

## 三、本轮落地的机制（代码位置）

- `src/plugins/l10n.ts`（新增）：`getPluginBundle`（bundle.json 打底 + `bundle.<locale>.json` 覆盖，按插件+locale 缓存）、`resolveTemplate`（`%key%`）、`resolveManifestL10n`（深解析 manifest 显示字符串）
- `src/stores/pluginStore.ts`：loadPlugins 后异步解析声明了 `l10n` 的清单并回写 store——侧栏/设置页/安装对话框拿到的即最终文案
- 桥：`getPluginStrings` / `getLocale`（免权限，`METHOD_PERMISSIONS` 空权限串）
- manifest 类型：`l10n?: string`（types.ts + plugin-ui 同步）
- 示范插件：server-manager 的 `l10n/bundle.json`（en 默认）+ `l10n/bundle.zh-CN.json`，manifest 用 `%plugin.name%` / `%installMode.toServer.label%` 等；pack 脚本把 `l10n/` 打进包

**约定**：默认包（`bundle.json`）建议用英文；面向中文用户可反向（默认中文 + 其他语言包），但默认包必须存在。key 命名建议 `<域>.<名称>`（如 `installMode.toServer.label`）。

## 四、建议排期（未落地的正解）

1. **激活事件**：`activationEvents: ["onStartupFinished" | "onCommand:<id>" | "onInstallMode" | ...]`。当前"全部启用插件启动即激活"在插件数量小时可接受；常驻隐藏挂载策略是无激活事件时的正确近似。引入激活事件时，`installModes`/`hooks` 声明应映射为隐式激活事件（对齐 VS Code 1.74 的 contributes.commands 自动激活）。
2. **插件进度通道**：桥 `progress.withProgress({ title, steps?[], cancellable? }, fn)`——title/step label 由插件传入（先经 getPluginStrings 本地化），任务进下载中心（复用 InstallTracker + 本轮的自动补卡 + title）。消除"插件长任务只能自己轮询"的最后一块债。
3. **l10n 工具链**：CLI `qomicex l10n` 扫描源码 `t('key')` 生成 bundle（对齐 `@vscode/l10n-dev`），verify 检查 `%key%` 引用都有词条。

## 参考来源

- [VS Code Extension Manifest / l10n API](https://code.visualstudio.com/api/references/extension-manifest) · [Localization guide（Elio Struyf）](https://www.eliostruyf.com/localization-visual-studio-code-extensions) · [@vscode/l10n-dev](https://github.com/microsoft/vscode-l10n/blob/main/l10n-dev/README.md) · [l10n API 设计讨论](https://github.com/microsoft/vscode-discussions/discussions/159)
- [Chrome i18n（_locales/messages.json/__MSG_key__）](https://developer.chrome.com/docs/extensions/mv2/reference/i18n) · [Chromium i18n 设计文档](https://www.chromium.org/developers/design-documents/extensions/how-the-extension-system-works/i18n) · [MDN WebExtensions i18n](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization)
- [JetBrains Internationalization（resource-bundle / %key）](https://plugins.jetbrains.com/docs/intellij/internationalization.html)
- [VS Code Activation Events](https://code.visualstudio.com/api/references/activation-events) · [Extension Anatomy（contributes）](https://code.visualstudio.com/api/get-started/extension-anatomy)
- [VS Code Progress API（withProgress）](https://code.visualstudio.com/api/extension-capabilities/common-capabilities) · [Progress 示例](https://github.com/microsoft/vscode-extension-samples/blob/main/progress-sample/README.md)
