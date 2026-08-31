import Database from 'better-sqlite3'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS budget_surplus_adjustments (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      source_seq INTEGER,
      item_code TEXT NOT NULL,
      item_name TEXT,
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      account_code TEXT,
      alt_amount REAL NOT NULL DEFAULT 0,
      item_type TEXT,
      balance_direction TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, source_seq)
    );

    CREATE INDEX IF NOT EXISTS idx_budget_surplus_adjustments_period
      ON budget_surplus_adjustments(account_set_id, year, period, item_code);
  `)
}

export function down(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_budget_surplus_adjustments_period;
    DROP TABLE IF EXISTS budget_surplus_adjustments;
  `)
}
