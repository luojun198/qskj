import { Database } from 'better-sqlite3'

export async function up(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cashier_attachments (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      journal_id TEXT NOT NULL REFERENCES cashier_journal(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(account_set_id, filename)
    );

    CREATE INDEX IF NOT EXISTS idx_cashier_attachments_journal ON cashier_attachments(account_set_id, journal_id);
    CREATE INDEX IF NOT EXISTS idx_cashier_attachments_created ON cashier_attachments(account_set_id, created_at);
  `)
}

export async function down(db: Database) {
  db.exec(`DROP TABLE IF EXISTS cashier_attachments`)
}
