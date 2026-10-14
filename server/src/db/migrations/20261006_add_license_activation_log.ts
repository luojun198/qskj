import type Database from 'better-sqlite3'

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName)
  return !!row
}

export function up(db: Database.Database) {
  if (hasTable(db, 'license_activation_log')) return

  db.exec(`
    CREATE TABLE license_activation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      modules TEXT NOT NULL,
      max_concurrent INTEGER NOT NULL DEFAULT 0,
      issued_at TEXT,
      operator TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  console.log('✓ license_activation_log')
}

export function down(db: Database.Database) {
  if (!hasTable(db, 'license_activation_log')) return
  db.exec('DROP TABLE license_activation_log')
}
