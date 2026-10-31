import React, { useEffect, useState } from 'react'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@qomicex/plugin-ui'
import { t } from '../i18n.js'
import FaIcon from './FaIcon.jsx'

const WAIT_SECONDS = 8
const EULA_URL = 'https://aka.ms/MinecraftEULA'

// issue #295：EULA 确认流程 —— 展示协议要求、跳转协议网站、倒计时后才可同意。
export default function EulaGate({ serverName, onAgree, onCancel }) {
  const [left, setLeft] = useState(WAIT_SECONDS)

  useEffect(() => {
    const timer = setInterval(() => setLeft(v => (v <= 1 ? 0 : v - 1)), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <Dialog open>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FaIcon cls="fa-solid fa-file-contract" className="h-4 w-4 text-primary" />
          {t('eula.title')}
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3 text-sm">
        <p>{t('eula.text1', { name: serverName })}</p>
        <p className="text-center">
          <Button variant="outline" onClick={() => void import('../api/bridge.js').then(m => m.openUrl(EULA_URL))}>
            <FaIcon cls="fa-solid fa-arrow-up-right-from-square" className="h-4 w-4" />
            {t('eula.open')}
          </Button>
        </p>
        <p className="text-center text-xs text-muted-foreground">{t('eula.text2')}</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{t('eula.cancel')}</Button>
        <Button disabled={left > 0} onClick={onAgree} title={left > 0 ? t('eula.agreeWaiting', { n: left }) : t('eula.agree')}>
          <FaIcon cls="fa-solid fa-check" className="h-4 w-4" />
          {left > 0 ? t('eula.agreeWaiting', { n: left }) : t('eula.agree')}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
