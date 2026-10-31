// 整合包一键开服 —— **插件侧完整实现**。
//
// 启动器只提供通用能力，本文件负责全部业务编排：
//   · download.addBatch   批量下载（几百个 mod 只占一张卡片，自带镜像回退）
//   · task.*              自报分步任务（下载中心同款卡片，插件推进度）
//   · curseforge.files    CF 文件 → 直链（API key 不出启动器）
//   · readArchiveEntry    不解压直接读包内元数据
//   · extractArchive(prefix/stripPrefix) 解包内子目录（overrides 提到根）
//   · renamePath          移动文件（client-only 隔离）
//
// 管线：解析包 → 装服务端运行时 → 批量下载 mods → 释放 overrides →
//       隔离 client-only → 写基础配置与 launch.json
import {
  call, getSystemInfo, getCache, setCache, log,
  downloadAddBatch, downloadBatchStatus, taskRegister, taskUpdate, taskComplete,
  readArchiveEntry, extractArchive, renamePath, listDir,
  writeText, proxyFetch, curseforgeFiles,
} from './bridge.js'
import { resolveJava } from './java.js'
import { t } from '../i18n.js'

/** 服务端根目录：{数据目录}/Servers（getSystemInfo().dataDir 定位）。 */
export async function serversRoot() {
  const cached = await getCache('servers-root').catch(() => null)
  if (cached) return cached
  try {
    const info = await getSystemInfo()
    if (info && info.dataDir) {
      const dir = String(info.dataDir).replace(/[\\/]+$/, '')
      const root = dir + (dir.includes('\\') ? '\\Servers' : '/Servers')
      await setCache('servers-root', root, 86400).catch(() => {})
      return root
    }
  } catch { /* 浏览器 dev 环境 */ }
  return null
}

const sepOf = (p) => (p.includes('\\') ? '\\' : '/')
const join = (a, b) => a.replace(/[\\/]+$/, '') + sepOf(a) + b.replace(/^[\\/]+/, '')

/** 管线步骤（顺序即显示顺序；weight 只影响合成总进度）。 */
const STEPS = [
  { id: 'parse-pack', weight: 10 },
  { id: 'server-runtime', weight: 35 },
  { id: 'download-files', weight: 40 },
  { id: 'overrides', weight: 10 },
  { id: 'client-filter', weight: 5 },
  { id: 'server-config', weight: 5 },
]

function stepSpecs() {
  return STEPS.map(s => ({ id: s.id, weight: s.weight, label: t(`setup.steps.${s.id}`) }))
}

/**
 * 发起服务端搭建。
 *   { source:'modrinth'|'cf', projectId, fileId } 在线整合包
 *   { packPath }                                  本地整合包
 *   { vanilla:true, mcVersion }                   纯净服
 * 返回 { taskId, dir }；进度见下载中心（task id = taskId）。
 */
export async function startServerSetup({ name, source, javaPath, xmxMb, title }) {
  const root = await serversRoot()
  if (!root) throw new Error('无法定位服务器根目录（getSystemInfo.dataDir 缺失）')
  const safeName = String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || 'server'
  const dir = join(root, safeName)

  const taskId = `server-setup:${safeName}:${Date.now()}`
  await taskRegister({
    taskId,
    title: title || t('task.title', { name: safeName }),
    steps: stepSpecs(),
  })

  // 后台跑：与后端管线一样「立即返回 taskId」，失败写回任务终态。
  void runPipeline({ taskId, dir, name: safeName, source, javaPath, xmxMb }).catch(async (e) => {
    log(`服务端搭建失败: ${e?.message || e}`, 'error')
    await taskComplete(taskId, String(e?.message || e)).catch(() => {})
  })

  return { taskId, dir }
}

async function update(taskId, patch) {
  await taskUpdate(taskId, patch).catch(() => {})
}

