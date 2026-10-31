import React, { useEffect, useState } from 'react'
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@qomicex/plugin-ui'
import { readText, writeText, showToast, proxyFetch, getCache, setCache } from '../api/bridge.js'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'
import { serverFilePath } from '../api/server.js'

// 白名单管理：whitelist.json 编辑 + 按玩家名经 Mojang API 查 UUID。
// 正版服可直接使用；离线服（online-mode=false）的 UUID 是离线算法，
// Mojang 查询结果不可用 —— 此场景请手填 UUID（高级模式）。
export default function WhitelistEditor({ server }) {
  const [list, setList] = useState(null) // null=加载中, []=空
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [manualUuid, setManualUuid] = useState('')
  const [manualName, setManualName] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [dirty, setDirty] = useState(false)

  const path = serverFilePath(server, 'whitelist.json')

  useEffect(() => {
    let cancelled = false
    setList(null); setDirty(false)
    ;(async () => {
      try {
        const { content } = await readText(path)
        if (cancelled) return
        try { setList(JSON.parse(content) || []) } catch { setList([]) }
      } catch {
        if (!cancelled) setList([])
      }
    })()
    return () => { cancelled = true }
  }, [path])

  const lookupUuid = async (playerName) => {
    const cacheKey = `mojang-uuid-${playerName.toLowerCase()}`
    const cached = await getCache(cacheKey).catch(() => null)
    if (cached) return cached
    const res = await proxyFetch({ url: `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(playerName)}`, timeoutMs: 15000 })
    if (res.status === 200) {
      const data = JSON.parse(res.body)
      const uuid = data.id
      await setCache(cacheKey, uuid, 86400).catch(() => {})
      return uuid
    }
    if (res.status === 204 || res.status === 404) throw new Error(t('whitelist.notFound'))
    throw new Error(`Mojang API ${res.status}`)
  }

  const dashUuid = (id) => {
    const s = String(id).replace(/-/g, '')
    return s.length === 32
      ? `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`.toLowerCase()
      : id
  }

  const add = async (e) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    setAdding(true)
    try {
      const uuid = await lookupUuid(n)
      if (list.some(p => p.uuid === dashUuid(uuid))) {
        showToast(t('whitelist.title'), 'info')
      } else {
        setList(prev => [...prev, { name: n, uuid: dashUuid(uuid) }])
        setDirty(true)
      }
      setName('')
    } catch (err) {
      showToast(t('whitelist.addFailed', { msg: err.message }), 'error')
    } finally {
      setAdding(false)
    }
  }

  const addManual = (e) => {
    e.preventDefault()
    const n = manualName.trim()
    const u = manualUuid.trim()
    if (!n || !u) return
    setList(prev => [...prev, { name: n, uuid: u }])
    setManualName(''); setManualUuid('')
    setDirty(true)
  }

  const save = async () => {
    try {
      await writeText(path, JSON.stringify(list, null, 2) + '\n')
      setDirty(false)
      showToast(t('whitelist.saved'), 'success')
    } catch (e) {
      showToast(t('whitelist.addFailed', { msg: e.message }), 'error')
    }
  }

  if (list === null) return <Card><CardContent className="py-4 text-muted-foreground">{t('config.reading')}</CardContent></Card>

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">{t('whitelist.title')}</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowManual(v => !v)}>
            {showManual ? <FaIcon cls="fa-solid fa-chevron-up" className="h-3.5 w-3.5" /> : <FaIcon cls="fa-solid fa-keyboard" className="h-3.5 w-3.5" />}
            {showManual ? t('whitelist.manualHide') : t('whitelist.manual')}
          </Button>
          <Button size="sm" disabled={!dirty} onClick={() => void save()}>
            <FaIcon cls="fa-solid fa-floppy-disk" className="h-3.5 w-3.5" />
            {t('whitelist.save')}{dirty ? ' *' : ''}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.length === 0 && <div className="text-xs text-muted-foreground">{t('whitelist.empty')}</div>}
        <div className="space-y-1">
          {list.map((p, i) => (
            <div key={`${p.uuid}-${i}`} className="flex items-center gap-2.5 rounded-md bg-background px-2 py-1.5">
              <span className="min-w-[120px] font-semibold">{p.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{p.uuid}</span>
              <Button size="sm" variant="ghost" onClick={() => { setList(prev => prev.filter((_, j) => j !== i)); setDirty(true) }}>
                <FaIcon cls="fa-solid fa-xmark" className="h-3.5 w-3.5" />
                {t('whitelist.remove')}
              </Button>
            </div>
          ))}
        </div>
        <form className="flex gap-2" onSubmit={add}>
          <div className="max-w-[240px] flex-1">
            <Input placeholder={t('whitelist.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <Button size="sm" type="submit" variant="outline" disabled={adding || !name.trim()}>
            <FaIcon cls="fa-solid fa-magnifying-glass" className="h-3.5 w-3.5" />
            {adding ? t('whitelist.adding') : t('whitelist.add')}
          </Button>
        </form>
        {showManual && (
          <form className="flex flex-wrap gap-2" onSubmit={addManual}>
            <div className="w-[200px]">
              <Input placeholder={t('whitelist.manualName')} value={manualName} onChange={e => setManualName(e.target.value)} />
            </div>
            <div className="max-w-[320px] flex-1">
              <Input className="font-mono" placeholder={t('whitelist.manualUuid')} value={manualUuid} onChange={e => setManualUuid(e.target.value)} />
            </div>
            <Button size="sm" type="submit" variant="outline" disabled={!manualName.trim() || !manualUuid.trim()}>
              <FaIcon cls="fa-solid fa-plus" className="h-3.5 w-3.5" />
              {t('whitelist.manualAdd')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
