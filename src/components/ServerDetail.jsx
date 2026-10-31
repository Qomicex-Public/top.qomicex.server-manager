import React, { useEffect, useState } from 'react'
import { Button, Tabs } from '@qomicex/plugin-ui'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'
import ConsoleView from './ConsoleView.jsx'
import ConfigTab from './ConfigTab.jsx'
import SettingsTab from './SettingsTab.jsx'
import { readEulaState, serverFilePath } from '../api/server.js'
import { readText } from '../api/bridge.js'

export default function ServerDetail({ server, runtime, logs, onClearLogs, onStart, onStop, onRestart, onCommand, onSave, onOpenFolder, onDelete }) {
  const [tab, setTab] = useState('console')
  const [eulaState, setEulaState] = useState('unknown')
  const [eulaText, setEulaText] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const state = await readEulaState(server)
      let text = ''
      if (state !== 'missing') {
        try { text = (await readText(serverFilePath(server, 'eula.txt'))).content } catch { /* ignore */ }
      }
      if (!cancelled) { setEulaState(state); setEulaText(text) }
    })()
    return () => { cancelled = true }
  }, [server.dir, runtime.status])

  const statusKey = { running: 'detail.running', starting: 'detail.starting', stopping: 'detail.stopping' }[runtime.status] || 'detail.stopped'
  const eulaKey = { accepted: 'detail.eulaAccepted', rejected: 'detail.eulaRejected', missing: 'detail.eulaMissing', unknown: 'detail.eulaReading' }[eulaState]
  const isRunning = runtime.status === 'running' || runtime.status === 'starting'

  return (
    <div className="flex h-full flex-col overflow-hidden px-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1 pt-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <FaIcon cls="fa-solid fa-server" className="h-5 w-5 text-primary" />
          <span className="truncate text-[17px] font-bold">{server.name || t('list.unnamed')}</span>
          <span className={`shrink-0 rounded-full border px-2.5 py-px text-xs ${runtime.status === 'running' ? 'border-primary text-primary' : 'text-muted-foreground'}`}>
            {t(statusKey)}{runtime.pid ? ` · PID ${runtime.pid}` : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {isRunning ? (
            <>
              <Button variant="outline" onClick={() => onStop(false)}>
                <FaIcon cls="fa-solid fa-stop" className="h-4 w-4" />
                {t('detail.stop')}
              </Button>
              <Button variant="destructive" title={t('detail.forceKillTip')} onClick={() => { if (window.confirm(t('detail.forceKillConfirm'))) onStop(true) }}>
                <FaIcon cls="fa-solid fa-skull" className="h-4 w-4" />
                {t('detail.forceKill')}
              </Button>
              <Button variant="ghost" onClick={onRestart}>
                <FaIcon cls="fa-solid fa-rotate-right" className="h-4 w-4" />
                {t('detail.restart')}
              </Button>
            </>
          ) : (
            <Button onClick={onStart}>
              <FaIcon cls="fa-solid fa-play" className="h-4 w-4" />
              {t('list.start')}
            </Button>
          )}
          <Button variant="ghost" onClick={onOpenFolder}>
            <FaIcon cls="fa-solid fa-folder-open" className="h-4 w-4" />
            {t('detail.openFolder')}
          </Button>
          <Button variant="ghost" onClick={onDelete}>
            <FaIcon cls="fa-solid fa-trash" className="h-4 w-4" />
            {t('detail.remove')}
          </Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {t(eulaKey)}
        {eulaText && <span className="opacity-70"> ({eulaText.trim()})</span>}
      </div>
      <Tabs
        className="mt-1.5"
        tabs={[
          { id: 'console', label: t('tab.console') },
          { id: 'config', label: t('tab.config') },
          { id: 'settings', label: t('tab.settings') },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      <div className="mb-3 mt-2 h-px bg-border" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {tab === 'console' && (
          <ConsoleView server={server} runtime={runtime} logs={logs} onClearLogs={onClearLogs} onCommand={onCommand} />
        )}
        {tab === 'config' && <ConfigTab server={server} />}
        {tab === 'settings' && <SettingsTab server={server} onSave={onSave} />}
      </div>
    </div>
  )
}
