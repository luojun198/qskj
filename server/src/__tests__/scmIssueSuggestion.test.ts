import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { computeIssueSuggestion, computeProductionPlanActionState } from '../services/scmProduction.js'

const AID = 'AS-TEST'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, unit TEXT, spec TEXT);
    CREATE TABLE scm_bom_line (unit TEXT, remark TEXT, sub_group TEXT, sub_priority INTEGER, account_set_id TEXT, bom_id TEXT, item_code TEXT, qty REAL,
      scrap_rate REAL, seq INTEGER, warehouse_code TEXT, line_type TEXT);
    CREATE TABLE scm_production_plan_line (account_set_id TEXT, plan_id TEXT, product_id TEXT, item_code TEXT, qty REAL,
      scrap_rate REAL, seq INTEGER, warehouse_code TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, seq INTEGER,
      item_code TEXT, plan_qty REAL, bom_id TEXT, fp_warehouse TEXT, finished_qty REAL, scrap_qty REAL);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT,
      item_code TEXT, direction TEXT, qty REAL);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, plan_id TEXT, status TEXT);
    CREATE TABLE scm_doc_line (id TEXT, doc_id TEXT, account_set_id TEXT, item_code TEXT, qty REAL);
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, direction TEXT);
    CREATE TABLE system_params (account_set_id TEXT, param_key TEXT, param_value TEXT);
  `)
  // 物料 + 主 BOM：成品 P 用料 I1×9（无损耗）
  db.prepare('INSERT INTO scm_item (account_set_id,code,name,unit) VALUES (?,?,?,?)').run(AID, 'I1', '原料一', '个')
  db.prepare('INSERT INTO scm_bom_line (account_set_id,bom_id,item_code,qty,scrap_rate,seq,line_type) VALUES (?,?,?,?,?,?,?)')
    .run(AID, 'B1', 'I1', 9, 0, 1, 'component')
  // 单据方向配置
  const dt = db.prepare('INSERT INTO scm_doc_type (account_set_id,code,direction) VALUES (?,?,?)')
  dt.run(AID, 'PL', 'out'); dt.run(AID, 'PB', 'out'); dt.run(AID, 'PJ', 'in'); dt.run(AID, 'WO', 'out')
  return db
}

const PLAN = { id: 'P1', bom_id: 'B1', plan_qty: 10, yl_warehouse: 'W1' }
const RELEASED_PLAN = { ...PLAN, status: 'released', plan_type: 'self' }

function addProduct(db: Database.Database, finishedQty = 0) {
  db.prepare(`INSERT INTO scm_production_plan_product
    (id,account_set_id,plan_id,seq,item_code,plan_qty,bom_id,fp_warehouse,finished_qty,scrap_qty)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('P1-PROD', AID, 'P1', 1, 'P', 10, 'B1', 'W2', finishedQty, 0)
}

// 生成一张关联工单的领料单（含一条 I1 明细）
function addIssueDoc(db: Database.Database, no: string, status: string, qty: number, type = 'PL') {
  db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,plan_id,status) VALUES (?,?,?,?,?,?)')
    .run(no, AID, type, no, 'P1', status)
  db.prepare('INSERT INTO scm_doc_line (id,doc_id,account_set_id,item_code,qty) VALUES (?,?,?,?,?)')
    .run(no + '-L1', no, AID, 'I1', qty)
  if (status === 'audited') {
    db.prepare('INSERT INTO scm_stock_move (id,account_set_id,doc_type,doc_no,item_code,direction,qty) VALUES (?,?,?,?,?,?,?)')
      .run(no + '-M1', AID, type, no, 'I1', type === 'PJ' ? 'in' : 'out', qty)
  }
}

describe('computeIssueSuggestion 领料建议（防重复领料）', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })

  it('无任何领料单时，建议=应领（10×9=90）', () => {
    const [l] = computeIssueSuggestion(db, AID, PLAN)
    expect(l).toMatchObject({ item_code: 'I1', need: 90, issued: 0, suggest: 90 })
  })

  it('已存在「未审核」领料草稿时，应计入已领，建议归零（防止重复领料）', () => {
    addIssueDoc(db, 'PL-001', 'draft', 90)
    const [l] = computeIssueSuggestion(db, AID, PLAN)
    expect(l.issued).toBe(90)
    expect(l.suggest).toBe(0)
  })

  it('已审核领料单同样计入已领', () => {
    addIssueDoc(db, 'PL-001', 'audited', 90)
    const [l] = computeIssueSuggestion(db, AID, PLAN)
    expect(l.issued).toBe(90)
    expect(l.suggest).toBe(0)
  })

  it('草稿部分领料后，仅就剩余给出建议', () => {
    addIssueDoc(db, 'PL-001', 'draft', 30)
    const [l] = computeIssueSuggestion(db, AID, PLAN)
    expect(l.issued).toBe(30)
    expect(l.suggest).toBe(60)
  })

  it('已审核领料 + 未审核退料草稿(PJ in) 抵消计算', () => {
    addIssueDoc(db, 'PL-001', 'audited', 90)
    addIssueDoc(db, 'PJ-001', 'draft', 20, 'PJ')
    const [l] = computeIssueSuggestion(db, AID, PLAN)
    expect(l.issued).toBe(70)
    expect(l.suggest).toBe(20)
  })
})

