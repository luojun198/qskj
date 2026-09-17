import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { applyMrpAdjustments, calculateMrpDocument, createMrpDocument, generateShortageFromMrp, getMrpDocumentSourceDetails, getMrpSourceState, listMrpSourceOptions } from '../services/scmMrpDocument.js'
import { buildMrPushPreview } from '../services/scmMrPush.js'

const AID = 'A1'

describe('MRP 计算单生命周期与预计算缺料单', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE system_params (account_set_id TEXT,param_key TEXT,param_value TEXT);
      CREATE TABLE scm_doc (
        id TEXT PRIMARY KEY,account_set_id TEXT,doc_type TEXT,doc_no TEXT,doc_date TEXT,
        operator TEXT,maker TEXT,status TEXT,source_doc_id TEXT,total_qty REAL,total_amount REAL,
        remark TEXT,field_values TEXT,expect_date TEXT,partner_code TEXT,created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT
      );
      CREATE TABLE scm_doc_line (
        id TEXT PRIMARY KEY,account_set_id TEXT,doc_id TEXT,seq INTEGER,item_code TEXT,
        warehouse_code TEXT,qty REAL,price REAL,amount REAL,source_line_id TEXT,remark TEXT,
        field_values TEXT,supplier_code TEXT,source_type TEXT
      );
      CREATE TABLE scm_mrp_source (
        id TEXT PRIMARY KEY,account_set_id TEXT,mrp_doc_id TEXT,source_kind TEXT,source_id TEXT,
        source_no TEXT,source_key TEXT,source_line_id TEXT,item_code TEXT,demand_qty REAL,
        allocated_net_qty REAL,need_date TEXT,priority INTEGER,snapshot_json TEXT
      );
      CREATE TABLE scm_item (
        account_set_id TEXT,code TEXT,name TEXT,spec TEXT,unit TEXT,source_type TEXT,
        supplier_code TEXT,purchase_price REAL,safety_stock REAL,min_order_qty REAL,lead_time_days REAL
      );
      CREATE TABLE scm_partner (id TEXT,account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_stock (account_set_id TEXT,item_code TEXT,warehouse_code TEXT,qty REAL);
      CREATE TABLE scm_bom (version TEXT, effective_date TEXT, expire_date TEXT, id TEXT,account_set_id TEXT,item_code TEXT,code TEXT,status TEXT,is_default INTEGER);
      CREATE TABLE scm_bom_line (unit TEXT, remark TEXT, sub_group TEXT, sub_priority INTEGER, id TEXT,bom_id TEXT,seq INTEGER,item_code TEXT,qty REAL,scrap_rate REAL,line_type TEXT);
      CREATE TABLE scm_production_plan (
        id TEXT,account_set_id TEXT,code TEXT,status TEXT,source_doc_id TEXT,plan_type TEXT,priority INTEGER,
        start_date TEXT,end_date TEXT,yl_warehouse TEXT,supplier_code TEXT
      );
      CREATE TABLE scm_production_plan_product (
        id TEXT,account_set_id TEXT,plan_id TEXT,item_code TEXT,plan_qty REAL,finished_qty REAL,source_line_id TEXT
      );
      CREATE TABLE scm_production_plan_line (
        id TEXT,account_set_id TEXT,plan_id TEXT,product_id TEXT,item_code TEXT,warehouse_code TEXT,qty REAL,scrap_rate REAL
      );
      CREATE TABLE scm_stock_move (account_set_id TEXT,item_code TEXT,qty REAL,direction TEXT,doc_type TEXT,doc_no TEXT);
    `)

    db.prepare(`INSERT INTO scm_doc
      (id,account_set_id,doc_type,doc_no,doc_date,status,total_qty,total_amount,expect_date,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('SO1', AID, 'SOa', 'SO-001', '2026-07-17', 'audited', 10, 0, '2026-07-20', '{}')
    db.prepare("UPDATE scm_doc SET partner_code='C1' WHERE id='SO1'").run()
    db.prepare('INSERT INTO scm_partner VALUES (?,?,?,?)').run('P1', AID, 'C1', '甲客户')
    db.prepare(`INSERT INTO scm_doc_line
      (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('SO-L1', AID, 'SO1', 1, '9005', 'W1', 10, 0, 0, '{}')

    const item = db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    item.run(AID, '9005', '成品', '', '件', 'self', '', 0, 0, 0, 1)
    item.run(AID, '9002', '半成品', '', '件', 'self', '', 0, 0, 0, 1)
    item.run(AID, 'R1', '原料', '', '件', 'purchase', 'S1', 2, 0, 0, 3)
    const bom = db.prepare('INSERT INTO scm_bom (id,account_set_id,item_code,code,status,is_default) VALUES (?,?,?,?,?,?)')
    bom.run('B1', AID, '9005', 'BOM-9005', 'active', 1)
    bom.run('B2', AID, '9002', 'BOM-9002', 'active', 1)
    const line = db.prepare('INSERT INTO scm_bom_line (id,bom_id,seq,item_code,qty,scrap_rate,line_type) VALUES (?,?,?,?,?,?,?)')
    line.run('B1-L1', 'B1', 1, '9002', 1, 0, 'component')
    line.run('B2-L1', 'B2', 1, 'R1', 3, 0, 'component')
  })

  it('保存多层结果并让缺料单直接读取快照，不再次展开或扣库存', () => {
    const created = createMrpDocument(db, AID, 'tester', {
      sources: [{ kind: 'sales_order', id: 'SO1' }], include_safety_stock: true,
    })
    const results = db.prepare('SELECT item_code,qty,field_values FROM scm_doc_line WHERE doc_id=? ORDER BY seq').all(created.id) as any[]
    expect(results.map(row => [row.item_code, row.qty, JSON.parse(row.field_values).level])).toEqual([
      ['9005', 10, 0], ['9002', 10, 1], ['R1', 30, 2],
    ])

    db.prepare("UPDATE scm_doc SET status='audited' WHERE id=?").run(created.id)
    const shortage = generateShortageFromMrp(db, AID, created.id, 'tester')
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?)').run(AID, 'R1', 'W1', 999)
    const preview = buildMrPushPreview(db, AID, shortage.id)

    expect(preview.nodes.map(node => [node.item_code, node.level, node.suggest_qty])).toEqual([
      ['9005', 0, 10], ['9002', 1, 10], ['R1', 2, 30],
    ])
    expect(generateShortageFromMrp(db, AID, created.id, 'tester')).toMatchObject({ id: shortage.id, reused: true })
  })

  it('FIX-217 仅设安全库存、无任何需求的物料也进入 MRP 结果（关闭开关则不出现）', () => {
    db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(AID, 'SS1', '安全库存件', '', '件', 'purchase', 'S1', 5, 20, 0, 2)
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?)').run(AID, 'SS1', 'W1', 8)
    const created = createMrpDocument(db, AID, 'tester', {
      sources: [{ kind: 'sales_order', id: 'SO1' }], include_safety_stock: true,
    })
    const rows = db.prepare('SELECT item_code,qty,field_values FROM scm_doc_line WHERE doc_id=? ORDER BY seq').all(created.id) as any[]
    const ss = rows.find(row => row.item_code === 'SS1')
    expect(ss).toBeTruthy()
    expect(ss.qty).toBe(12)   // 安全库存 20 − 在库 8
    expect(JSON.parse(ss.field_values)).toMatchObject({ level: 0, gross_req: 0, safety_stock: 20, net_req: 12 })

    // 关闭「纳入安全库存」重算：纯安全库存物料不再出现
    const fv = JSON.parse((db.prepare('SELECT field_values FROM scm_doc WHERE id=?').get(created.id) as any).field_values)
    db.prepare('UPDATE scm_doc SET field_values=? WHERE id=?').run(JSON.stringify({ ...fv, include_safety_stock: false }), created.id)
    calculateMrpDocument(db, AID, created.id)
    const offRows = db.prepare('SELECT item_code FROM scm_doc_line WHERE doc_id=?').all(created.id) as any[]
    expect(offRows.some(row => row.item_code === 'SS1')).toBe(false)
  })

  it('需求放大比例、固定追加和物料目标量按既定优先级计算', () => {
    const created = createMrpDocument(db, AID, 'tester', {
      sources: [{ kind: 'sales_order', id: 'SO1' }],
      demand_multiplier: 120,
      item_target_qty: { '9005': 18 },
    })
    db.prepare("UPDATE scm_mrp_source SET snapshot_json=? WHERE mrp_doc_id=? AND item_code='9005'")
      .run(JSON.stringify({ warehouse_code: 'W1', extra_qty: 2 }), created.id)
    calculateMrpDocument(db, AID, created.id)

    const results = db.prepare('SELECT item_code,qty,field_values FROM scm_doc_line WHERE doc_id=? ORDER BY seq').all(created.id) as any[]
    expect(results.map(row => [row.item_code, row.qty])).toEqual([
      ['9005', 18], ['9002', 18], ['R1', 54],
    ])
    expect(JSON.parse(results[0].field_values)).toMatchObject({
      base_direct_gross_qty: 10,
      multiplied_direct_gross_qty: 12,
      fixed_extra_qty: 2,
      item_target_qty: 18,
      target_overridden: true,
    })
  })

  it('固定追加量在重新计算时保留，并在比例后累加', () => {
    const created = createMrpDocument(db, AID, 'tester', {
      sources: [{ kind: 'sales_order', id: 'SO1' }], demand_multiplier: 120,
    })
    db.prepare("UPDATE scm_mrp_source SET snapshot_json=? WHERE mrp_doc_id=? AND item_code='9005'")
      .run(JSON.stringify({ warehouse_code: 'W1', extra_qty: 2 }), created.id)
    calculateMrpDocument(db, AID, created.id)

    const root = db.prepare("SELECT qty,field_values FROM scm_doc_line WHERE doc_id=? AND item_code='9005'").get(created.id) as any
    expect(root.qty).toBe(14)
    expect(JSON.parse(root.field_values)).toMatchObject({
      base_direct_gross_qty: 10, multiplied_direct_gross_qty: 12, fixed_extra_qty: 2, target_overridden: false,
    })
  })

  it('比例需求向上取整，并将目标需求量按调整后权重整数分摊到来源明细', () => {
    db.prepare(`INSERT INTO scm_doc
      (id,account_set_id,doc_type,doc_no,doc_date,status,total_qty,total_amount,expect_date,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('SO2', AID, 'SOa', 'SO-002', '2026-07-17', 'audited', 20, 0, '2026-07-20', '{}')
    db.prepare(`INSERT INTO scm_doc_line
      (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('SO-L2', AID, 'SO2', 1, '9005', 'W1', 20, 0, 0, '{}')
    const created = createMrpDocument(db, AID, 'tester', {
      sources: [{ kind: 'sales_order', id: 'SO1' }, { kind: 'sales_order', id: 'SO2' }],
      demand_multiplier: 105,
      item_target_qty: { '9005': 45 },
    })

    const sources = db.prepare('SELECT source_no,snapshot_json FROM scm_mrp_source WHERE mrp_doc_id=? ORDER BY source_no').all(created.id) as any[]
    expect(sources.map(row => {
      const snapshot = JSON.parse(row.snapshot_json)
      return [row.source_no, snapshot.multiplied_qty, snapshot.target_allocated_qty, snapshot.final_demand_qty]
    })).toEqual([
      ['SO-001', 11, 15, 15],
      ['SO-002', 21, 30, 30],
    ])

    const root = db.prepare("SELECT qty,field_values FROM scm_doc_line WHERE doc_id=? AND item_code='9005'").get(created.id) as any
    expect(root.qty).toBe(45)
    expect(JSON.parse(root.field_values)).toMatchObject({
      direct_gross_qty: 45,
      multiplied_direct_gross_qty: 32,
      final_direct_gross_qty: 45,
      target_overridden: true,
    })
  })

  it('保存调整时写入比例、物料目标量和来源固定追加量', () => {
    const created = createMrpDocument(db, AID, 'tester', { sources: [{ kind: 'sales_order', id: 'SO1' }] })
    const source = db.prepare('SELECT id FROM scm_mrp_source WHERE mrp_doc_id=?').get(created.id) as any
    const fields = applyMrpAdjustments(db, AID, created.id, {}, {
      demand_multiplier: 125,
      item_target_qty: { '9005': 16, ignored: 0 },
      source_adjustments: [{ id: source.id, extra_qty: 3 }],
    })

    expect(fields).toMatchObject({ demand_multiplier: 125, item_target_qty: { '9005': 16 } })
    const saved = db.prepare('SELECT snapshot_json FROM scm_mrp_source WHERE id=?').get(source.id) as any
    expect(JSON.parse(saved.snapshot_json)).toMatchObject({ extra_qty: 3 })
  })

  it('已审核 MRP 可直接读取分层快照，并按结果行扣减已生成数量', () => {
    const created = createMrpDocument(db, AID, 'tester', {
      sources: [{ kind: 'sales_order', id: 'SO1' }], include_safety_stock: true,
    })
    db.prepare("UPDATE scm_doc SET status='audited' WHERE id=?").run(created.id)
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?)').run(AID, 'R1', 'W1', 999)

    const initial = buildMrPushPreview(db, AID, created.id)
    expect(initial.nodes.map(node => [node.item_code, node.level, node.suggest_qty])).toEqual([
      ['9005', 0, 10], ['9002', 1, 10], ['R1', 2, 30],
    ])

    const rawLine = db.prepare("SELECT id FROM scm_doc_line WHERE doc_id=? AND item_code='R1'").get(created.id) as any
    db.prepare(`INSERT INTO scm_doc
      (id,account_set_id,doc_type,doc_no,doc_date,status,source_doc_id,total_qty,total_amount,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('PO1', AID, 'PO', 'PO-001', '2026-07-17', 'draft', created.id, 12, 0, '{}')
    db.prepare(`INSERT INTO scm_doc_line
      (id,account_set_id,doc_id,seq,item_code,qty,price,amount,source_line_id,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('PO-L1', AID, 'PO1', 1, 'R1', 12, 0, 0, rawLine.id, '{}')

    const afterPush = buildMrPushPreview(db, AID, created.id)
    expect(afterPush.nodes.find(node => node.item_code === 'R1')).toMatchObject({
      required_qty: 30, generated_qty: 12, suggest_qty: 18,
    })
  })

  it('同一来源再次进入时复用原有效 MRP 计算单', () => {
    const first = createMrpDocument(db, AID, 'tester', { sources: [{ kind: 'sales_order', id: 'SO1' }] })
    const second = createMrpDocument(db, AID, 'tester', { sources: [{ kind: 'sales_order', id: 'SO1' }] })
    expect(second).toMatchObject({ id: first.id, reused: true })
    expect(db.prepare("SELECT COUNT(*) count FROM scm_doc WHERE doc_type='MRP'").get()).toMatchObject({ count: 1 })
  })

  it('销售出库草稿不消耗 MRP 需求，审核后才扣减', () => {
    db.prepare(`INSERT INTO scm_doc
      (id,account_set_id,doc_type,doc_no,doc_date,status,source_doc_id,total_qty,total_amount,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('SHIP1', AID, 'SO', 'SHIP-001', '2026-07-17', 'draft', 'SO1', 4, 0, '{}')
    db.prepare(`INSERT INTO scm_doc_line
      (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,source_line_id,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('SHIP-L1', AID, 'SHIP1', 1, '9005', 'W1', 4, 0, 0, 'SO-L1', '{}')

    expect(getMrpSourceState(db, AID, 'sales_order', 'SO1')).toMatchObject({
      status: 'available',
      remaining_qty: 10,
      remaining_lines: 1,
    })

    db.prepare("UPDATE scm_doc SET status='audited' WHERE id='SHIP1'").run()
    expect(getMrpSourceState(db, AID, 'sales_order', 'SO1')).toMatchObject({
      status: 'available',
      remaining_qty: 6,
      remaining_lines: 1,
    })
  })

  it('新增 MRP 来源列表排除已进入有效 MRP 的单据', () => {
    db.prepare(`INSERT INTO scm_doc
      (id,account_set_id,doc_type,doc_no,doc_date,status,total_qty,total_amount,expect_date,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('SO2', AID, 'SOa', 'SO-002', '2026-07-18', 'audited', 5, 0, '2026-07-21', '{}')
    db.prepare(`INSERT INTO scm_doc_line
      (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('SO-L2', AID, 'SO2', 1, '9005', 'W1', 5, 0, 0, '{}')
    createMrpDocument(db, AID, 'tester', { sources: [{ kind: 'sales_order', id: 'SO1' }] })

    const rows = listMrpSourceOptions(db, AID, 'sales_order', '', { excludeOccupied: true })

    expect(rows.map((row: any) => row.id)).toEqual(['SO2'])
  })

  it('编辑 MRP 来源列表保留当前计算单自己的来源', () => {
    const mrp = createMrpDocument(db, AID, 'tester', { sources: [{ kind: 'sales_order', id: 'SO1' }] })

    const rows = listMrpSourceOptions(db, AID, 'sales_order', '', {
      excludeOccupied: true,
      currentMrpId: mrp.id,
    })

    expect(rows.map((row: any) => row.id)).toEqual(['SO1'])
    expect(rows[0]).toMatchObject({ eligible: true, occupied_mrp_id: null })
  })

  it('MRP 详情返回来源单汇总和带物料信息的需求明细', () => {
    const mrp = createMrpDocument(db, AID, 'tester', { sources: [{ kind: 'sales_order', id: 'SO1' }] })

    const detail = getMrpDocumentSourceDetails(db, AID, mrp.id)

    expect(detail.source_summaries).toEqual([expect.objectContaining({
      kind: 'sales_order', id: 'SO1', source_no: 'SO-001', doc_date: '2026-07-17',
      status: 'audited', partner_code: 'C1', partner_name: '甲客户',
      demand_line_count: 1, demand_qty: 10, earliest_need_date: '2026-07-20',
    })])
    expect(detail.sources).toEqual([expect.objectContaining({
      source_id: 'SO1', source_line_id: 'SO-L1', source_line_seq: 1,
      item_code: '9005', item_name: '成品', spec: '', unit: '件',
      demand_qty: 10, allocated_net_qty: 10, need_date: '2026-07-20',
    })])
  })
})
