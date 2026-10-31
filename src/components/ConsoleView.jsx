import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input } from '@qomicex/plugin-ui'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'

// Minecraft 日志行等级解析（[thread/LEVEL] 格式）
function lineClass(line) {
  const m = /\[(?:[^/\]]*\/)?(ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\]/.exec(line)
  if (!m) return ''
  switch (m[1]) {
    case 'ERROR': case 'FATAL': return 'log-err'
    case 'WARN': return 'log-warn'
    case 'DEBUG': case 'TRACE': return 'log-dim'
    default: return ''
  }
}

const LEVELS = [['all', 'console.level.all'], ['info', 'console.level.info'], ['warn', 'console.level.warn'], ['error', 'console.level.error']]

export default function ConsoleView({ server, runtime, logs, onClearLogs, onCommand }) {
  const [search, setSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [levelFilter, setLevelFilter] = useState('all') // all | info | warn | error
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const boxRef = useRef(null)

  // 行等级：Minecraft 日志 [thread/LEVEL] / stderr 视为 ERROR
  const lineLevel = (l) => {
    if (l.stream === 'err') return 'error'
    const m = /\[(?:[^/\]]*\/)?(ERROR|FATAL|WARN|INFO|DEBUG|TRACE)\]/.exec(l.text)
    if (!m) return 'info'
    const lv = m[1]
    if (lv === 'ERROR' || lv === 'FATAL') return 'error'
    if (lv === 'WARN') return 'warn'
    return 'info'
  }

  const filtered = useMemo(() => {
    let out = logs
    if (levelFilter !== 'all') out = out.filter(l => lineLevel(l) === levelFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(l => l.text.toLowerCase().includes(q))
    }
    return out
  }, [logs, search, levelFilter])

  // Ctrl+A 仅选中控制台日志（默认浏览器行为会选中整个页面文字）
  const onKeyDownBox = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && boxRef.current) {
      e.preventDefault()
      e.stopPropagation()
      const sel = window.getSelection()
      sel.removeAllRanges()
      const range = document.createRange()
      range.selectNodeContents(boxRef.current)
      sel.addRange(range)
    }
  }

  useEffect(() => {
    if (autoScroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [filtered.length, autoScroll])

  const submit = (e) => {
    e?.preventDefault?.()
    const text = command.trim()
    if (!text) return
    if (runtime.status !== 'running') return
    onCommand(text)
    setHistory(prev => [...prev, text])
    setHistoryIdx(-1)
    setCommand('')
  }

  const onKey = (e) => {
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault()
      const idx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1)
      setHistoryIdx(idx)
      setCommand(history[idx])
    } else if (e.key === 'ArrowDown' && historyIdx >= 0) {
      e.preventDefault()
      const idx = historyIdx + 1
      if (idx >= history.length) { setHistoryIdx(-1); setCommand('') }
      else { setHistoryIdx(idx); setCommand(history[idx]) }
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <div className="w-56">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('console.search')} />
        </div>
        <div className="flex gap-0.5">
          {LEVELS.map(([id, key]) => (
            <button
              key={id}
              type="button"
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${levelFilter === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setLevelFilter(id)}
            >
              {t(key)}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          {t('console.autoScroll')}
        </label>
        <Button size="sm" variant="ghost" onClick={onClearLogs}>{t('console.clear')}</Button>
        <span className="ml-auto text-xs text-muted-foreground">{t('console.lines', { n: filtered.length })}</span>
      </div>
      <div className={`sm-console-box min-h-0 flex-1 ${runtime.status === 'running' ? '' : 'paused'}`} ref={boxRef} onKeyDown={onKeyDownBox} tabIndex={0}>
        {filtered.length === 0 && (
          <div className="p-2 text-muted-foreground">
            {t('console.empty')} {runtime.status === 'running' ? '' : t('console.emptyHint')}
          </div>
        )}
        {filtered.map(l => (
          <div key={`${l.seq}-${l.stream}`} className={`sm-log-line ${l.stream === 'err' ? 'log-stderr' : lineClass(l.text)}`}>
            <span className="sm-log-text">{l.text}</span>
          </div>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={submit}>
        <div className="flex-1">
          <Input
            className="font-mono text-[13px]"
            placeholder={runtime.status === 'running' ? t('console.inputPlaceholder') : t('console.inputDisabled')}
            value={command}
            disabled={runtime.status !== 'running'}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <Button type="button" disabled={runtime.status !== 'running' || !command.trim()} onClick={submit}>
          <FaIcon cls="fa-solid fa-paper-plane" className="h-4 w-4" />
          {t('console.send')}
        </Button>
      </form>
    </div>
  )
}
