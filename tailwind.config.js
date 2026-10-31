import preset from '@qomicex/plugin-ui/tailwind-preset'

// 语义色全部来自 preset（hsl(var(--*))）：iframe 沙箱注入的主题 CSS 变量变化时
// 插件 UI 自动跟随（与主界面同一套 token），不出现硬编码色值。
//
// content 必须包含 plugin-ui 的 dist：组件库自身使用的工具类（fixed / inset-0 /
// z-50 / max-w-lg 等）只出现在它的产物里，不扫描就会被 purge 掉——Dialog 会退化
// 成页面底部的普通块（本插件实测踩过）。
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
    './node_modules/@qomicex/plugin-ui/dist/**/*.js',
  ],
  presets: [preset],
}
