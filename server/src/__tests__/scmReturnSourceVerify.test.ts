/**
 * 第四份反馈 Q5：采购退货（上游为采购入库 PI-003）审核后，付款单把退货额显示成 PI-003「已付 7910」。
 * 覆盖：退货审核自动冲上游（退货冲应付）、付款源单拆出「退货冲减」、未冲减退货列示、
 * 退货反审核不被自身自动核销拦截、自动核销不可单独删除。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  applyReturnSourceVerify, getPaymentSources, getOpenReturnsForPayment, getDocVerifiedInfo,
  cancelVerify, listVerifyRecords, reversePayment,
} from '../services/scmArAp.js'

const AID = 'RT-T'
let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, doc_date TEXT, partner_code TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, amount REAL, tax_amount REAL,
      arap_source_log_id TEXT, source_line_id TEXT);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_ar_ap_log (currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      doc_date TEXT, due_date TEXT, direction TEXT, amount REAL, ar_account TEXT, ap_account TEXT, cashier_journal_id TEXT,
      remark TEXT, verified_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), arap_side TEXT);
    CREATE TABLE scm_ar_ap_verify (id TEXT PRIMARY KEY, account_set_id TEXT, partner_code TEXT, verify_no TEXT,
      verify_date TEXT, in_log_id TEXT, out_log_id TEXT, amount REAL, created_by TEXT, created_at TEXT DEFAULT (datetime('now')));
  `)
  return d
}
const doc = (id: string, type: string, no: string) =>
  db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,partner_code) VALUES (?,?,?,?,'audited','2026-10-10','GYS001')").run(id, AID, type, no)
const line = (id: string, docId: string, amount: number, tax: number, src: string | null = null) =>
  db.prepare('INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,amount,tax_amount,source_line_id) VALUES (?,?,?,1,?,?,?)').run(id, AID, docId, amount, tax, src)
const log = (id: string, type: string, no: string, dir: 'in' | 'out', amount: number) =>
  db.prepare("INSERT INTO scm_ar_ap_log (id,account_set_id,partner_code,doc_type,doc_no,doc_date,direction,amount,amount_fc) VALUES (?,?,'GYS001',?,?,'2026-10-10',?,?,?)")
    .run(id, AID, type, no, dir, amount, amount)
const prDoc = { doc_type: 'PR', doc_no: 'PR-001', partner_code: 'GYS001', doc_date: '2026-10-10' }

describe('退货审核自动冲上游', () => {
  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO scm_partner VALUES ('P1',?,'GYS001','润衡财经')").run(AID)
    // 采购入库 PI-003：价税 55370
    doc('D-PI3', 'PI', 'PI-003'); line('L-PI3', 'D-PI3', 49000, 6370); log('A-PI3', 'PI', 'PI-003', 'in', 55370)
    // 采购入库 PI-001：11413（无退货）
    doc('D-PI1', 'PI', 'PI-001'); line('L-PI1', 'D-PI1', 10100, 1313); log('A-PI1', 'PI', 'PI-001', 'in', 11413)
    // 采购退货 PR-001：来源 PI-003 的明细行，价税 7910
    doc('D-PR1', 'PR', 'PR-001'); line('L-PR1', 'D-PR1', 7000, 910, 'L-PI3'); log('A-PR1', 'PR', 'PR-001', 'out', 7910)
  })

  const prLines = () => db.prepare("SELECT * FROM scm_doc_line WHERE doc_id='D-PR1'").all() as any[]

  it('冲减来源入库单；付款源单显示退货冲减 7910、已付 0、未付 47460', () => {
    const r = applyReturnSourceVerify(db, AID, prDoc, prLines(), '彭雁')
    expect(r.count).toBe(1)
    const src = getPaymentSources(db, AID, 'GYS001', 'PAY')
    const pi3 = src.find((s: any) => s.source_doc_no === 'PI-003')
    expect(pi3).toMatchObject({ return_offset_amount: 7910, settled_amount: 0, open_amount: 47460 })
    const pi1 = src.find((s: any) => s.source_doc_no === 'PI-001')
    expect(pi1).toMatchObject({ return_offset_amount: 0, settled_amount: 0, open_amount: 11413 })
    // 退货已冲完，不再列为未冲减退货
    expect(getOpenReturnsForPayment(db, AID, 'GYS001', 'PAY')).toHaveLength(0)
    // 核销单记录标记为自动生成的「退货冲应付」
    const rec = listVerifyRecords(db, AID).list[0]
    expect(rec).toMatchObject({ biz_type: '退货冲应付', gen_mode: 'auto' })
  })

  it('上游未清额不足时只冲到未清额，余额作为未冲减退货列示', () => {
    db.prepare("UPDATE scm_ar_ap_log SET verified_amount=50000, verified_fc=50000 WHERE id='A-PI3'").run()
    applyReturnSourceVerify(db, AID, prDoc, prLines())
    const open = getOpenReturnsForPayment(db, AID, 'GYS001', 'PAY')
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ source_doc_no: 'PR-001', source_amount: 7910, offset_amount: 5370, open_amount: 2540 })
  })

  it('无上游的退货不自动核销，列为未冲减退货', () => {
    db.prepare("UPDATE scm_doc_line SET source_line_id=NULL WHERE id='L-PR1'").run()
    expect(applyReturnSourceVerify(db, AID, prDoc, prLines()).count).toBe(0)
    expect(getOpenReturnsForPayment(db, AID, 'GYS001', 'PAY')[0]).toMatchObject({ open_amount: 7910 })
  })

  it('退货反审核：自身自动核销不算拦截项，reversePayment 后来源单恢复未清', () => {
    const { verify_no } = applyReturnSourceVerify(db, AID, prDoc, prLines())
    expect(getDocVerifiedInfo(db, AID, 'PR-001').verified).toBe(true)
    expect(getDocVerifiedInfo(db, AID, 'PR-001', { excludeReturnAuto: true }).verified).toBe(false)
    // 自动核销不可在核销单列表单独删除
    expect(() => cancelVerify(db, AID, verify_no)).toThrow(/采购退货单「PR-001」.*反审核/)
    reversePayment(db, AID, prDoc)
    const pi3 = db.prepare("SELECT verified_amount FROM scm_ar_ap_log WHERE id='A-PI3'").get() as any
    expect(pi3.verified_amount).toBe(0)
  })

  it('退货另被手工核销到其他入库单时，反审核仍拦截', () => {
    db.prepare("UPDATE scm_doc_line SET source_line_id=NULL WHERE id='L-PR1'").run()
    db.prepare("INSERT INTO scm_ar_ap_verify (id,account_set_id,partner_code,verify_no,verify_date,in_log_id,out_log_id,amount) VALUES ('V1',?,'GYS001','HX-1','2026-10-10','A-PI1','A-PR1',7910)").run(AID)
    db.prepare("UPDATE scm_ar_ap_log SET verified_amount=7910, verified_fc=7910 WHERE id IN ('A-PI1','A-PR1')").run()
    expect(getDocVerifiedInfo(db, AID, 'PR-001', { excludeReturnAuto: true })).toEqual({ verified: true, verify_nos: ['HX-1'] })
  })
})
