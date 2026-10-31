// 插件运行时 i18n：三源回退（当前 locale 包 → 默认包 → key 原文）。
// 生态机制：字符串包来自插件自带的 l10n/ 目录（manifest "l10n": "l10n"），
// 启动器切语言时广播 plugin:locale-changed（沙箱桥派发），这里重拉并通知重渲染。
import { useEffect, useState } from 'react'
import { getApi, getPluginStrings, getLocale, log } from './api/bridge.js'

let strings = {}
let locale = ''
let ready = false
const listeners = new Set()

function notify() { for (const fn of listeners) { try { fn() } catch { /* listener error */ } } }

/** 拉取（或重拉）字符串包与 locale。启动、语言切换广播时调用。 */
export async function reloadStrings() {
  try {
    const [s, l] = await Promise.all([getPluginStrings(), getLocale()])
    strings = s || {}
    locale = l || ''
    ready = true
  } catch (e) {
    log(`l10n 加载失败（按 key 原文显示）: ${e.message}`)
  }
  notify()
}

/** 翻译：t('console.search') → 词条；{n} 占位替换。缺 key 回退 key 本身（可诊断）。 */
export function t(key, params) {
  let val = strings[key]
  if (val == null) return key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = String(val).replaceAll(`{${k}}`, String(v))
    }
  }
  return val
}

export function getLocaleCode() { return locale }
export function isI18nReady() { return ready }

// 订阅（useT 用）
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// 启动即拉 + 监听语言切换广播（iframe 桥派发的 CustomEvent；inline 渲染同 window 同样派发）
void reloadStrings()
window.addEventListener('plugin:locale-changed', () => { void reloadStrings() })

/** React hook：t 函数 + 就绪状态；语言切换自动重渲染。 */
export function useT() {
  const [, force] = useState(0)
  useEffect(() => subscribe(() => force(n => n + 1)), [])
  return { t, locale, ready }
}

// 供 console 排障
if (typeof window !== 'undefined' && getApi()) {
  window.__sm_t = t
}
