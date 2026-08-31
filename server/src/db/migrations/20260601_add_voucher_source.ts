import type Database from 'better-sqlite3'

/** vouchers 表增加 source 字段，标记凭证来源（手工/出纳/折旧） */
export function up(db: Database.Database): void {
  db.exec(`ALTER TABLE vouchers ADD COLUMN source TEXT DEFAULT NULL`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vouchers_source ON vouchers(source)`)
  console.log('✓ vouchers.source 列已添加')
}

export function down(db: Database.Database): void {
  // SQLite 不支持 DROP COLUMN，需要重建表，此处仅为回滚标记
  console.log('⚠ source 列回滚需要手动处理 vouchers 表')
}
