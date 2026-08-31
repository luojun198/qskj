import type Database from 'better-sqlite3'

/**
 * 回填生产/委外计划的 bom_id：
 * 历史（含缺料单下推生成）计划未绑定 BOM，导致工单「BOM 用料」空白、无法下达。
 * 对 bom_id 为空、且其成品 item_code 在 scm_bom 中「恰好唯一匹配 1 张」BOM 的计划，
 * 自动回填该 BOM；0 张或多张匹配的留空，交由「编辑生产计划」手动指定，避免误绑。
 */
export function up(db: Database.Database) {
  const r = db.prepare(`
    UPDATE scm_production_plan
    SET bom_id = (
      SELECT b.id FROM scm_bom b
      WHERE b.account_set_id = scm_production_plan.account_set_id
        AND b.item_code = scm_production_plan.item_code
    )
    WHERE bom_id IS NULL
      AND (
        SELECT COUNT(*) FROM scm_bom b2
        WHERE b2.account_set_id = scm_production_plan.account_set_id
          AND b2.item_code = scm_production_plan.item_code
      ) = 1
  `).run()
  console.log(`✓ 已回填 ${r.changes} 条计划的 bom_id（成品唯一匹配 1 张 BOM）`)
}

export function down(_db: Database.Database) {
  // 仅数据回填，无结构变更，无需回滚
}
