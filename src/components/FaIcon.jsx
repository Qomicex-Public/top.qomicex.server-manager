// 内置图标统一入口。
//
// 用 `<Glyph icon={XxxIcon}>` + 单图标子路径导入：图标数据随组件库静态打包，
// 同步渲染、零 IPC，且打包器只收真正用到的 path（实测 28 个图标 ≈ 0 条冗余）。
//
// 早期版本走 `getIconSvg` 桥调用（每图标一次异步往返），且解析失败时渲染同尺寸
// 空 span —— 类名不在启动器内置表时界面上就是「有图标位置但没图标」且无报错
// （issue #300）。现在：
//   - 图标名在编译期已知 → <FaIcon cls="fa-solid fa-server" />（本文件别名，静态导入）
//   - 图标名来自运行期数据 → <Icon name={...}>（动态查表，会拖入整表，少用）
import React from 'react'
import { Glyph } from '@qomicex/plugin-ui'

// —— 单图标静态导入（tree-shake 友好）——
import { ServerIcon } from '@qomicex/plugin-ui/icons/server'
import { PlayIcon } from '@qomicex/plugin-ui/icons/play'
import { StopIcon } from '@qomicex/plugin-ui/icons/stop'
import { PlusIcon } from '@qomicex/plugin-ui/icons/plus'
import { XmarkIcon } from '@qomicex/plugin-ui/icons/xmark'
import { TrashIcon } from '@qomicex/plugin-ui/icons/trash'
import { SaveIcon } from '@qomicex/plugin-ui/icons/save'
import { FolderOpenIcon } from '@qomicex/plugin-ui/icons/folder-open'
import { TerminalIcon } from '@qomicex/plugin-ui/icons/terminal'
import { GearIcon } from '@qomicex/plugin-ui/icons/gear'
import { ListUlIcon } from '@qomicex/plugin-ui/icons/list-ul'
import { PaperPlaneIcon } from '@qomicex/plugin-ui/icons/paper-plane'
import { PowerOffIcon } from '@qomicex/plugin-ui/icons/power-off'
import { RotateRightIcon } from '@qomicex/plugin-ui/icons/rotate-right'
import { FileLinesIcon } from '@qomicex/plugin-ui/icons/file-lines'
import { BoxIcon } from '@qomicex/plugin-ui/icons/box'
import { LinkIcon } from '@qomicex/plugin-ui/icons/link'
import { BoltIcon } from '@qomicex/plugin-ui/icons/bolt'
import { DownloadIcon } from '@qomicex/plugin-ui/icons/download'
import { CheckIcon } from '@qomicex/plugin-ui/icons/check'
import { ExternalLinkAltIcon } from '@qomicex/plugin-ui/icons/external-link-alt'
import { MagnifyingGlassIcon } from '@qomicex/plugin-ui/icons/magnifying-glass'
import { PenToSquareIcon } from '@qomicex/plugin-ui/icons/pen-to-square'
import { ChevronUpIcon } from '@qomicex/plugin-ui/icons/chevron-up'
import { WandMagicSparklesIcon } from '@qomicex/plugin-ui/icons/wand-magic-sparkles'
import { CircleCheckIcon } from '@qomicex/plugin-ui/icons/circle-check'
import { SpinnerIcon } from '@qomicex/plugin-ui/icons/spinner'

/** 类名 → 静态字形。新增图标请同时在此登记（未登记会在 lint 阶段被抓到）。 */
const GLYPHS = {
  'fa-solid fa-server': ServerIcon,
  'fa-solid fa-play': PlayIcon,
  'fa-solid fa-stop': StopIcon,
  'fa-solid fa-plus': PlusIcon,
  'fa-solid fa-xmark': XmarkIcon,
  'fa-solid fa-trash': TrashIcon,
  'fa-solid fa-save': SaveIcon,
  'fa-solid fa-folder-open': FolderOpenIcon,
  'fa-solid fa-terminal': TerminalIcon,
  'fa-solid fa-gear': GearIcon,
  'fa-solid fa-list-ul': ListUlIcon,
  'fa-solid fa-paper-plane': PaperPlaneIcon,
  'fa-solid fa-power-off': PowerOffIcon,
  'fa-solid fa-rotate-right': RotateRightIcon,
  'fa-solid fa-file-lines': FileLinesIcon,
  'fa-solid fa-box': BoxIcon,
  'fa-solid fa-link': LinkIcon,
  'fa-solid fa-bolt': BoltIcon,
  'fa-solid fa-download': DownloadIcon,
  'fa-solid fa-check': CheckIcon,
  'fa-solid fa-external-link-alt': ExternalLinkAltIcon,
  'fa-solid fa-magnifying-glass': MagnifyingGlassIcon,
  'fa-solid fa-pen-to-square': PenToSquareIcon,
  'fa-solid fa-chevron-up': ChevronUpIcon,
  'fa-solid fa-wand-magic-sparkles': WandMagicSparklesIcon,
  'fa-solid fa-circle-check': CircleCheckIcon,
  'fa-solid fa-spinner': SpinnerIcon,
}

/** 兼容旧调用点：<FaIcon cls="fa-solid fa-server" className="h-4 w-4" />。
 * 全部图标名在编译期已知，直接查本地登记表走 <Glyph>（零冗余、零 IPC）。
 * 未登记的类名由 `qomicex lint` 在打包前拦成 error，这里返回 null 只作兜底。 */
export default function FaIcon({ cls, className = 'h-4 w-4' }) {
  const glyph = GLYPHS[cls]
  return glyph ? <Glyph icon={glyph} className={className} /> : null
}
