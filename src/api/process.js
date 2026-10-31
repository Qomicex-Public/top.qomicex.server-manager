// 常驻进程管理（process.* 原语的封装 + 日志游标轮询）。
import { getApi } from './bridge.js'
import { readLaunchManifest, buildLaunchArgs } from './setup.js'

export async function spawn(opts) {
  return getApi().call('process.spawn', opts)
}

export async function stdin(pid, text, appendNewline = true) {
  return getApi().call('process.stdin', pid, text, { appendNewline })
}

export async function kill(pid) {
  return getApi().call('process.kill', pid)
}

export async function alive(pid) {
  return getApi().call('process.alive', pid)
}

export async function listProcesses() {
  return getApi().call('process.list')
}

/** 组装服务端启动参数。jar 使用相对名（cwd = 服务器目录）。 */
export function buildSpawnArgs(server) {
  const jvm = []
  if (server.xmsMb) jvm.push(`-Xms${server.xmsMb}M`)
  if (server.xmxMb) jvm.push(`-Xmx${server.xmxMb}M`)
  jvm.push('-Dfile.encoding=UTF-8')
  if (server.jvmArgs) {
    jvm.push(...String(server.jvmArgs).split(/\s+/).filter(Boolean))
  }
  const tail = ['-jar', server.jar]
  const args = String(server.serverArgs || 'nogui').split(/\s+/).filter(Boolean)
  return [...jvm, ...tail, ...args]
}

/** 启动服务端：优先按 .qml-server/launch.json（整合包搭建产物）组装参数，否则手填 jar。 */
export async function spawnServer(server, javaPath) {
  const launch = await readLaunchManifest(server.dir).catch(() => null)
  const args = launch
    ? buildLaunchArgs(launch, server)
    : buildSpawnArgs(server)
  return spawn({ command: javaPath, args, cwd: server.dir })
}

/**
 * 游标式日志轮询 → 事件回调（模拟流式）。
 * 返回 { stop() }；onExit(exitCode) 在进程退出或句柄被回收时触发一次。
 */
export function watchLogs(pid, { onLines, onExit, intervalMs = 800 }) {
  let seq = 0
  let stopped = false
  let timer = null
  let busy = false

  const poll = async () => {
    if (stopped || busy) return
    busy = true
    try {
      const r = await getApi().call('process.logs', pid, seq)
      if (stopped) return
      seq = r.nextSeq
      if (r.lines && r.lines.length && onLines) onLines(r.lines)
      if (!r.alive) {
        stopped = true
        clearInterval(timer)
        if (onExit) onExit(r.exitCode)
      }
    } catch {
      stopped = true
      clearInterval(timer)
      if (onExit) onExit(null)
    } finally {
      busy = false
    }
  }

  void poll()
  timer = setInterval(poll, intervalMs)
  return {
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
    },
  }
}
