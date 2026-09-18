import type Database from 'better-sqlite3'

/**
 * 2026-09-18 生产评审 P2-10：工单实际开工 / 实际完工日期。
 *  - actual_start_date：首张已审核领料 / 补料 / 委外发货单的单据日期（反审核到无领料时清空）
 *  - actual_end_date：工单全部完工（含报废）时末批完工 / 委外入库单的单据日期（反审核回到未完工时清空）
 *  列表据此给出「已逾期」（released 且 end_date < 今天）与「延期完工」（actual_end_date > end_date）。
 */
export function up(db: Database.Database): void {
  const cols = (db.prepare("PRAGMA table_info('scm_production_plan')").all() as { name: string }[]).map(c => c.name)
  if (!cols.includes('actual_start_date')) db.exec('ALTER TABLE scm_production_plan ADD COLUMN actual_start_date TEXT')
  if (!cols.includes('actual_end_date')) db.exec('ALTER TABLE scm_production_plan ADD COLUMN actual_end_date TEXT')
  // 存量回填
  db.exec(`
    UPDATE scm_production_plan SET actual_start_date=(
      SELECT MIN(d.doc_date) FROM scm_doc d WHERE d.account_set_id=scm_production_plan.account_set_id AND d.plan_id=scm_production_plan.id
        AND d.status='audited' AND d.doc_type IN ('PL','PB','WO'))
    WHERE actual_start_date IS NULL;
    UPDATE scm_production_plan SET actual_end_date=(
      SELECT MAX(d.doc_date) FROM scm_doc d WHERE d.account_set_id=scm_production_plan.account_set_id AND d.plan_id=scm_production_plan.id
        AND d.status='audited' AND d.doc_type IN ('PF','WI'))
    WHERE actual_end_date IS NULL AND status='closed';
  `)
  console.log('✓ 工单实际开工/完工日期列已加')
}

export function down(_db: Database.Database): void {
  // SQLite 删列成本高，保留列无害
}
