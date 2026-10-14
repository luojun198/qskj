/**
 * 客户反馈（润衡云第三份测试）：采购 / 销售订单变更单。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { snapshotOrder, normalizeOrderTarget, validateOrderChange, computeOrderDiff, applyOrderChange } from '../services/scmOrderChange.js'

const AID = 'OC-T'
let db: Database.Database

function setup() {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, doc_date TEXT, partner_code TEXT,
      tax_rate REAL, remark TEXT, total_qty REAL, total_amount REAL, total_tax REAL, updated_at TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT, warehouse_code TEXT, qty REAL, price REAL, amount REAL,
      discount_rate REAL, discount_amount REAL, tax_rate REAL, tax_amount REAL, price_with_tax REAL, remark TEXT, source_line_id TEXT, field_values TEXT DEFAULT '{}');
    CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, spec TEXT, unit TEXT);
  `)
  for (const c of ['M1', 'M2', 'M3']) db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?)').run(AID, c, c + '名', '', '个')
  db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,tax_rate,remark) VALUES ('PO1',?,'PO','PO-001','audited',13,'原备注')").run(AID)
  const line = db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,price,amount,tax_rate) VALUES (?,?,?,?,?,?,?,?,NULL)")
  line.run('L1', AID, 'PO1', 1, 'M1', 100, 10, 1000)
  line.run('L2', AID, 'PO1', 2, 'M2', 50, 20, 1000)
  // L1 已审核入库 30
  db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status) VALUES ('PI1',?,'PI','PI-001','audited')").run(AID)
  db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,source_line_id) VALUES ('PIL1',?,'PI1',1,'M1',30,'L1')").run(AID)
}

const target = (lines: any[], remark = '原备注') => ({ head: { remark }, lines })

describe('订单变更单', () => {
  beforeEach(setup)

  it('快照带出已执行数量', () => {
    const { snapshot } = snapshotOrder(db, AID, 'PO1')
    expect(snapshot.lines.map(l => [l.item_code, l.executed_qty])).toEqual([['M1', 30], ['M2', 0]])
  })

  it('增加数量、对未执行部分改价、新增明细：通过并写回订单合计', () => {
    const { doc, snapshot } = snapshotOrder(db, AID, 'PO1')
    const after = normalizeOrderTarget(target([
      { id: 'L1', item_code: 'M1', qty: 120, price: 9 },
      { id: 'L2', item_code: 'M2', qty: 50, price: 20 },
      { item_code: 'M3', qty: 5, price: 100, tax_rate: 0 },
    ], '客户追加'), snapshot)
    expect(validateOrderChange(db, AID, doc, snapshot, after)).toEqual([])
    const diff = computeOrderDiff(snapshot, after)
    expect(diff.map(d => d.label)).toEqual(['订单备注', '数量', '单价', '新增明细'])
    applyOrderChange(db, AID, doc, after)
    const rows = db.prepare("SELECT item_code, qty, price, amount, tax_amount, price_with_tax FROM scm_doc_line WHERE doc_id='PO1' ORDER BY seq").all()
    expect(rows).toEqual([
      { item_code: 'M1', qty: 120, price: 9, amount: 1080, tax_amount: 140.4, price_with_tax: 10.17 },
      { item_code: 'M2', qty: 50, price: 20, amount: 1000, tax_amount: 130, price_with_tax: 22.6 },
      { item_code: 'M3', qty: 5, price: 100, amount: 500, tax_amount: 0, price_with_tax: 100 },
    ])
    expect(db.prepare("SELECT total_qty, total_amount, total_tax, remark FROM scm_doc WHERE id='PO1'").get())
      .toEqual({ total_qty: 175, total_amount: 2580, total_tax: 270.4, remark: '客户追加' })
  })

  it('新数量不能低于已入库；已入库的行不能删除', () => {
    const { doc, snapshot } = snapshotOrder(db, AID, 'PO1')
    const errs = validateOrderChange(db, AID, doc, snapshot, normalizeOrderTarget(target([{ id: 'L1', item_code: 'M1', qty: 20, price: 10 }]), snapshot))
    expect(errs.join()).toContain('新数量 20 小于已入库 30')
    expect(errs.join()).not.toContain('M2 已入库')   // M2 未执行可删除
    const errs2 = validateOrderChange(db, AID, doc, snapshot, normalizeOrderTarget(target([{ id: 'L2', item_code: 'M2', qty: 50, price: 20 }]), snapshot))
    expect(errs2.join()).toContain('M1 已入库 30，不能删除该行')
  })

  it('有草稿下游单时，减少数量或改价被拦截，增加数量照常', () => {
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status) VALUES ('PI2',?,'PI','PI-002','draft')").run(AID)
    db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,qty,source_line_id) VALUES ('PIL2',?,'PI2',1,'M2',10,'L2')").run(AID)
    const { doc, snapshot } = snapshotOrder(db, AID, 'PO1')
    const base = { id: 'L1', item_code: 'M1', qty: 100, price: 10 }
    const down = validateOrderChange(db, AID, doc, snapshot, normalizeOrderTarget(target([base, { id: 'L2', item_code: 'M2', qty: 40, price: 20 }]), snapshot))
    expect(down.join()).toContain('未审核的采购入库单 PI-002')
    const price = validateOrderChange(db, AID, doc, snapshot, normalizeOrderTarget(target([base, { id: 'L2', item_code: 'M2', qty: 50, price: 18 }]), snapshot))
    expect(price.join()).toContain('PI-002')
    const up = validateOrderChange(db, AID, doc, snapshot, normalizeOrderTarget(target([base, { id: 'L2', item_code: 'M2', qty: 60, price: 20 }]), snapshot))
    expect(up).toEqual([])
  })

  it('全部入库的行不能再改单价；更换已有行的物料被拒；未审核订单不走变更单', () => {
    db.prepare("UPDATE scm_doc_line SET qty=100 WHERE id='PIL1'").run()
    const { doc, snapshot } = snapshotOrder(db, AID, 'PO1')
    const errs = validateOrderChange(db, AID, doc, snapshot, normalizeOrderTarget(target([{ id: 'L1', item_code: 'M1', qty: 100, price: 8 }, { id: 'L2', item_code: 'M3', qty: 50, price: 20 }]), snapshot))
    expect(errs.join()).toContain('M1 已全部入库，不能再改单价')
    expect(errs.join()).toContain('不能更换物料')
    expect(validateOrderChange(db, AID, { ...doc, status: 'draft' }, snapshot, snapshot).join()).toContain('未审核')
  })
})
