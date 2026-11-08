// 服务端目录清理。
//
// 用启动器的 `deleteDir` 桥方法（POST /plugins/files/{id}/delete-dir）一次递归
// 删掉目录与内容。早期版本后端只有单文件 deleteFile，插件只能「递归删文件 +
// 把空壳目录改名挪开」，会在磁盘上留下无法清理的 .qsm-deleted-* 垃圾目录；
// 现在两端都走真删除。
import { listDir, deleteDir } from './bridge.js'
import { t } from '../i18n.js'

/** 单次 listDir 的条目上限（后端 clamp 到 1..10000）。 */
const LIST_CAP = 10000

function splitPath(p) {
  const trimmed = String(p || '').replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (idx <= 0) return null
  return { parent: trimmed.slice(0, idx), name: trimmed.slice(idx + 1) }
}

/**
 * 删除前的安全检查：拒绝空路径、盘符根、文件系统根、以及层级过浅的目录。
 *
 * 后端已经拒绝「没有父目录」的根，但业务层还要拦「层级过浅」——`D:\Servers`
 * 这种多半是存放多个服务端的容器，误配时删掉会连带别人的存档。前端先拦一次，
 * 用户能得到可读的提示，而不是一个泛化的后端错误。
 * @returns {string|null} 拒绝原因；null 表示可以删
 */
export function checkDeletable(dir) {
  const raw = String(dir || '').trim()
  if (!raw) return t('delete.refuseNoDir')
  const normalized = raw.replace(/[\\/]+$/, '')
  if (/^[a-zA-Z]:$/.test(normalized) || normalized === '' || normalized === '/') {
    return t('delete.refuseRoot')
  }
  const depth = /^[a-zA-Z]:[\\/]/.test(normalized)
    ? normalized.slice(3).split(/[\\/]+/).filter(Boolean).length
    : normalized.split(/[\\/]+/).filter(Boolean).length
  if (depth < 2) return t('delete.refuseShallow')
  return null
}

/**
 * 统计一个目录有多少文件、多大（删除前的确认信息用）。
 * 只读，失败按 0 处理——确认弹窗不该因为统计失败而打不开。
 */
export async function measureDirectory(dir) {
  try {
    const entries = await listDir(dir, { recursive: true, maxEntries: LIST_CAP })
    const files = entries.filter(e => !e.isDir)
    return {
      files: files.length,
      bytes: files.reduce((sum, e) => sum + (e.size || 0), 0),
      truncated: entries.length >= LIST_CAP,
    }
  } catch {
    return { files: 0, bytes: 0, truncated: false }
  }
}

/**
 * 递归删除服务端目录（内容 + 目录本身）。
 *
 * @param {string} dir 服务端目录
 * @returns {Promise<{removed: number, refused?: string, error?: string}>}
 */
export async function deleteServerFiles(dir) {
  const refused = checkDeletable(dir)
  if (refused) return { removed: 0, refused }

  try {
    const { removed } = await deleteDir(dir, { recursive: true })
    return { removed: removed || 0 }
  } catch (e) {
    // 授权被拒 / 目录不存在 / 文件占用都会到这里，原样上报让用户能看到原因
    return { removed: 0, error: e.message }
  }
}

/** 给人看的路径大小（1.2 GB）。 */
export function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** 删除结果的统一文案。 */
export function describeDeleteResult(result) {
  const { removed, refused, error } = result
  if (refused) return refused
  if (error) return t('delete.failed', { msg: error })
  return t('delete.done', { n: removed })
}
