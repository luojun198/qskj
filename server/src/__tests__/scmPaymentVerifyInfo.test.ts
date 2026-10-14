/**
 * 收付款单列表核销信息：已核销 / 未核销 / 核销单号 / 对方单据（预收、带源单收款、部分核销、无台账）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { getPaymentVerifyInfo } from '../services/scmOrderLinkedDocs.js'

const AID = 'PV-T'
let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, direction TEXT, doc_type TEXT, doc_no TEXT, currency TEXT,
      amount REAL, amount_fc REAL, verified_amount REAL, verified_fc REAL);
    CREATE TABLE scm_ar_ap_verify (id TEXT, account_set_id TEXT, verify_no TEXT, in_log_id TEXT, out_log_id TEXT, amount REAL);
  `)
  const doc = (id: string, t: string, no: string, st = 'audited') => db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?)').run(id, AID, t, no, st)
  const log = (id: string, dir: string, t: string, no: string, amt: number, ver: number) =>
    db.prepare('INSERT INTO scm_ar_ap_log VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, AID, dir, t, no, 'CNY', amt, amt, ver, ver)
  doc('S1', 'SO', 'SO-1'); doc('S2', 'SO', 'SO-2')
  log('LS1', 'in', 'SO', 'SO-1', 6000, 6000); log('LS2', 'in', 'SO', 'SO-2', 5000, 4000)
  doc('R1', 'RCV', 'RCV-1'); log('LR1', 'out', 'RCV', 'RCV-1', 15000, 10000) // 预收，被两张出库部分消耗
  doc('R2', 'RCV', 'RCV-2'); log('LR2', 'out', 'RCV', 'RCV-2', 3000, 0)      // 预收，未核销
  doc('R3', 'RCV', 'RCV-3', 'draft')                                         // 草稿：无台账
  db.prepare('INSERT INTO scm_ar_ap_verify VALUES (?,?,?,?,?,?)').run('V1', AID, 'HX-1', 'LS1', 'LR1', 6000)
  db.prepare('INSERT INTO scm_ar_ap_verify VALUES (?,?,?,?,?,?)').run('V2', AID, 'HX-2', 'LS2', 'LR1', 4000)
})

describe('收付款单列表核销信息', () => {
  const rows = () => [
    { id: 'R1', doc_type: 'RCV', doc_no: 'RCV-1' }, { id: 'R2', doc_type: 'RCV', doc_no: 'RCV-2' },
    { id: 'R3', doc_type: 'RCV', doc_no: 'RCV-3' }, { id: 'S1', doc_type: 'SO', doc_no: 'SO-1' },
  ]

  it('部分核销：已核销 / 未核销 / 核销单号 / 对方单据', () => {
    const r = getPaymentVerifyInfo(db, AID, rows()).get('R1')!
    expect(r.verified_amount).toBe(10000)
    expect(r.unverified_amount).toBe(5000)
    expect(r.verify_nos).toEqual(['HX-1', 'HX-2'])
    expect(r.pay_linked_docs.map(d => d.doc_no)).toEqual(['SO-1', 'SO-2'])
  })

  it('预收未核销：未核销=全额，无核销单号', () => {
    const r = getPaymentVerifyInfo(db, AID, rows()).get('R2')!
    expect(r.verified_amount).toBe(0)
    expect(r.unverified_amount).toBe(3000)
    expect(r.verify_nos).toEqual([])
  })

  it('草稿无台账：金额为 null；非收付款单不返回', () => {
    const m = getPaymentVerifyInfo(db, AID, rows())
    expect(m.get('R3')!.verified_amount).toBeNull()
    expect(m.has('S1')).toBe(false)
  })
})
