import React, { useState } from 'react'
import { Badge, Button, Tooltip } from '@qomicex/plugin-ui'
import { pickDirectory } from '../api/bridge.js'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'

// 状态点走插件自带 .sm-dot（基于主题 token）；启动器 .p-status-dot 自带
// margin-right 会和容器的 gap 叠加，横向间距翻倍，故不用它。
function StatusDot({ status }) {
  const cls = { running: 'sm-dot-ok', starting: 'sm-dot-warn', stopping: 'sm-dot-warn' }[status] || 'sm-dot-muted'
  return <span className={`sm-dot ${cls}`} />
}

export default function ServerList({ servers, runtime, selectedId, root, dirtyIds = [], onSelect, onImport, onChangeRoot, onStart, onStop, onDelete }) {
  const [changingRoot, setChangingRoot] = useState(false)

  const changeRoot = async () => {
    setChangingRoot(true)
    try {
      const dir = await pickDirectory({ title: t('list.changeRoot') })
      if (dir) await onChangeRoot(dir)
    } finally {
      setChangingRoot(false)
    }
  }

  // 确认交给上层统一的 RemoveServerDialog（含「同时删除文件」选项与本路径不可恢复警告）
  const removeServer = (server) => onDelete(server)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3.5 pb-2.5 pt-3.5">
        <span className="text-[15px] font-semibold">{t('list.title')}</span>
        <Button size="sm" onClick={onImport}>
          <FaIcon cls="fa-solid fa-plus" className="h-3.5 w-3.5" />
          {t('list.import')}
        </Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2.5">
        {servers.length === 0 && (
          <div className="pt-8 text-center text-sm leading-relaxed text-muted-foreground">
            {t('list.empty').split('\n').map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
        {servers.map(s => {
          const rt = runtime[s.id] || { status: 'stopped' }
          const running = rt.status === 'running'
          return (
            <div
              key={s.id}
              className={`cursor-pointer rounded-lg border bg-background px-3 py-2.5 transition-colors hover:border-primary ${selectedId === s.id ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]' : 'border-border'}`}
              onClick={() => onSelect(s.id)}
            >
              <div className="flex items-center gap-2">
                <StatusDot status={rt.status} />
                <span className="truncate font-semibold" title={s.name}>{s.name || t('list.unnamed')}</span>
                {s.mcVersion && (
                  <Badge variant="secondary" className="shrink-0 px-2 py-0 text-[11px] font-normal">
                    {s.mcVersion}
                  </Badge>
                )}
                {dirtyIds.includes(s.id) && (
                  <Badge variant="outline" className="shrink-0 px-2 py-0 text-[11px] font-normal text-amber-600 dark:text-amber-400">
                    {t('unsaved.short')}
                  </Badge>
                )}
                {s.status === 'setting-up' && (
                  <Badge variant="outline" className="shrink-0 px-2 py-0 text-[11px] font-normal text-muted-foreground">
                    {t('list.settingUp')}
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={s.dir}>{s.jar || s.dir}</span>
                <span className="flex shrink-0 gap-1.5" onClick={e => e.stopPropagation()}>
                  {running ? (
                    <Button size="sm" variant="destructive" onClick={() => onStop(s)}>
                      <FaIcon cls="fa-solid fa-stop" className="h-3 w-3" />
                      {t('list.stop')}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => onStart(s)}>
                      <FaIcon cls="fa-solid fa-play" className="h-3 w-3" />
                      {t('list.start')}
                    </Button>
                  )}
                  <Tooltip content={t('list.remove')}>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void removeServer(s)}>
                      <FaIcon cls="fa-solid fa-xmark" className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="space-y-1.5 border-t border-border p-3">
        <div className="truncate text-xs text-muted-foreground" title={root || ''}>
          {t('list.root', { path: root || '—' })}
        </div>
        <Button size="sm" variant="ghost" className="w-full justify-start" disabled={changingRoot} onClick={() => void changeRoot()}>
          <FaIcon cls="fa-solid fa-folder-open" className="h-3.5 w-3.5" />
          {changingRoot ? t('list.picking') : t('list.changeRoot')}
        </Button>
      </div>
    </div>
  )
}
