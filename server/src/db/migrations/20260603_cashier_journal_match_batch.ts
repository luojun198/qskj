import type Database from 'better-sqlite3'

/**
 * v45：cashier_journal 新增 match_batch 字段
 * 与 bank_statement.match_batch 对应，使手动/自动对账配对可追溯，支持精确撤销。
 */
export function up(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(cashier_journal)').all() as any[]).map((c: any) => c.name)
  if (!cols.includes('match_batch')) {
    db.exec(`ALTER TABLE cashier_journal ADD COLUMN match_batch TEXT;`)
    console.log('✓ cashier_journal.match_batch 字段添加完成')
  }
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，跳过
}
