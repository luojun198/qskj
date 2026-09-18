/**
 * 工单变更单（services/scmPlanChange.ts，生产评审 C-1）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { snapshotPlan, normalizeTarget, computeDiff, validateChange, applyChange } from '../services/scmPlanChange.js'

const AID = 'AS-PC'
const PLAN = 'PLAN-1'
let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, code TEXT, status TEXT, plan_type TEXT, item_code TEXT, plan_qty REAL, bom_id TEXT,
      start_date TEXT, end_date TEXT, priority INTEGER, yl_warehouse TEXT, fp_warehouse TEXT, dept_code TEXT, remark TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, seq INTEGER, item_code TEXT, plan_qty REAL, bom_id TEXT, fp_warehouse TEXT,
      finished_qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0, remark TEXT, process_fee REAL DEFAULT 0, process_tax_rate REAL DEFAULT 0);
    CREATE TABLE scm_production_plan_line (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT, seq INTEGER, item_code TEXT, qty REAL, unit TEXT, scrap_rate REAL, remark TEXT, warehouse_code TEXT);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_work_report (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT, qty REAL, status TEXT);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, plan_id TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, item_code TEXT, direction TEXT, qty REAL, amount REAL);
    CREATE TABLE scm_bom (id TEXT, account_set_id TEXT, code TEXT, item_code TEXT);
    CREATE TABLE scm_bom_line (id TEXT, account_set_id TEXT, bom_id TEXT, seq INTEGER, line_type TEXT, item_code TEXT, qty REAL, unit TEXT, scrap_rate REAL, remark TEXT, sub_group TEXT, sub_priority INTEGER);
  `)
  d.prepare("INSERT INTO scm_production_plan VALUES (?,?,'MO-1','released','self','FP',10,NULL,'2026-06-01','2026-06-30',0,'WR','WF',NULL,'原备注')").run(PLAN, AID)
  d.prepare("INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty,finished_qty,scrap_qty) VALUES ('P1',?,?,1,'FP',10,4,1)").run(AID, PLAN)
  d.prepare("INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,product_id,seq,item_code,qty,scrap_rate) VALUES ('L1',?,?,'P1',1,'R1',2,0)").run(AID, PLAN)
  d.prepare("INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,product_id,seq,item_code,qty,scrap_rate) VALUES ('L2',?,?,'P1',2,'R2',1,0)").run(AID, PLAN)
  // 已领 R1 12、R2 5
  d.prepare("INSERT INTO scm_doc VALUES ('D1',?,'PL','PL-1','audited',?)").run(AID, PLAN)
  d.prepare("INSERT INTO scm_stock_move VALUES ('M1',?,'PL','PL-1','R1','out',12,120)").run(AID)
  d.prepare("INSERT INTO scm_stock_move VALUES ('M2',?,'PL','PL-1','R2','out',5,50)").run(AID)
  return d
}
const plan = () => db.prepare('SELECT * FROM scm_production_plan WHERE id=?').get(PLAN) as any
const change = (body: any) => {
  const before = snapshotPlan(db, AID, PLAN)
  const after = normalizeTarget(db, { plan_id: PLAN, ...body }, before)
  return { before, after, errs: validateChange(db, AID, plan(), before, after), diff: computeDiff(before, after) }
}
const baseProducts = () => [{ id: 'P1', item_code: 'FP', plan_qty: 10, lines: [{ item_code: 'R1', qty: 2 }, { item_code: 'R2', qty: 1 }] }]

describe('工单变更单', () => {
  beforeEach(() => { db = createDb() })

  it('追加计划数 + 改交期：通过并生成差异', () => {
    const r = change({ head: { end_date: '2026-07-15' }, products: [{ ...baseProducts()[0], plan_qty: 15 }] })
    expect(r.errs).toEqual([])
    expect(r.diff).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'head', field: 'end_date', before: '2026-06-30', after: '2026-07-15' }),
      expect.objectContaining({ kind: 'product', field: 'plan_qty', product: 'FP', before: 10, after: 15 }),
    ]))
    expect(r.diff).toHaveLength(2)
  })

  it('计划数低于已完工+已报废、用料需求低于已领、删除有完工的成品 → 拒绝', () => {
    // 完工 4 + 报废 1 = 5；改成 4 被拒
    expect(change({ products: [{ ...baseProducts()[0], plan_qty: 4 }] }).errs.join()).toMatch(/低于已完工\+已报废 5/)
    // 计划 6 × R1 2 = 12 ≥ 已领 12 通过；计划 5 → 需求 10 < 12 被拒（先退料）
    expect(change({ products: [{ ...baseProducts()[0], plan_qty: 6 }] }).errs).toEqual([])
    expect(change({ products: [{ ...baseProducts()[0], plan_qty: 5 }] }).errs.join()).toMatch(/物料 R1 变更后需求 10 低于已领用 12，请先退料/)
    // 删掉 R2 用料：R2 已领 5 → 拒
    expect(change({ products: [{ id: 'P1', item_code: 'FP', plan_qty: 10, lines: [{ item_code: 'R1', qty: 2 }] }] }).errs.join()).toMatch(/物料 R2 .*低于已领用 5/)
    // 删除成品 P1（有完工）→ 拒
    expect(change({ products: [{ item_code: 'FP2', plan_qty: 3, lines: [{ item_code: 'R1', qty: 1 }] }] }).errs.join()).toMatch(/成品 FP 已有完工\/报废，不能删除/)
    // 草稿/已关闭工单不可变更
    db.prepare("UPDATE scm_production_plan SET status='closed'").run()
    expect(change({ products: baseProducts() }).errs.join()).toMatch(/仅已审核工单可做变更/)
  })

  it('无差异 / 成品重复 / 缺用料 均报错', () => {
    expect(change({ products: baseProducts() }).diff).toEqual([])
    expect(change({ products: [...baseProducts(), { item_code: 'FP', plan_qty: 1, lines: [{ item_code: 'R1', qty: 1 }] }] }).errs.join()).toMatch(/重复/)
    expect(change({ products: [...baseProducts(), { item_code: 'FP2', plan_qty: 1, lines: [] }] }).errs.join()).toMatch(/缺用料明细/)
  })

  it('审核生效：成品 id 保留、新成品插入、用料重写、头字段与 legacy 列同步', () => {
    const r = change({ head: { end_date: '2026-07-15', priority: 5, remark: '客户追加' },
      products: [{ id: 'P1', item_code: 'FP', plan_qty: 12, fp_warehouse: 'WF2', lines: [{ item_code: 'R1', qty: 2 }, { item_code: 'R2', qty: 1 }, { item_code: 'R3', qty: 0.5, scrap_rate: 10 }] },
        { item_code: 'FP2', plan_qty: 3, lines: [{ item_code: 'R1', qty: 1 }] }] })
    expect(r.errs).toEqual([])
    applyChange(db, AID, plan(), r.after)
    const p = plan()
    expect(p).toMatchObject({ end_date: '2026-07-15', priority: 5, remark: '客户追加', plan_qty: 15, item_code: 'FP', fp_warehouse: 'WF' })
    const prods = db.prepare('SELECT id, item_code, plan_qty, finished_qty, scrap_qty, fp_warehouse FROM scm_production_plan_product WHERE plan_id=? ORDER BY seq').all(PLAN) as any[]
    expect(prods[0]).toMatchObject({ id: 'P1', item_code: 'FP', plan_qty: 12, finished_qty: 4, scrap_qty: 1, fp_warehouse: 'WF2' })   // 原 id 与已完工保留
    expect(prods[1]).toMatchObject({ item_code: 'FP2', plan_qty: 3, finished_qty: 0 })
    const lines = db.prepare('SELECT item_code, qty, scrap_rate FROM scm_production_plan_line WHERE product_id=? ORDER BY seq').all('P1')
    expect(lines).toEqual([{ item_code: 'R1', qty: 2, scrap_rate: 0 }, { item_code: 'R2', qty: 1, scrap_rate: 0 }, { item_code: 'R3', qty: 0.5, scrap_rate: 10 }])
    // 再次快照 = after（幂等）
    expect(computeDiff(snapshotPlan(db, AID, PLAN), r.after)).toEqual([])
  })

  it('成品只给 bom_id 时按 BOM 展开用料', () => {
    db.prepare("INSERT INTO scm_bom VALUES ('B1',?,'BOM-FP2','FP2')").run(AID)
    db.prepare("INSERT INTO scm_bom_line (id,account_set_id,bom_id,seq,line_type,item_code,qty,scrap_rate) VALUES ('BL1',?,'B1',1,'component','R9',3,5)").run(AID)
    const r = change({ products: [...baseProducts(), { item_code: 'FP2', plan_qty: 2, bom_id: 'B1' }] })
    expect(r.errs).toEqual([])
    expect(r.after.products[1].lines).toEqual([expect.objectContaining({ item_code: 'R9', qty: 3, scrap_rate: 5 })])
  })
})