describe('computeProductionPlanActionState 工单动作状态', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb(); addProduct(db) })

  it('未领料且未完工时，两项动作均可执行', () => {
    expect(computeProductionPlanActionState(db, AID, RELEASED_PLAN)).toEqual({
      issue: { status: 'available', remaining_qty: 90, remaining_lines: 1, base_remaining: 90, max_allowed_qty: 90, overrun_remaining: 90 },
      finish: { status: 'available', remaining_qty: 10, remaining_lines: 1, base_remaining: 10, max_allowed_qty: 10, overrun_remaining: 10 },
    })
  })

  it('复用已计算的领料建议时，动作状态与独立计算保持一致', () => {
    const issueRows = computeIssueSuggestion(db, AID, RELEASED_PLAN)
    expect(computeProductionPlanActionState(db, AID, RELEASED_PLAN, issueRows))
      .toEqual(computeProductionPlanActionState(db, AID, RELEASED_PLAN))
  })

  it('领料草稿占满需求时标记为草稿阻塞，不误判已领齐', () => {
    addIssueDoc(db, 'PL-001', 'draft', 90)
    const state = computeProductionPlanActionState(db, AID, RELEASED_PLAN)
    expect(state.issue.status).toBe('blocked_draft')
    expect(state.issue.draft_doc?.doc_no).toBe('PL-001')
  })

  it('审核领料达到需求后标记已领齐，退料后恢复可领', () => {
    addIssueDoc(db, 'PL-001', 'audited', 90)
    expect(computeProductionPlanActionState(db, AID, RELEASED_PLAN).issue.status).toBe('completed')
    addIssueDoc(db, 'PJ-001', 'audited', 20, 'PJ')
    const restored = computeProductionPlanActionState(db, AID, RELEASED_PLAN).issue
    expect(restored).toMatchObject({ status: 'available', remaining_qty: 20, remaining_lines: 1 })
  })

  it('P2-18 完工草稿 / 分批完工不锁定领料，工单全部完工后锁定', () => {
    addIssueDoc(db, 'PF-DRAFT', 'draft', 1, 'PF')
    expect(computeProductionPlanActionState(db, AID, RELEASED_PLAN).issue.status).toBe('available')

    // 第一批完工已审核但未做完：剩余批次仍可领料
    addIssueDoc(db, 'PF-001', 'audited', 4, 'PF')
    db.prepare('UPDATE scm_production_plan_product SET finished_qty=4 WHERE id=?').run('P1-PROD')
    expect(computeProductionPlanActionState(db, AID, RELEASED_PLAN).issue.status).toBe('available')

    db.prepare('UPDATE scm_production_plan_product SET finished_qty=8, scrap_qty=2 WHERE id=?').run('P1-PROD')
    expect(computeProductionPlanActionState(db, AID, RELEASED_PLAN).issue).toMatchObject({
      status: 'unavailable',
      reason: '工单已全部完工（末批 完工入库单 PF-001），领料已锁定',
    })
  })

  it('委外工单全部入库后锁定委外发货', () => {
    addIssueDoc(db, 'WI-001', 'audited', 10, 'WI')
    db.prepare('UPDATE scm_production_plan_product SET finished_qty=10 WHERE id=?').run('P1-PROD')
    const state = computeProductionPlanActionState(db, AID, { ...RELEASED_PLAN, plan_type: 'outsource' }).issue
    expect(state).toMatchObject({
      status: 'unavailable',
      reason: '工单已全部完工（末批 委外入库单 WI-001），领料已锁定',
    })
  })

  it('成品全部完工后标记已完工，关闭工单后所有动作不可用', () => {
    db.prepare('UPDATE scm_production_plan_product SET finished_qty=10 WHERE id=?').run('P1-PROD')
    expect(computeProductionPlanActionState(db, AID, RELEASED_PLAN).finish.status).toBe('completed')
    const closed = computeProductionPlanActionState(db, AID, { ...RELEASED_PLAN, status: 'closed' })
    expect(closed.issue.status).toBe('unavailable')
    expect(closed.finish.status).toBe('unavailable')
  })

  it('生产超量额度保持默认建议为零，但动作状态保留可追加额度', () => {
    addIssueDoc(db, 'PL-001', 'audited', 90)
    db.prepare('UPDATE scm_production_plan_product SET finished_qty=10 WHERE id=?').run('P1-PROD')
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:production_overrun_enabled', '1')
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:production_overrun_rate', '10')

    const [suggestion] = computeIssueSuggestion(db, AID, RELEASED_PLAN)
    expect(suggestion.suggest).toBe(0)
    expect(computeProductionPlanActionState(db, AID, RELEASED_PLAN)).toMatchObject({
      issue: {
        status: 'available',
        remaining_qty: 0,
        base_remaining: 0,
        max_allowed_qty: 99,
        overrun_remaining: 9,
      },
      finish: {
        status: 'available',
        remaining_qty: 0,
        base_remaining: 0,
        max_allowed_qty: 11,
        overrun_remaining: 1,
      },
    })
  })

  it('无 BOM 和用料的历史工单标记无需领料', () => {
    const noMaterialPlan = { ...RELEASED_PLAN, id: 'P2', bom_id: null }
    db.prepare(`INSERT INTO scm_production_plan_product
      (id,account_set_id,plan_id,seq,item_code,plan_qty,bom_id,fp_warehouse,finished_qty,scrap_qty)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('P2-PROD', AID, 'P2', 1, 'P2', 5, null, 'W2', 0, 0)
    expect(computeProductionPlanActionState(db, AID, noMaterialPlan).issue.status).toBe('not_required')
  })
})
