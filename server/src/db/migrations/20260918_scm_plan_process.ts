import type Database from 'better-sqlite3'

/**
 * 2026-09-18 生产评审 C-2 / C-3：工单工序快照 + 工作中心产能。
 *
 *  - scm_production_plan_process：工单下达时按成品启用工艺路线快照出的工序行（seq / 工序 / 工作中心 / 单件标准工时 / 计划数 /
 *    已完成 / 不良）；报工挂到工序行，工序流转按「后道累计 ≤ 前道完成」校验；工序在制 = 转入 − 完成 − 不良
 *  - scm_work_report.process_id：报工所属工序行（无工艺路线的工单为空，沿用「整件一道」口径）
 *  - scm_work_center.daily_capacity_hours：日产能工时（0 = 未维护，不参与负荷 / 交期推算）
 *  存量已审核工单按当前启用路线回填工序行；已审核报工按 (成品, 工序名) 回挂并汇总完成数。
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_production_plan_process (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      process_name TEXT NOT NULL,
      work_center_code TEXT,
      std_hours REAL NOT NULL DEFAULT 0,
      is_outsource INTEGER NOT NULL DEFAULT 0,
      plan_qty REAL NOT NULL DEFAULT 0,
      done_qty REAL NOT NULL DEFAULT 0,
      scrap_qty REAL NOT NULL DEFAULT 0,
      remark TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scm_plan_process_plan ON scm_production_plan_process(account_set_id, plan_id, product_id, seq);
  `)
  const wrCols = (db.prepare("PRAGMA table_info('scm_work_report')").all() as { name: string }[]).map(c => c.name)
  if (!wrCols.includes('process_id')) db.exec('ALTER TABLE scm_work_report ADD COLUMN process_id TEXT')
  const wcCols = (db.prepare("PRAGMA table_info('scm_work_center')").all() as { name: string }[]).map(c => c.name)
  if (!wcCols.includes('daily_capacity_hours')) db.exec('ALTER TABLE scm_work_center ADD COLUMN daily_capacity_hours REAL NOT NULL DEFAULT 0')

  // 存量回填：已审核 / 已关闭自制工单 × 成品 × 启用路线工序
  const plans = db.prepare(`SELECT pp.id AS product_id, pp.plan_id, pp.account_set_id, pp.item_code, pp.plan_qty
    FROM scm_production_plan_product pp JOIN scm_production_plan p ON p.id=pp.plan_id
    WHERE COALESCE(p.plan_type,'self')='self' AND p.status IN ('released','closed')
      AND NOT EXISTS (SELECT 1 FROM scm_production_plan_process x WHERE x.product_id=pp.id)`).all() as any[]
  const routing = db.prepare(`SELECT l.seq, l.process_name, l.work_center_code, l.std_hours, l.is_outsource FROM scm_routing r JOIN scm_routing_line l ON l.routing_id=r.id
    WHERE r.account_set_id=? AND r.item_code=? AND r.status='active'
      AND r.id=(SELECT id FROM scm_routing r2 WHERE r2.account_set_id=r.account_set_id AND r2.item_code=r.item_code AND r2.status='active' ORDER BY r2.code LIMIT 1)
    ORDER BY l.seq`)
  const ins = db.prepare(`INSERT INTO scm_production_plan_process (id,account_set_id,plan_id,product_id,seq,process_name,work_center_code,std_hours,is_outsource,plan_qty,done_qty,scrap_qty)
    VALUES (lower(hex(randomblob(16))),?,?,?,?,?,?,?,?,?,
      COALESCE((SELECT SUM(qty) FROM scm_work_report w WHERE w.account_set_id=? AND w.product_id=? AND w.status='audited' AND TRIM(COALESCE(w.process_name,''))=?),0),
      COALESCE((SELECT SUM(scrap_qty) FROM scm_work_report w WHERE w.account_set_id=? AND w.product_id=? AND w.status='audited' AND TRIM(COALESCE(w.process_name,''))=?),0))`)
  let n = 0
  for (const p of plans) {
    const lines = routing.all(p.account_set_id, p.item_code) as any[]
    let seq = 0
    for (const l of lines) {
      seq++
      const name = String(l.process_name || '').trim()
      if (!name) continue
      ins.run(p.account_set_id, p.plan_id, p.product_id, seq, name, l.work_center_code ?? null, Number(l.std_hours) || 0, l.is_outsource ? 1 : 0, Number(p.plan_qty) || 0,
        p.account_set_id, p.product_id, name, p.account_set_id, p.product_id, name)
      n++
    }
  }
  db.exec(`UPDATE scm_work_report SET process_id=(SELECT x.id FROM scm_production_plan_process x WHERE x.product_id=scm_work_report.product_id AND x.process_name=TRIM(COALESCE(scm_work_report.process_name,'')))
    WHERE process_id IS NULL AND product_id IS NOT NULL`)
  console.log(`✓ 工单工序表已建（回填 ${n} 行工序）；报工 process_id / 工作中心日产能列已加`)
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_production_plan_process')
}
