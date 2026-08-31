import Database from 'better-sqlite3'

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some(item => item.name === column)
}

export function up(db: Database.Database): void {
  if (!hasColumn(db, 'voucher_types', 'prefix')) return

  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE voucher_types_new (
      id TEXT PRIMARY KEY,
      account_set_id TEXT REFERENCES account_sets(id),
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO voucher_types_new (
      id, account_set_id, name, code, description, sort_order, created_at
    )
    SELECT id, account_set_id, name, code, description, sort_order, created_at
    FROM voucher_types;

    DROP TABLE voucher_types;
    ALTER TABLE voucher_types_new RENAME TO voucher_types;

    PRAGMA foreign_keys = ON;
  `)
}

export function down(db: Database.Database): void {
  if (hasColumn(db, 'voucher_types', 'prefix')) return

  db.exec(`
    ALTER TABLE voucher_types ADD COLUMN prefix TEXT;
  `)
}
