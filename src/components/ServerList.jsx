import React, { useState } from 'react'
import { Button, Tooltip } from '@qomicex/plugin-ui'
import { pickDirectory } from '../api/bridge.js'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'

function StatusDot({ status }) {
  const cls = { running: 'sm-dot-ok', starting: 'sm-dot-warn', stopping: 'sm-dot-warn' }[status] || 'sm-dot-muted'
  return <span className={`sm-dot ${cls}`} />
}

export default function ServerList({ servers, runtime, selectedId, root, onSelect, onImport, onChangeRoot, onStart, onStop, onDelete }) {
  const [changingRoot, setChangingRoot] = useState(false)

  const changeRoot = async () => {
    const dir = await pickDirectory({ title: t('list.changeRoot') })
    if (dir) await onChangeRoot(dir)
    setChangingRoot(false)
  }

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
                {s.mcVersion && <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[11px] text-muted-foreground">{s.mcVersion}</span>}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={s.dir}>{s.jar || s.dir}</span>
                <span className="flex shrink-0 gap-1.5" onClick={e => e.stopPropagation()}>
                  {running ? (
                    <Button size="sm" variant="destructive" onClick={() => onStop(s)}>{t('list.stop')}</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => onStart(s)}>
                      <FaIcon cls="fa-solid fa-play" className="h-3 w-3" />
                      {t('list.start')}
                    </Button>
                  )}
                  <Tooltip content={t('list.remove')}>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { if (window.confirm(t('list.removeConfirm', { name: s.name }))) onDelete(s) }}>
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
        <Button size="sm" variant="ghost" disabled={changingRoot} onClick={() => void changeRoot()}>
          <FaIcon cls="fa-solid fa-folder-tree" className="h-3.5 w-3.5" />
          {t('list.changeRoot')}
        </Button>
      </div>
    </div>
  )
}
