import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE IF NOT EXISTS init_balances_new (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      init_balance REAL NOT NULL DEFAULT 0,
      init_debit REAL NOT NULL DEFAULT 0,
      init_credit REAL NOT NULL DEFAULT 0,
      aux_item_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      opening_debit REAL NOT NULL DEFAULT 0,
      opening_credit REAL NOT NULL DEFAULT 0,
      pre_book_debit REAL NOT NULL DEFAULT 0,
      pre_book_credit REAL NOT NULL DEFAULT 0,
      init_balance_cents INTEGER,
      UNIQUE(account_set_id, account_id, year, period, aux_item_id)
    );

    INSERT INTO init_balances_new (
      id, account_set_id, account_id, direction, year, period,
      init_balance, init_debit, init_credit, aux_item_id, created_at,
      opening_debit, opening_credit, pre_book_debit, pre_book_credit,
      init_balance_cents
    )
    SELECT
      MIN(id) as id,
      account_set_id,
      account_id,
      direction,
      year,
      period,
      SUM(COALESCE(init_balance, 0)) as init_balance,
      SUM(COALESCE(init_debit, 0)) as init_debit,
      SUM(COALESCE(init_credit, 0)) as init_credit,
      COALESCE(aux_item_id, '') as aux_item_id,
      MIN(created_at) as created_at,
      SUM(COALESCE(opening_debit, 0)) as opening_debit,
      SUM(COALESCE(opening_credit, 0)) as opening_credit,
      SUM(COALESCE(pre_book_debit, 0)) as pre_book_debit,
      SUM(COALESCE(pre_book_credit, 0)) as pre_book_credit,
      CASE
        WHEN SUM(COALESCE(init_balance_cents, 0)) = 0 THEN NULL
        ELSE SUM(COALESCE(init_balance_cents, 0))
      END as init_balance_cents
    FROM init_balances
    GROUP BY account_set_id, account_id, direction, year, period, COALESCE(aux_item_id, '');

    DROP TABLE init_balances;
    ALTER TABLE init_balances_new RENAME TO init_balances;

    CREATE INDEX IF NOT EXISTS idx_init_balances ON init_balances(account_set_id, year, period);
    CREATE INDEX IF NOT EXISTS idx_init_balances_lookup
      ON init_balances(account_set_id, account_id, year);

    PRAGMA foreign_keys = ON;
  `)
}

export function down(db: Database): void {
  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE IF NOT EXISTS init_balances_old (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      init_balance REAL NOT NULL DEFAULT 0,
      init_debit REAL NOT NULL DEFAULT 0,
      init_credit REAL NOT NULL DEFAULT 0,
      aux_item_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      opening_debit REAL NOT NULL DEFAULT 0,
      opening_credit REAL NOT NULL DEFAULT 0,
      pre_book_debit REAL NOT NULL DEFAULT 0,
      pre_book_credit REAL NOT NULL DEFAULT 0,
      init_balance_cents INTEGER,
      UNIQUE(account_set_id, account_id, year, period)
    );

    INSERT INTO init_balances_old (
      id, account_set_id, account_id, direction, year, period,
      init_balance, init_debit, init_credit, aux_item_id, created_at,
      opening_debit, opening_credit, pre_book_debit, pre_book_credit,
      init_balance_cents
    )
    SELECT
      MIN(id) as id,
      account_set_id,
      account_id,
      direction,
      year,
      period,
      SUM(COALESCE(init_balance, 0)) as init_balance,
      SUM(COALESCE(init_debit, 0)) as init_debit,
      SUM(COALESCE(init_credit, 0)) as init_credit,
      NULL as aux_item_id,
      MIN(created_at) as created_at,
      SUM(COALESCE(opening_debit, 0)) as opening_debit,
      SUM(COALESCE(opening_credit, 0)) as opening_credit,
      SUM(COALESCE(pre_book_debit, 0)) as pre_book_debit,
      SUM(COALESCE(pre_book_credit, 0)) as pre_book_credit,
      CASE
        WHEN SUM(COALESCE(init_balance_cents, 0)) = 0 THEN NULL
        ELSE SUM(COALESCE(init_balance_cents, 0))
      END as init_balance_cents
    FROM init_balances
    GROUP BY account_set_id, account_id, direction, year, period;

    DROP TABLE init_balances;
    ALTER TABLE init_balances_old RENAME TO init_balances;

    CREATE INDEX IF NOT EXISTS idx_init_balances ON init_balances(account_set_id, year, period);
    CREATE INDEX IF NOT EXISTS idx_init_balances_lookup
      ON init_balances(account_set_id, account_id, year);

    PRAGMA foreign_keys = ON;
  `)
}
