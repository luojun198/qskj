import type Database from 'better-sqlite3'

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName)
  return !!row
}

export function up(db: Database.Database) {
  if (hasTable(db, 'license_activation')) return

  db.exec(`
    CREATE TABLE license_activation (
      id TEXT PRIMARY KEY DEFAULT 'default',
      machine_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      license_token TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  console.log('✓ license_activation')
}

export function down(db: Database.Database) {
  if (!hasTable(db, 'license_activation')) return
  db.exec('DROP TABLE license_activation')
}
