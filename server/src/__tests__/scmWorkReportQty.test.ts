/**
 * 生产报工数量口径单元测试（services/scmWorkReport.ts）
 *
 * 报工原先只校验「必须选工单」，数量无上限——10 件的工单能报 500 件，
 * 人工/制费按工时×费率照单全收，最后全摊进成品成本。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  getReportedGoodQtyByProduct,
  getReportedQtyByProduct,
  validateWorkReportQty,
} from '../services/scmWorkReport.js'

const AID = 'AS-WR'
const PLAN = 'PLAN-1'
const P1 = 'PROD-1'
const P2 = 'PROD-2'

let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, plan_type TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, seq INTEGER,
      item_code TEXT, plan_qty REAL DEFAULT 0, finished_qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0);
    CREATE TABLE scm_work_report (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT,
      qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0, status TEXT, process_name TEXT);
    CREATE TABLE scm_routing (id TEXT, account_set_id TEXT, code TEXT, item_code TEXT, status TEXT);
    CREATE TABLE scm_routing_line (id TEXT, account_set_id TEXT, routing_id TEXT, seq INTEGER, process_name TEXT);
  `)
  return d
}

function seed(planType = 'self') {
  db.prepare('INSERT INTO scm_production_plan (id,account_set_id,plan_type) VALUES (?,?,?)').run(PLAN, AID, planType)
  db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty) VALUES (?,?,?,1,?,?)')
    .run(P1, AID, PLAN, 'FP1', 10)
  db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty) VALUES (?,?,?,2,?,?)')
    .run(P2, AID, PLAN, 'FP2', 5)
}

function report(id: string, productId: string | null, qty: number, scrap = 0, status = 'audited', process: string | null = null) {
  db.prepare('INSERT INTO scm_work_report (id,account_set_id,plan_id,product_id,qty,scrap_qty,status,process_name) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, AID, PLAN, productId, qty, scrap, status, process)
}
function routing(item: string, processes: string[]) {
  db.prepare("INSERT INTO scm_routing (id,account_set_id,code,item_code,status) VALUES (?,?,?,?,'active')").run('RT-' + item, AID, 'RT-' + item, item)
  processes.forEach((p, i) => db.prepare('INSERT INTO scm_routing_line (id,account_set_id,routing_id,seq,process_name) VALUES (?,?,?,?,?)').run('RL-' + item + i, AID, 'RT-' + item, i + 1, p))
}

const check = (productId: string | null, qty: number, scrap = 0, excludeReportId?: string, processName?: string) =>
  validateWorkReportQty(db, AID, { planId: PLAN, productId, qty, scrapQty: scrap, excludeReportId, processName })

describe('validateWorkReportQty', () => {
  beforeEach(() => { db = createDb(); seed() })

  it('计划内报工放行', () => {
    expect(check(P1, 10)).toBeNull()
    expect(check(P1, 6, 4)).toBeNull()
  })

  it('合格数 + 报废数合计超计划被拦截', () => {
    const err = check(P1, 8, 4)
    expect(err).toContain('禁止超报')
    expect(err).toContain('计划 10')
    expect(err).toContain('本次 12')
  })

  it('累计已报工计入上限', () => {
    report('R1', P1, 7)
    expect(check(P1, 3)).toBeNull()
    const err = check(P1, 4)
    expect(err).toContain('已报工 7')
    expect(err).toContain('禁止超报')
  })

  it('草稿报工也算占用，避免反复新建草稿绕过上限', () => {
    report('R1', P1, 9, 0, 'draft')
    expect(check(P1, 1)).toBeNull()
    expect(check(P1, 2)).toContain('禁止超报')
  })

  it('编辑时排除自己，不会把旧值算两遍', () => {
    report('R1', P1, 9)
    expect(check(P1, 10, 0, 'R1')).toBeNull()
    expect(check(P1, 11, 0, 'R1')).toContain('禁止超报')
  })

  it('各成品独立计数，不互相挤占', () => {
    report('R1', P1, 10)
    expect(check(P2, 5)).toBeNull()
    expect(check(P1, 1)).toContain('禁止超报')
  })

  it('未指定成品的计划级报工按工单计划合计校验', () => {
    expect(check(null, 15)).toBeNull()
    const err = check(null, 16)
    expect(err).toContain('工单计划合计 15')
    expect(err).toContain('禁止超报')
  })

  it('开启生产超额策略后按放宽上限校验', () => {
    db.prepare('INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)')
      .run('x1', AID, 'scm:production_overrun_enabled', '1')
    db.prepare('INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)')
      .run('x2', AID, 'scm:production_overrun_rate', '20')
    expect(check(P1, 12)).toBeNull()
    expect(check(P1, 13)).toContain('允许上限 12')
  })

  it('委外工单走委外超额策略', () => {
    db.prepare("UPDATE scm_production_plan SET plan_type='outsource' WHERE id=?").run(PLAN)
    db.prepare('INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)')
      .run('x1', AID, 'scm:outsource_overrun_enabled', '1')
    db.prepare('INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)')
      .run('x2', AID, 'scm:outsource_overrun_rate', '50')
    expect(check(P1, 15)).toBeNull()
    expect(check(P1, 16)).toContain('禁止超报')
  })

  it('负数与不属于本工单的成品被拒绝；零数量放行', () => {
    expect(check(P1, -1)).toContain('不能为负数')
    expect(check('NOT-MINE', 1)).toContain('不属于该工单')
    expect(check(P1, 0, 0)).toBeNull()
  })

  it('工单不存在时报错', () => {
    expect(validateWorkReportQty(db, AID, { planId: 'NOPE', productId: P1, qty: 1 })).toContain('工单不存在')
  })
})

describe('已报工数量汇总', () => {
  beforeEach(() => { db = createDb(); seed() })

  it('getReportedQtyByProduct 默认含草稿，onlyAudited 只数已审核', () => {
    report('R1', P1, 4, 1)
    report('R2', P1, 3, 0, 'draft')
    expect(getReportedQtyByProduct(db, AID, PLAN).get(P1)).toMatchObject({ qty: 7, scrap: 1 })
    expect(getReportedQtyByProduct(db, AID, PLAN, { onlyAudited: true }).get(P1)).toMatchObject({ qty: 4, scrap: 1 })
  })

  it('getReportedGoodQtyByProduct 只返回已审核的合格数', () => {
    report('R1', P1, 6, 2)
    report('R2', P1, 3, 0, 'draft')
    report('R3', P2, 5)
    const good = getReportedGoodQtyByProduct(db, AID, PLAN)
    expect(good.get(P1)).toBe(6)
    expect(good.get(P2)).toBe(5)
  })

  it('计划级报工（product_id 为空）不进入按成品的合格数表', () => {
    report('R1', null, 8)
    expect(getReportedGoodQtyByProduct(db, AID, PLAN).size).toBe(0)
  })
})

describe('按工序维度计数（生产评审 P1-1）', () => {
  beforeEach(() => { db = createDb(); seed() })

  it('同一成品不同工序各报满计划数都放行；同一工序再报才算超报', () => {
    report('R1', P1, 10, 0, 'audited', '下料')
    report('R2', P1, 10, 0, 'audited', '焊接')
    expect(check(P1, 10, 0, undefined, '喷涂')).toBeNull()
    expect(check(P1, 1, 0, undefined, '焊接')).toMatch(/工序「焊接」.*禁止超报/)
    // 未指定工序视为独立的一道（键 ''）
    expect(check(P1, 10)).toBeNull()
    report('R3', P1, 10)
    expect(check(P1, 1)).toMatch(/禁止超报/)
  })

  it('有工艺路线时合格数取路线最后一道有报工的工序', () => {
    routing('FP1', ['下料', '焊接', '喷涂'])
    report('R1', P1, 10, 0, 'audited', '下料')
    report('R2', P1, 8, 2, 'audited', '焊接')
    expect(getReportedGoodQtyByProduct(db, AID, PLAN).get(P1)).toBe(8)   // 喷涂未报 → 取焊接
    report('R3', P1, 7, 1, 'audited', '喷涂')
    expect(getReportedGoodQtyByProduct(db, AID, PLAN).get(P1)).toBe(7)
    // 路线外的「返修」工序不影响末道口径
    report('R4', P1, 3, 0, 'audited', '返修')
    expect(getReportedGoodQtyByProduct(db, AID, PLAN).get(P1)).toBe(7)
  })

  it('无工艺路线且多工序时取各工序合格数的最小值；单一工序退化为原口径', () => {
    report('R1', P1, 10, 0, 'audited', 'A')
    report('R2', P1, 6, 0, 'audited', 'B')
    expect(getReportedGoodQtyByProduct(db, AID, PLAN).get(P1)).toBe(6)
    report('R3', P2, 5)
    expect(getReportedGoodQtyByProduct(db, AID, PLAN).get(P2)).toBe(5)
  })

  it('计划级报工按工序独立计数', () => {
    report('R1', null, 15, 0, 'audited', '总装')
    expect(check(null, 15, 0, undefined, '包装')).toBeNull()
    expect(check(null, 1, 0, undefined, '总装')).toMatch(/禁止超报/)
  })
})
