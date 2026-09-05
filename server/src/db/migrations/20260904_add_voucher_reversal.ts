import type Database from 'better-sqlite3'

/**
 * 凭证冲红（红字凭证）关联字段
 *
 * reversal_of_voucher_id：本凭证是哪张原凭证的红字冲销凭证
 * reversed_by_voucher_id：本凭证被哪张红字凭证冲销
 *
 * 两个字段互为对端，便于列表标记与双向跳转；不加外键约束，与 vouchers 表其余
 * 关联字段（如 source）风格一致，删除凭证时由业务代码清理对端引用。
 */
export function up(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(vouchers)`).all() as Array<{ name: string }>
  const has = (name: string) => cols.some((c) => c.name === name)

  if (!has('reversal_of_voucher_id')) {
    db.exec(`ALTER TABLE vouchers ADD COLUMN reversal_of_voucher_id TEXT DEFAULT NULL`)
  }
  if (!has('reversed_by_voucher_id')) {
    db.exec(`ALTER TABLE vouchers ADD COLUMN reversed_by_voucher_id TEXT DEFAULT NULL`)
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_vouchers_reversal_of ON vouchers(reversal_of_voucher_id)`
  )
  console.log('✓ vouchers 冲红关联列已添加')
}

export function down(db: Database.Database): void {
  // SQLite 不支持 DROP COLUMN，需要重建表；此处仅清理索引与数据作为回滚标记
  db.exec(`DROP INDEX IF EXISTS idx_vouchers_reversal_of`)
  db.exec(`UPDATE vouchers SET reversal_of_voucher_id = NULL, reversed_by_voucher_id = NULL`)
  console.log('⚠ 冲红关联列已清空，列本身需手动重建 vouchers 表移除')
}
