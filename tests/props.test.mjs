// server.properties 解析器纯函数测试：node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProps, serializeProps, getProp, setProp } from '../src/api/props.js'
import { guessMcVersion } from '../src/api/server.js'

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
