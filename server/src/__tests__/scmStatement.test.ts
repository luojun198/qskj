/**
 * 第四份反馈 Q2：对账单单据化——按明细行勾选生成、草稿占用、审核锁定、未对账行下次带出、对账明细表。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { up as statementUp } from '../db/migrations/20261011_scm_statement.js'
import {
  getStatementCandidates, createStatement, updateStatement, deleteStatement, auditStatement, unauditStatement,
  getStatement, listStatements, getStatementDetailReport, getDocStatementLock, releaseDocFromDraftStatements,
} from '../services/scmStatement.js'

const AID = 'ST-T'
let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, doc_date TEXT, partner_code TEXT, process_mode TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT, qty REAL, price REAL,
      amount REAL, tax_amount REAL, remark TEXT, source_line_id TEXT, line_role TEXT, process_fee REAL);
    CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, spec TEXT, unit TEXT);
    CREATE TABLE scm_partner (account_set_id TEXT, code TEXT, name TEXT, partner_type TEXT);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT, doc_date TEXT,
      direction TEXT, amount REAL, amount_fc REAL, remark TEXT, arap_side TEXT);
  `)
  statementUp(d)
  return d
}
const doc = (id: string, type: string, no: string, date: string, partner = 'GYS001', status = 'audited') =>
  db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?,?,NULL)').run(id, AID, type, no, status, date, partner)
const line = (id: string, docId: string, seq: number, item: string, qty: number, price: number, amount: number, tax: number, src: string | null = null) =>
  db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,NULL)').run(id, AID, docId, seq, item, qty, price, amount, tax, src)
const log = (id: string, type: string, no: string, date: string, dir: 'in' | 'out', amount: number) =>
  db.prepare("INSERT INTO scm_ar_ap_log VALUES (?,?,'GYS001',?,?,?,?,?,?,NULL,NULL)").run(id, AID, type, no, date, dir, amount, amount)

describe('对账单单据化', () => {
  beforeEach(() => {
    db = createDb()
    db.prepare("INSERT INTO scm_partner VALUES (?, 'GYS001', '润衡财经', 'supplier'), (?, 'KH001', '客户甲', 'customer')").run(AID, AID)
    db.prepare("INSERT INTO scm_item VALUES (?, '0101', '电路板', '25W', '块'), (?, '0102', '电容', '5W', '个')").run(AID, AID)
    // PI-001：两行（11300 + 113 含税）
    doc('PI1', 'PI', 'PI-001', '2026-10-10'); line('PI1-1', 'PI1', 1, '0101', 50, 200, 10000, 1300); line('PI1-2', 'PI1', 2, '0102', 50, 2, 100, 13)
    log('A-PI1', 'PI', 'PI-001', '2026-10-10', 'in', 11413)
    // PR-001：退货 7910（来源 PI-001 第 1 行）
    doc('PR1', 'PR', 'PR-001', '2026-10-10'); line('PR1-1', 'PR1', 1, '0101', 20, 350, 7000, 910, 'PI1-1')
    log('A-PR1', 'PR', 'PR-001', '2026-10-10', 'out', 7910)
    // PAY-001：付款 3 条明细（台账 3 行）
    doc('PAY1', 'PAY', 'PAY-001', '2026-10-11')
    log('A-PAY1', 'PAY', 'PAY-001', '2026-10-11', 'out', 1000); log('A-PAY2', 'PAY', 'PAY-001', '2026-10-11', 'out', 2000); log('A-PAY3', 'PAY', 'PAY-001', '2026-10-11', 'out', 500)
    // 下推发票（有来源行）不进对账单；草稿入库单不进
    doc('RP1', 'RP', 'RP-001', '2026-10-10'); line('RP1-1', 'RP1', 1, '0101', 50, 210, 10500, 1365, 'PI1-1')
    doc('PI9', 'PI', 'PI-009', '2026-10-10', 'GYS001', 'draft'); line('PI9-1', 'PI9', 1, '0101', 1, 1, 1, 0)
    // 截止日之后的入库单不进
    doc('PI2', 'PI', 'PI-002', '2026-11-02'); line('PI2-1', 'PI2', 1, '0101', 1, 100, 100, 13)
  })

  const pick = (ids: string[], logs: string[] = []) => [
    ...ids.map(id => ({ src_kind: 'line' as const, src_line_id: id })),
    ...logs.map(id => ({ src_kind: 'log' as const, src_log_id: id })),
  ]

  it('候选行：已审核明细 + 收付款台账行；退货为负，下推发票、草稿、晚于截止日的不出现', () => {
    const c = getStatementCandidates(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31' })
    const keys = c.rows.map(r => r.src_line_id || r.src_log_id)
    expect(keys).toEqual(['PI1-1', 'PI1-2', 'PR1-1', 'A-PAY1', 'A-PAY2', 'A-PAY3'])
    expect(c.rows.find(r => r.src_line_id === 'PR1-1')).toMatchObject({ sign: -1, amount_with_tax: 7910, item_name: '电路板', unit: '块' })
    expect(c.ledger_balance).toBe(11413 - 7910 - 3500)
  })

  it('应收对账单不能选供应商、应付不能选客户（第五份反馈）', () => {
    expect(() => createStatement(db, AID, { direction: 'ar', partner_code: 'GYS001', end_date: '2026-10-31', lines: pick(['PI1-1']) }, '彭雁'))
      .toThrow('是供应商，不能做应收对账单')
    expect(() => createStatement(db, AID, { direction: 'ap', partner_code: 'KH001', end_date: '2026-10-31', lines: pick(['PI1-1']) }, '彭雁'))
      .toThrow('是客户，不能做应付对账单')
  })

  it('勾选部分行生成草稿；草稿占用的行不再出现在候选里，未勾的行下次继续带出', () => {
    const r = createStatement(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', stmt_date: '2026-10-31',
      lines: pick(['PI1-1', 'PR1-1'], ['A-PAY1']) }, '彭雁')!
    expect(r.stmt_no).toBe('DZ-202610-001')
    const s = getStatement(db, AID, r.id)
    expect(s).toMatchObject({ status: 'draft', doc_amount: 11300 - 7910, payment_amount: 1000, net_amount: 2390, partner_name: '润衡财经' })
    expect(s.lines).toHaveLength(3)
    const c = getStatementCandidates(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31' })
    expect(c.rows.map(x => x.src_line_id || x.src_log_id)).toEqual(['PI1-2', 'A-PAY2', 'A-PAY3'])
    // 编辑本单时，本单已占用的行也是可选的
    const self = getStatementCandidates(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', statement_id: r.id })
    expect(self.rows).toHaveLength(6)
    expect(self.rows.filter(x => x.selected_by_self)).toHaveLength(3)
    // 第二张对账单不能重复勾已占用的行
    expect(() => createStatement(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', lines: pick(['PI1-1']) }, '彭雁'))
      .toThrow(/已在对账单 DZ-202610-001/)
    const r2 = createStatement(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', stmt_date: '2026-10-31', lines: pick(['PI1-2']) }, '彭雁')!
    expect(r2.stmt_no).toBe('DZ-202610-002')
  })

  it('修改草稿：重取快照；审核后不能改、不能删；反审核后可删', () => {
    const { id } = createStatement(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', lines: pick(['PI1-1']) }, '彭雁')!
    updateStatement(db, AID, id, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', lines: pick(['PI1-1', 'PI1-2']) })
    expect(getStatement(db, AID, id).doc_amount).toBe(11413)
    auditStatement(db, AID, id, '审核人')
    expect(() => updateStatement(db, AID, id, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', lines: pick(['PI1-1']) })).toThrow(/仅草稿/)
    expect(() => deleteStatement(db, AID, id)).toThrow(/先反审核/)
    unauditStatement(db, AID, id)
    expect(deleteStatement(db, AID, id).ok).toBe(true)
    expect(listStatements(db, AID, {}).total).toBe(0)
  })

  it('锁定：已审核对账单引用的源单拦截反审核；草稿只占用，源单反审核时移出并重算', () => {
    const { id } = createStatement(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', lines: pick(['PI1-1', 'PI1-2'], ['A-PAY1']) }, '彭雁')!
    expect(getDocStatementLock(db, AID, 'PI1')).toEqual({ error: null, drafts: ['DZ-202610-001'] })
    auditStatement(db, AID, id, '审核人')
    expect(getDocStatementLock(db, AID, 'PI1').error).toMatch(/对账单 DZ-202610-001 锁定/)
    expect(getDocStatementLock(db, AID, 'PAY1').error).toMatch(/锁定/)
    unauditStatement(db, AID, id)
    expect(releaseDocFromDraftStatements(db, AID, 'PI1')).toEqual(['DZ-202610-001'])
    expect(getStatement(db, AID, id)).toMatchObject({ doc_amount: 0, payment_amount: 1000, net_amount: -1000 })
  })

  it('勾选的行源单已反审核时，保存给出提示', () => {
    db.prepare("UPDATE scm_doc SET status='draft' WHERE id='PI1'").run()
    expect(() => createStatement(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', lines: pick(['PI1-1']) }, '彭雁'))
      .toThrow(/已不可对账/)
  })

  it('对账明细表：按状态区分已对账 / 对账中 / 未对账并汇总', () => {
    const a = createStatement(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', lines: pick(['PI1-1']) }, '彭雁')!
    auditStatement(db, AID, a.id, '审核人')
    createStatement(db, AID, { direction: 'ap', partner_code: 'GYS001', end_date: '2026-10-31', lines: pick(['PR1-1']) }, '彭雁')
    const rep = getStatementDetailReport(db, AID, { direction: 'ap', date_from: '2026-10-01', date_to: '2026-10-31' })
    expect(rep.list).toHaveLength(6)
    expect(rep.summary).toEqual({ total: 11413 - 7910 - 3500, reconciled: 11300, pending: -7910, unreconciled: 113 - 3500 })
    const recon = getStatementDetailReport(db, AID, { direction: 'ap', status: 'reconciled', date_to: '2026-10-31' })
    expect(recon.list.map(r => r.src_line_id)).toEqual(['PI1-1'])
    expect(recon.list[0]).toMatchObject({ stmt_no: 'DZ-202610-001', partner_name: '润衡财经', signed_amount: 11300 })
  })
})
