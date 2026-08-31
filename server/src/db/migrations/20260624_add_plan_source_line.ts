import type Database from 'better-sqlite3'

/**
 * 缺料单下推「已下推」追溯：生产/委外计划补行级来源 source_line_id。
 *
 * 原本计划只记 source_doc_id（缺料单头），而缺料单行的「已下推数量」只统计
 * scm_doc_line.source_line_id，导致生成计划不计入已下推 → 缺口恒为满 → 可无限重复下推。
 * 本迁移给 scm_production_plan 增加 source_line_id，并回填历史由缺料单生成的计划
 * （按 缺料单 + 物料 匹配到对应行），使后续/历史的计划都能计入已下推。
 */
export function up(db: Database.Database) {
  try {
    db.prepare('ALTER TABLE scm_production_plan ADD COLUMN source_line_id TEXT').run()
  } catch (e: any) {
    if (!String(e.message).includes('duplicate column name')) throw e
  }
  // 回填：由缺料单(MR)生成、尚无行级来源的计划 → 按 物料编号 匹配该缺料单的明细行
  db.prepare(`
    UPDATE scm_production_plan
    SET source_line_id = (
      SELECT l.id FROM scm_doc_line l
      WHERE l.doc_id = scm_production_plan.source_doc_id
        AND l.item_code = scm_production_plan.item_code
      ORDER BY l.seq LIMIT 1
    )
    WHERE source_line_id IS NULL AND source_doc_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM scm_doc d WHERE d.id = scm_production_plan.source_doc_id AND d.doc_type = 'MR')
  `).run()
  console.log('✓ scm_production_plan 已增加 source_line_id 并回填缺料单来源行')
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，保留列即可
}
