/**
 * 写入 deploy-final/BUILD_STAMP.json，便于核对部署包是否与当前源码构建一致。
 * 用法: node scripts/write-deploy-build-stamp.cjs <projectRoot> [deployDirName]
 */
const { createHash } = require('crypto')
const { readFileSync, writeFileSync, statSync, existsSync } = require('fs')
const { join, resolve } = require('path')
const { execSync } = require('child_process')

const projectRoot = resolve(process.argv[2] || '.')
const deployDir = resolve(projectRoot, process.argv[3] || 'deploy-final')
const buildInfoPath = join(projectRoot, 'client/public/version.json')

function readGeneratedBuildInfo() {
  if (!existsSync(buildInfoPath)) return null
  try {
    return JSON.parse(readFileSync(buildInfoPath, 'utf8'))
  } catch {
    return null
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function dbBusinessFingerprint(dbPath) {
  let Database
  try {
    Database = require('better-sqlite3')
  } catch {
    return null
  }
  if (!existsSync(dbPath)) return null
  const db = new Database(dbPath, { readonly: true })
  try {
    const accountSets = db.prepare('SELECT COUNT(*) AS c FROM account_sets').get()?.c ?? 0
    const reports = db.prepare('SELECT COUNT(*) AS c, MAX(updated_at) AS m FROM report_definitions').get()
    const prints = db.prepare('SELECT COUNT(*) AS c, MAX(updated_at) AS m FROM print_templates').get()
    const cells = db.prepare('SELECT COUNT(*) AS c FROM report_cells').get()?.c ?? 0
    return `${accountSets}|${reports?.c ?? 0}|${reports?.m ?? ''}|${prints?.c ?? 0}|${prints?.m ?? ''}|${cells}`
  } catch {
    return null
  } finally {
    db.close()
  }
}

function gitHead() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

const clientIndex = join(deployDir, 'client/dist/index.html')
const serverBundle = join(deployDir, 'server/bundle.cjs')
const deployDb = join(deployDir, 'data/finance.db')
const devDb = join(projectRoot, 'data/finance.db')
const srcClientIndex = join(projectRoot, 'client/dist/index.html')
const srcServerBundle = join(projectRoot, 'server/dist/bundle.cjs')

if (!existsSync(clientIndex) || !existsSync(serverBundle)) {
  console.error('BUILD_STAMP: deploy artifacts missing under', deployDir)
  process.exit(1)
}

let inSync = true
const mismatches = []

if (existsSync(srcClientIndex)) {
  const a = sha256File(clientIndex)
  const b = sha256File(srcClientIndex)
  if (a !== b) {
    inSync = false
    mismatches.push('client/dist/index.html differs from project client/dist')
  }
}

if (existsSync(srcServerBundle)) {
  const a = sha256File(serverBundle)
  const b = sha256File(srcServerBundle)
  if (a !== b) {
    inSync = false
    mismatches.push('server/bundle.cjs differs from project server/dist/bundle.cjs')
  }
}

let dbInSyncWithDev = null
let deployDbHash = null
let devDbHash = null
let deployDbFingerprint = null
let devDbFingerprint = null
if (existsSync(deployDb) && existsSync(devDb)) {
  deployDbHash = sha256File(deployDb)
  devDbHash = sha256File(devDb)
  deployDbFingerprint = dbBusinessFingerprint(deployDb)
  devDbFingerprint = dbBusinessFingerprint(devDb)
  dbInSyncWithDev =
    deployDbFingerprint != null &&
    devDbFingerprint != null &&
    deployDbFingerprint === devDbFingerprint
  if (!dbInSyncWithDev) {
    mismatches.push('deploy-final/data/finance.db business data differs from dev data/finance.db')
  }
}

const generated = readGeneratedBuildInfo()
const now = new Date()
const stamp = {
  builtAt: generated?.builtAt || now.toISOString(),
  builtAtLocal: generated?.builtAtLocal || now.toLocaleString('zh-CN', { hour12: false }),
  version: generated?.version || require(join(projectRoot, 'package.json')).version,
  build: generated?.build || null,
  mode: generated?.mode || 'production',
  gitCommit: generated?.gitCommit ?? gitHead(),
  clientIndexHash: sha256File(clientIndex),
  serverBundleHash: sha256File(serverBundle),
  clientIndexMtime: statSync(clientIndex).mtime.toISOString(),
  serverBundleMtime: statSync(serverBundle).mtime.toISOString(),
  deployDbHash,
  devDbHash,
  deployDbFingerprint,
  devDbFingerprint,
  deployDbMtime: existsSync(deployDb) ? statSync(deployDb).mtime.toISOString() : null,
  devDbMtime: existsSync(devDb) ? statSync(devDb).mtime.toISOString() : null,
  dbInSyncWithDev,
  inSyncWithProjectDist: inSync,
  mismatches,
}

writeFileSync(join(deployDir, 'BUILD_STAMP.json'), JSON.stringify(stamp, null, 2), 'utf8')
console.log('BUILD_STAMP written:', join(deployDir, 'BUILD_STAMP.json'))
if (!inSync) {
  console.warn('WARN: deploy-final is out of sync with project build outputs')
  mismatches.forEach(m => console.warn(' -', m))
  process.exit(2)
}

if (dbInSyncWithDev === false) {
  console.warn('WARN: deploy-final database differs from dev data/finance.db')
  console.warn('       Report/print template changes in dev DB are NOT in this deploy package.')
  console.warn('       Re-run build-deploy.bat or scripts\\sync-deploy-data.bat before compressing zip.')
}
