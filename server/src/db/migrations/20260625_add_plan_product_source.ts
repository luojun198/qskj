import type Database from 'better-sqlite3'

/**
 * 下推「多成品合并」改造：行级来源下沉到成品行。
 *
 * 缺料单下推合并为「一张多成品工单」后，工单头无法承载多个缺料行来源，
 * 故把 source_line_id（缺料行级来源，用于「已下推」防重）+ source_doc_id（缺料单）下沉到成品行。
 * 回填：现有成品行从其父工单头复制 source_line_id/source_doc_id（旧单成品下推工单头上有）。
 */
export function up(db: Database.Database) {
  const cols = new Set((db.prepare('PRAGMA table_info(scm_production_plan_product)').all() as any[]).map(c => c.name))
  if (!cols.has('source_line_id')) db.exec('ALTER TABLE scm_production_plan_product ADD COLUMN source_line_id TEXT')
  if (!cols.has('source_doc_id')) db.exec('ALTER TABLE scm_production_plan_product ADD COLUMN source_doc_id TEXT')
  db.exec('CREATE INDEX IF NOT EXISTS idx_scm_pp_product_srcline ON scm_production_plan_product(source_line_id)')

  // 回填：从父工单头复制（仅当成品行尚无来源）
  const n = db.prepare(`
    UPDATE scm_production_plan_product
    SET source_line_id = (SELECT p.source_line_id FROM scm_production_plan p WHERE p.id = scm_production_plan_product.plan_id),
        source_doc_id  = (SELECT p.source_doc_id  FROM scm_production_plan p WHERE p.id = scm_production_plan_product.plan_id)
    WHERE (source_line_id IS NULL OR source_line_id = '')
  `).run()
  console.log(`✓ scm_production_plan_product 增加 source_line_id/source_doc_id 并回填 ${n.changes} 行`)
}

export function down(db: Database.Database) {
  // 列保留无害（SQLite 不便 drop column）；仅删索引
  db.exec('DROP INDEX IF EXISTS idx_scm_pp_product_srcline')
}
