import type Database from 'better-sqlite3'

/**
 * 工单「一单多成品」改造：新增成品明细层。
 *
 * - 新建 scm_production_plan_product（工单 1:N 成品）：每行一个成品 + 计划数 + BOM + 成品仓 + 已完工数。
 * - scm_production_plan_line（原料用料）新增 product_id，把原料行归属到具体成品。
 * - 回填：每个现有 plan 生成「一条」成品行（取头的 item_code/plan_qty/bom_id/fp_warehouse/finished_qty），
 *   并把该 plan 现有原料行的 product_id 指向它，使旧单成品工单平滑变成「含 1 个成品的工单」。
 *
 * 注：scm_production_plan 头表的 item_code/plan_qty/bom_id/fp_warehouse/finished_qty 转为 legacy 兼容列，
 *     新代码一律读成品明细表；plan_type/supplier_code/yl_warehouse/status 仍是工单头级。
 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_production_plan_product (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES scm_production_plan(id) ON DELETE CASCADE,
      seq INTEGER,
      item_code TEXT NOT NULL,
      plan_qty REAL NOT NULL DEFAULT 0,
      bom_id TEXT,
      fp_warehouse TEXT,
      finished_qty REAL DEFAULT 0,
      scrap_qty REAL DEFAULT 0,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_production_plan_product ON scm_production_plan_product(plan_id);
  `)

  // scm_production_plan_line 增加 product_id（SQLite 无 IF NOT EXISTS for ADD COLUMN，先探测）
  const lineCols = new Set((db.prepare('PRAGMA table_info(scm_production_plan_line)').all() as any[]).map(c => c.name))
  if (!lineCols.has('product_id')) {
    db.exec('ALTER TABLE scm_production_plan_line ADD COLUMN product_id TEXT')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_scm_pp_line_product ON scm_production_plan_line(product_id)')

  // 回填：每个 plan 生成一条成品行（仅当尚无成品行），并把原料行 product_id 指向它
  const plans = db.prepare(`
    SELECT id, account_set_id, item_code, plan_qty, bom_id, fp_warehouse, finished_qty
    FROM scm_production_plan
    WHERE NOT EXISTS (SELECT 1 FROM scm_production_plan_product pp WHERE pp.plan_id = scm_production_plan.id)
  `).all() as any[]
  const insProduct = db.prepare(`INSERT INTO scm_production_plan_product
    (id, account_set_id, plan_id, seq, item_code, plan_qty, bom_id, fp_warehouse, finished_qty)
    VALUES (?,?,?,?,?,?,?,?,?)`)
  const linkLines = db.prepare('UPDATE scm_production_plan_line SET product_id=? WHERE plan_id=? AND (product_id IS NULL OR product_id=\'\')')
  let count = 0
  for (const p of plans) {
    if (!p.item_code) continue   // 头无成品的异常计划跳过（不造空成品行）
    const productId = `${p.id}-P1`
    insProduct.run(productId, p.account_set_id, p.id, 1, p.item_code, Number(p.plan_qty) || 0,
      p.bom_id ?? null, p.fp_warehouse ?? null, Number(p.finished_qty) || 0)
    linkLines.run(productId, p.id)
    count++
  }
  console.log(`✓ scm_production_plan_product 已创建；回填 ${count} 个工单的成品行并关联原料行`)
}

export function down(db: Database.Database) {
  // product_id 列 SQLite 不便 drop，留存无害；仅删成品明细表
  db.exec('DROP TABLE IF EXISTS scm_production_plan_product')
}
