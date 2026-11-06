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
 * 在目录里检测服务端 jar。返回 { jar, candidates, hasProperties, hasEula, start }。
 * 启发式：名字含 server > 含 paper/fabric/forge/neoforge/purpur/folia/craft > 体积最大。
 * start：整合包自带启动脚本（startserver*.sh / run.bat）解析出的参数，优先于 jar 启发式。
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
  const start = await readStartScript(dir, entries)
  return {
    jar: start?.jar || (sorted.length ? sorted[0].name : null),
    jarPath: sorted.length ? sorted[0].path : null,
    candidates: sorted.map(j => ({ name: j.name, path: j.path, size: j.size })),
    hasProperties: entries.some(e => !e.isDir && /^server\.properties$/i.test(e.name)),
    hasEula: entries.some(e => !e.isDir && /^eula\.txt$/i.test(e.name)),
    topDirs: entries.filter(e => e.isDir).map(e => e.name),
    start,
  }
}

/** 整合包自带启动脚本的候选名（根目录）。run.* 是 Forge 系，startserver* 是 GTNH 系。 */
const START_SCRIPT_RE = /^(?:run|start|startserver[^/\\]*|start[-_][^/\\]*)\.(?:sh|bat|cmd)$/i

/** 读根目录启动脚本并解析出启动参数；没有可用脚本返回 null。 */
async function readStartScript(dir, entries) {
  const rootNorm = normPath(dir)
  const names = entries
    .filter(e => !e.isDir && START_SCRIPT_RE.test(e.name))
    .map(e => ({ name: e.name, parent: e.path ? normPath(String(e.path).replace(/[\\/][^\\/]*$/, '')) : rootNorm }))
    // 只取根目录的脚本：recursive 模式下列表会混入子目录里的同名文件
    .filter(e => e.parent === rootNorm)
    .map(e => e.name)
    .sort((a, b) => Number(/\.(bat|cmd)$/i.test(b)) - Number(/\.(bat|cmd)$/i.test(a)))
  for (const name of names) {
    const text = await readText(joinPath(dir, name)).then(r => r?.content).catch(() => null)
    const start = parseStartScript(text)
    if (start) return { ...start, script: name }
  }
  return null
}

const normPath = p => String(p).replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()

/** 简易 shell 分词：按空白切分，支持单/双引号。 */
function tokenize(line) {
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** `-Xmx6G` / `-Xms2048m` → MB；无法识别返回 null。 */
function memToMb(flag, token) {
  const m = new RegExp(`^${flag}(\\d+)([kKmMgG]?)$`).exec(token)
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  if (unit === 'g') return n * 1024
  if (unit === 'k') return Math.max(1, Math.round(n / 1024))
  return Math.round(n)
}

/**
 * 解析启动脚本里的 java 命令行（issue #1：GTNH 等整合包自带 startserver*.sh）。
 * 返回 { jar, xmsMb, xmxMb, jvmArgs, serverArgs } 或 null。
 * 只认 `java ... -jar x.jar ...` 单行形式；Forge 的 `@args.txt` 脚本不识别
 * （那不是 -jar，交给 jar 启发式，避免把 @argfile 塞进 jvmArgs 反而启动失败）。
 */
export function parseStartScript(text) {
  if (!text) return null
  const line = String(text).split(/\r?\n/)
    .map(l => l.trim())
    // 跳过注释：sh 的 #，bat 的 rem / ::
    .filter(l => l && !l.startsWith('#') && !/^(?:rem\b|::)/i.test(l))
    .find(l => /(?:^|[\s;&|(])java(?:\.exe)?\s/i.test(l))
  if (!line) return null
  const tokens = tokenize(line)
  const javaAt = tokens.findIndex(t => /(?:^|[\\/])java(?:\.exe)?$/i.test(t))
  if (javaAt < 0) return null
  const rest = tokens.slice(javaAt + 1)
  const jarAt = rest.indexOf('-jar')
  if (jarAt < 0 || !rest[jarAt + 1]) return null

  let xmsMb = null
  let xmxMb = null
  const jvm = []
  for (const t of rest.slice(0, jarAt)) {
    const xms = memToMb('-Xms', t)
    const xmx = memToMb('-Xmx', t)
    if (xms != null) { xmsMb = xms; continue }
    if (xmx != null) { xmxMb = xmx; continue }
    // 跳过 "$@" / %* 这类参数透传占位
    if (/^\$[@*]$/.test(t) || /^%(\*|[1-9])$/.test(t)) continue
    if (/^-/.test(t)) jvm.push(t)
  }
  const serverArgs = rest.slice(jarAt + 2)
    .filter(t => !/^\$[@*]$/.test(t) && !/^%(\*|[1-9])$/.test(t))
  return {
    jar: rest[jarAt + 1],
    xmsMb,
    xmxMb,
    jvmArgs: jvm.join(' '),
    serverArgs: serverArgs.join(' '),
  }
}

/** 把脚本解析结果转成服务器条目的字段补丁（空值不覆盖用户已有设置）。 */
export function startPatch(start) {
  if (!start) return {}
  const p = {}
  if (start.jar) p.jar = start.jar
  if (start.xmsMb) p.xmsMb = start.xmsMb
  if (start.xmxMb) p.xmxMb = start.xmxMb
  if (start.jvmArgs) p.jvmArgs = start.jvmArgs
  if (start.serverArgs) p.serverArgs = start.serverArgs
  return p
}

/** 从目录名/文件名猜测 MC 版本（形如 1.20.4 / 1.21）。 */
export function guessMcVersion(text) {
  const m = /\b(1\.\d+(?:\.\d+)?)(?:\b|$)/.exec(String(text || ''))
  return m ? m[1] : ''
}
