import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  computeSourceLineUsedQty,
  findDraftDocumentUsingSourceLines,
  pushedLineAmount,
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
    CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, item_code TEXT, plan_qty REAL, finished_qty REAL, scrap_qty REAL DEFAULT 0, bom_id TEXT);
    CREATE TABLE scm_production_plan_line (id TEXT, account_set_id TEXT, plan_id TEXT, product_id TEXT, item_code TEXT, qty REAL, scrap_rate REAL);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, item_code TEXT, direction TEXT, qty REAL);
    CREATE TABLE scm_bom_line (id TEXT, account_set_id TEXT, bom_id TEXT, seq INTEGER, item_code TEXT, qty REAL, unit TEXT, scrap_rate REAL DEFAULT 0, remark TEXT, line_type TEXT DEFAULT 'component', sub_group TEXT, sub_priority INTEGER);
  `)
  db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?)').run('PO1', AID, 'PO', 'PO-001', 'audited', null)
  db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?)').run('POL1', AID, 'PO1', 'M1', 100, null, '{}')
  db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?)').run('SOA1', AID, 'SOa', 'SO-001', 'audited', null)
  db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?)').run('SOAL1', AID, 'SOA1', 'FG1', 100, null, '{}')
  db.prepare('INSERT INTO scm_production_plan VALUES (?,?,?,?,?)').run('P1', AID, 'MO-001', 'released', 'self')
  db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,item_code,plan_qty,finished_qty) VALUES (?,?,?,?,?,?)').run('PP1', AID, 'P1', 'FG1', 10, 0)
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

  it('客户反馈：来源数量超限提示说明来源单、上限、占用单据（草稿点名）与超出量', () => {
    addDoc(db, 'SO1', 'SO', 'draft', 'FG1', 90, 'SOAL1')
    const msg = validateSourceLineQuantities(db, AID, 'SO', [{ item_code: 'FG1', qty: 11, source_line_id: 'SOAL1' }], undefined, 'save')
    expect(msg).toBe('物料 FG1：销售订单 SO-001 数量 100；已被其他销售出库单占用 90（SO-SO1（草稿） 90）；本次 11，合计 101，超过来源数量上限 100（超出 1）。请先审核或删除上述草稿销售出库单，或减少本次数量。')
  })

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

  it('FIX-212 退料/不良品入库必须关联已审核工单', () => {
    expect(validatePlanLink(db, AID, 'PJ', null).message).toContain('退料必须关联')
    expect(validatePlanLink(db, AID, 'PS', null).message).toContain('不良品入库必须关联')
    expect(validatePlanLink(db, AID, 'PJ', 'P1').message).toBeUndefined()
  })

  it('FIX-212 退料不得超过工单净已领（已审核领料 − 其它退料）', () => {
    addDoc(db, 'ISS1', 'PL', 'audited', 'RM1', 15, null, 'P1')
    addDoc(db, 'ISS2', 'PL', 'draft', 'RM1', 5, null, 'P1')          // 草稿领料不算已领
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PJ', [{ item_code: 'RM1', qty: 16 }])).toContain('超出')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PJ', [{ item_code: 'RM1', qty: 15 }])).toBeNull()
    addDoc(db, 'RET1', 'PJ', 'draft', 'RM1', 10, null, 'P1')         // 草稿退料也占用
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PJ', [{ item_code: 'RM1', qty: 6 }])).toContain('超出')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PJ', [{ item_code: 'RM1', qty: 5 }])).toBeNull()
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PJ', [{ item_code: 'RM1', qty: 10 }], 'RET1')).toBeNull()  // 修改本单时排除自己
  })

  it('客户反馈：已随完工消耗的物料不能再退回（可退 = 净已领 − 已消耗）', () => {
    addDoc(db, 'ISS1', 'PL', 'audited', 'RM1', 20, null, 'P1')
    // 完工 6 件，单件用量 2 → 已消耗 12，车间在制 8
    db.prepare("UPDATE scm_production_plan_product SET finished_qty=6 WHERE id='PP1'").run()
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PJ', [{ item_code: 'RM1', qty: 9 }])).toMatch(/已随完工\/报废消耗 12，车间在制可退 8/)
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PJ', [{ item_code: 'RM1', qty: 8 }])).toBeNull()
    // 全部完工后（消耗 20）一件都不能退
    db.prepare("UPDATE scm_production_plan_product SET finished_qty=10 WHERE id='PP1'").run()
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PJ', [{ item_code: 'RM1', qty: 1 }])).toContain('不能退回原料仓')
  })

  it('C-1 替代料：领用替代料按主料需求上限计，同组合并占用', () => {
    db.prepare("UPDATE scm_production_plan_product SET bom_id='B1' WHERE id='PP1'").run()
    db.prepare("INSERT INTO scm_bom_line (id,account_set_id,bom_id,seq,item_code,qty,sub_group,sub_priority) VALUES ('L1',?,'B1',1,'RM1',2,'G',1)").run(AID)
    db.prepare("INSERT INTO scm_bom_line (id,account_set_id,bom_id,seq,item_code,qty,sub_group,sub_priority) VALUES ('L2',?,'B1',2,'RM1-ALT',2,'G',2)").run(AID)
    // 主料需求 20：先领替代料 15，再领主料 6 → 超出
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1-ALT', qty: 15 }])).toBeNull()
    addDoc(db, 'ALT1', 'PL', 'audited', 'RM1-ALT', 15, null, 'P1')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 6 }])).toContain('禁止超领')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 5 }])).toBeNull()
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'NOT-IN-BOM', qty: 1 }])).toContain('不能领用')
  })

  it('FIX-219 草稿上游：保存阶段放行、审核阶段拦截、作废上游一律拦截', () => {
    db.prepare("UPDATE scm_doc SET status='draft' WHERE id='PO1'").run()
    const lines = [{ item_code: 'M1', qty: 10, source_line_id: 'POL1' }]
    expect(validateSourceLineQuantities(db, AID, 'PI', lines, undefined, 'save')).toBeNull()
    expect(validateSourceLineQuantities(db, AID, 'PI', lines, undefined, 'audit')).toContain('未审核')
    expect(validateSourceLineQuantities(db, AID, 'PI', lines)).toContain('未审核')
    db.prepare("UPDATE scm_doc SET status='voided' WHERE id='PO1'").run()
    expect(validateSourceLineQuantities(db, AID, 'PI', lines, undefined, 'save')).toContain('已作废')
  })

  it('领料、退料与完工数量按工单累计控制', () => {
    addDoc(db, 'ISS1', 'PL', 'draft', 'RM1', 15, null, 'P1')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 6 }])).toContain('禁止超领')
    addDoc(db, 'RET1', 'PJ', 'audited', 'RM1', 5, null, 'P1')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 10 }])).toBeNull()
    addDoc(db, 'FIN1', 'PF', 'draft', 'FG1', 8, null, 'P1')
    expect(validatePlanFinishQuantities(db, AID, 'P1', 'PF', [{ item_code: 'FG1', qty: 3 }])).toContain('禁止超完工')
    // 客户反馈：超完工提示须点名占用计划数的草稿单，便于审核或删除
    expect(validatePlanFinishQuantities(db, AID, 'P1', 'PF', [{ item_code: 'FG1', qty: 3 }])).toMatch(/未审核草稿 \S+ 8，请先审核或删除/)
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
    db.prepare('INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,item_code,plan_qty,finished_qty) VALUES (?,?,?,?,?,?)').run('PP2', AID, 'P2', 'OFG1', 10, 0)
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

  it('P2-18 分批完工不锁领料；工单全部完工（含报废）后才锁定', () => {
    addDoc(db, 'FIN-DRAFT', 'PF', 'draft', 'FG1', 1, null, 'P1')
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 1 }])).toBeNull()

    // 第一批完工 4 件已审核：剩余批次仍可领料/补料
    addDoc(db, 'FIN-AUDITED', 'PF', 'audited', 'FG1', 4, null, 'P1')
    db.prepare("UPDATE scm_production_plan_product SET finished_qty=4 WHERE id='PP1'").run()
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PB', [{ item_code: 'RM1', qty: 1 }])).toBeNull()

    // 完工 8 + 报废 2 = 计划 10 → 锁定
    db.prepare("UPDATE scm_production_plan_product SET finished_qty=8, scrap_qty=2 WHERE id='PP1'").run()
    expect(validatePlanIssueQuantities(db, AID, 'P1', 'PL', [{ item_code: 'RM1', qty: 1 }]))
      .toContain('领料已锁定')
  })

  it('已审核委外入库锁定委外发货', () => {
    addDoc(db, 'WI-AUDITED', 'WI', 'audited', 'FG1', 10, null, 'P1')
    db.prepare("UPDATE scm_production_plan_product SET finished_qty=10 WHERE id='PP1'").run()   // 全部完工后锁定（P2-18）
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

describe('已下推金额', () => {
  it('部分下推按数量比例分摊，含税类型含税额', () => {
    // 数量 10，不含税 100，税额 13，已下推 4 → 价税合计 113 的 40%
    expect(pushedLineAmount('PO', 10, 4, 100, 13)).toBe(45.2)
    expect(pushedLineAmount('SOa', 10, 4, 100, 13)).toBe(45.2)
    expect(pushedLineAmount('PQ', 10, 4, 100, 13)).toBe(45.2)
    expect(pushedLineAmount('SQ', 10, 4, 100, 13)).toBe(45.2)
  })

  it('不显示价税合计的类型只用不含税金额', () => {
    expect(pushedLineAmount('MR', 10, 4, 100, 13)).toBe(40)
    expect(pushedLineAmount('PI', 10, 4, 100, 13)).toBe(40)
  })

  it('未下推或行数量为 0 时金额为 0', () => {
    expect(pushedLineAmount('PO', 10, 0, 100, 13)).toBe(0)
    expect(pushedLineAmount('PO', 0, 4, 100, 13)).toBe(0)
  })

  it('按分四舍五入', () => {
    // 100.005 * 1/3 = 33.335 → 33.34
    expect(pushedLineAmount('PO', 3, 1, 100, 0.005)).toBe(33.34)
  })
})
