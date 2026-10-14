#!/usr/bin/env node
/**
 * CW Finance 注册码生成器（供应商离线工具，CommonJS 供 pkg 打包）
 */
const { readFileSync, existsSync } = require('node:fs')
const { createInterface } = require('node:readline')
const { dirname, join, resolve } = require('node:path')
const { createSign } = require('node:crypto')
const { spawnSync } = require('node:child_process')

function getAppDir() {
  if (process.pkg) {
    return dirname(process.execPath)
  }
  return __dirname
}

const DEFAULT_PRIVATE_KEY = join(getAppDir(), 'license-private.pem')

/** 与 server/src/services/licenseModules.ts 保持一致 */
const LICENSE_MODULES = [
  { key: 'gl', name: '总账' },
  { key: 'cashier', name: '出纳管理' },
  { key: 'asset', name: '固定资产' },
  { key: 'scm', name: '进销存' },
  { key: 'production', name: '生产管理' },
  { key: 'outsource', name: '委外管理' },
]
const MODULE_KEYS = LICENSE_MODULES.map(m => m.key)

function toBase64Url(input) {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function parseArgs(argv) {
  const args = { machineId: '', expires: '', modules: '', concurrent: null, privateKey: DEFAULT_PRIVATE_KEY }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--machine-id' || arg === '-m')
      args.machineId = (argv[++i] || '').trim().toUpperCase()
    else if (arg === '--expires' || arg === '-e') args.expires = (argv[++i] || '').trim()
    else if (arg === '--modules' || arg === '-M') args.modules = (argv[++i] || '').trim()
    else if (arg === '--concurrent' || arg === '-c') args.concurrent = (argv[++i] || '').trim()
    else if (arg === '--private-key' || arg === '-k') args.privateKey = resolve(argv[++i] || '')
    else if (arg === '--help' || arg === '-h') args.help = true
  }
  return args
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

function formatDateOnly(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 解析模块输入：支持 key（gl,scm）、编号（1,4）、中文名、all/* / 空（全部）。
 * 返回 { mods, names }；mods 为写入注册码的数组（全部时为 ['*']）。
 */
function parseModules(input) {
  const raw = String(input || '').trim()
  if (!raw || raw.toLowerCase() === 'all' || raw === '*') {
    return { mods: ['*'], names: LICENSE_MODULES.map(m => m.name) }
  }
  const tokens = raw.split(/[\s,，、;]+/).filter(Boolean)
  const keys = []
  for (const token of tokens) {
    const lower = token.toLowerCase()
    let key = null
    if (MODULE_KEYS.includes(lower)) key = lower
    else if (/^\d+$/.test(token)) key = MODULE_KEYS[Number(token) - 1] || null
    else {
      const byName = LICENSE_MODULES.find(m => m.name === token)
      key = byName ? byName.key : null
    }
    if (!key) throw new Error(`未知模块: ${token}`)
    if (!keys.includes(key)) keys.push(key)
  }
  if (keys.length === 0) throw new Error('至少选择一个模块')
  // 生产 / 委外依赖进销存的物料、仓库、单据体系，自动补上进销存
  let note = ''
  if ((keys.includes('production') || keys.includes('outsource')) && !keys.includes('scm')) {
    keys.push('scm')
    note = '生产/委外依赖进销存，已自动包含「进销存」模块'
  }
  const ordered = MODULE_KEYS.filter(k => keys.includes(k))
  return { mods: ordered, names: ordered.map(k => LICENSE_MODULES.find(m => m.key === k).name), note }
}

function buildLicenseCode(payload, privateKeyPem) {
  const payloadEncoded = toBase64Url(JSON.stringify(payload))
  const signer = createSign('RSA-SHA256')
  signer.update(payloadEncoded)
  signer.end()
  const signature = signer.sign(privateKeyPem).toString('base64url')
  return `${payloadEncoded}.${signature}`
}

function copyToClipboard(code) {
  if (process.platform !== 'win32') return false
  const result = spawnSync('clip.exe', [], {
    input: code,
    encoding: 'utf8',
    windowsHide: true,
  })
  return result.status === 0
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolveAnswer => {
    rl.question(question, answer => {
      rl.close()
      resolveAnswer(String(answer).trim())
    })
  })
}

function printModuleMenu() {
  console.log('可授权模块：')
  LICENSE_MODULES.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.name} (${m.key})`)
  })
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    console.log(`CW Finance 注册码生成器

用法:
  generate-license.exe [选项]
  node generate-license.mjs [选项]

选项:
  -m, --machine-id <code>    用户机器码（12 位十六进制）
  -e, --expires <YYYY-MM-DD> 授权截止日期（含当天）
  -M, --modules <list>       授权模块，逗号分隔 key 或编号；all 表示全部（默认）
                             可选：${MODULE_KEYS.join(', ')}
  -c, --concurrent <N>       最大并发在线人数（正整数；0 或 all = 不限制，默认不限制）
  -k, --private-key <path>   私钥路径（默认同目录 license-private.pem）
  -h, --help                 显示帮助

示例:
  generate-license.exe -m A1B2C3D4E5F6 -e 2027-12-31 -M gl,cashier -c 5
  generate-license.exe -m A1B2C3D4E5F6 -e 2027-12-31 -M all
`)
    process.exit(0)
  }

  let machineId = args.machineId
  let expires = args.expires
  let modulesInput = args.modules

  if (!machineId) {
    machineId = (await prompt('请输入用户机器码: ')).toUpperCase()
  }
  if (!expires) {
    expires = await prompt('请输入授权截止日期 (YYYY-MM-DD): ')
  }
  if (!modulesInput) {
    printModuleMenu()
    modulesInput = await prompt('请输入授权模块编号或 key（逗号分隔，回车 = 全部）: ')
  }
  let concurrentInput = args.concurrent
  if (concurrentInput === null) {
    concurrentInput = await prompt('请输入最大并发在线人数（正整数，回车 = 不限制）: ')
  }

  if (!/^[0-9A-F]{12}$/.test(machineId)) {
    console.error('错误: 机器码应为 12 位十六进制字符')
    process.exit(1)
  }
  if (!isValidDateOnly(expires)) {
    console.error('错误: 截止日期格式无效，请使用 YYYY-MM-DD')
    process.exit(1)
  }

  const concurrentRaw = String(concurrentInput || '').trim().toLowerCase()
  let concurrent = 0
  if (concurrentRaw && concurrentRaw !== 'all' && concurrentRaw !== '0') {
    if (!/^\d+$/.test(concurrentRaw) || Number(concurrentRaw) > 100000) {
      console.error('错误: 最大并发在线人数应为正整数（0 或留空 = 不限制）')
      process.exit(1)
    }
    concurrent = Number(concurrentRaw)
  }

  let modules
  try {
    modules = parseModules(modulesInput)
  } catch (err) {
    console.error(`错误: ${err.message}（可选：${MODULE_KEYS.join(', ')} 或 all）`)
    process.exit(1)
  }

  const endOfDay = new Date(
    ...expires.split('-').map((v, i) => (i === 0 ? Number(v) : i === 1 ? Number(v) - 1 : Number(v)))
  )
  endOfDay.setHours(23, 59, 59, 999)
  if (Date.now() > endOfDay.getTime()) {
    console.error('错误: 截止日期不能早于今天')
    process.exit(1)
  }

  if (!existsSync(args.privateKey)) {
    console.error(`错误: 私钥文件不存在: ${args.privateKey}`)
    console.error('请将 license-private.pem 放在本程序同目录，或使用 -k 指定路径')
    process.exit(1)
  }

  const privateKeyPem = readFileSync(args.privateKey, 'utf8')
  const payload = {
    v: concurrent > 0 ? 3 : 2,
    mid: machineId,
    exp: expires,
    iat: formatDateOnly(new Date()),
    mods: modules.mods,
  }
  if (concurrent > 0) payload.cc = concurrent
  const code = buildLicenseCode(payload, privateKeyPem)

  console.log('')
  console.log('========== 注册码 ==========')
  console.log(code)
  console.log('============================')
  console.log(`机器码:   ${machineId}`)
  console.log(`有效期至: ${expires}（含当天）`)
  console.log(`授权模块: ${modules.names.join('、')}${modules.mods[0] === '*' ? '（全部）' : ''}`)
  console.log(`并发授权: ${concurrent > 0 ? `${concurrent} 人同时在线` : '不限制'}`)
  if (modules.note) console.log(`提示:     ${modules.note}`)
  console.log(`签发日期: ${payload.iat}`)
  console.log(
    copyToClipboard(code)
      ? '注册码已复制到剪贴板，可直接粘贴激活'
      : '请完整复制上方注册码，避免夹带换行'
  )
  console.log('')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
