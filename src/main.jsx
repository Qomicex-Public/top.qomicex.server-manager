import React from 'react'
import { createRoot } from 'react-dom/client'
import { MessageBoxProvider } from '@qomicex/plugin-ui'
import App from './App.jsx'
import { t, subscribe, isI18nReady, reloadStrings } from './i18n.js'
import './index.css'

// MessageBoxProvider 必须包在最外层：插件 iframe 沙箱不含 allow-modals，
// 原生 window.confirm 会被静默拦截（恒为 false），确认类交互统一走组件库弹窗。
//
// messages 跟 i18n 词条联动：词条在模块加载时异步拉取，首帧可能还没就绪，
// 所以这里订阅语言/词条变化并重算 messages（provider 按 messages 对象缓存回调）。
function Root() {
  const [stringsReady, setStringsReady] = React.useState(isI18nReady)
  React.useEffect(() => {
    const off = subscribe(() => setStringsReady(isI18nReady()))
    // 首帧时词条可能仍在路上（subscribe 晚于那次 notify），主动补一次拉取
    if (!isI18nReady()) void reloadStrings()
    return off
  }, [])

  const messages = React.useMemo(() => ({
    ok: t('dialog.ok'),
    cancel: t('dialog.cancel'),
    error: t('dialog.title.error'),
    warning: t('dialog.title.warning'),
    success: t('dialog.title.success'),
    info: t('dialog.title.info'),
    input: t('dialog.title.input'),
    inputPlaceholder: t('dialog.inputPlaceholder'),
  }), [stringsReady])

  return (
    <MessageBoxProvider messages={messages}>
      <App />
    </MessageBoxProvider>
  )
}

createRoot(document.getElementById('root')).render(<Root />)
