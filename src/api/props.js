// server.properties 解析/序列化（无损往返：保留注释与空行顺序）。

export function parseProps(text) {
  const lines = String(text || '').split(/\r?\n/)
  return lines.map(line => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return { type: 'raw', line }
    const eq = t.indexOf('=')
    if (eq <= 0) return { type: 'raw', line }
    return { type: 'kv', key: t.slice(0, eq).trim(), value: t.slice(eq + 1).trim(), line }
  })
}

export function serializeProps(parsed) {
  return parsed.map(e => (e.type === 'kv' ? `${e.key}=${e.value}` : e.line)).join('\n')
}

export function getProp(parsed, key) {
  const e = parsed.find(e => e.type === 'kv' && e.key === key)
  return e ? e.value : undefined
}

export function setProp(parsed, key, value) {
  const str = String(value)
  for (const e of parsed) {
    if (e.type === 'kv' && e.key === key) {
      e.value = str
      return parsed
    }
  }
  parsed.push({ type: 'kv', key, value: str })
  return parsed
}

// 常用配置字段的元数据（表单渲染用）
export const COMMON_FIELDS = [
  { key: 'gamemode', label: '游戏模式', type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'] },
  { key: 'difficulty', label: '难度', type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'] },
  { key: 'max-players', label: '最大玩家数', type: 'number', min: 1, max: 1000 },
  { key: 'online-mode', label: '正版验证 (online-mode)', type: 'bool' },
  { key: 'white-list', label: '白名单', type: 'bool' },
  { key: 'pvp', label: 'PvP', type: 'bool' },
  { key: 'allow-flight', label: '允许飞行', type: 'bool' },
  { key: 'enable-command-block', label: '命令方块', type: 'bool' },
  { key: 'spawn-protection', label: '出生点保护半径', type: 'number', min: 0, max: 256 },
  { key: 'view-distance', label: '视距 (区块)', type: 'number', min: 3, max: 32 },
  { key: 'simulation-distance', label: '模拟距离 (区块)', type: 'number', min: 3, max: 32 },
  { key: 'level-type', label: '世界类型', type: 'select', options: ['normal', 'flat', 'large_biomes', 'amplified'] },
  { key: 'level-seed', label: '世界种子', type: 'text' },
  { key: 'motd', label: '服务器欢迎语 (MOTD)', type: 'text' },
  { key: 'resource-pack', label: '资源包 URL', type: 'text' },
]

export const DEFAULT_PROPS_TEXT = [
  '#Minecraft server properties',
  `#${new Date().toISOString().replace(/T.*/, ' HH:mm:ss')}`,
  'gamemode=survival',
  'difficulty=normal',
  'max-players=20',
  'online-mode=true',
  'white-list=false',
  'pvp=true',
  'allow-flight=false',
  'view-distance=10',
  'motd=A Minecraft Server',
].join('\n')
