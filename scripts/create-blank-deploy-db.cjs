const { existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')

const deployDir = resolve(process.argv[2] || 'deploy-final')
const dbDir = join(deployDir, 'data')
const dbPath = join(dbDir, 'finance.db')
const schemaPath = join(deployDir, 'server', 'schema.sql')
const migrationListPath = resolve('server', 'src', 'db', 'migrationList.ts')

if (!existsSync(schemaPath)) {
  throw new Error(`schema.sql 不存在: ${schemaPath}`)
}

mkdirSync(dbDir, { recursive: true })
for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true })
  }
}

const Database = require(join(deployDir, 'server', 'node_modules', 'better-sqlite3'))
const db = new Database(dbPath)
try {
  db.pragma('journal_mode = DELETE')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(schemaPath, 'utf8'))
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  const accountSetColumns = db.prepare('PRAGMA table_info(account_sets)').all()
  const hasImportSource = accountSetColumns.some(column => column.name === 'import_source')
  if (!hasImportSource) {
    db.exec(`ALTER TABLE account_sets ADD COLUMN import_source TEXT DEFAULT 'manual'`)
  }
  if (existsSync(migrationListPath)) {
    const migrationList = readFileSync(migrationListPath, 'utf8')
    const migrationRe = /version:\s*(\d+),\s*[\r\n\s]*name:\s*['"]([^'"]+)['"]/g
    const insertMigration = db.prepare(
      'INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)'
    )
    for (const match of migrationList.matchAll(migrationRe)) {
      insertMigration.run(Number(match[1]), match[2])
    }
  }
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.pragma('journal_mode = DELETE')
  const hasLicenseTable = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'license_activation'`)
    .get()
  if (hasLicenseTable) {
    db.prepare('DELETE FROM license_activation').run()
  }
  const integrity = db.pragma('integrity_check', { simple: true })
  if (integrity !== 'ok') {
    throw new Error(`部署空白库 integrity_check 失败: ${integrity}`)
  }
} finally {
  db.close()
}

for (const filePath of [`${dbPath}-wal`, `${dbPath}-shm`]) {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true })
  }
}

console.log(`Blank deploy database created: ${dbPath}`)