async function runPipeline({ taskId, dir, name, source, javaPath, xmxMb }) {
  const ctx = { taskId, dir, name, source, javaPath, xmxMb }
  try {
    await update(taskId, { status: 'downloading', stage: 'parse-pack', stepId: 'parse-pack', stepStatus: 'active' })
    const pack = await resolvePack(ctx)

    // ---- 2. 服务端运行时 ----
    await update(taskId, { stepId: 'parse-pack', stepStatus: 'done', status: 'installing', stage: 'server-runtime' })
    await update(taskId, { stepId: 'server-runtime', stepStatus: 'active' })
    await installRuntime(ctx, pack)

    // ---- 3. mods 批量下载 ----
    await update(taskId, { stepId: 'server-runtime', stepStatus: 'done', stage: 'download-files' })
    await update(taskId, { stepId: 'download-files', stepStatus: 'active' })
    const blocked = await downloadPackFiles(ctx, pack)
    await update(taskId, { stepId: 'download-files', stepStatus: 'done' })

    // ---- 4. overrides ----
    await update(taskId, { stepId: 'overrides', stepStatus: 'active', stage: 'overrides' })
    await releaseOverrides(ctx, pack)
    await update(taskId, { stepId: 'overrides', stepStatus: 'done' })

    // ---- 5. client-only 隔离 ----
    await update(taskId, { stepId: 'client-filter', stepStatus: 'active', stage: 'client-filter' })
    const moved = await filterClientOnlyMods(ctx)
    await update(taskId, { stepId: 'client-filter', stepStatus: 'done', currentFile: t('setup.misc.clientFiltered', { n: moved }) })

    // ---- 6. 基础配置 + launch.json ----
    await update(taskId, { stepId: 'server-config', stepStatus: 'active', stage: 'server-config' })
    await writeBaseConfig(ctx)
    await writeLaunchManifest(ctx, pack)
    await saveBlocked(ctx, blocked)
    await update(taskId, { stepId: 'server-config', stepStatus: 'done' })

    // 受限文件不报 blockedFiles：那会让任务进 awaiting-files，而本插件目前没有
    // 「补全后标记完成」的界面，卡片会在下载中心永久停住。改为正常完成并把数量
    // 交给调用方 toast（清单仍写 .qml-server/blocked-mods.json 备后续界面使用）。
    if (blocked.length > 0) {
      log(`有 ${blocked.length} 个受限文件未下载（见 .qml-server/blocked-mods.json）`, 'warn')
    }
    await taskComplete(taskId)
    log(`服务端搭建完成: ${dir}`)
  } catch (e) {
    await taskComplete(taskId, String(e?.message || e)).catch(() => {})
    throw e
  }
}

// ---------------------------------------------------------------------------
// 1. 解析包
// ---------------------------------------------------------------------------

/**
 * 解析安装来源，下载包体并读出清单。
 * 返回 { kind:'vanilla'|'modrinth'|'curseforge', packPath?, mcVersion, loader, loaderVersion, files[] }
 */
async function resolvePack(ctx) {
  const src = ctx.source || {}
  if (src.vanilla) {
    const mcVersion = String(src.mcVersion || '').trim()
    if (!mcVersion) throw new Error('纯净服需要 mcVersion')
    return { kind: 'vanilla', mcVersion, loader: '', loaderVersion: '', files: [] }
  }

  const packPath = await ensurePackFile(ctx, src)
  const mr = await readArchiveEntry(packPath, 'modrinth.index.json', { maxBytes: 32 * 1024 * 1024 })
  if (mr && mr.content) {
    const doc = JSON.parse(mr.content)
    const deps = doc.dependencies || {}
    const files = (doc.files || [])
      .filter(f => (f.env?.server ?? 'required') !== 'unsupported')
      .map(f => ({ path: normalizeRel(f.path), url: f.downloads?.[0] || '' }))
    return {
      kind: 'modrinth',
      packPath,
      mcVersion: deps.minecraft || '',
      loader: deps['fabric-loader'] ? 'fabric' : (deps.neoforge ? 'neoforge' : (deps.forge ? 'forge' : '')),
      loaderVersion: deps['fabric-loader'] || deps.neoforge || deps.forge || '',
      files,
    }
  }

  const cf = await readArchiveEntry(packPath, 'manifest.json', { maxBytes: 32 * 1024 * 1024 })
  if (cf && cf.content) {
    const doc = JSON.parse(cf.content)
    const mc = doc.minecraft || {}
    const primary = (mc.modLoaders || []).find(l => l.primary) || (mc.modLoaders || [])[0]
    const loaderId = primary?.id || ''
    const [loaderName, loaderVersion] = loaderId.split('-')
    return {
      kind: 'curseforge',
      packPath,
      mcVersion: mc.version || '',
      loader: normalizeLoader(loaderName),
      loaderVersion: loaderVersion || '',
      files: (doc.files || []).map(f => ({ projectId: f.projectID, fileId: f.fileID, path: '' })),
    }
  }

  throw new Error(t('toast.packUnrecognized'))
}

