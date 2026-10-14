import type Database from 'better-sqlite3'

/**
 * v166：自动结转允许同期多次（补结差额）
 *
 * 原表 UNIQUE(account_set_id, year, period, transfer_type_code) 限定每期每个结转类型只能结转一次，
 * 结转后又有损益凭证记账时只能反结转重做。改为允许多条，新增 seq 记录同期同类型第几次结转。
 * 没有其他表外键引用 auto_transfer_runs，重建表是安全的。
 */
export function up(db: Database.Database) {
  const cols = db.prepare('PRAGMA table_info(auto_transfer_runs)').all() as Array<{ name: string }>
  if (cols.length === 0) return
  const hasSeq = cols.some(c => c.name === 'seq')
  db.exec(`
    CREATE TABLE auto_transfer_runs_new (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      transfer_type TEXT NOT NULL,
      transfer_type_code TEXT,
      voucher_id TEXT NOT NULL REFERENCES vouchers(id),
      seq INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO auto_transfer_runs_new
      (id, account_set_id, year, period, transfer_type, transfer_type_code, voucher_id, seq, created_by, created_at)
    SELECT id, account_set_id, year, period, transfer_type, transfer_type_code, voucher_id,
           ${hasSeq ? 'COALESCE(seq, 1)' : '1'}, created_by, created_at
    FROM auto_transfer_runs;
    DROP TABLE auto_transfer_runs;
    ALTER TABLE auto_transfer_runs_new RENAME TO auto_transfer_runs;
    CREATE INDEX IF NOT EXISTS idx_auto_transfer_runs_period
      ON auto_transfer_runs(account_set_id, year, period, transfer_type);
    CREATE INDEX IF NOT EXISTS idx_auto_transfer_runs_type
      ON auto_transfer_runs(account_set_id, year, period, transfer_type_code);
  `)
  console.log('✓ auto_transfer_runs 已允许同期多次结转（新增 seq）')
}

/** 回滚：同期同类型多条时只保留最早一条（其余结转凭证需先在页面反结转） */
export function down(db: Database.Database) {
  db.exec(`
    CREATE TABLE auto_transfer_runs_old (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      transfer_type TEXT NOT NULL,
      transfer_type_code TEXT,
      voucher_id TEXT NOT NULL REFERENCES vouchers(id),
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, year, period, transfer_type_code)
    );
    INSERT OR IGNORE INTO auto_transfer_runs_old
      (id, account_set_id, year, period, transfer_type, transfer_type_code, voucher_id, created_by, created_at)
    SELECT id, account_set_id, year, period, transfer_type, transfer_type_code, voucher_id, created_by, created_at
    FROM auto_transfer_runs ORDER BY seq ASC, created_at ASC;
    DROP TABLE auto_transfer_runs;
    ALTER TABLE auto_transfer_runs_old RENAME TO auto_transfer_runs;
    CREATE INDEX IF NOT EXISTS idx_auto_transfer_runs_period
      ON auto_transfer_runs(account_set_id, year, period, transfer_type);
  `)
}
