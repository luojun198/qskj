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
  applyInvoice,
  reverseInvoice,
  sumGrossAmount,
  getPaymentSources,
  getPartnerBalanceSummary,
  verifyArAp,
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
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, doc_date TEXT, partner_code TEXT, source_doc_id TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT, qty REAL, price REAL, amount REAL, tax_amount REAL);
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT, ar_account TEXT, ap_account TEXT);
    CREATE TABLE scm_ar_ap_log (currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
      doc_date TEXT, due_date TEXT, direction TEXT, amount REAL, ar_account TEXT, ap_account TEXT, cashier_journal_id TEXT,
      remark TEXT, verified_amount REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE scm_ar_ap_verify (id TEXT PRIMARY KEY, account_set_id TEXT, partner_code TEXT, verify_no TEXT,
      verify_date TEXT, in_log_id TEXT, out_log_id TEXT, amount REAL, created_by TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT, purchase_price REAL, ref_cost REAL);
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

  // ── S5 / S7 回归 ─────────────────────────────────────────

  it('S5 负库存出库无库存记录时按最近入库单价兜底，不再记成本 0', () => {
    // 先在别的仓入库，建立该物料的入库单价轨迹
    applyMovingAvgIn(db, AID, 'W9', 'I1', 10, 88, ref('IN-9'))
    const { unitCost } = applyMovingAvgOut(db, AID, 'W1', 'I1', 2, { ...ref('OUT-1'), type: 'PL' }, { allowNegative: true })
    expect(unitCost).toBe(88)
    expect(stock(db, 'W1', 'I1')).toMatchObject({ qty: -2, amount: -176 })
  })

  it('S5 无任何入库轨迹时退回物料档案参考进价', () => {
    db.prepare('INSERT INTO scm_item (id,account_set_id,code,name,purchase_price,ref_cost) VALUES (?,?,?,?,?,?)')
      .run(uuidv4(), AID, 'I2', '物料二', 0, 55)
    const { unitCost } = applyMovingAvgOut(db, AID, 'W1', 'I2', 1, { ...ref('OUT-2'), type: 'PL' }, { allowNegative: true })
    expect(unitCost).toBe(55)
  })

  it('S5 档案也没有价格时仍返回 0（保持可用，不抛错）', () => {
    const { unitCost } = applyMovingAvgOut(db, AID, 'W1', 'I3', 1, { ...ref('OUT-3'), type: 'PL' }, { allowNegative: true })
    expect(unitCost).toBe(0)
  })

  it('S7 反审核回算均价按 4 位舍入，与入/出库口径一致', () => {
    const docId = uuidv4()
    db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no) VALUES (?,?,?,?)').run(docId, AID, 'PI', 'IN-R')
    applyMovingAvgIn(db, AID, 'W1', 'I1', 3, 10, ref('IN-0'))
    applyMovingAvgIn(db, AID, 'W1', 'I1', 1, 20, ref('IN-R'))
    reverseDocMoves(db, AID, docId)
    const avg = stock(db).avg_cost
    expect(avg).toBe(Math.round(avg * 10000) / 10000)
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

  // ── S2：往来台账改为含税口径 ──────────────────────────────

  it('S2 销售发货按价税合计挂应收（与凭证借方应收口径一致）', () => {
    const lines = [{ amount: 300, tax_amount: 39 }, { amount: 100, tax_amount: 13 }]
    applyReceivableFromShipment(db, AID, { doc_type: 'SO', doc_no: 'S2', doc_date: '2026-06-01', partner_code: 'P1' }, lines)
    const row = db.prepare("SELECT amount FROM scm_ar_ap_log WHERE doc_no='S2'").get() as any
    // 凭证 sale 分支借应收 = Σ(amt + tax) = 452
    const voucherAr = lines.reduce((t, l) => t + l.amount + l.tax_amount, 0)
    expect(row.amount).toBe(452)
    expect(row.amount).toBe(voucherAr)
  })

  it('S2 采购入库按价税合计挂应付（与凭证贷方应付口径一致）', () => {
    const lines = [{ amount: 1000, tax_amount: 130 }]
    applyPayableFromReceipt(db, AID, { doc_type: 'PI', doc_no: 'I2', doc_date: '2026-06-01', partner_code: 'P1' }, lines)
    const row = db.prepare("SELECT amount FROM scm_ar_ap_log WHERE doc_no='I2'").get() as any
    expect(row.amount).toBe(1130)
    expect(row.amount).toBe(lines.reduce((t, l) => t + l.amount + l.tax_amount, 0))
  })

  it('S2 含税收款可以把应收核销干净（原不含税口径下税额永远核不掉）', () => {
    applyReceivableFromShipment(db, AID, { doc_type: 'SO', doc_no: 'S3', doc_date: '2026-06-01', partner_code: 'P1' }, [{ amount: 1000, tax_amount: 130 }])
    const inLog = db.prepare("SELECT id, amount FROM scm_ar_ap_log WHERE doc_no='S3'").get() as any
    expect(inLog.amount).toBe(1130)
    // 客户按含税额 1130 付款，核销后无余额
    db.prepare(`INSERT INTO scm_ar_ap_log (id,account_set_id,partner_code,doc_type,doc_no,doc_date,direction,amount,verified_amount)
      VALUES (?,?,?,'RCV','R1','2026-06-10','out',1130,0)`).run(uuidv4(), AID, 'P1')
    const outLog = db.prepare("SELECT id FROM scm_ar_ap_log WHERE doc_no='R1'").get() as any
    expect(() => verifyArAp(db, AID, {
      partner_code: 'P1', matches: [{ in_log_id: inLog.id, out_log_id: outLog.id, amount: 1130 }],
    })).not.toThrow()
    const after = db.prepare("SELECT amount, verified_amount FROM scm_ar_ap_log WHERE doc_no='S3'").get() as any
    expect(after.amount - after.verified_amount).toBe(0)
  })

  // ── S1：发票（RP/RS）挂账 ─────────────────────────────────

  /** 建一张来源单据（含明细），返回其 id */
  const mkSourceDoc = (docType: string, docNo: string, lines: Array<{ amount: number; tax_amount: number }>) => {
    const id = uuidv4()
    db.prepare("INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,partner_code) VALUES (?,?,?,?,?,?)")
      .run(id, AID, docType, docNo, '2026-06-01', 'P1')
    lines.forEach((l, i) => db.prepare("INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,amount,tax_amount) VALUES (?,?,?,?,?,?)")
      .run(uuidv4(), AID, id, i + 1, l.amount, l.tax_amount))
    return id
  }
  const logOf = (docNo: string) => db.prepare("SELECT * FROM scm_ar_ap_log WHERE doc_no=?").get(docNo) as any
  const logCount = () => (db.prepare("SELECT COUNT(*) c FROM scm_ar_ap_log WHERE account_set_id=?").get(AID) as any).c

  it('S1 有来源单据的发票校正暂估额，不新增台账（避免同一笔业务双计）', () => {
    const srcLines = [{ amount: 1000, tax_amount: 130 }]
    const srcId = mkSourceDoc('PI', 'PI-1', srcLines)
    applyPayableFromReceipt(db, AID, { doc_type: 'PI', doc_no: 'PI-1', doc_date: '2026-06-01', partner_code: 'P1' }, srcLines)
    expect(logOf('PI-1').amount).toBe(1130)
    expect(logCount()).toBe(1)

    // 实际开票 1200 + 156 税
    const r = applyInvoice(db, AID,
      { doc_type: 'RP', doc_no: 'RP-1', doc_date: '2026-06-05', partner_code: 'P1', source_doc_id: srcId },
      [{ amount: 1200, tax_amount: 156 }])
    expect(r).toMatchObject({ mode: 'adjust', amount: 1356, sourceDocNo: 'PI-1' })
    expect(logCount()).toBe(1)                    // 没有新增
    expect(logOf('PI-1').amount).toBe(1356)       // 按发票金额校正
    expect(logOf('PI-1').remark).toMatch(/RP-1/)
  })

  it('S1 独立发票（无来源单据）新挂一条台账', () => {
    const r = applyInvoice(db, AID,
      { doc_type: 'RS', doc_no: 'RS-9', doc_date: '2026-06-05', partner_code: 'P1' },
      [{ amount: 500, tax_amount: 65 }])
    expect(r).toMatchObject({ mode: 'create', amount: 565 })
    const log = logOf('RS-9')
    expect(log).toMatchObject({ direction: 'in', amount: 565, ar_account: '1131' })
    expect(log.ap_account).toBeNull()
  })

  it('S1 独立采购发票挂应付科目', () => {
    applyInvoice(db, AID, { doc_type: 'RP', doc_no: 'RP-9', doc_date: '2026-06-05', partner_code: 'P1' }, [{ amount: 200, tax_amount: 26 }])
    const log = logOf('RP-9')
    expect(log).toMatchObject({ amount: 226, ap_account: '2121' })
    expect(log.ar_account).toBeNull()
  })

  it('S1 发票金额低于已核销金额时拦截', () => {
    const srcLines = [{ amount: 1000, tax_amount: 130 }]
    const srcId = mkSourceDoc('PI', 'PI-2', srcLines)
    applyPayableFromReceipt(db, AID, { doc_type: 'PI', doc_no: 'PI-2', doc_date: '2026-06-01', partner_code: 'P1' }, srcLines)
    db.prepare("UPDATE scm_ar_ap_log SET verified_amount=800, verified_fc=800 WHERE doc_no='PI-2'").run()
    expect(() => applyInvoice(db, AID,
      { doc_type: 'RP', doc_no: 'RP-2', doc_date: '2026-06-05', partner_code: 'P1', source_doc_id: srcId },
      [{ amount: 500, tax_amount: 65 }])).toThrow(/已核销金额/)
  })

  it('S1 反审核发票：校正过暂估的还原为来源单据金额', () => {
    const srcLines = [{ amount: 1000, tax_amount: 130 }]
    const srcId = mkSourceDoc('PI', 'PI-3', srcLines)
    applyPayableFromReceipt(db, AID, { doc_type: 'PI', doc_no: 'PI-3', doc_date: '2026-06-01', partner_code: 'P1' }, srcLines)
    const invoice = { doc_type: 'RP', doc_no: 'RP-3', doc_date: '2026-06-05', partner_code: 'P1', source_doc_id: srcId }
    applyInvoice(db, AID, invoice, [{ amount: 1200, tax_amount: 156 }])
    expect(logOf('PI-3').amount).toBe(1356)

    reverseInvoice(db, AID, invoice)
    expect(logOf('PI-3').amount).toBe(1130)       // 还原为来源单据价税合计
    expect(String(logOf('PI-3').remark ?? '')).not.toMatch(/RP-3/)
    expect(logCount()).toBe(1)
  })

  it('S1 反审核独立发票：删除自己的台账', () => {
    const invoice = { doc_type: 'RS', doc_no: 'RS-4', doc_date: '2026-06-05', partner_code: 'P1' }
    applyInvoice(db, AID, invoice, [{ amount: 500, tax_amount: 65 }])
    expect(logCount()).toBe(1)
    reverseInvoice(db, AID, invoice)
    expect(logCount()).toBe(0)
  })

  it('S1 无往来单位或零金额的发票不挂账', () => {
    expect(applyInvoice(db, AID, { doc_type: 'RP', doc_no: 'RP-0', doc_date: '2026-06-05' }, [{ amount: 100, tax_amount: 13 }]).mode).toBe('skip')
    expect(applyInvoice(db, AID, { doc_type: 'RP', doc_no: 'RP-0', doc_date: '2026-06-05', partner_code: 'P1' }, []).mode).toBe('skip')
    expect(logCount()).toBe(0)
  })

  it('sumGrossAmount 累加价税合计并按分舍入', () => {
    expect(sumGrossAmount([{ amount: 33.335, tax_amount: 0 }, { amount: 1, tax_amount: 0.135 }])).toBe(34.48)
    expect(sumGrossAmount([])).toBe(0)
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
    db.prepare('UPDATE scm_ar_ap_log SET verified_amount=80, verified_fc=80 WHERE id=?').run(source.arap_source_log_id)
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
      CREATE TABLE scm_ar_ap_log (currency TEXT, exchange_rate REAL NOT NULL DEFAULT 1, amount_fc REAL, verified_fc REAL NOT NULL DEFAULT 0, id TEXT, account_set_id TEXT, partner_code TEXT, doc_type TEXT, doc_no TEXT,
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
