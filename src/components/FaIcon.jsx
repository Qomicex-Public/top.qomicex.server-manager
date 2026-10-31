// 内置图标（Font Awesome 类名 → SVG path）经桥获取，内联 <svg> 渲染：
// currentColor 跟随主题色，不引入图标字体。类名清单 = 启动器 BuiltinIcons。
import React, { useEffect, useState } from 'react'
import { call } from '../api/bridge.js'

const cache = new Map()

async function fetchSvg(cls) {
  if (cache.has(cls)) return cache.get(cls)
  const svg = await call('getIconSvg', cls).catch(() => null)
  cache.set(cls, svg)
  return svg
}

/** fa 类名图标：<FaIcon cls="fa-solid fa-server" className="h-4 w-4" />。
 * 解析前渲染占位 span（同尺寸，不跳动）。 */
export default function FaIcon({ cls, className = 'h-4 w-4' }) {
  const [svg, setSvg] = useState(() => cache.get(cls) ?? null)
  useEffect(() => {
    if (svg) return
    let cancelled = false
    void fetchSvg(cls).then(s => { if (!cancelled && s) setSvg(s) })
    return () => { cancelled = true }
  }, [cls, svg])
  if (!svg) return <span className={className} aria-hidden="true" />
  return (
    <svg viewBox={`0 0 ${svg.width} ${svg.height}`} fill="currentColor" className={className} aria-hidden="true">
      <path d={svg.path} />
    </svg>
  )
}