/** 在线包先落到 {dir}/temp/pack.zip；本地包直接用给定路径。 */
async function ensurePackFile(ctx, src) {
  if (src.packPath) return src.packPath
  if (!src.source || !src.projectId || !src.fileId) throw new Error('在线整合包来源需要 source + projectId + fileId')

  let url
  if (String(src.source).toLowerCase() === 'modrinth') {
    const v = await proxyFetch({ url: `https://api.modrinth.com/v2/version/${encodeURIComponent(src.fileId)}` })
    const body = typeof v.body === 'string' ? JSON.parse(v.body) : v.body
    url = body?.files?.[0]?.url
    if (!url) throw new Error('Modrinth 版本没有可下载文件')
  } else {
    const [info] = await curseforgeFiles([{ projectId: Number(src.projectId), fileId: Number(src.fileId) }])
    url = info?.downloadUrl
    if (!url) throw new Error(info?.blockedReason || 'CurseForge 无法取得整合包下载链接')
  }

  const ext = String(src.source).toLowerCase() === 'modrinth' ? 'mrpack' : 'zip'
  const packPath = join(join(ctx.dir, 'temp'), `pack.${ext}`)
  await downloadAndWait(ctx, [{ url, destPath: packPath }], 'parse-pack')
  return packPath
}

function normalizeRel(p) {
  return String(p).replace(/\\/g, '/').replace(/^\/+/, '')
}

function normalizeLoader(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('neoforge')) return 'neoforge'
  if (n.includes('forge')) return 'forge'
  if (n.includes('fabric')) return 'fabric'
  return ''
}

// ---------------------------------------------------------------------------
// 2. 服务端运行时
// ---------------------------------------------------------------------------

