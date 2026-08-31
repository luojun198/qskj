import type Database from 'better-sqlite3'

export function up(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(cashier_journal)').all() as any[]).map((c: any) => c.name)
  if (!cols.includes('counter_aux_item_id')) {
    db.exec(`ALTER TABLE cashier_journal ADD COLUMN counter_aux_item_id TEXT;`)
    console.log('✓ cashier_journal.counter_aux_item_id 字段添加完成')
  }
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，跳过
}
