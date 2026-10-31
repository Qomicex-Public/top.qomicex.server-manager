// Java 运行时：全部走启动器后端 /java/* 端点（callBackend）。
import { callBackend } from './bridge.js'

export async function listJavas(mode = 'quick') {
  const list = await callBackend(`/java/list?mode=${encodeURIComponent(mode)}`)
  return Array.isArray(list) ? list : []
}

/** 按 MC 版本自动推荐（1.21+→21、1.18+→17、1.17→16、1.16→11、更老→8）。 */
export async function recommendJava(minecraftVersion, gameDir) {
  return callBackend('/java/recommended', { minecraftVersion, gameDir: gameDir || '.' })
}

export async function addCustomJava(path) {
  return callBackend('/java/custom', { path })
}

export async function validateJava(path) {
  return callBackend('/java/validate', { path })
}

/** 解析服务端应使用的 Java：手动指定优先；否则按 MC 版本推荐；再回退列表第一个 Valid。 */
export async function resolveJava(server) {
  if (server.javaPath) return server.javaPath
  if (server.mcVersion) {
    try {
      const rec = await recommendJava(server.mcVersion, server.dir)
      if (rec && rec.path) return rec.path
    } catch { /* 继续回退 */ }
  }
  const list = await listJavas()
  const valid = list.filter(j => j.state === 'Valid')
  return valid.length > 0 ? valid[0].path : null
}
