import React, { useEffect, useState } from 'react'
import { Badge, Button, Tabs, useMessageBox } from '@qomicex/plugin-ui'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'
import ConsoleView from './ConsoleView.jsx'
import ConfigTab from './ConfigTab.jsx'
import SettingsTab from './SettingsTab.jsx'
import { readEulaState, serverFilePath } from '../api/server.js'
import { readText } from '../api/bridge.js'

const TAB_ICONS = {
  console: <FaIcon cls="fa-solid fa-terminal" className="h-3.5 w-3.5" />,
  config: <FaIcon cls="fa-solid fa-list-ul" className="h-3.5 w-3.5" />,
  settings: <FaIcon cls="fa-solid fa-gear" className="h-3.5 w-3.5" />,
}

export default function ServerDetail({ server, runtime, logs, onClearLogs, onStart, onStop, onRestart, onCommand, onSave, onOpenFolder, onDelete, onDirtyChange }) {
  const [tab, setTab] = useState('console')
  const [eulaState, setEulaState] = useState('unknown')
  const [eulaText, setEulaText] = useState('')
  // 各标签页自身的未保存状态（由子组件通过 onDirty 上报）
  const [tabDirty, setTabDirty] = useState({})
  const { confirm } = useMessageBox()

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

  const markDirty = React.useCallback((tabId, dirty) => {
    setTabDirty(prev => {
      if (!!prev[tabId] === !!dirty) return prev
      const next = { ...prev, [tabId]: !!dirty }
      if (!dirty) delete next[tabId]
      return next
    })
    onDirtyChange?.(tabId, dirty)
  }, [onDirtyChange])

  const dirtyTabsCount = Object.values(tabDirty).filter(Boolean).length
  const anyDirty = dirtyTabsCount > 0

  const statusKey = { running: 'detail.running', starting: 'detail.starting', stopping: 'detail.stopping' }[runtime.status] || 'detail.stopped'
  const eulaKey = { accepted: 'detail.eulaAccepted', rejected: 'detail.eulaRejected', missing: 'detail.eulaMissing', unknown: 'detail.eulaReading' }[eulaState]
  const isRunning = runtime.status === 'running' || runtime.status === 'starting'

  const forceKill = async () => {
    const ok = await confirm(t('detail.forceKillConfirm'), t('detail.forceKill'))
    if (ok) onStop(true)
  }

  // 确认交给上层统一的 RemoveServerDialog（含「同时删除文件」选项与本路径不可恢复警告）
  const removeServer = () => onDelete()

  return (
    <div className="flex h-full flex-col overflow-hidden px-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-1 pt-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <FaIcon cls="fa-solid fa-server" className="h-5 w-5 text-primary" />
          <span className="truncate text-[17px] font-bold">{server.name || t('list.unnamed')}</span>
          <Badge
            variant={runtime.status === 'running' ? 'default' : 'outline'}
            className="shrink-0 px-2.5 py-px text-xs font-normal"
          >
            {t(statusKey)}{runtime.pid ? ` · PID ${runtime.pid}` : ''}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {isRunning ? (
            <>
              <Button variant="outline" onClick={() => onStop(false)}>
                <FaIcon cls="fa-solid fa-stop" className="h-4 w-4" />
                {t('detail.stop')}
              </Button>
              <Button variant="destructive" title={t('detail.forceKillTip')} onClick={() => void forceKill()}>
                <FaIcon cls="fa-solid fa-power-off" className="h-4 w-4" />
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
          <Button variant="ghost" onClick={() => void removeServer()}>
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
          { id: 'console', label: t('tab.console'), icon: TAB_ICONS.console },
          { id: 'config', label: t('tab.config'), icon: TAB_ICONS.config },
          { id: 'settings', label: t('tab.settings'), icon: TAB_ICONS.settings },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {/* 未保存提示必须显眼：改动只在内存里，切页/切服/关窗口都会丢，后端文件没变 */}
      {anyDirty && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <FaIcon cls="fa-solid fa-triangle-exclamation" className="h-3.5 w-3.5" />
          <span className="font-medium">{t('unsaved.banner')}</span>
          <span className="text-muted-foreground">{t('unsaved.bannerHint')}</span>
        </div>
      )}
      <div className="mb-3 mt-2 h-px bg-border" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {tab === 'console' && (
          <ConsoleView server={server} runtime={runtime} logs={logs} onClearLogs={onClearLogs} onCommand={onCommand} />
        )}
        {tab === 'config' && <ConfigTab server={server} onDirty={dirty => markDirty('config', dirty)} />}
        {tab === 'settings' && <SettingsTab server={server} onSave={onSave} onDirty={dirty => markDirty('settings', dirty)} />}
      </div>
    </div>
  )
}
