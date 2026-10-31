// __PLUGIN_API__ 桥封装：本插件所有启动器能力的唯一入口。
// 浏览器直开（vite dev）时 __PLUGIN_API__ 为 null —— 调用抛出可识别错误，UI 层降级提示。
//
// 注意：每个方法都以 `getApi()?.call('<方法名>', ...)` 字面形式书写 ——
// qomicex verify 的权限最小化扫描按 `.call('x')` 文本识别用到的桥方法。

export const FALLBACK_PLUGIN_ID = 'top.qomicex.server-manager'

export function getApi() {
  return (typeof window !== 'undefined' && window.__PLUGIN_API__) || null
}

export function getPluginId() {
  return (typeof window !== 'undefined' && window.__PLUGIN_ID__) || FALLBACK_PLUGIN_ID
}

export async function call(method, ...args) {
  const api = getApi()
  if (!api) throw new Error('PLUGIN_API_UNAVAILABLE')
  return api.call(method, ...args)
}

export function apiAvailable() {
  return !!getApi()
}

const unavailable = () => new Error('PLUGIN_API_UNAVAILABLE')
const need = () => { const api = getApi(); if (!api) throw unavailable(); return api }

// ---- 常用方法的薄封装 ----

export const showToast = (message, type = 'info') => need().call('showToast', message, type)
export const openUrl = (url) => need().call('openUrl', url)
export const log = (message, level = 'info') => { try { need().call('log', `[server-manager] ${message}`, level) } catch { /* dev 环境静默 */ } }
export const getSettings = () => need().call('getSettings')
export const setSettings = (key, value) => need().call('setSettings', key, value)
export const getCache = (key) => need().call('getCache', key)
export const setCache = (key, value, ttlSeconds) => need().call('setCache', key, value, ttlSeconds)
export const callBackend = (endpoint, data) => need().call('callBackend', endpoint, data)
export const readText = (path, options) => need().call('readText', path, options)
export const writeText = (path, content) => need().call('writeText', path, content)
export const listDir = (path, options) => need().call('listDir', path, options)
export const extractArchive = (archivePath, destPath, options) => need().call('extractArchive', archivePath, destPath, options)
export const renamePath = (from, to) => need().call('renamePath', from, to)
export const readArchiveEntry = (archivePath, entryPath, options) => need().call('readArchiveEntry', archivePath, entryPath, options)
export const deleteFile = (path) => need().call('deleteFile', path)
export const writeBytes = (path, bytes) => need().call('writeBytes', path, bytes)
export const taskRegister = (options) => need().call('task.register', options)
export const taskUpdate = (taskId, patch) => need().call('task.update', taskId, patch)
export const taskComplete = (taskId, error) => need().call('task.complete', taskId, error)
export const taskProgress = (taskId) => need().call('task.progress', taskId)
export const downloadAddBatch = (options) => need().call('download.addBatch', options)
export const downloadBatchStatus = (batchId) => need().call('download.batchStatus', batchId)
export const curseforgeFiles = (files) => need().call('curseforge.files', files)
export const pickFile = (options) => need().call('pickFile', options)
export const pickDirectory = (options) => need().call('pickDirectory', options)
export const sendNotification = (options) => need().call('sendNotification', options)
export const downloadAddTask = (options) => need().call('download.addTask', options)
export const downloadProgress = (taskId) => need().call('download.progress', taskId)
export const proxyFetch = (req) => need().call('proxyFetch', req)
export const getSystemInfo = () => need().call('getSystemInfo')
export const getPluginStrings = () => need().call('getPluginStrings')
export const getLocale = () => need().call('getLocale')
export const getIconSvg = (cls) => need().call('getIconSvg', cls)

/** 启动器退出前回调（尽力而为、同步）。 */
export function onLauncherExit(cb) {
  const api = getApi()
  if (api && typeof api.onLauncherExit === 'function') api.onLauncherExit(cb)
}
