import type Database from 'better-sqlite3'

export function up(db: Database.Database) {
  db.exec(`
    ALTER TABLE cashier_init_balance ADD COLUMN init_date TEXT;
  `)
}

export function down(db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，重建表
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE cashier_init_balance_new (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      account_code TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RMB',
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, account_code, currency)
    );
    INSERT INTO cashier_init_balance_new SELECT id, account_set_id, account_code, currency, balance, created_at, updated_at FROM cashier_init_balance;
    DROP TABLE cashier_init_balance;
    ALTER TABLE cashier_init_balance_new RENAME TO cashier_init_balance;
    PRAGMA foreign_keys = ON;
  `)
}
