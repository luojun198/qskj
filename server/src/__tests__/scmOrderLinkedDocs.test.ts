/**
 * 客户反馈（润衡云测试）：订单序时簿显示关联入库 / 出库单号（参照金蝶）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { getOrderLinkedDocs } from '../services/scmOrderLinkedDocs.js'

const AID = 'OL-T'
let db: Database.Database

function setup() {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, source_line_id TEXT, field_values TEXT);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT);
    CREATE TABLE scm_ar_ap_verify (id TEXT, account_set_id TEXT, in_log_id TEXT, out_log_id TEXT);
  `)
}
const doc = (id: string, type: string, no: string, status = 'audited') =>
  db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?)').run(id, AID, type, no, status)
const line = (id: string, docId: string, src: string | null = null, fv: any = null) =>
  db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?)').run(id, AID, docId, src, fv ? JSON.stringify(fv) : null)

describe('订单列表关联单号', () => {
  beforeEach(() => {
    setup()
    doc('PO1', 'PO', 'PO-001'); line('PO1-L1', 'PO1'); line('PO1-L2', 'PO1')
    doc('PO2', 'PO', 'PO-002'); line('PO2-L1', 'PO2')
    doc('PO3', 'PO', 'PO-003'); line('PO3-L1', 'PO3')
    // PO1 分两次入库；PI-002 由 PO1 + PO2 合并下推（allocations）
    doc('PI1', 'PI', 'PI-001'); line('PI1-L1', 'PI1', 'PO1-L1')
    doc('PI2', 'PI', 'PI-002', 'draft'); line('PI2-L1', 'PI2', null, { source_line_allocations: [{ source_line_id: 'PO1-L2', qty: 1 }, { source_line_id: 'PO2-L1', qty: 2 }] })
    doc('PIV', 'PI', 'PI-009', 'voided'); line('PIV-L1', 'PIV', 'PO3-L1')
    // PI-001 被付款单 PAY-001 核销
    db.prepare("INSERT INTO scm_ar_ap_log VALUES ('LI1',?, 'PI','PI-001'),('LO1',?,'PAY','PAY-001')").run(AID, AID)
    db.prepare("INSERT INTO scm_ar_ap_verify VALUES ('V1',?,'LI1','LO1')").run(AID)
    doc('PAY1', 'PAY', 'PAY-001')
    // 销售订单 → 出库 → 收款
    doc('SA1', 'SOa', 'SOa-001'); line('SA1-L1', 'SA1')
    doc('SO1', 'SO', 'SO-001'); line('SO1-L1', 'SO1', 'SA1-L1')
    db.prepare("INSERT INTO scm_ar_ap_log VALUES ('LI2',?, 'SO','SO-001'),('LO2',?,'RCV','RCV-001')").run(AID, AID)
    db.prepare("INSERT INTO scm_ar_ap_verify VALUES ('V2',?,'LI2','LO2')").run(AID)
    doc('RCV1', 'RCV', 'RCV-001')
  })

  it('直接引用 + 合并下推都能关联；作废单据不算；付款单按核销带出', () => {
    const r = getOrderLinkedDocs(db, AID, [
      { id: 'PO1', doc_type: 'PO' }, { id: 'PO2', doc_type: 'PO' }, { id: 'PO3', doc_type: 'PO' },
    ])
    expect(r.get('PO1')!.linked_docs.map(d => d.doc_no)).toEqual(['PI-001', 'PI-002'])
    expect(r.get('PO1')!.linked_payments.map(d => d.doc_no)).toEqual(['PAY-001'])
    expect(r.get('PO2')!.linked_docs.map(d => d.doc_no)).toEqual(['PI-002'])
    expect(r.get('PO2')!.linked_payments).toEqual([])
    expect(r.get('PO3')!.linked_docs).toEqual([])
    expect(r.get('PO1')!.linked_docs[1]).toMatchObject({ id: 'PI2', status: 'draft', doc_type: 'PI' })
  })

  it('销售订单关联出库单与收款单；非订单类型不处理', () => {
    const r = getOrderLinkedDocs(db, AID, [{ id: 'SA1', doc_type: 'SOa' }, { id: 'PI1', doc_type: 'PI' }])
    expect(r.get('SA1')).toEqual({
      linked_docs: [{ id: 'SO1', doc_no: 'SO-001', doc_type: 'SO', status: 'audited' }],
      linked_payments: [{ id: 'RCV1', doc_no: 'RCV-001', doc_type: 'RCV', status: 'audited' }],
    })
    expect(r.has('PI1')).toBe(false)
  })
})
