/**
 * 模拟生产部署空白库 + ACD 导入，用于复现 malformed 问题
 */
import { readFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import Database from 'better-sqlite3'

const root = resolve(import.meta.dirname, '../..')
const dbDir = join(root, process.argv[3] || 'deploy-test/data')
const dbPath = join(dbDir, 'finance.db')
const acdPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(root, '标准模版/行政事业单位/行政事业单位.acd')

mkdirSync(dbDir, { recursive: true })
for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  if (existsSync(p)) rmSync(p)
}

const db = new Database(dbPath)
try {
  db.pragma('journal_mode = DELETE')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(join(root, 'server/src/db/schema.sql'), 'utf8'))
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  const migrationList = readFileSync(join(root, 'server/src/db/migrationList.ts'), 'utf8')
  const migrationRe = /version:\s*(\d+),\s*[\r\n\s]*name:\s*['"]([^'"]+)['"]/g
  const insertMigration = db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)'
  )
  for (const match of migrationList.matchAll(migrationRe)) {
    insertMigration.run(Number(match[1]), match[2])
  }
} finally {
  db.close()
}

process.env.DB_PATH = dbPath
process.env.DB_DIR = dbDir
process.env.SCHEMA_DIR = join(root, 'server/src/db')
process.env.SEED_DEFAULT_ACCOUNT_SET = 'false'

const { initDatabase } = await import('../src/db/index.ts')
const { runMigrations } = await import('../src/db/migrations.ts')
const { migrations } = await import('../src/db/migrationList.ts')
const { acdImportService } = await import('../src/services/acdImport.ts')

initDatabase()
runMigrations(migrations)

const acdBuffer = readFileSync(acdPath)
console.log('ACD size:', acdBuffer.length)

try {
  const result = await acdImportService({
    acdBuffer,
    name: '生产库测试导入',
    code: `AS${Date.now()}`,
    fiscalYear: new Date().getFullYear(),
    startDate: `${new Date().getFullYear()}-01-01`,
  })
  console.log('Import OK:', result.accountSetId, result.stats.accounts)
  const checkDb = new Database(dbPath)
  console.log('integrity:', checkDb.pragma('integrity_check'))
  checkDb.close()
} catch (err) {
  console.error('Import FAILED:', err?.message || err)
  process.exit(1)
}
