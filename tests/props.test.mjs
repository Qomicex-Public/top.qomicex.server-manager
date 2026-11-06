// server.properties 解析器纯函数测试：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProps, serializeProps, getProp, setProp } from '../src/api/props.js'
import { guessMcVersion, parseStartScript, startPatch } from '../src/api/server.js'

test('parseProps 识别 kv / 注释 / 空行并保序', () => {
  const text = [
    '#Minecraft server properties',
    '#Mon Jan 01 00:00:00 UTC 2026',
    'gamemode=survival',
    '',
    'motd=A Minecraft Server',
    'weird line no equals',
  ].join('\n')
  const parsed = parseProps(text)
  assert.equal(parsed.length, 6)
  assert.equal(parsed[0].type, 'raw')
  assert.equal(parsed[2].type, 'kv')
  assert.equal(parsed[2].key, 'gamemode')
  assert.equal(parsed[2].value, 'survival')
  assert.equal(parsed[4].value, 'A Minecraft Server')
  assert.equal(parsed[5].type, 'raw')
})

test('serializeProps 无损往返（kv 重写、raw 保留）', () => {
  const text = '#header\nenable-rcon=false\nview-distance=10\n\nmax-players=20\n'
  const parsed = parseProps(text)
  setProp(parsed, 'view-distance', '12')
  const out = serializeProps(parsed)
  assert.ok(out.includes('#header'))
  assert.ok(out.includes('view-distance=12'))
  assert.ok(!out.includes('view-distance=10'))
  assert.ok(out.includes('max-players=20'))
  // 二次解析再序列化应稳定
  assert.equal(serializeProps(parseProps(out)), out)
})

test('setProp 更新已有键并新增缺失键', () => {
  const parsed = parseProps('difficulty=normal')
  setProp(parsed, 'difficulty', 'hard')
  assert.equal(getProp(parsed, 'difficulty'), 'hard')
  assert.equal(parsed.length, 1)
  setProp(parsed, 'white-list', 'true')
  assert.equal(getProp(parsed, 'white-list'), 'true')
  assert.equal(parsed.length, 2)
})

test('getProp 缺失键返回 undefined', () => {
  const parsed = parseProps('gamemode=survival')
  assert.equal(getProp(parsed, 'pvp'), undefined)
})

test('值中的等号与井号不被破坏', () => {
  const parsed = parseProps('motd=a=b # not comment')
  assert.equal(parsed[0].type, 'kv')
  assert.equal(parsed[0].value, 'a=b # not comment')
})

test('CRLF 兼容', () => {
  const parsed = parseProps('gamemode=survival\r\nmotd=hi\r\n')
  assert.equal(parsed[0].value, 'survival')
  assert.equal(serializeProps(parsed).split('\n').length, 3)
})

test('guessMcVersion 从 jar/目录名提取版本', () => {
  assert.equal(guessMcVersion('paper-1.21.4-236.jar'), '1.21.4')
  assert.equal(guessMcVersion('server-1.20.1.zip'), '1.20.1')
  assert.equal(guessMcVersion('fabric-server-mc.1.21-launch.0.115.jar'), '1.21')
  assert.equal(guessMcVersion('no-version-here.jar'), '')
  assert.equal(guessMcVersion('MyServer 1.19.2'), '1.19.2')
})

test('parseStartScript 解析 GTNH 启动脚本（jar + 内存 + JVM 参数）', () => {
  const sh = [
    '#!/bin/bash',
    'cd "$(dirname "$0")"',
    'java -Xms6G -Xmx6G -XX:+UseG1GC -Dfile.encoding=UTF-8 -jar minecraft_server.1.7.10.jar nogui',
  ].join('\n')
  const s = parseStartScript(sh)
  assert.equal(s.jar, 'minecraft_server.1.7.10.jar')
  assert.equal(s.xmsMb, 6144)
  assert.equal(s.xmxMb, 6144)
  assert.equal(s.jvmArgs, '-XX:+UseG1GC -Dfile.encoding=UTF-8')
  assert.equal(s.serverArgs, 'nogui')
})

test('parseStartScript 处理引号路径与参数透传占位', () => {
  const bat = 'java -Xmx2048M -jar "server jar.jar" --nogui %*'
  const s = parseStartScript(bat)
  assert.equal(s.jar, 'server jar.jar')
  assert.equal(s.xmxMb, 2048)
  assert.equal(s.serverArgs, '--nogui')
})

test('parseStartScript 忽略注释行与非 java 行', () => {
  const sh = '# java -Xmx1G -jar wrong.jar\necho starting\nexec java -Xms512M -jar a.jar'
  const s = parseStartScript(sh)
  assert.equal(s.jar, 'a.jar')
  assert.equal(s.xmsMb, 512)
  assert.equal(s.xmxMb, null)
})

test('parseStartScript 不识别 @argfile 形式（返回 null 交给 jar 启发式）', () => {
  assert.equal(parseStartScript('java @libraries/net/forge/win_args.txt nogui'), null)
  assert.equal(parseStartScript(''), null)
  assert.equal(parseStartScript(null), null)
})

test('startPatch 只带非空字段', () => {
  assert.deepEqual(startPatch(null), {})
  assert.deepEqual(
    startPatch({ jar: 'a.jar', xmsMb: null, xmxMb: 6144, jvmArgs: '', serverArgs: 'nogui' }),
    { jar: 'a.jar', xmxMb: 6144, serverArgs: 'nogui' },
  )
})
