import React, { useEffect, useState } from 'react'
import { Button, Checkbox, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@qomicex/plugin-ui'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'
import { measureDirectory, formatBytes, checkDeletable } from '../api/cleanup.js'

/**
 * 移除服务端的二次确认。
 *
 * 与普通 confirm 的区别：这里要解释「移除」和「删除文件」是两件不同的事，并让
 * 用户显式选择是否连文件一起删（默认不删 —— 存档不可恢复）。因此不用
 * useMessageBox().confirm（只支持一段文本），单独做一个带选项的对话框。
 */
export default function RemoveServerDialog({ server, running, onCancel, onConfirm }) {
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [stats, setStats] = useState(null)
  const [busy, setBusy] = useState(false)
  // 安全策略：路径过浅/盘符根/空路径时不允许删文件（防误配删掉整个分区）
  const refused = checkDeletable(server.dir)
  const canDeleteFiles = !running && !refused

  // 打开时统计目录规模：让用户在勾选前就知道要删多少东西
  useEffect(() => {
    let cancelled = false
    void measureDirectory(server.dir).then(s => { if (!cancelled) setStats(s) })
    return () => { cancelled = true }
  }, [server.dir])

  // 策略变更（切服务器）时复位勾选，避免带着旧选择
  useEffect(() => { setDeleteFiles(false) }, [server.id])

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm({ deleteFiles })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onCancel}>
      <DialogHeader onClose={busy ? undefined : onCancel}>
        <DialogTitle className="flex items-center gap-2">
          <FaIcon cls="fa-solid fa-triangle-exclamation" className="h-4 w-4 text-destructive" />
          {t('remove.title', { name: server.name })}
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('remove.intro')}</p>

        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
          {server.dir || t('remove.noDir')}
        </div>

        {stats && !refused && (
          <div className="text-xs text-muted-foreground">
            {t('remove.stats', { files: stats.files, size: formatBytes(stats.bytes) })}
            {stats.truncated && <span className="ml-1 text-destructive">（{t('delete.truncated')}）</span>}
          </div>
        )}

        <label className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors ${deleteFiles ? 'border-destructive bg-destructive/5' : 'border-border'} ${canDeleteFiles ? '' : 'cursor-not-allowed opacity-60'}`}>
          <Checkbox
            className="mt-0.5"
            checked={deleteFiles}
            disabled={!canDeleteFiles}
            onCheckedChange={v => setDeleteFiles(v === true)}
          />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t('remove.deleteFiles')}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {running ? t('remove.deleteFilesRunning') : refused || t('remove.deleteFilesHint')}
            </span>
          </span>
        </label>

        {deleteFiles && canDeleteFiles && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {t('remove.warning')}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>{t('remove.cancel')}</Button>
        <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
          <FaIcon cls="fa-solid fa-trash" className="h-4 w-4" />
          {busy ? t('remove.working') : deleteFiles && canDeleteFiles ? t('remove.confirmDelete') : t('remove.confirmRemove')}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
