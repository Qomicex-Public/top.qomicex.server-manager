import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectOption, Switch, Textarea } from '@qomicex/plugin-ui'
import { readText, writeText, showToast } from '../api/bridge.js'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'
import { serverFilePath } from '../api/server.js'
import { parseProps, serializeProps, getProp, setProp, COMMON_FIELDS, DEFAULT_PROPS_TEXT } from '../api/props.js'
import WhitelistEditor from './WhitelistEditor.jsx'

export default function ConfigTab({ server, onDirty }) {
  const [parsed, setParsed] = useState(null)
  const [raw, setRaw] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // 白名单编辑器也有自己的未保存状态：两者任一脏就算脏
  const [whitelistDirty, setWhitelistDirty] = useState(false)
  const anyDirty = dirty || whitelistDirty
  // 上报给 ServerDetail：未保存改动只在内存，切页/切服就丢（后端文件没变）
  useEffect(() => { onDirty?.(anyDirty) }, [anyDirty, onDirty])
  useEffect(() => () => onDirty?.(false), [onDirty])

  const propsPath = useMemo(() => serverFilePath(server, 'server.properties'), [server.dir])

  useEffect(() => {
    let cancelled = false
    setParsed(null); setDirty(false); setError('')
    ;(async () => {
      try {
        const { content } = await readText(propsPath)
        if (cancelled) return
        setParsed(parseProps(content))
        setRaw(content)
      } catch (e) {
        if (cancelled) return
        // 首次启动前 server.properties 不存在：给默认模板（可保存生成）
        setParsed(parseProps(DEFAULT_PROPS_TEXT))
        setRaw(DEFAULT_PROPS_TEXT)
        setError(t('config.notExists'))
      }
    })()
    return () => { cancelled = true }
  }, [propsPath])

  const applyForm = (key, value) => {
    setParsed(prev => {
      const next = prev.map(e => ({ ...e }))
      setProp(next, key, value)
      setRaw(serializeProps(next))
      return next
    })
    setDirty(true)
  }

  const applyRaw = (text) => {
    setRaw(text)
    setParsed(parseProps(text))
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await writeText(propsPath, raw.endsWith('\n') ? raw : raw + '\n')
      setDirty(false)
      showToast(t('config.saved'), 'success')
    } catch (e) {
      showToast(t('config.saveFailed', { msg: e.message }), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!parsed) return <div className="py-4 text-muted-foreground">{t('config.reading')}</div>

  return (
    <div className="max-w-[980px] space-y-4">
      {error && <div className="p-alert p-alert--warn text-xs">{error}</div>}

      <Card>
        <CardHeader><CardTitle className="text-sm">{t('config.common')}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 gap-y-3">
            {COMMON_FIELDS.map(f => {
              const value = getProp(parsed, f.key)
              const missing = value === undefined
              return (
                <div key={f.key} className="flex min-w-0 flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {t(`field.${f.key}`)}{missing && <span className="ml-1 text-primary">({t('config.newField')})</span>}
                  </Label>
                  {f.type === 'select' && (
                    <Select value={value ?? f.options[0]} onChange={v => applyForm(f.key, v)}>
                      {f.options.map(o => <SelectOption key={o} value={o}>{o}</SelectOption>)}
                    </Select>
                  )}
                  {f.type === 'bool' && (
                    <div className="flex h-9 items-center">
                      <Switch checked={value === undefined ? true : value === 'true'} onCheckedChange={v => applyForm(f.key, String(v))} />
                    </div>
                  )}
                  {f.type === 'number' && (
                    <Input type="number" min={f.min} max={f.max} value={value ?? ''} onChange={e => applyForm(f.key, e.target.value)} />
                  )}
                  {f.type === 'text' && (
                    <Input value={value ?? ''} onChange={e => applyForm(f.key, e.target.value)} />
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <WhitelistEditor server={server} onDirty={setWhitelistDirty} />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">{t('config.raw')}</CardTitle>
          <div className="flex items-center gap-2">
            {anyDirty && (
              <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <FaIcon cls="fa-solid fa-circle-exclamation" className="h-3.5 w-3.5" />
                {t('unsaved.field')}
              </span>
            )}
            <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
              <FaIcon cls="fa-solid fa-save" className="h-3.5 w-3.5" />
              {saving ? t('config.saving') : t('config.save')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            className="h-64 resize-y font-mono text-[12.5px]"
            spellCheck={false}
            value={raw}
            onChange={e => applyRaw(e.target.value)}
          />
        </CardContent>
      </Card>
    </div>
  )
}
