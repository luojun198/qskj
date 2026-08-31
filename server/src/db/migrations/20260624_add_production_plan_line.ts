import type Database from 'better-sqlite3'

/**
 * 每条生产/委外计划记录自己「实际执行的 BOM」用料明细（与共享主 BOM 解耦的快照）。
 *
 * 新建 scm_production_plan_line（结构对齐 scm_bom_line，外键 plan_id 关联计划），
 * 并把历史计划按其 bom_id 对应主 BOM 的明细回填进来（仅当该计划尚无行），
 * 使工单/领料建议/库存「计划未领用」从此读「计划用料」而非主 BOM。
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_production_plan_line (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES scm_production_plan(id) ON DELETE CASCADE,
      seq INTEGER,
      item_code TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      unit TEXT,
      scrap_rate REAL DEFAULT 0,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_production_plan_line ON scm_production_plan_line(plan_id);
  `)

  // 回填：把每条计划 bom_id 对应主 BOM 的明细复制进来（仅当该计划尚无行）
  const plans = db.prepare(`
    SELECT p.id, p.account_set_id, p.bom_id FROM scm_production_plan p
    WHERE p.bom_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM scm_production_plan_line pl WHERE pl.plan_id = p.id)
  `).all() as any[]
  const getLines = db.prepare('SELECT item_code, qty, unit, scrap_rate, remark FROM scm_bom_line WHERE bom_id=? ORDER BY seq')
  const ins = db.prepare('INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,seq,item_code,qty,unit,scrap_rate,remark) VALUES (?,?,?,?,?,?,?,?,?)')
  let count = 0
  for (const p of plans) {
    const lines = getLines.all(p.bom_id) as any[]
    let seq = 0
    for (const l of lines) {
      seq++
      ins.run(`${p.id}-${seq}`, p.account_set_id, p.id, seq, l.item_code, Number(l.qty) || 0, l.unit ?? null, Number(l.scrap_rate) || 0, l.remark ?? null)
    }
    if (lines.length) count++
  }
  console.log(`✓ scm_production_plan_line 已创建，并回填 ${count} 条计划的用料明细`)
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS scm_production_plan_line')
}
