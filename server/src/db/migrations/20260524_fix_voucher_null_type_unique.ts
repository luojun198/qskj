import type Database from 'better-sqlite3'

export function up(db: Database.Database) {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_period_type_no_coalesce
      ON vouchers(account_set_id, year, period, COALESCE(voucher_type_id, '__NULL__'), voucher_no);
  `)
  console.log('✓ idx_vouchers_period_type_no_coalesce 唯一索引创建完成')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP INDEX IF EXISTS idx_vouchers_period_type_no_coalesce;
  `)
  console.log('✓ idx_vouchers_period_type_no_coalesce 索引已删除')
}
