// 插件状态持久化（settings.json via getSettings/setSettings）。
import { getSettings, setSettings, getSystemInfo } from './bridge.js'

export async function loadState() {
  const s = (await getSettings().catch(() => null)) || {}
  return {
    servers: Array.isArray(s.servers) ? s.servers : [],
    serversRoot: typeof s.serversRoot === 'string' && s.serversRoot ? s.serversRoot : null,
  }
}

export async function saveServers(servers) {
  await setSettings('servers', servers)
}

export async function saveRoot(root) {
  await setSettings('serversRoot', root)
}

/** 解析服务器根目录：已设置优先；否则默认 {启动器数据目录}/Servers。 */
export async function resolveRoot(current) {
  if (current) return current
  try {
    const info = await getSystemInfo()
    if (info && info.dataDir) {
      const dir = String(info.dataDir).replace(/[\\/]+$/, '')
      if (dir) {
        const sep = dir.includes('\\') ? '\\' : '/'
        return dir + sep + 'Servers'
      }
    }
  } catch { /* 浏览器 dev 环境 */ }
  return null
}

export function joinPath(base, name) {
  const sep = base.includes('\\') && (!base.includes('/') || base.lastIndexOf('\\') > base.lastIndexOf('/')) ? '\\' : '/'
  return base.replace(/[\\/]+$/, '') + sep + name
}

export function newServer(partial = {}) {
  return {
    id: 'srv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    name: '',
    dir: '',
    jar: '',
    mcVersion: '',
    javaPath: null,
    xmxMb: 2048,
    xmsMb: 1024,
    jvmArgs: '',
    serverArgs: 'nogui',
    lastPid: null,
    createdAt: Date.now(),
    ...partial,
  }
}