async function installRuntime(ctx, pack) {
  const { dir } = ctx
  const mc = pack.mcVersion
  if (!mc) throw new Error('无法确定 Minecraft 版本')

  const javaPath = await resolveJavaPath(ctx, mc)

  if (!pack.loader) {
    // vanilla：官方 version JSON 的 downloads.server（download_batch 自动挂 BMCLAPI 兜底）
    await update(ctx.taskId, { currentFile: t('setup.misc.vanillaMeta', { mc }) })
    const manifest = await proxyFetch({ url: 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json' })
    const mbody = typeof manifest.body === 'string' ? JSON.parse(manifest.body) : manifest.body
    const entry = (mbody?.versions || []).find(v => v.id === mc)
    if (!entry) throw new Error(t('setup.errors.versionNotFound', { mc }))
    const vj = await proxyFetch({ url: entry.url })
    const vbody = typeof vj.body === 'string' ? JSON.parse(vj.body) : vj.body
    const serverUrl = vbody?.downloads?.server?.url
    if (!serverUrl) throw new Error(t('setup.errors.noServerJar', { mc }))
    await downloadAndWait(ctx, [{ url: serverUrl, destPath: join(dir, 'server.jar') }], 'server-runtime')
    return
  }

  if (pack.loader === 'fabric') {
    // 缺 loader 版本时取最新 stable（与官方 meta 一致）
    let loader = pack.loaderVersion
    if (!loader) {
      const list = await proxyFetch({ url: 'https://meta.fabricmc.net/v2/versions/loader' })
      const arr = typeof list.body === 'string' ? JSON.parse(list.body) : list.body
      loader = (arr || []).find(v => v.stable)?.version || arr?.[0]?.version
      if (!loader) throw new Error(t('setup.errors.noFabricLoader'))
    }
    const inst = await proxyFetch({ url: 'https://meta.fabricmc.net/v2/versions/installer' })
    const iarr = typeof inst.body === 'string' ? JSON.parse(inst.body) : inst.body
    const installer = (iarr || []).find(v => v.stable)?.version || iarr?.[0]?.version
    if (!installer) throw new Error(t('setup.errors.noFabricInstaller'))
    const url = `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/${installer}/server/jar`
    await update(ctx.taskId, { currentFile: t('setup.misc.fabricLauncher') })
    await downloadAndWait(ctx, [{ url, destPath: join(dir, 'fabric-server-launch.jar') }], 'server-runtime')
    pack.loaderVersion = loader
    return
  }

  // forge / neoforge：下载 installer → java -jar --installServer
  const loader = pack.loader
  const version = pack.loaderVersion
  if (!version) throw new Error(t('setup.errors.missingLoaderVersion', { loader }))
  const installerUrl = loader === 'neoforge'
    ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
    : `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${version}/forge-${mc}-${version}-installer.jar`
  const installerPath = join(join(dir, 'temp'), `${loader}-installer.jar`)
  await update(ctx.taskId, { currentFile: t('setup.misc.downloadInstaller', { loader }) })
  await downloadAndWait(ctx, [{ url: installerUrl, destPath: installerPath }], 'server-runtime')

  // 预填 libraries：安装器内部的库下载直连 maven（--mirror 不覆盖 neoforged.net，
  // 实测），受限网络下必挂。清单就嵌在安装器 jar 里，先用启动器批量下载（自动
  // 挂 ForgeCDN/BMCLAPI 兜底）预填，安装器 sha1 校验通过即跳过下载——还顺带把
  // 安装器的串行下载换成了并发。
  await prefetchInstallerLibraries(ctx, installerPath, dir)

  await update(ctx.taskId, {
    status: 'installing',
    currentFile: t('setup.misc.runningInstaller', { loader }),
  })
  const res = await call('process.spawn', { command: javaPath, args: ['-jar', installerPath, '--installServer'], cwd: dir })
  const pid = res?.pid
  if (!pid) throw new Error(t('setup.errors.installerSpawn', { java: javaPath }))
  await waitProcess(ctx, pid, 20 * 60 * 1000)
}

/**
 * 从安装器 jar 内嵌清单预填 `libraries/`。
 *
 * 安装器对已存在且 sha1 匹配的文件直接跳过（"File ... exists. Checksum valid."）。
 * 清单来源：install_profile.json（安装用）与 version.json（运行用），两者可能重叠，
 * 按落盘路径去重。URL 分两种形态：
 *   · downloads.artifact.url（NeoForge/新版 Forge：完整 URL + path）
 *   · name + url base（旧版 Forge：maven 坐标，需推导相对路径）
 * 经 download.addBatch 走启动器下载层——NeoForge maven 因此拿到 ForgeCDN 兜底。
 */
async function prefetchInstallerLibraries(ctx, installerPath, dir) {
  const libRoot = join(dir, 'libraries')
  const items = []
  const seen = new Set()
  for (const entry of ['install_profile.json', 'version.json']) {
    const raw = await readArchiveEntry(installerPath, entry, { maxBytes: 16 * 1024 * 1024 })
    if (!raw?.content) continue
    let doc
    try {
      doc = JSON.parse(raw.content)
    } catch {
      continue
    }
    for (const l of doc.libraries || []) {
      const a = l?.downloads?.artifact
      if (a?.url && a?.path) {
        pushLib(a.url, a.path)
      } else if (l?.name) {
        const path = mavenArtifactPath(l.name)
        if (!path) continue
        const base = String(l.url || 'https://libraries.minecraft.net/')
        pushLib(base.replace(/\/?$/, '/') + path, path)
      }
    }
  }
  if (items.length === 0) return 0
  await update(ctx.taskId, { currentFile: t('setup.misc.prefetchLibs', { n: items.length }) })
  await downloadAndWait(ctx, items, 'server-runtime')
  return items.length

  function pushLib(url, relPath) {
    const clean = normalizeRel(relPath)
    if (!clean || clean.includes('..')) return
    const dest = join(libRoot, clean)
    const key = dest.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    items.push({ url, destPath: dest })
  }
}

/** maven 坐标 → 仓库相对路径（group/artifact/version/artifact-version[-classifier].ext）。
 * 坐标形如 group:artifact:version[:classifier][@ext]，ext 缺省 jar。 */
function mavenArtifactPath(name) {
  const m = /^([^:@]+):([^:@]+):([^:@]+)(?::([^:@]+))?(?:@([^:@]+))?$/.exec(String(name).trim())
  if (!m) return null
  const [, group, artifact, version, classifier, extRaw] = m
  const ext = extRaw || 'jar'
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`
}

/** 轮询进程退出；期间把日志尾部作为 currentFile 展示。 */
async function waitProcess(ctx, pid, timeoutMs) {
  const started = Date.now()
  let lastSeq = 0
  for (;;) {
    await new Promise(r => setTimeout(r, 2000))
    const snap = await call('process.alive', pid).catch(() => null)
    // 拉日志尾部做展示（安装器输出很长，只取最后一行）
    try {
      const logs = await call('process.logs', pid, lastSeq)
      const lines = logs?.lines || []
      if (lines.length > 0) {
        lastSeq = (lines[lines.length - 1]?.seq ?? lastSeq) + 1
        const tail = lines[lines.length - 1]?.text || ''
        if (tail) await update(ctx.taskId, { currentFile: `[installer] ${String(tail).slice(0, 300)}` })
      }
    } catch { /* 日志不可用不影响等待 */ }
    if (!snap || snap.alive === false) {
      const exitCode = snap?.exitCode ?? snap?.exit_code ?? 0
      if (exitCode !== 0) throw new Error(t('setup.errors.installerExit', { code: exitCode }))
      return
    }
    if (Date.now() - started > timeoutMs) {
      await call('process.kill', pid).catch(() => {})
      throw new Error(t('setup.errors.installerTimeout'))
    }
  }
}

async function resolveJavaPath(ctx, mc) {
  if (ctx.javaPath) return ctx.javaPath
  try {
    const j = await resolveJava({ mcVersion: mc, dir: ctx.dir })
    if (j) return j
  } catch { /* 回退到 PATH 里的 java */ }
  return 'java'
}

// ---------------------------------------------------------------------------
// 3. mods 下载
// ---------------------------------------------------------------------------

/** 下载清单文件；CF 走元数据代理换直链，取不到直链的记入 blocked。 */
async function downloadPackFiles(ctx, pack) {
  if (!pack.files || pack.files.length === 0) return []
  const modsDir = join(ctx.dir, 'mods')
  const blocked = []

  let items
  if (pack.kind === 'modrinth') {
    items = pack.files
      .filter(f => f.url)
      .map(f => ({ url: f.url, destPath: join(ctx.dir, normalizeRel(f.path)) }))
  } else {
    const infos = await curseforgeFiles(pack.files.map(f => ({ projectId: f.projectId, fileId: f.fileId })))
    items = []
    for (const info of infos) {
      if (!info.downloadUrl) {
        blocked.push({
          projectId: info.projectId,
          fileId: info.fileId,
          fileName: info.fileName || '',
          reason: info.blockedReason || 'restricted',
        })
        continue
      }
      const fileName = info.fileName || `cf-${info.fileId}.jar`
      items.push({ url: info.downloadUrl, destPath: join(modsDir, sanitizeName(fileName)) })
    }
  }

  if (items.length > 0) {
    await downloadAndWait(ctx, items, 'download-files')
  }
  return blocked
}

/**
 * 批量下载并等待完成。
 *
 * `download.addBatch` 是后台任务（立即返回 taskId/batchId），不等待就会跑到下一步。
 * 按 batchId 轮询；同时把 totalFiles 报给任务（下载中心展示）。
 */
async function downloadAndWait(ctx, files, stepId) {
  const res = await downloadAddBatch({ files, taskId: ctx.taskId, stepId })
  const batchId = res?.batchId
  if (!batchId) return
  for (;;) {
    await new Promise(r => setTimeout(r, 800))
    const st = await downloadBatchStatus(batchId).catch(() => null)
    if (!st) throw new Error('批量下载批次丢失（后端可能已重启）')
    if (st.status === 'completed') return
    if (st.status === 'failed') throw new Error(st.error || t('setup.errors.downloadFailed'))
  }
}

function sanitizeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_')
}

// ---------------------------------------------------------------------------
// 4. overrides
// ---------------------------------------------------------------------------

/** 把包内 overrides/ 提到服务端根目录。 */
async function releaseOverrides(ctx, pack) {
  if (!pack.packPath) return
  await extractArchive(pack.packPath, ctx.dir, { prefix: 'overrides', stripPrefix: true })
}

// ---------------------------------------------------------------------------
// 5. client-only 隔离
// ---------------------------------------------------------------------------

/** 扫 mods/*.jar 的元数据，把纯客户端模组移到 mods-client-only/（不删，可恢复）。 */
async function filterClientOnlyMods(ctx) {
  const modsDir = join(ctx.dir, 'mods')
  let entries = []
  try {
    entries = await listDir(modsDir, { maxEntries: 5000 })
  } catch {
    return 0
  }
  const jars = (entries || []).filter(e => !e.isDir && /\.jar$/i.test(e.name || ''))
  let moved = 0
  for (const jar of jars) {
    const path = join(modsDir, jar.name)
    let clientOnly = null
    try {
      clientOnly = await detectClientOnly(path)
    } catch {
      continue // 读不出元数据就保守保留
    }
    if (clientOnly === true) {
      try {
        await renamePath(path, join(join(ctx.dir, 'mods-client-only'), jar.name))
        moved++
      } catch (e) {
        log(`隔离 ${jar.name} 失败: ${e.message}`, 'warn')
      }
    }
  }
  if (moved > 0) log(`已隔离 ${moved} 个 client-only 模组`)
  return moved
}

/** 判定 jar 是否 client-only：fabric.mod.json 的 environment / (neo)forge mods.toml 的 clientSideOnly。 */
async function detectClientOnly(jarPath) {
  const fabric = await readArchiveEntry(jarPath, 'fabric.mod.json')
  if (fabric?.content) {
    const doc = JSON.parse(fabric.content)
    const env = doc.environment
    if (typeof env === 'string') {
      if (env === 'client') return true
      if (env === '*' || env === 'server') return false
    }
    if (Array.isArray(env)) {
      // 旧版两段式：["*", "client"] / ["required", "unsupported"]
      if (env[1] === 'client' || env[1] === 'unsupported') return true
      return false
    }
  }
  for (const entry of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
    const toml = await readArchiveEntry(jarPath, entry)
    if (toml?.content) {
      const m = /^\s*clientSideOnly\s*=\s*(true|false)\s*$/im.exec(toml.content)
      if (m) return m[1].toLowerCase() === 'true'
      return null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 6. 基础配置 + launch.json
// ---------------------------------------------------------------------------

async function writeBaseConfig(ctx) {
  const { dir, xmxMb } = ctx
  // 已存在的文件不覆盖：overrides 可能带正式配置
  await ensureFile(join(dir, 'eula.txt'), '# 同意即视为接受 Minecraft EULA: https://aka.ms/MinecraftEULA\neula=false\n')
  await ensureFile(join(dir, 'server.properties'), '#Minecraft server properties\nonline-mode=true\n')
  if (xmxMb && Number(xmxMb) > 0) {
    await ensureFile(join(dir, 'user_jvm_args.txt'), `# 由 Qomicex 服务端搭建生成\n-Xmx${Math.round(Number(xmxMb))}M\n`)
  }
}

async function ensureFile(path, content) {
  try {
    await call('readText', path)
    return // 已存在
  } catch { /* 不存在则写 */ }
  await writeText(path, content)
}

/** 写 .qml-server/launch.json（jar / argfile 两种启动方式自描述）。 */
async function writeLaunchManifest(ctx, pack) {
  const { dir } = ctx
  const winArg = parseArgfile(await readTextSafe(join(dir, 'run.bat')))
  const unixArg = parseArgfile(await readTextSafe(join(dir, 'run.sh')))
  const doc = {
    gameVersion: pack.mcVersion || '',
    loader: pack.loader || '',
    loaderVersion: pack.loaderVersion || '',
  }
  if (winArg || unixArg) {
    doc.mode = 'argfile'
    if (winArg) doc.windowsArgfile = winArg
    if (unixArg) doc.unixArgfile = unixArg
  } else {
    let entries = []
    try {
      entries = await listDir(dir, { maxEntries: 500 })
    } catch { /* 目录读不到就交给默认 server.jar */ }
    const jars = (entries || [])
      .filter(e => !e.isDir && /\.jar$/i.test(e.name || ''))
      .filter(e => !String(e.name).toLowerCase().includes('installer'))
      .map(e => ({ name: e.name, size: e.size || 0 }))
    const jar = pickLaunchJar(jars)
    if (!jar) throw new Error(t('setup.errors.noLaunchJar'))
    doc.mode = 'jar'
    doc.jar = jar
  }
  await writeText(join(join(dir, '.qml-server'), 'launch.json'), JSON.stringify(doc, null, 2))
}

async function readTextSafe(path) {
  try {
    const { content } = await call('readText', path)
    return content
  } catch {
    return null
  }
}

/** 从 run.bat / run.sh 里找 `@libraries/.../win_args.txt`。 */
function parseArgfile(text) {
  if (!text) return null
  const m = /@(libraries\/[^\s"']+_args\.txt)/.exec(text)
  return m ? m[1] : null
}

/** 根目录 jar 里选启动目标：优先 forge universal，其次最大 jar。 */
function pickLaunchJar(jars) {
  if (!jars || jars.length === 0) return null
  const universal = jars.find(j => /universal/i.test(j.name))
  if (universal) return universal.name
  const sorted = [...jars].sort((a, b) => (b.size || 0) - (a.size || 0))
  return sorted[0]?.name || null
}

async function saveBlocked(ctx, blocked) {
  const path = join(join(ctx.dir, '.qml-server'), 'blocked-mods.json')
  if (!blocked || blocked.length === 0) {
    await call('deleteFile', path).catch(() => {})
    return
  }
  await writeText(path, JSON.stringify(blocked, null, 2))
}

// ---------------------------------------------------------------------------
// 进度 / 其它
// ---------------------------------------------------------------------------

/**
 * 轮询搭建进度（task 快照）。返回 { stop }。
 * onDone(success, snapshot) 只触发一次。
 */
export function watchSetup(taskId, { onUpdate, onDone, intervalMs = 1200 }) {
  let stopped = false
  let timer = null
  const poll = async () => {
    if (stopped) return
    try {
      const snap = await call('task.progress', taskId)
      if (stopped) return
      if (onUpdate) onUpdate(snap)
      const terminal = ['completed', 'failed', 'cancelled', 'awaiting-files']
      if (terminal.includes(snap?.status)) {
        stop()
        if (onDone) onDone(snap.status === 'completed' || snap.status === 'awaiting-files', snap)
      }
    } catch (e) {
      stop()
      if (onDone) onDone(false, { error: e.message })
    }
  }
  void poll()
  timer = setInterval(poll, intervalMs)
  function stop() {
    stopped = true
    if (timer) clearInterval(timer)
  }
  return { stop }
}

/** 取消搭建任务（插件侧管线：仅标记失败，正在下载的批次由后端照常结束）。 */
export async function cancelSetup(taskId) {
  return call('task.complete', taskId, '安装已取消').catch(() => {})
}

/** 读取 launch.json（服务端搭建完成后的启动方式自描述）。 */
export async function readLaunchManifest(serverDir) {
  try {
    const { content } = await call('readText', serverDir.replace(/[\\/]+$/, '') + '/.qml-server/launch.json')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/** 读取分发受限清单（.qml-server/blocked-mods.json）。 */
export async function readBlockedMods(serverDir) {
  try {
    const { content } = await call('readText', serverDir.replace(/[\\/]+$/, '') + '/.qml-server/blocked-mods.json')
    return JSON.parse(content)
  } catch {
    return []
  }
}

/**
 * 由 launch.json 组装 spawn 参数（process.spawn 的 args）。
 * argfile 模式：按当前平台选 win/unix args 文件（java @file）；jar 模式：-jar。
 * 两种模式都追加服务端程序参数（默认含 nogui）：vanilla/fabric 服务端默认开
 * GUI——GUI 会接管控制台输出（stdout 不再输出日志）且不读 stdin 管道
 * （stop 命令失效），必须 nogui 无头运行。
 */
export function buildLaunchArgs(launch, server, javaPath) {
  const jvm = []
  if (server?.xmsMb) jvm.push(`-Xms${server.xmsMb}M`)
  if (server?.xmxMb) jvm.push(`-Xmx${server.xmxMb}M`)
  jvm.push('-Dfile.encoding=UTF-8')
  if (server?.jvmArgs) jvm.push(...String(server.jvmArgs).split(/\s+/).filter(Boolean))
  const serverArgs = String(server?.serverArgs ?? 'nogui').split(/\s+/).filter(Boolean)

  if (launch && launch.mode === 'argfile') {
    const isWin = navigator.userAgent.includes('Windows')
    const argfile = (isWin ? launch.windowsArgfile : launch.unixArgfile) || launch.windowsArgfile || launch.unixArgfile
    if (argfile) {
      return [...jvm, `@${argfile}`, ...serverArgs]
    }
  }
  const jar = (launch && launch.jar) || server?.jar
  if (jar) return [...jvm, '-jar', jar, ...serverArgs]
  return [...jvm, '-jar', 'server.jar', ...serverArgs]
}

/** 供 console 调试：直接发起一次本地整合包开服（插件页向导复用同一入口）。 */
export async function setupFromLocalPack(packPath, name) {
  return startServerSetup({ name, source: { packPath } })
}
