import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' 必须设置：插件在 srcdoc 沙箱里以包内相对路径加载产物，
// 绝对路径会被解析为后端文件服务根，导致白屏。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
