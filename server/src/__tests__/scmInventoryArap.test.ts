import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  applyMovingAvgIn,
  applyMovingAvgOut,
  reverseDocMoves,
  getCostingMethod,
} from '../services/scmCosting.js'
import {
  applyPayment,
  reversePayment,
  applyReceivableFromShipment,
  applyPayableFromReceipt,
  applyOutsourceFeePayable,
  getPaymentSources,
  getPartnerBalanceSummary,
} from '../services/scmArAp.js'
import { computeFinishCost } from '../routes/scmDoc.js'

const AID = 'AS-TEST'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_stock (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      qty REAL DEFAULT 0, amount REAL DEFAULT 0, avg_cost REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, move_date TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, direction TEXT, qty REAL, unit_cost REAL,
      amount REAL, batch_no TEXT, balance_qty REAL, balance_amount REAL, balance_avg_cost REAL);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, doc_date TEXT, partner_code TEXT);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT, ar_account TEXT, ap_account TEXT);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      doc_date TEXT, due_date TEXT, direction TEXT, amount REAL, ar_account TEXT, ap_account TEXT, cashier_journal_id TEXT,
      remark TEXT, verified_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE scm_ar_ap_verify (id TEXT PRIMARY KEY, account_set_id TEXT, partner_code TEXT, verify_no TEXT,
      verify_date TEXT, in_log_id TEXT, out_log_id TEXT, amount REAL, created_by TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE cashier_journal (id TEXT, account_set_id TEXT, account_code TEXT, currency TEXT, biz_date TEXT,
      summary TEXT, debit REAL, credit REAL, settle_type TEXT, counter_account TEXT, created_by TEXT);
  `)
  return db
}

function stock(db: Database.Database, wh = 'W1', item = 'I1') {
  return db.prepare('SELECT qty, amount, avg_cost FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?').get(AID, wh, item) as any
}
const ref = (no: string, seq = 1) => ({ type: 'PI', no, seq, date: '2026-06-01' })

describe('scmCosting 移动加权平均', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })

  it('入库按加权平均累计单位成本', () => {
    applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('D1'))
    expect(stock(db)).toMatchObject({ qty: 10, amount: 1000, avg_cost: 100 })
    applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 120, ref('D2'))
    // (1000 + 1200) / 20 = 110
    expect(stock(db)).toMatchObject({ qty: 20, amount: 2200, avg_cost: 110 })
  })

  it('出库取当前均价、扣减库存', () => {
    applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('D1'))
    applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 120, ref('D2'))
    const { unitCost } = applyMovingAvgOut(db, AID, 'W1', 'I1', 5, ref('D3'))
    expect(unitCost).toBe(110)
    // 20 - 5 = 15；2200 - 110*5 = 1650
    expect(stock(db)).toMatchObject({ qty: 15, amount: 1650, avg_cost: 110 })
  })

  it('reverseDocMoves 撤销单据库存移动', () => {
    const docId = uuidv4()
    db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no) VALUES (?,?,?,?)').run(docId, AID, 'PI', 'D1')
    applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('D1'))
    expect(stock(db).qty).toBe(10)
    reverseDocMoves(db, AID, docId)
    expect(stock(db).qty).toBe(0)
    expect(db.prepare("SELECT COUNT(*) c FROM scm_stock_move WHERE account_set_id=?").get(AID)).toMatchObject({ c: 0 })
  })

  it('入库已被后续出库占用时禁止反审核形成负库存', () => {
    const docId = uuidv4()
    db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no) VALUES (?,?,?,?)').run(docId, AID, 'PI', 'IN-1')
    applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('IN-1'))
    applyMovingAvgOut(db, AID, 'W1', 'I1', 6, { ...ref('OUT-1'), type: 'PL' })

    expect(() => reverseDocMoves(db, AID, docId)).toThrow('反审核将导致负库存')
    expect(stock(db)).toMatchObject({ qty: 4, amount: 400, avg_cost: 100 })
    expect(db.prepare("SELECT COUNT(*) c FROM scm_stock_move WHERE account_set_id=? AND doc_no='IN-1'").get(AID)).toMatchObject({ c: 1 })
  })

  it('底层出库直接阻止超出当前库存', () => {
    applyMovingAvgIn(db, AID, 'W1', 'I1', 5, 100, ref('IN-1'))
    expect(() => applyMovingAvgOut(db, AID, 'W1', 'I1', 6, { ...ref('OUT-1'), type: 'PL' })).toThrow('库存不足')
    expect(stock(db)).toMatchObject({ qty: 5, amount: 500, avg_cost: 100 })
  })

  it('getCostingMethod 默认 moving_avg，可读参数', () => {
    expect(getCostingMethod(db, AID)).toBe('moving_avg')
    db.prepare('INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)').run(uuidv4(), AID, 'scm:costing_method', 'fifo')
    expect(getCostingMethod(db, AID)).toBe('fifo')
  })
})

describe('scmArAp 货物驱动往来', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createDb()
    db.prepare('INSERT INTO scm_partner (id,account_set_id,code,name,ar_account,ap_account) VALUES (?,?,?,?,?,?)')
      .run(uuidv4(), AID, 'P1', '客户甲', '1131', '2121')
  })

  it('销售发货生成应收（direction=in）', () => {
    applyReceivableFromShipment(db, AID, { doc_type: 'SO', doc_no: 'S1', doc_date: '2026-06-01', partner_code: 'P1' }, [{ amount: 300 }, { amount: 100 }])
    const rows = db.prepare("SELECT direction, amount FROM scm_ar_ap_log WHERE account_set_id=?").all(AID) as any[]
    expect(rows).toEqual([{ direction: 'in', amount: 400 }])
  })

  it('采购入库生成应付（direction=in）', () => {
    applyPayableFromReceipt(db, AID, { doc_type: 'PI', doc_no: 'I1', doc_date: '2026-06-01', partner_code: 'P1' }, [{ amount: 500 }])
    const rows = db.prepare("SELECT direction, amount, ap_account FROM scm_ar_ap_log WHERE account_set_id=?").all(AID) as any[]
    expect(rows).toEqual([{ direction: 'in', amount: 500, ap_account: '2121' }])
  })

  it('无往来单位时不挂应收/应付（回归 PI 无供应商崩溃）', () => {
    applyPayableFromReceipt(db, AID, { doc_type: 'PI', doc_no: 'I2', doc_date: '2026-06-01', partner_code: null }, [{ amount: 500 }])
    applyReceivableFromShipment(db, AID, { doc_type: 'SO', doc_no: 'S2', doc_date: '2026-06-01', partner_code: '' }, [{ amount: 300 }])
    expect(db.prepare("SELECT COUNT(*) c FROM scm_ar_ap_log WHERE account_set_id=?").get(AID)).toMatchObject({ c: 0 })
  })

  it('委外入库加工费生成委外厂应付（direction=in）', () => {
    applyOutsourceFeePayable(db, AID, { doc_type: 'WI', doc_no: 'WI1', doc_date: '2026-06-01', partner_code: 'P1' }, 300)
    const rows = db.prepare("SELECT direction, amount, ap_account FROM scm_ar_ap_log WHERE account_set_id=?").all(AID) as any[]
    expect(rows).toEqual([{ direction: 'in', amount: 300, ap_account: '2121' }])
  })

  it('加工费为0或无委外厂时不挂应付', () => {
    applyOutsourceFeePayable(db, AID, { doc_type: 'WI', doc_no: 'WI2', doc_date: '2026-06-01', partner_code: 'P1' }, 0)
    applyOutsourceFeePayable(db, AID, { doc_type: 'WI', doc_no: 'WI3', doc_date: '2026-06-01', partner_code: '' }, 300)
    expect(db.prepare("SELECT COUNT(*) c FROM scm_ar_ap_log WHERE account_set_id=?").get(AID)).toMatchObject({ c: 0 })
  })

  it('收款按多行金额写入所选银行账户、币种和结算方式', () => {
    const doc = {
      doc_type: 'RCV', doc_no: 'RCV-1', doc_date: '2026-07-13', partner_code: 'P1',
      settle_account: '100201', currency: 'USD', payment_type: 'transfer', remark: '整单备注',
    }
    applyPayment(db, AID, doc, [{ amount: 300, remark: '首款' }, { amount: 200, remark: '尾款' }], '测试员')
    const journals = db.prepare(`SELECT account_code, currency, summary, debit, credit, settle_type, counter_account
      FROM cashier_journal ORDER BY rowid`).all() as any[]
    expect(journals).toEqual([
      { account_code: '100201', currency: 'USD', summary: '首款', debit: 300, credit: 0, settle_type: '转账', counter_account: '1131' },
      { account_code: '100201', currency: 'USD', summary: '尾款', debit: 200, credit: 0, settle_type: '转账', counter_account: '1131' },
    ])
    expect(db.prepare('SELECT COUNT(*) c FROM scm_ar_ap_log').get()).toMatchObject({ c: 2 })
  })

  it('付款写贷方流水，反审核删除对应往来和出纳记录', () => {
    const doc = {
      doc_type: 'PAY', doc_no: 'PAY-1', doc_date: '2026-07-13', partner_code: 'P1',
      settle_account: '100202', currency: 'CNY', payment_type: 'cash',
    }
    applyPayment(db, AID, doc, [{ amount: 88.6 }], '测试员')
    expect(db.prepare('SELECT account_code, debit, credit, settle_type, counter_account FROM cashier_journal').get()).toEqual({
      account_code: '100202', debit: 0, credit: 88.6, settle_type: '现金', counter_account: '2121',
    })
    reversePayment(db, AID, doc)
    expect(db.prepare('SELECT COUNT(*) c FROM cashier_journal').get()).toMatchObject({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM scm_ar_ap_log').get()).toMatchObject({ c: 0 })
  })

  it('收款按销售发货源单自动核销，预收款保留未核销余额，反审核完整回退', () => {
    db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,partner_code) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), AID, 'SO', 'SO-1', 'audited', '2026-07-01', 'P1')
    applyReceivableFromShipment(db, AID, {
      doc_type: 'SO', doc_no: 'SO-1', doc_date: '2026-07-01', partner_code: 'P1',
    }, [{ amount: 300 }])
    const source = getPaymentSources(db, AID, 'P1', 'RCV')[0]
    expect(source).toMatchObject({ source_doc_no: 'SO-1', source_amount: 300, settled_amount: 0, open_amount: 300 })

    const receipt = {
      doc_type: 'RCV', doc_no: 'RCV-2', doc_date: '2026-07-13', partner_code: 'P1',
      settle_account: '100201', currency: 'CNY', payment_type: 'transfer',
    }
    db.transaction(() => applyPayment(db, AID, receipt, [
      { amount: 180, arap_source_log_id: source.arap_source_log_id, remark: 'SO-1部分收款' },
      { amount: 20, remark: '预收款' },
    ], '测试员'))()

    expect(db.prepare('SELECT verified_amount FROM scm_ar_ap_log WHERE id=?').get(source.arap_source_log_id)).toEqual({ verified_amount: 180 })
    expect(db.prepare('SELECT COUNT(*) c, SUM(amount) amount FROM scm_ar_ap_verify').get()).toMatchObject({ c: 1, amount: 180 })
    const receiptLogs = db.prepare("SELECT amount, verified_amount FROM scm_ar_ap_log WHERE doc_no='RCV-2' ORDER BY amount DESC").all() as any[]
    expect(receiptLogs).toEqual([{ amount: 180, verified_amount: 180 }, { amount: 20, verified_amount: 0 }])

    db.transaction(() => reversePayment(db, AID, receipt))()
    expect(db.prepare('SELECT verified_amount FROM scm_ar_ap_log WHERE id=?').get(source.arap_source_log_id)).toEqual({ verified_amount: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM scm_ar_ap_verify').get()).toMatchObject({ c: 0 })
    expect(db.prepare("SELECT COUNT(*) c FROM scm_ar_ap_log WHERE doc_no='RCV-2'").get()).toMatchObject({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM cashier_journal').get()).toMatchObject({ c: 0 })
  })

  it('并发后源单余额不足时审核核销失败并整体回滚', () => {
    db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status,doc_date,partner_code) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), AID, 'SO', 'SO-2', 'audited', '2026-07-01', 'P1')
    applyReceivableFromShipment(db, AID, { doc_type: 'SO', doc_no: 'SO-2', doc_date: '2026-07-01', partner_code: 'P1' }, [{ amount: 100 }])
    const source = getPaymentSources(db, AID, 'P1', 'RCV')[0]
    db.prepare('UPDATE scm_ar_ap_log SET verified_amount=80 WHERE id=?').run(source.arap_source_log_id)
    const receipt = { doc_type: 'RCV', doc_no: 'RCV-3', doc_date: '2026-07-13', partner_code: 'P1', settle_account: '100201' }
    const audit = db.transaction(() => applyPayment(db, AID, receipt, [{ amount: 30, arap_source_log_id: source.arap_source_log_id }], '测试员'))
    expect(() => audit()).toThrow(/超出未核销余额/)
    expect(db.prepare("SELECT COUNT(*) c FROM scm_ar_ap_log WHERE doc_no='RCV-3'").get()).toMatchObject({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM cashier_journal').get()).toMatchObject({ c: 0 })
  })
})

describe('生产完工成本结转（实际成本·按计划数分摊，末批吸收）', () => {
  // 工单：计划10，已领成本1500（单位成本150）
  it('非末批按 单位成本×完工数 结转', () => {
    const r = computeFinishCost({ issuedCost: 1500, planQty: 10, wipBefore: 1500, finishedBefore: 0, thisQty: 5 })
    expect(r).toMatchObject({ isLast: false, unitCost: 150, thisAmount: 750, perUnit: 150 })
  })

  it('末批吸收 WIP 全部余额（含差异），保证在制归零', () => {
    // 已完工5、再完工5达成计划 → 末批；wipBefore=750
    const r = computeFinishCost({ issuedCost: 1500, planQty: 10, wipBefore: 750, finishedBefore: 5, thisQty: 5 })
    expect(r).toMatchObject({ isLast: true, thisAmount: 750, perUnit: 150 })
  })

  it('末批领料偏多时，末批吸收剩余差异（单位成本被抬高）', () => {
    // 计划10、实际领料1700（unitCost=170）；先完工5(按170→850)，余850；末批完工5 吸收 850
    const first = computeFinishCost({ issuedCost: 1700, planQty: 10, wipBefore: 1700, finishedBefore: 0, thisQty: 5 })
    expect(first).toMatchObject({ isLast: false, unitCost: 170, thisAmount: 850 })
    const last = computeFinishCost({ issuedCost: 1700, planQty: 10, wipBefore: 850, finishedBefore: 5, thisQty: 5 })
    expect(last).toMatchObject({ isLast: true, thisAmount: 850, perUnit: 170 })
  })

  it('超产也视为末批、吸收余额', () => {
    const r = computeFinishCost({ issuedCost: 1500, planQty: 10, wipBefore: 600, finishedBefore: 8, thisQty: 4 })
    expect(r.isLast).toBe(true)
    expect(r.thisAmount).toBe(600)
  })

  it('一次性全部完工：单位成本×全部数量=已领成本', () => {
    const r = computeFinishCost({ issuedCost: 1500, planQty: 10, wipBefore: 1500, finishedBefore: 0, thisQty: 10 })
    expect(r).toMatchObject({ isLast: true, thisAmount: 1500, perUnit: 150 })
  })
})

describe('往来余额表 · getPartnerBalanceSummary（按往来单位汇总）', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
        doc_date TEXT, due_date TEXT, direction TEXT, amount REAL, ar_account TEXT, ap_account TEXT,
        cashier_journal_id TEXT, remark TEXT, verified_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT, partner_type TEXT);
    `)
    db.prepare("INSERT INTO scm_partner (id,account_set_id,code,name,partner_type) VALUES (?,?,?,?,?)").run('p1', AID, 'C001', '客户甲', 'customer')
    db.prepare("INSERT INTO scm_partner (id,account_set_id,code,name,partner_type) VALUES (?,?,?,?,?)").run('p2', AID, 'S001', '供应商乙', 'supplier')
  })
  const insLog = (id: string, partner: string, date: string, dir: 'in' | 'out', amount: number, docType = 'PI') =>
    db.prepare("INSERT INTO scm_ar_ap_log (id,account_set_id,partner_code,doc_type,doc_no,doc_date,direction,amount) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, AID, partner, docType, 'D' + id, date, dir, amount)

  it('无数据 → 空汇总', () => {
    const r = getPartnerBalanceSummary(db, AID)
    expect(r.summary).toHaveLength(0)
    expect(r.total_closing).toBe(0)
  })

  it('应收业务分别返回应收、收款及期末应收', () => {
    insLog('1', 'C001', '2026-07-01', 'in', 1000, 'SO')   // 销售→应收增加
    insLog('2', 'C001', '2026-07-05', 'out', 300, 'RCV')  // 收款→核销减少
    const r = getPartnerBalanceSummary(db, AID, '2026-07-01', '2026-07-31')
    expect(r.summary).toHaveLength(1)
    const c = r.summary[0]
    expect(c.partner_code).toBe('C001')
    expect(c.period_in).toBe(1000)
    expect(c.period_out).toBe(300)
    expect(c.receivable_amount).toBe(1000)
    expect(c.received_amount).toBe(300)
    expect(c.payable_amount).toBe(0)
    expect(c.paid_amount).toBe(0)
    expect(c.ar_closing).toBe(700)
    expect(c.ap_closing).toBe(0)
    expect(c.closing).toBe(700)
    expect(c.opening).toBe(0)
    expect(c.partner_name).toBe('客户甲')
    expect(c.partner_type).toBe('customer')
    // 合计
    expect(r.total_in).toBe(1000)
    expect(r.total_out).toBe(300)
    expect(r.total_closing).toBe(700)
    expect(r.total_receivable).toBe(1000)
    expect(r.total_received).toBe(300)
  })

  it('期初正确：startDate 之前净额计入期初，之后计入本期', () => {
    insLog('1', 'C001', '2026-06-20', 'in', 500, 'SO')    // 期初前
    insLog('2', 'C001', '2026-07-10', 'in', 200, 'SO')    // 本期
    const r = getPartnerBalanceSummary(db, AID, '2026-07-01', '2026-07-31')
    const c = r.summary[0]
    expect(c.opening).toBe(500)
    expect(c.ar_opening).toBe(500)
    expect(c.period_in).toBe(200)
    expect(c.closing).toBe(700)
  })

  it('多往来单位仍一单位一行，应收与应付分别汇总并使用净额口径', () => {
    insLog('1', 'C001', '2026-07-01', 'in', 100, 'SO')
    insLog('2', 'S001', '2026-07-02', 'in', 400, 'PI')
    insLog('3', 'S001', '2026-07-03', 'out', 100, 'PAY')
    const r = getPartnerBalanceSummary(db, AID)
    expect(r.summary).toHaveLength(2)
    const c = r.summary.find((x: any) => x.partner_code === 'C001')
    const s = r.summary.find((x: any) => x.partner_code === 'S001')
    expect(c.closing).toBe(100)
    expect(c.ar_closing).toBe(100)
    expect(s.ap_closing).toBe(300)
    expect(s.payable_amount).toBe(400)
    expect(s.paid_amount).toBe(100)
    expect(s.closing).toBe(-300)   // 全部往来净额：应收为正、应付为负
    expect(r.total_ar_closing).toBe(100)
    expect(r.total_ap_closing).toBe(300)
    expect(r.total_closing).toBe(-200)
  })

  it('应收/应付筛选只保留对应业务，筛选应付时余额保持正数', () => {
    insLog('1', 'C001', '2026-07-01', 'in', 100, 'SO')
    insLog('2', 'S001', '2026-07-02', 'in', 400, 'PI')
    insLog('3', 'S001', '2026-07-03', 'out', 100, 'PAY')
    const ar = getPartnerBalanceSummary(db, AID, undefined, undefined, 'ar')
    const ap = getPartnerBalanceSummary(db, AID, undefined, undefined, 'ap')
    expect(ar.summary.map((x: any) => x.partner_code)).toEqual(['C001'])
    expect(ar.total_ar_closing).toBe(100)
    expect(ap.summary.map((x: any) => x.partner_code)).toEqual(['S001'])
    expect(ap.total_payable).toBe(400)
    expect(ap.total_paid).toBe(100)
    expect(ap.total_closing).toBe(300)
  })
})
