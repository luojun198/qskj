/**
 * 将开发环境 data/finance.db 复制到部署包 data/ 目录。
 * 先 checkpoint 合并 WAL，再复制主库文件，输出 DELETE 模式单文件库。
 * 授权记录随数据库保留；复制到其他机器后仍会由机器码校验拦截。
 */
const { existsSync, mkdirSync, rmSync, copyFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const projectRoot = resolve(process.argv[2] || '.')
const deployDir = resolve(process.argv[3] || join(projectRoot, 'deploy-final'))
const sourceDbPath = resolve(process.argv[4] || join(projectRoot, 'data', 'finance.db'))
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
