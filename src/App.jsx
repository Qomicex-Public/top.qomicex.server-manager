import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, useMessageBox } from '@qomicex/plugin-ui'
import { apiAvailable, showToast, log, onLauncherExit, callBackend, sendNotification, writeText, getSettings, taskProgress } from './api/bridge.js'
import { registerInstallModeHandler, finalizeSetupEntry, markSetupFailed } from './api/installMode.js'
import { t, useT } from './i18n.js'
import FaIcon from './components/FaIcon.jsx'
import { loadState, saveServers, saveRoot, resolveRoot } from './api/state.js'
import { deleteServerFiles, describeDeleteResult } from './api/cleanup.js'
import { spawnServer, watchLogs, stdin, kill as killProcess, alive as aliveProcess } from './api/process.js'
import { resolveJava } from './api/java.js'
import { readEulaState, serverFilePath } from './api/server.js'
import ServerList from './components/ServerList.jsx'
import ServerDetail from './components/ServerDetail.jsx'
import ImportDialog from './components/ImportDialog.jsx'
import EulaGate from './components/EulaGate.jsx'
import RemoveServerDialog from './components/RemoveServerDialog.jsx'

const MAX_LOG_LINES = 4000

export default function App() {
  useT() // 语言切换时整树重渲染（t 的词条来自 getPluginStrings）
  const { confirm } = useMessageBox()
  const [ready, setReady] = useState(false)
  const [servers, setServers] = useState([])
  const [root, setRoot] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [eulaPending, setEulaPending] = useState(null) // { server, javaPath }
  const [removePending, setRemovePending] = useState(null) // server 对象
  // 各标签页是否有未保存修改：serverId -> Set<tabId>。用于切页/切服/移除前拦截，
  // 避免用户改完配置直接切走，以为已生效（后端文件其实没动）。
  const [dirtyTabs, setDirtyTabs] = useState({})
  // serverId -> { pid, status: 'starting'|'running'|'stopping'|'stopped', startedAtMs, exitCode }
  const [runtime, setRuntime] = useState({})
  const [logs, setLogs] = useState({}) // serverId -> [{ seq, stream, text }]
  const watchersRef = useRef({}) // serverId -> { stop }
  const runtimeRef = useRef({})
  runtimeRef.current = runtime

  const updateRuntime = useCallback((serverId, patch) => {
    setRuntime(prev => {
      const cur = prev[serverId] || {}
      const next = { ...cur, ...patch }
      runtimeRef.current = { ...prev, [serverId]: next }
      return runtimeRef.current
    })
  }, [])

  const appendLines = useCallback((serverId, lines) => {
    setLogs(prev => {
      const cur = prev[serverId] || []
      const next = [...cur, ...lines]
      return { ...prev, [serverId]: next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next }
    })
  }, [])

  const persistServers = useCallback(async (next) => {
    setServers(next)
    await saveServers(next).catch(e => log(`保存设置失败: ${e.message}`, 'warn'))
  }, [])

  // ---------- 启动 / 停止 ----------

  const beginWatch = useCallback((server, pid) => {
    if (watchersRef.current[server.id]) watchersRef.current[server.id].stop()
    updateRuntime(server.id, { pid, status: 'running', startedAtMs: Date.now(), exitCode: null })
    watchersRef.current[server.id] = watchLogs(pid, {
      onLines: lines => appendLines(server.id, lines),
      onExit: code => {
        updateRuntime(server.id, { status: 'stopped', exitCode: code })
        // 通知（尽力而为）：优先系统通知，不可用降级 toast
        void sendNotification({ title: t('toast.stopped', { name: server.name }), body: code === 0 || code === null ? '' : `exit ${code}` })
          .catch(() => false)
          .then(ok => { if (!ok) showToast(t('toast.stopped', { name: server.name, code: code ? `（exit ${code}）` : '' }), 'info') })
      },
    })
  }, [appendLines, updateRuntime])

  const startServer = useCallback(async (server) => {
    const rt = runtimeRef.current[server.id]
    if (rt && rt.status === 'running') return
    // 1. EULA 检查（issue #295：提示 EULA 协议 + 倒计时确认）
    const eula = await readEulaState(server)
    // 2. Java 解析前置（弹 EULA 时顺带校验，省一次往返）
    const javaPath = await resolveJava(server)
    if (!javaPath) {
      showToast(t('toast.noJava'), 'error')
      return
    }
    if (eula !== 'accepted') {
      setEulaPending({ server, javaPath })
      return
    }
    updateRuntime(server.id, { status: 'starting' })
    try {
      const { pid } = await spawnServer(server, javaPath)
      appendLines(server.id, [{ seq: 0, stream: 'out', text: t('log.started', { pid, java: javaPath }) }])
      beginWatch(server, pid)
      // 记住 pid（插件页重载/启动器重启后找回）
      const idx = servers.findIndex(s => s.id === server.id)
      if (idx >= 0 && servers[idx].lastPid !== pid) {
        const next = [...servers]
        next[idx] = { ...next[idx], lastPid: pid }
        void persistServers(next)
      }
      log(`服务端 ${server.name} 已启动 pid=${pid}`)
    } catch (e) {
      updateRuntime(server.id, { status: 'stopped' })
      showToast(t('toast.startFailed', { msg: e.message }), 'error')
    }
  }, [appendLines, beginWatch, persistServers, servers, updateRuntime])

  const confirmEulaAndStart = useCallback(async () => {
    const pending = eulaPending
    if (!pending) return
    setEulaPending(null)
    try {
      await writeText(serverFilePath(pending.server, 'eula.txt'), 'eula=true\n')
      const { pid } = await spawnServer(pending.server, pending.javaPath)
      appendLines(pending.server.id, [{ seq: 0, stream: 'out', text: t('log.eulaStarted', { pid }) }])
      beginWatch(pending.server, pid)
    } catch (e) {
      updateRuntime(pending.server.id, { status: 'stopped' })
      showToast(t('toast.startFailed', { msg: e.message }), 'error')
    }
  }, [appendLines, beginWatch, eulaPending, updateRuntime])

  /** 优雅停止：先发 stop 命令，超时后强杀。 */
  const stopServer = useCallback(async (server, { force = false } = {}) => {
    const rt = runtimeRef.current[server.id]
    const pid = rt && rt.pid
    if (!pid) return
    updateRuntime(server.id, { status: 'stopping' })
    try {
      if (force) {
        await killProcess(pid)
        return
      }
      await stdin(pid, 'stop')
      appendLines(server.id, [{ seq: 0, stream: 'out', text: t('log.stopSent') }])
      // 等待优雅退出，30s 后强杀
      const deadline = Date.now() + 30000
      const poll = setInterval(async () => {
        try {
          const snap = await aliveProcess(pid)
          if (!snap.alive || Date.now() > deadline) {
            clearInterval(poll)
            if (snap.alive) {
              appendLines(server.id, [{ seq: 0, stream: 'err', text: t('log.stopTimeout') }])
              await killProcess(pid).catch(() => {})
            }
          }
        } catch {
          clearInterval(poll)
        }
      }, 2000)
    } catch (e) {
      showToast(t('toast.stopFailed', { msg: e.message }), 'error')
      updateRuntime(server.id, { status: 'running' })
    }
  }, [appendLines, updateRuntime])

  const sendCommand = useCallback(async (server, text) => {
    const rt = runtimeRef.current[server.id]
    if (!rt || !rt.pid) return
    try {
      await stdin(rt.pid, text)
      appendLines(server.id, [{ seq: 0, stream: 'out', text: t('log.cmdEcho', { cmd: text }) }])
    } catch (e) {
      appendLines(server.id, [{ seq: 0, stream: 'err', text: t('log.cmdFailed', { msg: e.message }) }])
    }
  }, [appendLines])

  const restartServer = useCallback(async (server) => {
    await stopServer(server, { force: false })
    const wait = setInterval(async () => {
      const rt = runtimeRef.current[server.id]
      if (!rt || rt.status !== 'stopping') {
        clearInterval(wait)
        setTimeout(() => void startServer(server), 1500)
      }
    }, 1500)
  }, [startServer, stopServer])

  const openFolder = useCallback(async (server) => {
    try {
      await callBackend('/settings/open-folder', { path: server.dir })
    } catch (e) {
      showToast(t('toast.folderFailed', { msg: e.message }), 'error')
    }
  }, [])

  /** 记录某服务器某标签页是否有未保存修改。 */
  const setTabDirty = useCallback((serverId, tabId, dirty) => {
    setDirtyTabs(prev => {
      const cur = prev[serverId] || {}
      if (!!cur[tabId] === !!dirty) return prev
      const nextTabs = { ...cur, [tabId]: !!dirty }
      if (!dirty) delete nextTabs[tabId]
      const next = { ...prev }
      if (Object.keys(nextTabs).length === 0) delete next[serverId]
      else next[serverId] = nextTabs
      return next
    })
  }, [])

  const clearDirty = useCallback((serverId) => {
    setDirtyTabs(prev => {
      if (!prev[serverId]) return prev
      const next = { ...prev }
      delete next[serverId]
      return next
    })
  }, [])

  const hasUnsaved = useCallback((serverId) => !!dirtyTabs[serverId], [dirtyTabs])

  /** 切服务器前拦一下：有未保存修改就确认（切走后组件卸载，改动直接丢）。 */
  const requestSwitchServer = useCallback((nextId) => {
    if (!selectedId || selectedId === nextId || !hasUnsaved(selectedId)) {
      setSelectedId(nextId)
      return
    }
    void (async () => {
      const ok = await confirm(t('unsaved.switchConfirm'), t('unsaved.title'))
      if (ok) {
        clearDirty(selectedId)
        setSelectedId(nextId)
      }
    })()
  }, [clearDirty, confirm, hasUnsaved, selectedId])

  /** 打开移除确认框（运行时先拦下：必须先停服）。 */
  const requestRemove = useCallback((server) => {
    const rt = runtimeRef.current[server.id]
    if (rt && rt.status === 'running') {
      showToast(t('toast.stopWhileRunning'), 'error')
      return
    }
    if (hasUnsaved(server.id)) {
      void (async () => {
        const ok = await confirm(t('unsaved.removeConfirm'), t('unsaved.title'))
        if (!ok) return
        clearDirty(server.id)
        setRemovePending(server)
      })()
      return
    }
    setRemovePending(server)
  }, [clearDirty, confirm, hasUnsaved])

  /** 确认后真正执行：可选连文件一起删。 */
  const deleteServer = useCallback(async (server, { deleteFiles = false } = {}) => {
    if (watchersRef.current[server.id]) watchersRef.current[server.id].stop()

    // 先摘条目再删文件：即使删文件中途失败/中断，列表也不会留下指向半删目录的条目
    const next = servers.filter(s => s.id !== server.id)
    await persistServers(next)
    if (selectedId === server.id) setSelectedId(null)
    setRemovePending(null)

    if (!deleteFiles) {
      showToast(t('toast.removedKeepFiles', { name: server.name }), 'success')
      return
    }

    showToast(t('toast.deletingFiles', { name: server.name }), 'info')
    const result = await deleteServerFiles(server.dir)
    log(`删除服务端 ${server.dir}: removed=${result.removed}${result.refused ? ' refused' : ''}${result.error ? ` error=${result.error}` : ''}`)

    if (result.refused) {
      // 安全策略拒绝：条目已摘掉，但文件一个没删 —— 必须说清楚，别让用户以为删干净了
      showToast(result.refused, 'error')
      log(`拒绝删除 ${server.dir}：${result.refused}`, 'warn')
    } else if (result.error) {
      showToast(describeDeleteResult(result), 'error')
    } else {
      showToast(describeDeleteResult(result), 'success')
    }
  }, [persistServers, selectedId, servers])

  const updateServer = useCallback(async (updated) => {
    const next = servers.map(s => (s.id === updated.id ? { ...s, ...updated } : s))
    await persistServers(next)
  }, [persistServers, servers])

  // ---------- 初始化 ----------

  useEffect(() => {
    // 资源中心「安装为服务端」：插件方式被选中时启动器经注册表调用本插件
    registerInstallModeHandler()
    // 搭建完成（或任何来源）写入新服务器条目后刷新列表
    const onServersChanged = () => {
      void (async () => {
        const s = (await getSettings().catch(() => null)) || {}
        setServers(Array.isArray(s.servers) ? s.servers : [])
      })()
    }
    window.addEventListener('sm:servers-changed', onServersChanged)
    return () => window.removeEventListener('sm:servers-changed', onServersChanged)
  }, [])

  // setting-up 条目对账：插件页（重）打开时查任务终态并补全条目——
  // 自动注册不依赖 iframe 存活（刷新/重启启动器后仍一致）
  useEffect(() => {
    if (!apiAvailable()) return
    let cancelled = false
    ;(async () => {
      const s = (await getSettings().catch(() => null)) || {}
      const servers = Array.isArray(s.servers) ? s.servers : []
      const pending = servers.filter(x => x.status === 'setting-up' && x.setupTaskId)
      for (const entry of pending) {
        if (cancelled) return
        try {
          const snap = await taskProgress(entry.setupTaskId)
          if (!snap) { await markSetupFailed(entry.dir, 'task-lost'); continue }
          if (snap.status === 'completed' || snap.status === 'awaiting-files') {
            await finalizeSetupEntry(entry.dir)
          } else if (snap.status === 'failed' || snap.status === 'cancelled') {
            await markSetupFailed(entry.dir, snap.error || snap.status)
          }
        } catch { /* 任务已回收/后端未起：保留 setting-up，下次再对账 */ }
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const state = await loadState()
      const resolvedRoot = await resolveRoot(state.serversRoot)
      if (cancelled) return
      setServers(state.servers)
      setRoot(resolvedRoot)
      // 找回重启前仍在运行的服务端（lastPid 存活检查）
      for (const s of state.servers) {
        if (!s.lastPid) continue
        try {
          const snap = await aliveProcess(s.lastPid)
          if (snap && snap.alive) {
            updateRuntime(s.id, { pid: s.lastPid, status: 'running' })
            beginWatch(s, s.lastPid)
          }
        } catch { /* 已退出或已回收 */ }
      }
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [beginWatch, updateRuntime])

  // 启动器退出：尽力而为（同步回调里不能发请求，仅记录）
  useEffect(() => {
    onLauncherExit(() => {
      log('启动器退出，服务端进程将保持运行（可在下载中心/任务管理器管理）', 'warn')
    })
  }, [])

  const selected = useMemo(() => servers.find(s => s.id === selectedId) || null, [servers, selectedId])

  if (!apiAvailable()) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <FaIcon cls="fa-solid fa-server" className="h-10 w-10 opacity-60" />
        <div>{t('empty.needLauncher')}</div>
        <div className="text-xs opacity-70">{t('empty.needLauncherSub')}</div>
      </div>
    )
  }

  if (!ready) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">{t('empty.loading')}</div>
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="w-72 min-w-[260px] shrink-0 border-r border-border bg-card">
        <ServerList
          servers={servers}
          runtime={runtime}
          selectedId={selectedId}
          root={root}
          onSelect={requestSwitchServer}
          dirtyIds={Object.keys(dirtyTabs)}
          onImport={() => setImportOpen(true)}
          onChangeRoot={async (r) => { setRoot(r); await saveRoot(r) }}
          onStart={startServer}
          onStop={stopServer}
          onDelete={requestRemove}
        />
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <ServerDetail
            key={selected.id}
            server={selected}
            runtime={runtime[selected.id] || { status: 'stopped' }}
            logs={logs[selected.id] || []}
            onClearLogs={() => setLogs(prev => ({ ...prev, [selected.id]: [] }))}
            onStart={() => void startServer(selected)}
            onStop={(force) => void stopServer(selected, { force })}
            onRestart={() => void restartServer(selected)}
            onCommand={(text) => void sendCommand(selected, text)}
            onSave={updateServer}
            onOpenFolder={() => void openFolder(selected)}
            onDelete={() => requestRemove(selected)}
            onDirtyChange={(tabId, dirty) => setTabDirty(selected.id, tabId, dirty)}
            onSwitchServer={(nextId) => requestSwitchServer(nextId)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <FaIcon cls="fa-solid fa-server" className="h-10 w-10 opacity-60" />
            <div>{servers.length === 0 ? t('empty.none') : t('empty.select')}</div>
            <Button onClick={() => setImportOpen(true)}>
              <FaIcon cls="fa-solid fa-plus" className="h-4 w-4" />
              {t('list.import')}
            </Button>
          </div>
        )}
      </div>
      {importOpen && (
        <ImportDialog
          root={root}
          onClose={() => setImportOpen(false)}
          onImported={(server) => {
            void persistServers([...servers, server])
            setSelectedId(server.id)
          }}
        />
      )}
      {eulaPending && (
        <EulaGate
          serverName={eulaPending.server.name}
          onAgree={() => void confirmEulaAndStart()}
          onCancel={() => { setEulaPending(null); updateRuntime(eulaPending.server.id, { status: 'stopped' }) }}
        />
      )}
      {removePending && (
        <RemoveServerDialog
          server={removePending}
          running={runtimeRef.current[removePending.id]?.status === 'running'}
          onCancel={() => setRemovePending(null)}
          onConfirm={({ deleteFiles }) => deleteServer(removePending, { deleteFiles })}
        />
      )}
    </div>
  )
}
