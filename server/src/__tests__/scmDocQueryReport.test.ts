/**
 * 第四份反馈 Q6 ~ Q8：退货 / 发票查询表——逐单逐行、带上游单号、退货冲减额、汇总。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runDocQueryReport } from '../services/scmDocQueryReport.js'

const AID = 'DQ-T'
let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, doc_date TEXT, partner_code TEXT,
      warehouse_code TEXT, voucher_id TEXT, remark TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT, warehouse_code TEXT,
      qty REAL, price REAL, amount REAL, tax_amount REAL, remark TEXT, source_line_id TEXT);
    CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, spec TEXT, unit TEXT);
    CREATE TABLE scm_partner (account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_warehouse (account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_ar_ap_log (account_set_id TEXT, doc_type TEXT, doc_no TEXT, amount REAL, amount_fc REAL, verified_amount REAL, verified_fc REAL);
  `)
  db.prepare("INSERT INTO scm_partner VALUES (?, 'GYS001', '润衡财经')").run(AID)
  db.prepare("INSERT INTO scm_item VALUES (?, '0101', '电路板', '25W', '块')").run(AID)
  db.prepare("INSERT INTO scm_warehouse VALUES (?, 'W1', '材料仓')").run(AID)
  const doc = (id: string, type: string, no: string, date: string, status = 'audited') =>
    db.prepare("INSERT INTO scm_doc VALUES (?,?,?,?,?,?,'GYS001','W1',NULL,NULL)").run(id, AID, type, no, status, date)
  const line = (id: string, docId: string, qty: number, amount: number, tax: number, src: string | null = null) =>
    db.prepare("INSERT INTO scm_doc_line VALUES (?,?,?,1,'0101',NULL,?,?,?,?,NULL,?)").run(id, AID, docId, qty, amount / qty, amount, tax, src)
  doc('PI3', 'PI', 'PI-003', '2026-10-10'); line('L-PI3', 'PI3', 140, 49000, 6370)
  doc('PR1', 'PR', 'PR-001', '2026-10-10'); line('L-PR1', 'PR1', 20, 7000, 910, 'L-PI3')
  doc('PR2', 'PR', 'PR-002', '2026-10-12', 'draft'); line('L-PR2', 'PR2', 1, 350, 45.5)
  db.prepare("INSERT INTO scm_ar_ap_log VALUES (?, 'PR', 'PR-001', 7910, 7910, 7910, 7910)").run(AID)
})

describe('单据查询表', () => {
  it('采购退货逐行列出：带上游入库单号、仓库、退货冲减额，汇总含草稿', () => {
    const r = runDocQueryReport(db, AID, { doc_type: 'PR' })
    expect(r.total).toBe(2)
    expect(r.summary).toMatchObject({ doc_count: 2, qty: 21, amount: 7350, amount_with_tax: 8305.5 })
    const pr1 = r.list.find(x => x.doc_no === 'PR-001')!
    expect(pr1).toMatchObject({ src_doc_no: 'PI-003', src_doc_type: 'PI', warehouse_name: '材料仓', item_name: '电路板', amount_with_tax: 7910, arap_offset: 7910, arap_open: 0 })
  })

  it('按状态 / 日期 / 关键字（含上游单号）筛选', () => {
    expect(runDocQueryReport(db, AID, { doc_type: 'PR', status: 'audited' }).total).toBe(1)
    expect(runDocQueryReport(db, AID, { doc_type: 'PR', start_date: '2026-10-11' }).list.map(x => x.doc_no)).toEqual(['PR-002'])
    expect(runDocQueryReport(db, AID, { doc_type: 'PR', keyword: 'PI-003' }).list.map(x => x.doc_no)).toEqual(['PR-001'])
  })

  it('不支持的单据类型报错', () => {
    expect(() => runDocQueryReport(db, AID, { doc_type: 'PI' })).toThrow(/不支持/)
  })
})
