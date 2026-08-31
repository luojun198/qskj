import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  computeSourceLineUsedQty,
  findDraftDocumentUsingSourceLines,
  validateFinishKitting,
  validatePlanFinishQuantities,
  validatePlanIssueQuantities,
  validatePlanLink,
  validateSourceLineQuantities,
} from '../services/scmDocumentControls.js'

const AID = 'A1'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, plan_id TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, item_code TEXT, qty REAL, source_line_id TEXT, field_values TEXT DEFAULT '{}');
    CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, code TEXT, status TEXT, plan_type TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, item_code TEXT, plan_qty REAL, finished_qty REAL);
    CREATE TABLE scm_production_plan_line (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT, item_code TEXT, qty REAL, scrap_rate REAL);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, item_code TEXT, direction TEXT, qty REAL);
  `)
  db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?)').run('PO1', AID, 'PO', 'PO-001', 'audited', null)
  db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?)').run('POL1', AID, 'PO1', 'M1', 100, null, '{}')
  db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?)').run('SOA1', AID, 'SOa', 'SO-001', 'audited', null)
  db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?)').run('SOAL1', AID, 'SOA1', 'FG1', 100, null, '{}')
  db.prepare('INSERT INTO scm_production_plan VALUES (?,?,?,?,?)').run('P1', AID, 'MO-001', 'released', 'self')
  db.prepare('INSERT INTO scm_production_plan_product VALUES (?,?,?,?,?,?)').run('PP1', AID, 'P1', 'FG1', 10, 0)
  db.prepare('INSERT INTO scm_production_plan_line VALUES (?,?,?,?,?,?,?)').run('PLN1', AID, 'P1', 'PP1', 'RM1', 2, 0)
  return db
}

function addDoc(db: Database.Database, id: string, type: string, status: string, item: string, qty: number, sourceLine: string | null = null, planId: string | null = null) {
  db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?)').run(id, AID, type, `${type}-${id}`, status, planId)
  db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?)').run(`${id}-L`, AID, id, item, qty, sourceLine, '{}')
}

describe('供应链单据数量与工单来源控制', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })

  it('合并来源分配已被销售出库草稿占用时能找到原草稿', () => {
    addDoc(db, 'SO-MERGED', 'SO', 'draft', 'FG1', 100)
    db.prepare('UPDATE scm_doc_line SET source_line_id=NULL,field_values=? WHERE id=?').run(JSON.stringify({
      source_line_allocations: [
        { source_line_id: 'SOAL1', qty: 100 },
        { source_line_id: 'OTHER-LINE', qty: 20 },
      ],
    }), 'SO-MERGED-L')

    expect(findDraftDocumentUsingSourceLines(db, AID, 'SO', ['SOAL1'])).toMatchObject({
      id: 'SO-MERGED',
      doc_no: 'SO-SO-MERGED',
      status: 'draft',
    })
  })

  it('采购默认严格收货，开启比例后允许在上限内超收，草稿也占用数量', () => {
    addDoc(db, 'PI1', 'PI', 'draft', 'M1', 90, 'POL1')
    expect(validateSourceLineQuantities(db, AID, 'PI', [{ item_code: 'M1', qty: 11, source_line_id: 'POL1' }])).toContain('超过')
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:purchase_over_receipt_enabled', '1')
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:purchase_over_receipt_rate', '10')
    expect(validateSourceLineQuantities(db, AID, 'PI', [{ item_code: 'M1', qty: 20, source_line_id: 'POL1' }])).toBeNull()
    expect(validateSourceLineQuantities(db, AID, 'PI', [{ item_code: 'M1', qty: 20.001, source_line_id: 'POL1' }])).toContain('超过')
  })

  it('销售默认严格发货，开启比例后允许在上限内超发', () => {
    addDoc(db, 'SO1', 'SO', 'draft', 'FG1', 90, 'SOAL1')
    expect(validateSourceLineQuantities(db, AID, 'SO', [{ item_code: 'FG1', qty: 11, source_line_id: 'SOAL1' }])).toContain('超过')
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:sales_over_delivery_enabled', '1')
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:sales_over_delivery_rate', '10')
    expect(validateSourceLineQuantities(db, AID, 'SO', [{ item_code: 'FG1', qty: 20, source_line_id: 'SOAL1' }])).toBeNull()
    expect(validateSourceLineQuantities(db, AID, 'SO', [{ item_code: 'FG1', qty: 20.000002, source_line_id: 'SOAL1' }])).toContain('超过')
  })

  it('仅已审核销售退货恢复销售订单可发额度', () => {
    addDoc(db, 'SO1', 'SO', 'audited', 'FG1', 100, 'SOAL1')
    addDoc(db, 'SR-DRAFT', 'SR', 'draft', 'FG1', 10, 'SO1-L')
    expect(validateSourceLineQuantities(db, AID, 'SO', [{ item_code: 'FG1', qty: 1, source_line_id: 'SOAL1' }])).toContain('超过')
    db.prepare("UPDATE scm_doc SET status='audited' WHERE id='SR-DRAFT'").run()
    expect(validateSourceLineQuantities(db, AID, 'SO', [{ item_code: 'FG1', qty: 10, source_line_id: 'SOAL1' }])).toBeNull()
  })

  it('修改时排除本单旧数量，作废单不占用', () => {
    addDoc(db, 'PI1', 'PI', 'draft', 'M1', 80, 'POL1')
    addDoc(db, 'PI2', 'PI', 'voided', 'M1', 50, 'POL1')
    expect(validateSourceLineQuantities(db, AID, 'PI', [{ item_code: 'M1', qty: 100, source_line_id: 'POL1' }], 'PI1')).toBeNull()
  })

  it('已审核采购退货释放原采购订单可收数量', () => {
    addDoc(db, 'PI1', 'PI', 'audited', 'M1', 100, 'POL1')
    addDoc(db, 'PR1', 'PR', 'draft', 'M1', 20, 'PI1-L')
    expect(validateSourceLineQuantities(db, AID, 'PI', [{ item_code: 'M1', qty: 1, source_line_id: 'POL1' }])).toContain('超过')
    db.prepare("UPDATE scm_doc SET status='audited' WHERE id='PR1'").run()
    expect(validateSourceLineQuantities(db, AID, 'PI', [{ item_code: 'M1', qty: 20, source_line_id: 'POL1' }])).toBeNull()
    expect(validateSourceLineQuantities(db, AID, 'PI', [{ item_code: 'M1', qty: 20.001, source_line_id: 'POL1' }])).toContain('超过')
  })

  it('工单类型与审核状态必须匹配', () => {
    expect(validatePlanLink(db, AID, 'PL', 'P1').message).toBeUndefined()
    expect(validatePlanLink(db, AID, 'WO', 'P1').message).toContain('委外')
    expect(validatePlanLink(db, AID, 'PF', null).message).toContain('必须关联')
  })

  it('领料、退料与完工数量按工单累计控制', () => {
    addDoc(db, 'ISS1', 'PL', 'draft', 'RM1', 15, null, 'P1')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 6 }])).toContain('禁止超领')
    addDoc(db, 'RET1', 'PJ', 'audited', 'RM1', 5, null, 'P1')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 10 }])).toBeNull()
    addDoc(db, 'FIN1', 'PF', 'draft', 'FG1', 8, null, 'P1')
    expect(validatePlanFinishQuantities(db, AID, 'P1', 'PF', [{ item_code: 'FG1', qty: 3 }])).toContain('禁止超完工')
    expect(validatePlanFinishQuantities(db, AID, 'P1', 'PF', [{ item_code: 'FG1', qty: 2 }])).toBeNull()
  })

  it('生产超量比例同时放宽领料和完工上限', () => {
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:production_overrun_enabled', '1')
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:production_overrun_rate', '10')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 22 }])).toBeNull()
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 22.000002 }])).toContain('禁止超领')
    expect(validatePlanFinishQuantities(db, AID, 'P1', 'PF', [{ item_code: 'FG1', qty: 11 }])).toBeNull()
    expect(validatePlanFinishQuantities(db, AID, 'P1', 'PF', [{ item_code: 'FG1', qty: 11.000002 }])).toContain('禁止超完工')
  })

  it('委外超量使用独立参数，不读取生产超量参数', () => {
    db.prepare('INSERT INTO scm_production_plan VALUES (?,?,?,?,?)').run('P2', AID, 'WW-001', 'released', 'outsource')
    db.prepare('INSERT INTO scm_production_plan_product VALUES (?,?,?,?,?,?)').run('PP2', AID, 'P2', 'OFG1', 10, 0)
    db.prepare('INSERT INTO scm_production_plan_line VALUES (?,?,?,?,?,?,?)').run('PLN2', AID, 'P2', 'PP2', 'ORM1', 2, 0)
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:production_overrun_enabled', '1')
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:production_overrun_rate', '10')
    expect(validatePlanIssueQuantities(db, AID, 'P2', 'WO', [{ item_code: 'ORM1', qty: 21 }])).toContain('禁止超领')
    expect(validatePlanFinishQuantities(db, AID, 'P2', 'WI', [{ item_code: 'OFG1', qty: 11 }])).toContain('禁止超完工')
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:outsource_overrun_enabled', '1')
    db.prepare('INSERT INTO system_params VALUES (?,?,?)').run(AID, 'scm:outsource_overrun_rate', '10')
    expect(validatePlanIssueQuantities(db, AID, 'P2', 'WO', [{ item_code: 'ORM1', qty: 22 }])).toBeNull()
    expect(validatePlanFinishQuantities(db, AID, 'P2', 'WI', [{ item_code: 'OFG1', qty: 11 }])).toBeNull()
  })

  it('已审核完工单锁定领料，草稿完工单不影响补料', () => {
    addDoc(db, 'FIN-DRAFT', 'PF', 'draft', 'FG1', 1, null, 'P1')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 1 }])).toBeNull()

    addDoc(db, 'FIN-AUDITED', 'PF', 'audited', 'FG1', 1, null, 'P1')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 1 }]))
      .toContain('领料已锁定')
  })

  it('已审核委外入库锁定委外发货', () => {
    addDoc(db, 'WI-AUDITED', 'WI', 'audited', 'FG1', 1, null, 'P1')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'WO', [{ item_code: 'RM1', qty: 1 }]))
      .toContain('领料已锁定')
  })

  it('完工审核按累计完工应耗校验已审核净领料', () => {
    addDoc(db, 'ISS1', 'PL', 'audited', 'RM1', 8, null, 'P1')
    db.prepare('INSERT INTO scm_stock_move VALUES (?,?,?,?,?,?,?)').run('M1', AID, 'PL', 'PL-ISS1', 'RM1', 'out', 8)
    expect(validateFinishKitting(db, AID, 'P1', [{ item_code: 'FG1', qty: 5 }])).toContain('缺')
    db.prepare('UPDATE scm_stock_move SET qty=10 WHERE id=?').run('M1')
    expect(validateFinishKitting(db, AID, 'P1', [{ item_code: 'FG1', qty: 5 }])).toBeNull()
  })

  it('合并出库行按来源分配数量校验并占用各订单行', () => {
    const line = {
      item_code: 'FG1', qty: 100,
      field_values: { source_line_allocations: [{ source_line_id: 'SOAL1', qty: 100 }] },
    }
    expect(validateSourceLineQuantities(db, AID, 'SO', [line])).toBeNull()
    addDoc(db, 'SO-MERGED', 'SO', 'draft', 'FG1', 100)
    db.prepare('UPDATE scm_doc_line SET field_values=? WHERE id=?')
      .run(JSON.stringify(line.field_values), 'SO-MERGED-L')
    expect(validateSourceLineQuantities(db, AID, 'SO', [{ ...line, qty: 1, field_values: { source_line_allocations: [{ source_line_id: 'SOAL1', qty: 1 }] } }])).toContain('超过')
    expect(validateSourceLineQuantities(db, AID, 'SO', [{ ...line, qty: 101, field_values: { source_line_allocations: [{ source_line_id: 'SOAL1', qty: 101 }] } }])).toContain('超过')
    expect(validateSourceLineQuantities(db, AID, 'SO', [{ ...line, qty: 100, field_values: { source_line_allocations: [{ source_line_id: 'SOAL1', qty: 99 }] } }])).toContain('分配数量')
  })
})

describe('下推进度只统计实物下游单据', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })

  it('销售订单生成 MRP 计算单后，不应被当成已下推（否则订单会从「选择源单」消失）', () => {
    addDoc(db, 'MRP1', 'MRP', 'audited', 'FG1', 100, 'SOAL1')
    expect(computeSourceLineUsedQty(db, AID, 'SO', 'SOAL1')).toBe(0)
  })

  it('销售出库草稿仍然占用订单行数量', () => {
    addDoc(db, 'SO9', 'SO', 'draft', 'FG1', 30, 'SOAL1')
    expect(computeSourceLineUsedQty(db, AID, 'SO', 'SOAL1')).toBe(30)
  })

  it('作废的销售出库不占用数量', () => {
    addDoc(db, 'SO8', 'SO', 'voided', 'FG1', 30, 'SOAL1')
    expect(computeSourceLineUsedQty(db, AID, 'SO', 'SOAL1')).toBe(0)
  })

  it('采购入库不会被销售出库口径误算', () => {
    addDoc(db, 'PI9', 'PI', 'audited', 'M1', 40, 'POL1')
    expect(computeSourceLineUsedQty(db, AID, 'PI', 'POL1')).toBe(40)
    expect(computeSourceLineUsedQty(db, AID, 'SO', 'POL1')).toBe(0)
  })
})
