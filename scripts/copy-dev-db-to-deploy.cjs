/**
 * 将开发环境 data/finance.db 复制到部署包 data/ 目录。
 * 先 checkpoint 合并 WAL，再复制主库文件，输出 DELETE 模式单文件库。
 * 授权记录随数据库保留；复制到其他机器后仍会由机器码校验拦截。
 */
const { existsSync, mkdirSync, rmSync, copyFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const projectRoot = resolve(process.argv[2] || '.')
const deployDir = resolve(process.argv[3] || join(projectRoot, 'deploy-final'))
// 本分支(cw0523)开发库为 data/finance-0523.db（见 server/.env 的 DB_PATH）；
// data/finance.db 是原项目 cw 的历史库，不能作为打包来源。
function resolveSourceDb() {
  if (process.argv[4]) return resolve(process.argv[4])
  const candidates = ['finance-0523.db', 'finance.db']
  for (const name of candidates) {
    const candidate = join(projectRoot, 'data', name)
    if (existsSync(candidate)) return candidate
  }
  return join(projectRoot, 'data', candidates[0])
}
const sourceDbPath = resolveSourceDb()
const dbDir = join(deployDir, 'data')
const destDbPath = join(dbDir, 'finance.db')

if (!existsSync(sourceDbPath)) {
  throw new Error(`开发库不存在: ${sourceDbPath}`)
}

const betterSqlite3Path = join(deployDir, 'server', 'node_modules', 'better-sqlite3')
if (!existsSync(betterSqlite3Path)) {
  throw new Error(`部署包 better-sqlite3 未安装: ${betterSqlite3Path}`)
}

const Database = require(betterSqlite3Path)

mkdirSync(dbDir, { recursive: true })
for (const filePath of [destDbPath, `${destDbPath}-wal`, `${destDbPath}-shm`]) {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true })
  }
}

const sourceDb = new Database(sourceDbPath)
try {
  sourceDb.pragma('wal_checkpoint(TRUNCATE)')
} finally {
  sourceDb.close()
}

copyFileSync(sourceDbPath, destDbPath)

const destDb = new Database(destDbPath)
try {
  destDb.pragma('journal_mode = DELETE')
  destDb.pragma('wal_checkpoint(TRUNCATE)')
  const integrity = destDb.pragma('integrity_check', { simple: true })
  if (integrity !== 'ok') {
    throw new Error(`复制后 integrity_check 失败: ${integrity}`)
  }
  const accountSets = destDb.prepare('SELECT COUNT(*) AS cnt FROM account_sets').get()?.cnt ?? 0
  const hasLicenseTable = destDb
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'license_activation'`)
    .get()
  const licenseRecords = hasLicenseTable
    ? destDb.prepare('SELECT COUNT(*) AS cnt FROM license_activation').get()?.cnt ?? 0
    : 0
  console.log(
    `Dev database copied to deploy: ${destDbPath} (account_sets=${accountSets}, license_records=${licenseRecords})`
  )
} finally {
  destDb.close()
}

for (const filePath of [`${destDbPath}-wal`, `${destDbPath}-shm`]) {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true })
  }
}
