import type Database from 'better-sqlite3'

export function up(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(scm_item)').all() as Array<{ name: string }>
  if (!columns.some(column => column.name === 'default_warehouse_code')) {
    db.exec('ALTER TABLE scm_item ADD COLUMN default_warehouse_code TEXT')
  }
}

export function down(db: Database.Database) {
  // SQLite 不支持安全删除列；保留字段以避免重建表时丢失业务数据。
}
