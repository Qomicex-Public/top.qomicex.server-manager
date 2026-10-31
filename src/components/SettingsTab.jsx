import React, { useEffect, useState } from 'react'
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectOption } from '@qomicex/plugin-ui'
import { showToast, pickFile } from '../api/bridge.js'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'
import { listJavas, recommendJava, addCustomJava, validateJava } from '../api/java.js'
import { detectServer, guessMcVersion } from '../api/server.js'

export default function SettingsTab({ server, onSave }) {
  const [draft, setDraft] = useState(server)
  const [javas, setJavas] = useState(null)
  const [customPath, setCustomPath] = useState('')
  const [testing, setTesting] = useState(false)
  const [jarCandidates, setJarCandidates] = useState(null)

  useEffect(() => { setDraft(server) }, [server])

  const loadJavas = async () => {
    try { setJavas(await listJavas()) } catch (e) { setJavas([]); showToast(t('whitelist.addFailed', { msg: e.message }), 'error') }
  }
  useEffect(() => { void loadJavas() }, [])

  const set = (patch) => setDraft(prev => ({ ...prev, ...patch }))

  const autoDetect = async () => {
    try {
      const d = await detectServer(draft.dir)
      setJarCandidates(d.candidates.length ? d.candidates : null)
      if (d.jar) set({ jar: d.jar })
      const guess = guessMcVersion(d.jar || draft.dir)
      if (guess && !draft.mcVersion) set({ mcVersion: guess })
      showToast(t('settings.jarDetected', { n: d.candidates.length, jar: d.jar || '—' }), 'info')
    } catch (e) {
      showToast(t('whitelist.addFailed', { msg: e.message }), 'error')
    }
  }

  const recommend = async () => {
    if (!draft.mcVersion) { showToast(t('settings.mcVersionPlaceholder'), 'error'); return }
    try {
      const rec = await recommendJava(draft.mcVersion, draft.dir)
      if (rec && rec.path) {
        set({ javaPath: rec.path })
        showToast(t('settings.javaValid', { name: rec.name || rec.path, major: rec.majorVersion }), 'success')
      } else showToast(t('toast.noJava'), 'error')
    } catch (e) { showToast(t('whitelist.addFailed', { msg: e.message }), 'error') }
  }

  const addCustom = async () => {
    if (!customPath.trim()) return
    try {
      await addCustomJava(customPath.trim())
      showToast(t('toast.saved'), 'success')
      await loadJavas()
      set({ javaPath: customPath.trim() })
    } catch (e) { showToast(t('whitelist.addFailed', { msg: e.message }), 'error') }
  }

  const browseJava = async () => {
    const p = await pickFile({ title: t('settings.javaPathPlaceholder'), filters: [{ name: 'Java', extensions: ['exe'] }] })
    if (p) setCustomPath(p)
  }

  const testValidate = async () => {
    const path = draft.javaPath
    if (!path) { showToast(t('settings.javaAuto'), 'info'); return }
    setTesting(true)
    try {
      const r = await validateJava(path)
      if (r && r.state === 'Valid') showToast(t('settings.javaValid', { name: r.name, major: r.majorVersion }), 'success')
      else showToast(t('whitelist.addFailed', { msg: r ? r.state : 'invalid path' }), 'error')
    } catch (e) { showToast(t('whitelist.addFailed', { msg: e.message }), 'error') }
    finally { setTesting(false) }
  }

  const save = () => { onSave(draft); showToast(t('toast.saved'), 'success') }

  return (
    <div className="max-w-[980px] space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">{t('tab.settings')}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-4 gap-y-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.name')}</Label>
              <Input value={draft.name} onChange={e => set({ name: e.target.value })} />
            </div>
            <div className="col-span-full flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.dir')}</Label>
              <Input value={draft.dir} onChange={e => set({ dir: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.jar')}</Label>
              <Input value={draft.jar} onChange={e => set({ jar: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.redetect')}</Label>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void autoDetect()}>
                  <FaIcon cls="fa-solid fa-rotate" className="h-3.5 w-3.5" />
                  {t('settings.redetect')}
                </Button>
              </div>
              {jarCandidates && (
                <Select value={draft.jar} onChange={v => set({ jar: v })}>
                  {jarCandidates.map(c => <SelectOption key={c.path} value={c.name}>{c.name}（{(c.size / 1048576).toFixed(1)} MB）</SelectOption>)}
                </Select>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.mcVersion')}</Label>
              <Input placeholder={t('settings.mcVersionPlaceholder')} value={draft.mcVersion} onChange={e => set({ mcVersion: e.target.value })} />
            </div>
            <div className="col-span-full flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.java')}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[280px] flex-1">
                  <Select value={draft.javaPath || ''} onChange={v => set({ javaPath: v || null })}>
                    <SelectOption value="">{t('settings.javaAuto')}</SelectOption>
                    {(javas || []).map(j => (
                      <SelectOption key={j.path} value={j.path}>{j.name} — Java {j.majorVersion}</SelectOption>
                    ))}
                  </Select>
                </div>
                <Button size="sm" variant="outline" onClick={() => void recommend()}>{t('settings.javaRecommend')}</Button>
                <Button size="sm" variant="outline" disabled={testing} onClick={() => void testValidate()}>{testing ? t('settings.javaValidating') : t('settings.javaValidate')}</Button>
              </div>
            </div>
            <div className="col-span-full flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.javaAddCustom')}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[280px] flex-1">
                  <Input placeholder={t('settings.javaPathPlaceholder')} value={customPath} onChange={e => setCustomPath(e.target.value)} />
                </div>
                <Button size="sm" variant="outline" onClick={() => void browseJava()}>{t('settings.browse')}</Button>
                <Button size="sm" variant="outline" onClick={() => void addCustom()}>{t('settings.add')}</Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.xmx')}</Label>
              <Input type="number" min={512} step={512} value={draft.xmxMb} onChange={e => set({ xmxMb: Number(e.target.value) || 0 })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.xms')}</Label>
              <Input type="number" min={0} step={512} value={draft.xmsMb} onChange={e => set({ xmsMb: Number(e.target.value) || 0 })} />
            </div>
            <div className="col-span-full flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.jvmArgs')}</Label>
              <Input placeholder={t('settings.jvmArgsPlaceholder')} value={draft.jvmArgs} onChange={e => set({ jvmArgs: e.target.value })} />
            </div>
            <div className="col-span-full flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('settings.serverArgs')}</Label>
              <Input value={draft.serverArgs} onChange={e => set({ serverArgs: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={save}>
          <FaIcon cls="fa-solid fa-floppy-disk" className="h-4 w-4" />
          {t('settings.save')}
        </Button>
      </div>
    </div>
  )
}
