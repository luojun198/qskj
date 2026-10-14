/**
 * 客户反馈（润衡云测试）：没有核销单列表、核销单无法删除；核销完的预收款在核销页消失。
 * 覆盖：核销单记录（业务类型 / 生成方式 / 筛选）、核销单详情、收付款自动核销不可单独删除、已核销完毕收付款查询。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  verifyArAp, cancelVerify, listVerifyRecords, getVerifyDetail, getOpenItems, verifyBizType,
} from '../services/scmArAp.js'

const AID = 'VR-T'
let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, doc_date TEXT, partner_code TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, amount REAL, arap_source_log_id TEXT, source_line_id TEXT, tax_amount REAL);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_ar_ap_log (currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      doc_date TEXT, due_date TEXT, direction TEXT, amount REAL, ar_account TEXT, ap_account TEXT, cashier_journal_id TEXT,
      remark TEXT, verified_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), arap_side TEXT);
    CREATE TABLE scm_ar_ap_verify (id TEXT PRIMARY KEY, account_set_id TEXT, partner_code TEXT, verify_no TEXT,
      verify_date TEXT, in_log_id TEXT, out_log_id TEXT, amount REAL, created_by TEXT, created_at TEXT DEFAULT (datetime('now')));
  `)
  return d
}
const partner = (code: string, name: string) => db.prepare('INSERT INTO scm_partner (id,account_set_id,code,name) VALUES (?,?,?,?)').run(code, AID, code, name)
const doc = (id: string, type: string, no: string, p: string) =>
  db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,partner_code) VALUES (?,?,?,?,'audited','2026-10-04',?)").run(id, AID, type, no, p)
const log = (id: string, p: string, type: string, no: string, dir: 'in' | 'out', amount: number) =>
  db.prepare('INSERT INTO scm_ar_ap_log (id,account_set_id,partner_code,doc_type,doc_no,doc_date,direction,amount,amount_fc) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, AID, p, type, no, '2026-10-04', dir, amount, amount)

describe('核销单记录 / 详情 / 删除', () => {
  beforeEach(() => {
    db = createDb()
    partner('C01', '中岚餐饮'); partner('S01', '丰科贸易')
    // 客户 C01：销售出库 7910，预收款 5000（手工核销）
    doc('D-SO1', 'SO', 'SO-001', 'C01'); log('L-SO1', 'C01', 'SO', 'SO-001', 'in', 7910)
    doc('D-RCV1', 'RCV', 'RCV-001', 'C01'); log('L-RCV1', 'C01', 'RCV', 'RCV-001', 'out', 5000)
    verifyArAp(db, AID, { partner_code: 'C01', verify_date: '2026-10-04', operator: '彭雁', matches: [{ in_log_id: 'L-SO1', out_log_id: 'L-RCV1', amount: 5000 }] })
    // 供应商 S01：采购入库 31866，付款单选源单自动核销 20000
    doc('D-PI1', 'PI', 'PI-001', 'S01'); log('L-PI1', 'S01', 'PI', 'PI-001', 'in', 31866)
    doc('D-PAY1', 'PAY', 'PAY-001', 'S01'); log('L-PAY1', 'S01', 'PAY', 'PAY-001', 'out', 20000)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,amount,arap_source_log_id) VALUES ('DL1',?,'D-PAY1',1,20000,'L-PI1')").run(AID)
    verifyArAp(db, AID, { partner_code: 'S01', verify_date: '2026-10-05', operator: '彭雁', matches: [{ in_log_id: 'L-PI1', out_log_id: 'L-PAY1', amount: 20000 }] })
  })

  it('跨往来单位列出核销单，带业务类型、生成方式、核销金额合计', () => {
    const r = listVerifyRecords(db, AID)
    expect(r.total).toBe(2)
    expect(r.total_amount).toBe(25000)
    const manual = r.list.find(x => x.partner_code === 'C01')!
    expect(manual).toMatchObject({ side: 'ar', biz_type: '预收冲应收', gen_mode: 'manual', total_amount: 5000, partner_name: '中岚餐饮', in_doc_nos: 'SO-001', out_doc_nos: 'RCV-001' })
    const auto = r.list.find(x => x.partner_code === 'S01')!
    expect(auto).toMatchObject({ side: 'ap', biz_type: '付款核销应付', gen_mode: 'auto' })
    // 按日期倒序
    expect(r.list[0].partner_code).toBe('S01')
  })

  it('按日期 / 业务类型 / 生成方式 / 关键字（参与单据号）筛选', () => {
    expect(listVerifyRecords(db, AID, { date_from: '2026-10-05' }).total).toBe(1)
    expect(listVerifyRecords(db, AID, { side: 'ar' }).list.map(x => x.partner_code)).toEqual(['C01'])
    expect(listVerifyRecords(db, AID, { gen_mode: 'auto' }).list.map(x => x.partner_code)).toEqual(['S01'])
    expect(listVerifyRecords(db, AID, { keyword: 'SO-001' }).list.map(x => x.partner_code)).toEqual(['C01'])
    expect(listVerifyRecords(db, AID, { keyword: '丰科' }).list.map(x => x.partner_code)).toEqual(['S01'])
  })

  it('详情分上下两表：收付款方 / 应收应付方，含单据金额、已核销、未核销、本次核销', () => {
    const no = listVerifyRecords(db, AID, { partner_code: 'C01' }).list[0].verify_no
    const d = getVerifyDetail(db, AID, no)!
    expect(d.biz_type).toBe('预收冲应收')
    expect(d.out_items).toHaveLength(1)
    expect(d.out_items[0]).toMatchObject({ doc_no: 'RCV-001', doc_id: 'D-RCV1', doc_amount: 5000, verified_amount: 5000, open_amount: 0, this_amount: 5000 })
    expect(d.in_items[0]).toMatchObject({ doc_no: 'SO-001', doc_amount: 7910, verified_amount: 5000, open_amount: 2910, this_amount: 5000 })
    expect(getVerifyDetail(db, AID, 'HX-NOPE')).toBeNull()
  })

  it('手动核销单可删除，两侧恢复未核销；收付款自动核销不可单独删除', () => {
    const list = listVerifyRecords(db, AID).list
    const auto = list.find(x => x.gen_mode === 'auto')!
    expect(() => cancelVerify(db, AID, auto.verify_no)).toThrow(/付款单「PAY-001」.*反审核/)
    const manual = list.find(x => x.gen_mode === 'manual')!
    expect(cancelVerify(db, AID, manual.verify_no).count).toBe(1)
    expect(listVerifyRecords(db, AID).total).toBe(1)
    const so = db.prepare("SELECT verified_amount FROM scm_ar_ap_log WHERE id='L-SO1'").get() as any
    expect(so.verified_amount).toBe(0)
  })

  it('核销页可查询已核销完毕的收付款（带核销单号），默认不返回', () => {
    const plain = getOpenItems(db, AID, 'C01', 'ar')
    expect(plain.out_items).toHaveLength(0)
    expect(plain.settled_out_items).toEqual([])
    const withSettled = getOpenItems(db, AID, 'C01', 'ar', { includeSettled: true })
    expect(withSettled.settled_out_items).toHaveLength(1)
    expect(withSettled.settled_out_items[0]).toMatchObject({ doc_no: 'RCV-001', doc_amount: 5000 })
    expect(String(withSettled.settled_out_items[0].verify_nos)).toMatch(/^HX-/)
  })
})

describe('核销业务类型命名', () => {
  it('应收 / 应付 × 收付款手动 / 自动 / 退货', () => {
    expect(verifyBizType('SO', ['RCV'], false).label).toBe('预收冲应收')
    expect(verifyBizType('SO', ['RCV'], true).label).toBe('收款核销应收')
    expect(verifyBizType('SO', ['SR'], false).label).toBe('退货冲应收')
    expect(verifyBizType('PI', ['PAY'], false)).toEqual({ side: 'ap', label: '预付冲应付' })
    expect(verifyBizType('PI', ['PR'], false).label).toBe('退货冲应付')
    expect(verifyBizType('PI', ['PAY', 'PR'], false).label).toBe('应付核销')
  })
})
