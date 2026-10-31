#!/usr/bin/env node
// 本地开发签名：离线生成 Ed25519 根/开发者密钥对 + 开发者证书 + 包体签名，
// 产出 build/signature.json + build/signature.cert.json（pack.ps1 会打进 .qplugin）。
//
// 字节级规范与 packages/qomicex-cli/src/lib/signature.ts / 启动器
// plugin_signature.rs 一致（ADR-050 三级信任链）：
//   payload   = canonicalJson({ manifest: sha256(manifest.json), files: [{path, sha256}] 按 path 排序 })
//   sig       = Ed25519(devKey, payload)          → signature.json
//   certBody  = canonicalJson({alg, developerId, developerName, issuedAt, keyId, publicKey})
//   certSig   = Ed25519(localRootKey, certBody)   → signature.cert.json
//
// 本地签名的包在启动器（debug 构建 + QOMICEX_DEV_ROOT_PUBLIC_KEY=<本地根公钥>）
// 下通过完整三级验证；release 构建仍只认商店根钥。
//
// 用法：node scripts/sign-local.mjs [--stage <dir>]（默认 --stage . ，即项目根）

import { generateKeyPairSync, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT_DIR = 'dev-keys'
const ROOT_SEED_FILE = join(ROOT_DIR, 'dev-root.seed')
const DEV_SEED_FILE = join(ROOT_DIR, 'dev-key.seed')
const OUT_DIR = 'build'
const ALG = 'Ed25519'
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20])

// ---------- 参数 ----------
const args = process.argv.slice(2)
const stageIdx = args.indexOf('--stage')
const STAGE = stageIdx >= 0 ? args[stageIdx + 1] : '.'

// ---------- canonicalJson（递归按键排序、无空白；与 CLI 一致） ----------
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string') return JSON.stringify(value)
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
}

// ---------- Ed25519 原语 ----------
const seedToDer = seed => {
  const der = new Uint8Array(48)
  der.set(PKCS8_PREFIX, 0)
  der.set(seed, 16)
  return der
}
const keyFromSeed = seed => createPrivateKey({ key: seedToDer(seed), format: 'der', type: 'pkcs8' })
const rawPub = privKey => {
  const spki = createPublicKey(privKey).export({ format: 'der', type: 'spki' })
  return new Uint8Array(spki.subarray(spki.length - 32))
}
const signBytes = (privKey, msg) => new Uint8Array(edSign(null, msg, privKey))
const verifyBytes = (rawPubB64, msg, sigB64) =>
  edVerify(null, msg, createPublicKey({ key: Buffer.concat([Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]), Buffer.from(rawPubB64, 'base64')]), format: 'der', type: 'spki' }), Buffer.from(sigB64, 'base64'))
const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex')

// ---------- 密钥对持久化（raw 32 字节 seed base64，同 mctiers dev-key.seed 惯例） ----------
function loadOrCreateSeed(file, label) {
  if (existsSync(file)) {
    const seed = new Uint8Array(Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'))
    if (seed.length !== 32) throw new Error(`${file} 的 seed 长度异常（${seed.length}），应为 32 字节 raw base64`)
    return seed
  }
  const { privateKey } = generateKeyPairSync('ed25519')
  const der = privateKey.export({ format: 'der', type: 'pkcs8' })
  const seed = new Uint8Array(der.subarray(der.length - 32))
  mkdirSync(ROOT_DIR, { recursive: true })
  writeFileSync(file, Buffer.from(seed).toString('base64') + '\n', { mode: 0o600 })
  console.log(`[sign] 已生成${label}密钥: ${file}（勿入库/勿外传）`)
  return seed
}

// ---------- 收集待签文件（forward-slash 相对路径，排除签名文件本身） ----------
function collectEntries(root) {
  const entries = {}
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      const rel = relative(root, p).split(sep).join('/')
      if (rel === 'signature.json' || rel === 'signature.cert.json') continue
      entries[rel] = new Uint8Array(readFileSync(p))
    }
  }
  walk(root)
  if (!entries['manifest.json']) throw new Error('stage 目录缺少 manifest.json')
  return entries
}

// ---------- 主流程 ----------
const rootSeed = loadOrCreateSeed(ROOT_SEED_FILE, '本地根')
const devSeed = loadOrCreateSeed(DEV_SEED_FILE, '开发者')
const rootKey = keyFromSeed(rootSeed)
const devKey = keyFromSeed(devSeed)
const rootPubB64 = Buffer.from(rawPub(rootKey)).toString('base64')
const devPubB64 = Buffer.from(rawPub(devKey)).toString('base64')
const keyId = `ed25519:${devPubB64.slice(0, 8)}`

// 包体签名载荷：manifest.json 同时出现在 files 列表和顶层 manifest 键（与
// CLI signedPayloadBytes / 启动器 canonical_payload 一致——只排除两个签名文件）
const entries = collectEntries(STAGE)
const files = Object.keys(entries)
  .sort()
  .map(p => ({ path: p, sha256: sha256Hex(entries[p]) }))
const payload = canonicalJson({ manifest: sha256Hex(entries['manifest.json']), files })
const payloadBytes = new TextEncoder().encode(payload)
const signedHash = sha256Hex(payloadBytes)
const packageSig = Buffer.from(signBytes(devKey, payloadBytes)).toString('base64')

// 证书（本地根钥签发开发者证书 —— 与商店根钥签发的结构完全一致）
const certBody = canonicalJson({
  alg: ALG,
  keyId,
  developerId: 'local-dev',
  developerName: 'local-dev',
  publicKey: devPubB64,
  issuedAt: new Date().toISOString(),
})
const cert = {
  alg: ALG,
  keyId,
  developerId: 'local-dev',
  developerName: 'local-dev',
  publicKey: devPubB64,
  issuedAt: JSON.parse(certBody).issuedAt,
  signature: Buffer.from(signBytes(rootKey, new TextEncoder().encode(certBody))).toString('base64'),
}

// ---------- 自验（本地根钥走完整链路） ----------
const certOk = verifyBytes(rootPubB64, new TextEncoder().encode(certBody), cert.signature)
const sigOk = verifyBytes(devPubB64, payloadBytes, packageSig)
if (!certOk || !sigOk) {
  console.error('[sign] 自验失败（证书或包体签名不符），拒绝写出')
  process.exit(1)
}

const sigJson = JSON.stringify({ alg: ALG, signedHash, signerKeyId: keyId, signature: packageSig })
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'signature.json'), sigJson)
writeFileSync(join(OUT_DIR, 'signature.cert.json'), JSON.stringify(cert))

console.log('[sign] ✔ 自验通过，已写出 build/signature.json + build/signature.cert.json')
console.log(`[sign] 本地根公钥（raw base64）: ${rootPubB64}`)
console.log('[sign] 启动器（debug 构建）需设置环境变量后重启后端：')
console.log(`[sign]   set QOMICEX_DEV_ROOT_PUBLIC_KEY=${rootPubB64}`)
