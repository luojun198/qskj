import type Database from 'better-sqlite3'

/**
 * 2026-09-18 压测（FIX-249）补索引：
 *  - scm_doc_line(source_line_id)：下推数量 / 未发未收 子查询全靠它，之前在大库上是全表扫
 *  - scm_doc_line(account_set_id, item_code)：按物料聚合订单行
 *  - scm_stock_move(account_set_id, doc_type, doc_no)：库存流水 ↔ 单据 关联（工单成本归集 / 领料建议 / 反审核）
 *  - scm_doc(account_set_id, status, doc_date)：列表按状态 + 日期
 *  - scm_doc(account_set_id, source_doc_id)：上下游追溯 / 下推防重
 *  - scm_production_plan(account_set_id, status, plan_type)：已下达工单扫描
 *  - scm_ar_ap_log(account_set_id, doc_type, doc_no)：台账 ↔ 单据
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scm_doc_line_source_line ON scm_doc_line(source_line_id);
    CREATE INDEX IF NOT EXISTS idx_scm_doc_line_item ON scm_doc_line(account_set_id, item_code);
    CREATE INDEX IF NOT EXISTS idx_scm_move_doc ON scm_stock_move(account_set_id, doc_type, doc_no);
    CREATE INDEX IF NOT EXISTS idx_scm_doc_status_date ON scm_doc(account_set_id, status, doc_date);
    CREATE INDEX IF NOT EXISTS idx_scm_doc_source ON scm_doc(account_set_id, source_doc_id);
    CREATE INDEX IF NOT EXISTS idx_scm_plan_status ON scm_production_plan(account_set_id, status, plan_type);
    CREATE INDEX IF NOT EXISTS idx_scm_arap_doc ON scm_ar_ap_log(account_set_id, doc_type, doc_no);
  `)
  // 刷新查询规划器统计：没有 sqlite_stat1 时多表 JOIN 常选错索引（见 db/index.ts ensureQueryPlannerStats）
  db.exec('ANALYZE')
  console.log('✓ 供应链性能索引已建，已刷新统计信息')
}

export function down(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_scm_doc_line_source_line; DROP INDEX IF EXISTS idx_scm_doc_line_item; DROP INDEX IF EXISTS idx_scm_move_doc;
    DROP INDEX IF EXISTS idx_scm_doc_status_date; DROP INDEX IF EXISTS idx_scm_doc_source; DROP INDEX IF EXISTS idx_scm_plan_status; DROP INDEX IF EXISTS idx_scm_arap_doc;
  `)
}
