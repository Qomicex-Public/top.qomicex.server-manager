import React, { useRef, useState } from 'react'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@qomicex/plugin-ui'
import { pickFile, pickDirectory, extractArchive, downloadAddTask, downloadProgress, showToast } from '../api/bridge.js'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'
import { resolveRoot, joinPath, newServer } from '../api/state.js'
import { detectServer, guessMcVersion } from '../api/server.js'
import { startServerSetup, watchSetup, readLaunchManifest, readBlockedMods } from '../api/setup.js'
import { addServerEntry } from '../api/installMode.js'

const MODES = [
  { id: 'zip', label: 'import.mode.zip', icon: 'fa-solid fa-file-zipper' },
  { id: 'pack', label: 'import.mode.pack', icon: 'fa-solid fa-boxes-packing' },
  { id: 'url', label: 'import.mode.url', icon: 'fa-solid fa-link' },
  { id: 'dir', label: 'import.mode.dir', icon: 'fa-solid fa-folder-open' },
]

export default function ImportDialog({ root, onClose, onImported }) {
  const [mode, setMode] = useState('zip')
  const [name, setName] = useState('')
  const [zipPath, setZipPath] = useState('')
  const [url, setUrl] = useState('')
  const [dirPath, setDirPath] = useState('')
  const [packPath, setPackPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [progressText, setProgressText] = useState('')
  const [setupProgress, setSetupProgress] = useState(null) // { percent, stage, currentFile }
  const setupStopRef = useRef(null)

  const deriveName = (p, stripExt) => {
    const base = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
    return stripExt ? base.replace(/\.(zip|mrpack)$/i, '') : base
  }

  const browseZip = async () => {
    const p = await pickFile({ title: t('import.zipPath'), filters: [{ name: 'zip', extensions: ['zip'] }] })
    if (p) {
      setZipPath(p)
      if (!name.trim()) setName(deriveName(p, true))
    }
  }

  const browseDir = async () => {
    const p = await pickDirectory({ title: t('import.dirPath') })
    if (p) {
      setDirPath(p)
      if (!name.trim()) setName(deriveName(p, false))
    }
  }

  const browsePack = async () => {
    const p = await pickFile({
      title: t('import.packPath'),
      filters: [{ name: 'CurseForge/Modrinth', extensions: ['zip', 'mrpack'] }],
    })
    if (p) {
      setPackPath(p)
      if (!name.trim()) setName(deriveName(p, true))
    }
  }

  const finalize = async (dir, srvName) => {
    setProgressText(t('settings.redetect'))
    const d = await detectServer(dir)
    if (!d.jar) {
      throw new Error(t('import.noJar'))
    }
    const server = newServer({
      name: srvName,
      dir,
      jar: d.jar,
      mcVersion: guessMcVersion(d.jar) || guessMcVersion(dir),
    })
    onImported(server)
    showToast(t('import.done', { name: srvName, jar: d.jar }), 'success')
  }

  const ensureRoot = async () => {
    const r = root || (await resolveRoot(null))
    if (!r) throw new Error('getSystemInfo.dataDir missing')
    return r
  }

  /** 整合包开服：插件侧管线（task.* 上报进度），对话框内展示合成进度。 */
  const doPackSetup = async () => {
    const srvName = name.trim()
    if (!packPath.trim()) { showToast(t('import.packPath'), 'error'); return }
    if (!srvName) { showToast(t('import.name'), 'error'); return }
    setBusy(true)
    setSetupProgress({ percent: 0, stage: 'queued', currentFile: '' })
    try {
      const { taskId, dir } = await startServerSetup({ name: srvName, source: { packPath: packPath.trim() } })
      await new Promise((resolve, reject) => {
        if (setupStopRef.current) setupStopRef.current.stop()
        setupStopRef.current = watchSetup(taskId, {
          onUpdate: snap => setSetupProgress({ percent: snap.progress || 0, stage: snap.stage || '', currentFile: snap.currentFile || '' }),
          onDone: (success, snap) => {
            if (!success) { reject(new Error(snap?.error || 'failed/cancelled')); return }
            resolve(snap)
          },
        })
      })
      const launch = await readLaunchManifest(dir)
      const blocked = await readBlockedMods(dir)
      const entry = newServer({
        name: srvName,
        dir,
        jar: launch?.jar || '',
        mcVersion: launch?.gameVersion || '',
        fromPack: true,
      })
      if (launch?.mode) entry.launchMode = launch.mode
      await addServerEntry(entry)
      onImported(entry)
      showToast(
        blocked.length > 0 ? t('import.packDoneBlocked', { n: blocked.length }) : t('import.packDone', { name: srvName }),
        'success',
      )
      onClose()
    } catch (e) {
      showToast(t('import.packFailed', { msg: e.message }), 'error')
    } finally {
      setBusy(false)
      setSetupProgress(null)
    }
  }

  const doImport = async () => {
    if (mode === 'pack') return doPackSetup()
    const srvName = name.trim()
    if (!srvName) { showToast(t('import.name'), 'error'); return }
    setBusy(true)
    try {
      if (mode === 'dir') {
        if (!dirPath.trim()) { showToast(t('import.dirPath'), 'error'); return }
        await finalize(dirPath.trim().replace(/[\\/]+$/, ''), srvName)
      } else if (mode === 'zip') {
        if (!zipPath.trim()) { showToast(t('import.zipPath'), 'error'); return }
        const r = await ensureRoot()
        const dest = joinPath(r, srvName)
        setProgressText(t('import.extracting'))
        await extractArchive(zipPath.trim(), dest)
        // 压缩包常带顶层目录：若解压结果只有一个子目录且其内有 jar，把目录下钻一层
        let target = dest
        const d0 = await detectServer(dest)
        if (!d0.jar && d0.topDirs.length === 1) target = joinPath(dest, d0.topDirs[0])
        await finalize(target, srvName)
      } else {
        const u = url.trim()
        if (!/^https?:\/\//i.test(u)) { showToast(t('import.url'), 'error'); return }
        const r = await ensureRoot()
        const importsDir = joinPath(r, '.imports')
        const fileName = (u.split('/').pop() || 'server.zip').replace(/[?#].*$/, '') || 'server.zip'
        const zipTarget = joinPath(importsDir, fileName.endsWith('.zip') ? fileName : fileName + '.zip')
        setProgressText(t('import.downloading', { pct: 0 }))
        const { taskId } = await downloadAddTask({ url: u, targetPath: zipTarget, name: `${srvName}` })
        // 轮询下载进度（下载中心同时可见）
        await new Promise((resolve, reject) => {
          const timer = setInterval(async () => {
            try {
              const p = await downloadProgress(taskId)
              if (!p) return
              setProgressText(t('import.downloading', { pct: Math.round(p.progress || 0) }))
              if (p.status === 'completed') { clearInterval(timer); resolve() }
              else if (p.status === 'failed' || p.status === 'cancelled') { clearInterval(timer); reject(new Error(p.error || p.status)) }
            } catch (e) { clearInterval(timer); reject(e) }
          }, 1000)
        })
        const dest = joinPath(r, srvName)
        setProgressText(t('import.extracting'))
        await extractArchive(zipTarget, dest)
        let target = dest
        const d0 = await detectServer(dest)
        if (!d0.jar && d0.topDirs.length === 1) target = joinPath(dest, d0.topDirs[0])
        await finalize(target, srvName)
      }
      onClose()
    } catch (e) {
      showToast(t('import.failed', { msg: e.message }), 'error')
    } finally {
      setBusy(false)
      setProgressText('')
    }
  }

  const hint = { zip: 'import.zipHint', pack: 'import.packHint', url: 'import.urlHint', dir: 'import.dirHint' }[mode]

  return (
    <Dialog open onClose={() => { if (!busy) onClose() }}>
      <DialogHeader onClose={() => { if (!busy) onClose() }}>
        <DialogTitle className="flex items-center gap-2">
          <FaIcon cls="fa-solid fa-server" className="h-4 w-4 text-primary" />
          {t('import.title')}
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {/* 模式切换独立一行：与操作按钮分开，避免 footer 在 max-w-lg 内被挤压裁切 */}
        <div className="flex flex-wrap gap-1 border-b border-border pb-3">
          {MODES.map(m => (
            <Button
              key={m.id}
              size="sm"
              variant={mode === m.id ? 'default' : 'ghost'}
              disabled={busy}
              onClick={() => setMode(m.id)}
            >
              <FaIcon cls={m.icon} className="h-3.5 w-3.5" />
              {t(m.label)}
            </Button>
          ))}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">{t('import.name')}</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('import.namePlaceholder')} disabled={busy} />
        </div>
        {mode === 'zip' && (
          <div>
            <Label className="text-xs text-muted-foreground">{t('import.zipPath')}</Label>
            <div className="flex gap-2">
              <Input value={zipPath} onChange={e => setZipPath(e.target.value)} disabled={busy} />
              <Button size="sm" variant="outline" onClick={() => void browseZip()} disabled={busy}>{t('import.browse')}</Button>
            </div>
          </div>
        )}
        {mode === 'pack' && (
          <div>
            <Label className="text-xs text-muted-foreground">{t('import.packPath')}</Label>
            <div className="flex gap-2">
              <Input value={packPath} onChange={e => setPackPath(e.target.value)} disabled={busy} />
              <Button size="sm" variant="outline" onClick={() => void browsePack()} disabled={busy}>{t('import.browse')}</Button>
            </div>
          </div>
        )}
        {mode === 'url' && (
          <div>
            <Label className="text-xs text-muted-foreground">{t('import.url')}</Label>
            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/server.zip" disabled={busy} />
          </div>
        )}
        {mode === 'dir' && (
          <div>
            <Label className="text-xs text-muted-foreground">{t('import.dirPath')}</Label>
            <div className="flex gap-2">
              <Input value={dirPath} onChange={e => setDirPath(e.target.value)} disabled={busy} />
              <Button size="sm" variant="outline" onClick={() => void browseDir()} disabled={busy}>{t('import.browse')}</Button>
            </div>
          </div>
        )}
        <div className="text-xs text-muted-foreground">{t(hint)}</div>
        {progressText && <div className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">{progressText}</div>}
        {setupProgress && (
          <div className="space-y-1.5">
            <div className="sm-progress-bar"><div className="sm-progress-fill" style={{ width: `${Math.round(setupProgress.percent)}%` }} /></div>
            <div className="text-xs text-muted-foreground">
              {Math.round(setupProgress.percent)}% · {setupProgress.stage}
              {setupProgress.currentFile && ` · ${setupProgress.currentFile}`}
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>{t('import.cancel')}</Button>
        <Button disabled={busy} onClick={() => void doImport()}>
          {busy
            ? (mode === 'pack' ? t('import.busyPack') : t('import.busy'))
            : (mode === 'pack'
              ? <><FaIcon cls="fa-solid fa-bolt" className="h-4 w-4" />{t('import.confirmPack')}</>
              : t('import.confirm'))}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
