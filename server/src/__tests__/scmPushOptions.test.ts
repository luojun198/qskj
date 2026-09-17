import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildScmPushOptions } from '../services/scmPushOptions.js'
import { findActiveMrpSource } from '../services/scmMrpDocument.js'

const AID = 'A1'
let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc (
      id TEXT PRIMARY KEY, account_set_id TEXT, doc_type TEXT, doc_no TEXT, doc_date TEXT,
      status TEXT, source_doc_id TEXT, plan_id TEXT, expect_date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE scm_doc_line (
      id TEXT PRIMARY KEY, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT,
      qty REAL, warehouse_code TEXT, source_line_id TEXT, source_type TEXT, supplier_code TEXT
    );
    CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, direction TEXT);
    CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, unit TEXT);
    CREATE TABLE scm_stock (account_set_id TEXT, item_code TEXT, warehouse_code TEXT, qty REAL);
    CREATE TABLE system_params (account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_stock_move (
      account_set_id TEXT, item_code TEXT, direction TEXT, qty REAL, doc_type TEXT, doc_no TEXT
    );
    CREATE TABLE scm_production_plan (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, plan_type TEXT, status TEXT,
      plan_qty REAL, yl_warehouse TEXT, bom_id TEXT, source_doc_id TEXT,
      start_date TEXT, end_date TEXT, priority INTEGER
    );
    CREATE TABLE scm_production_plan_product (
      id TEXT PRIMARY KEY, account_set_id TEXT, plan_id TEXT, seq INTEGER, item_code TEXT,
      plan_qty REAL, finished_qty REAL DEFAULT 0, scrap_qty REAL DEFAULT 0, source_line_id TEXT, bom_id TEXT
    );
    CREATE TABLE scm_production_plan_line (
      id TEXT PRIMARY KEY, account_set_id TEXT, plan_id TEXT, product_id TEXT, seq INTEGER,
      item_code TEXT, qty REAL, scrap_rate REAL DEFAULT 0, warehouse_code TEXT
    );
    CREATE TABLE scm_mrp_source (
      id TEXT PRIMARY KEY, account_set_id TEXT, mrp_doc_id TEXT, source_kind TEXT,
      source_id TEXT, item_code TEXT, demand_qty REAL, allocated_net_qty REAL DEFAULT 0, snapshot_json TEXT
    );
  `)
  db.prepare("INSERT INTO scm_doc_type VALUES (?,?,?)").run(AID, 'PL', 'out')
  db.prepare("INSERT INTO scm_doc_type VALUES (?,?,?)").run(AID, 'WO', 'out')
  db.prepare("INSERT INTO scm_doc_type VALUES (?,?,?)").run(AID, 'PF', 'in')
  db.prepare("INSERT INTO scm_doc_type VALUES (?,?,?)").run(AID, 'WI', 'in')
})

afterEach(() => db.close())

function seedPlan(planType: 'self' | 'outsource' = 'self') {
  db.prepare(`INSERT INTO scm_production_plan
    (id,account_set_id,code,plan_type,status,plan_qty,yl_warehouse,start_date)
    VALUES ('P1',?,'PP-001',?,'released',10,'RM','2026-07-17')`).run(AID, planType)
  db.prepare("INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty,finished_qty) VALUES ('PP1',?,'P1',1,'FG',10,0)").run(AID)
  db.prepare("INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,product_id,seq,item_code,qty,scrap_rate,warehouse_code) VALUES ('L1',?,'P1','PP1',1,'RM1',1,0,'RM')").run(AID)
  db.prepare("INSERT INTO scm_item VALUES (?,?,?,?)").run(AID, 'RM1', '原料1', '个')
}

describe('统一下推目标状态', () => {
  it('生产计划同时提供 MRP、领料和完工，领料草稿会阻止重复生成并允许打开', () => {
    seedPlan('self')
    let actions = buildScmPushOptions(db, AID, 'production_plan', 'P1')
    expect(actions.map(action => [action.action, action.status])).toEqual([
      ['mrp', 'available'], ['issue', 'available'], ['finish', 'available'],
    ])

    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,plan_id) VALUES ('D1',?,'PL','PL-001','draft','P1')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty) VALUES ('DL1',?,'D1',1,'RM1',10)").run(AID)
    actions = buildScmPushOptions(db, AID, 'production_plan', 'P1')
    const issue = actions.find(action => action.action === 'issue')!
    expect(issue.status).toBe('blocked_draft')
    expect(issue.existing_doc?.doc_no).toBe('PL-001')
  })

  it('委外计划返回委外发货和委外入库目标', () => {
    seedPlan('outsource')
    const actions = buildScmPushOptions(db, AID, 'outsource_plan', 'P1')
    expect(actions.find(action => action.action === 'issue')?.target_doc_type).toBe('WO')
    expect(actions.find(action => action.action === 'finish')?.target_doc_type).toBe('WI')
  })

  it('销售订单按可发库存和缺口同时开放销售出库与 MRP', () => {
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,status) VALUES ('SOA1',?,'SOa','SOA-001','2026-07-17','audited')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,warehouse_code) VALUES ('SOL1',?,'SOA1',1,'FG',10,'FG')").run(AID)
    db.prepare("INSERT INTO scm_stock VALUES (?,?,?,?)").run(AID, 'FG', 'FG', 4)

    const actions = buildScmPushOptions(db, AID, 'sales_order', 'SOA1')
    const dispatch = actions.find(action => action.action === 'sales_dispatch')!
    const mrp = actions.find(action => action.action === 'mrp')!
    expect(dispatch.status).toBe('available')
    expect(dispatch.remaining_qty).toBe(10)
    expect(dispatch.remaining_lines).toBe(1)
    expect(mrp.status).toBe('available')
  })

  it('销售订单零库存时仍允许生成按正常剩余量预填的销售出库草稿', () => {
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,status) VALUES ('SOA1',?,'SOa','SOA-001','2026-07-17','audited')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,warehouse_code) VALUES ('SOL1',?,'SOA1',1,'FG',10,'FG')").run(AID)

    const actions = buildScmPushOptions(db, AID, 'sales_order', 'SOA1')
    const dispatch = actions.find(action => action.action === 'sales_dispatch')!
    expect(dispatch).toMatchObject({
      status: 'available',
      remaining_qty: 10,
      remaining_lines: 1,
      base_remaining: 10,
      reason: '当前库存不足，可先保存草稿，审核时校验库存',
    })
  })

  it('销售订单已有销售出库草稿时仍允许生成 MRP', () => {
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,status) VALUES ('SOA1',?,'SOa','SOA-001','2026-07-17','audited')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,warehouse_code) VALUES ('SOL1',?,'SOA1',1,'FG',10,'FG')").run(AID)
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,status,source_doc_id) VALUES ('SO1',?,'SO','SO-001','2026-07-17','draft','SOA1')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,warehouse_code,source_line_id) VALUES ('S1L1',?,'SO1',1,'FG',10,'FG','SOL1')").run(AID)

    const actions = buildScmPushOptions(db, AID, 'sales_order', 'SOA1')
    const dispatch = actions.find(action => action.action === 'sales_dispatch')!
    const mrp = actions.find(action => action.action === 'mrp')!

    expect(dispatch).toMatchObject({ status: 'blocked_draft', existing_doc: { id: 'SO1' } })
    expect(mrp).toMatchObject({ status: 'available', remaining_qty: 10, remaining_lines: 1 })
  })

  it('销售订单部分已发且当前零库存时仍可继续生成草稿', () => {
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,status) VALUES ('SOA1',?,'SOa','SOA-001','2026-07-17','audited')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,warehouse_code) VALUES ('SOL1',?,'SOA1',1,'FG',10,'FG')").run(AID)
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,status,source_doc_id) VALUES ('SO1',?,'SO','SO-001','2026-07-17','audited','SOA1')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,warehouse_code,source_line_id) VALUES ('S1L1',?,'SO1',1,'FG',4,'FG','SOL1')").run(AID)

    const dispatch = buildScmPushOptions(db, AID, 'sales_order', 'SOA1')
      .find(action => action.action === 'sales_dispatch')!
    expect(dispatch).toMatchObject({ status: 'partial', remaining_qty: 6, remaining_lines: 1 })
  })

  it('销售订单已有出库草稿时返回原草稿，正常剩余量为零时判定完成', () => {
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,status) VALUES ('SOA1',?,'SOa','SOA-001','2026-07-17','audited')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,warehouse_code) VALUES ('SOL1',?,'SOA1',1,'FG',10,'FG')").run(AID)
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,status,source_doc_id) VALUES ('SO1',?,'SO','SO-001','2026-07-17','draft','SOA1')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,warehouse_code,source_line_id) VALUES ('S1L1',?,'SO1',1,'FG',10,'FG','SOL1')").run(AID)

    let dispatch = buildScmPushOptions(db, AID, 'sales_order', 'SOA1')
      .find(action => action.action === 'sales_dispatch')!
    expect(dispatch.status).toBe('blocked_draft')
    expect(dispatch.existing_doc).toMatchObject({ id: 'SO1', doc_no: 'SO-001', status: 'draft' })

    db.prepare("UPDATE scm_doc SET status='audited' WHERE id='SO1'").run()
    dispatch = buildScmPushOptions(db, AID, 'sales_order', 'SOA1')
      .find(action => action.action === 'sales_dispatch')!
    expect(dispatch).toMatchObject({ status: 'completed', remaining_qty: 0, remaining_lines: 0 })
  })

  it('已有 MRP 时不创建第二入口而是返回原计算单', () => {
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,status) VALUES ('AS1',?,'AS','AS-001','2026-07-17','draft')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty) VALUES ('ASL1',?,'AS1',1,'RM1',2)").run(AID)
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,status) VALUES ('M1',?,'MRP','MRP-001','2026-07-17','draft')").run(AID)
    db.prepare("INSERT INTO scm_mrp_source (id,account_set_id,mrp_doc_id,source_kind,source_id,demand_qty,snapshot_json) VALUES ('MS1',?,'M1','assembly','AS1',2,'{}')").run(AID)

    const [mrp] = buildScmPushOptions(db, AID, 'assembly', 'AS1')
    expect(mrp.status).toBe('blocked_draft')
    expect(mrp.existing_doc).toMatchObject({ id: 'M1', doc_no: 'MRP-001', status: 'draft' })
    expect(findActiveMrpSource(db, AID, 'assembly', 'AS1')).toMatchObject({ id: 'M1', doc_no: 'MRP-001', status: 'draft' })

    db.prepare("UPDATE scm_doc SET status='deleted' WHERE id='M1'").run()
    expect(findActiveMrpSource(db, AID, 'assembly', 'AS1')).toBeUndefined()
  })
})
