import type Database from 'better-sqlite3'

/**
 * 2026-09-18 生产·委外·进销存联动收口：物料档案「委外加工费 / 税率」默认值。
 *  MRP 下推委外工单、委外计划选成品、委外入库生成时按此带出加工费单价，不再每次手填。
 */
export function up(db: Database.Database): void {
  const cols = (db.prepare("PRAGMA table_info('scm_item')").all() as { name: string }[]).map(c => c.name)
  if (!cols.includes('outsource_fee')) db.exec('ALTER TABLE scm_item ADD COLUMN outsource_fee REAL NOT NULL DEFAULT 0')
  if (!cols.includes('outsource_tax_rate')) db.exec('ALTER TABLE scm_item ADD COLUMN outsource_tax_rate REAL NOT NULL DEFAULT 0')
  console.log('✓ 物料委外加工费 / 税率列已加')
}

export function down(_db: Database.Database): void {
  // 保留列无害
}
