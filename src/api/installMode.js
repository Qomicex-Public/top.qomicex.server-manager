// installMode:to-server —— 资源中心「安装为服务端」的处理函数注册。
// 对话框快速返回（后端任务 + 下载中心进度），完成后再注册进服务器列表。
import { getApi, showToast, log, setSettings, getSettings } from './bridge.js'
import { startServerSetup, watchSetup, readLaunchManifest, readBlockedMods } from './setup.js'
import { newServer } from './state.js'
import { t, reloadStrings } from '../i18n.js'

/** 启动器侧在对话框确认时调用本插件方法。 */
export function registerInstallModeHandler() {
  const api = getApi()
  if (!api) return
  api.registerMethod('installMode:to-server', (ctx) => {
    void handleInstallMode(ctx || {}).catch(e => {
      showToast(t('toast.setupStartFailed', { msg: e.message }), 'error')
    })
    // 立即返回：任务已登记进后端 InstallTracker，进度在下载中心可见
    return { accepted: true }
  })
}

async function handleInstallMode(ctx) {
  const { kind, source, path } = ctx
  if (kind !== 'modpack') throw new Error(`to-server supports modpack only (got ${kind})`)
  if (String(source).toLowerCase() === 'technic') {
    throw new Error('Technic modpacks are not supported yet')
  }

  const packSource = path
    ? { packPath: path }
    : { source, projectId: ctx.projectId, fileId: ctx.fileId }
  if (!path && !(ctx.projectId && ctx.fileId)) {
    throw new Error('missing pack source (projectId/fileId)')
  }

  // 词条可能在插件页打开前就绪（常驻挂载），保险起见确保已拉取
  await reloadStrings().catch(() => {})

  const { taskId, dir } = await startServerSetup({
    name: ctx.name || 'server',
    source: packSource,
    title: t('task.title', { name: ctx.name || 'server' }),
  })
  showToast(t('toast.setupStarted', { name: ctx.name }), 'success')
  log(`installMode:to-server task=${taskId} dir=${dir}`)

  // 发起即注册占位条目（status='setting-up'）：插件页刷新/启动器重启都不会
  // 丢注册——打开插件页时对 setupTaskId 对账补全（见 App.jsx reconcileSetup）。
  try {
    await addServerEntry(newServer({
      name: ctx.name || 'server',
      dir,
      mcVersion: ctx.gameVersion || '',
      fromPack: true,
      setupTaskId: taskId,
      status: 'setting-up',
    }))
  } catch (e) {
    log(`占位注册失败（不影响搭建）: ${e.message}`)
  }

  // iframe 存活期间负责补全终态（jar/mcVersion/launchMode）；不存活则由
  // 插件页对账兜底。任何一步失败都不影响搭建本身。
  void watchSetup(taskId, {
    onDone: async (success, snap) => {
      if (!success) {
        showToast(t('toast.setupFailed', { msg: snap?.error || t('misc.unknown') }), 'error')
        void markSetupFailed(dir, snap?.error || 'unknown')
        return
      }
      try {
        await finalizeSetupEntry(dir)
        const blocked = await readBlockedMods(dir)
        showToast(
          blocked.length > 0
            ? t('toast.setupDoneBlocked', { n: blocked.length })
            : t('toast.setupDone', { name: ctx.name || 'server' }),
          'success',
        )
      } catch (e) {
        showToast(t('toast.setupFinalizeFailed', { msg: e.message }), 'error')
      }
    },
  })
}

/** 读 launch.json 把 setting-up 条目补成可用条目。 */
export async function finalizeSetupEntry(dir) {
  const launch = await readLaunchManifest(dir)
  const s = (await getSettings().catch(() => null)) || {}
  const servers = Array.isArray(s.servers) ? s.servers : []
  const idx = servers.findIndex(x => x.dir === dir)
  if (idx < 0) throw new Error('placeholder entry missing')
  servers[idx] = {
    ...servers[idx],
    jar: launch?.jar || servers[idx].jar || '',
    mcVersion: launch?.gameVersion || servers[idx].mcVersion || '',
    launchMode: launch?.mode || servers[idx].launchMode,
    status: 'ready',
  }
  await setSettings('servers', servers)
  window.dispatchEvent(new CustomEvent('sm:servers-changed'))
}

/** 搭建失败：占位条目标记 failed（保留供用户查看/清理）。 */
export async function markSetupFailed(dir, error) {
  const s = (await getSettings().catch(() => null)) || {}
  const servers = Array.isArray(s.servers) ? s.servers : []
  const idx = servers.findIndex(x => x.dir === dir)
  if (idx < 0) return
  servers[idx] = { ...servers[idx], status: 'failed', setupError: String(error).slice(0, 200) }
  await setSettings('servers', servers)
  window.dispatchEvent(new CustomEvent('sm:servers-changed'))
}

/** 追加服务器条目到插件设置（读-改-写 + 广播刷新事件）。 */
export async function addServerEntry(entry) {
  const s = (await getSettings().catch(() => null)) || {}
  const servers = Array.isArray(s.servers) ? s.servers : []
  if (servers.some(x => x.dir === entry.dir)) return
  await setSettings('servers', [...servers, entry])
  window.dispatchEvent(new CustomEvent('sm:servers-changed'))
}

/** 供 console 调试：直接发起一次本地整合包开服（插件页向导复用同一入口）。 */
export async function setupFromLocalPack(packPath, name) {
  return startServerSetup({ name, source: { packPath } })
}
