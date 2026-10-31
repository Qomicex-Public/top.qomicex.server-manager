// 服务器目录探测：EULA、server.properties、jar 检测（listDir，无 shell）。
import { readText, listDir } from './bridge.js'

function joinPath(base, rel) {
  const sep = base.includes('\\') && (!base.includes('/') || base.lastIndexOf('\\') > base.lastIndexOf('/')) ? '\\' : '/'
  return base.replace(/[\\/]+$/, '') + sep + rel.replace(/^[\\/]+/, '')
}

export function serverFilePath(server, file) {
  return joinPath(server.dir, file)
}

/** EULA 状态：'missing' | 'accepted' | 'rejected' */
export async function readEulaState(server) {
  try {
    const { content } = await readText(serverFilePath(server, 'eula.txt'))
    const m = /eula\s*=\s*(\w+)/i.exec(String(content || ''))
    if (!m) return 'missing'
    return m[1].toLowerCase() === 'true' ? 'accepted' : 'rejected'
  } catch {
    return 'missing'
  }
}

/**
 * 在目录里检测服务端 jar。返回 { jar, candidates, hasProperties, hasEula }。
 * 启发式：名字含 server > 含 paper/fabric/forge/neoforge/purpur/folia/craft > 体积最大。
 */
export async function detectServer(dir, { recursive = true } = {}) {
  const entries = await listDir(dir, { recursive, maxEntries: 3000 }).catch(() => [])
  const jars = entries.filter(e => !e.isDir && /\.jar$/i.test(e.name))
  const score = j => {
    const n = j.name.toLowerCase()
    if (n.includes('server')) return 100
    for (const kw of ['paper', 'fabric', 'forge', 'neoforge', 'purpur', 'folia', 'velocity', 'craft']) {
      if (n.includes(kw)) return 60
    }
    return j.size
  }
  const sorted = [...jars].sort((a, b) => score(b) - score(a))
  return {
    jar: sorted.length ? sorted[0].name : null,
    jarPath: sorted.length ? sorted[0].path : null,
    candidates: sorted.map(j => ({ name: j.name, path: j.path, size: j.size })),
    hasProperties: entries.some(e => !e.isDir && /^server\.properties$/i.test(e.name)),
    hasEula: entries.some(e => !e.isDir && /^eula\.txt$/i.test(e.name)),
    topDirs: entries.filter(e => e.isDir).map(e => e.name),
  }
}

/** 从目录名/文件名猜测 MC 版本（形如 1.20.4 / 1.21）。 */
export function guessMcVersion(text) {
  const m = /\b(1\.\d+(?:\.\d+)?)(?:\b|$)/.exec(String(text || ''))
  return m ? m[1] : ''
}
