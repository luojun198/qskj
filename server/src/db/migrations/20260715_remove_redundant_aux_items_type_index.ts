import type Database from 'better-sqlite3'

export function up(db: Database.Database) {
  db.exec('DROP INDEX IF EXISTS idx_aux_items_type')
}

export function down(db: Database.Database) {
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_aux_items_type ON aux_items(account_set_id, type)'
  )
}
