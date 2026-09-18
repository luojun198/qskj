import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { applyMovingAvgIn, applyMovingAvgOut, reverseDocMoves, applyCostAdjustment, listStockLayers } from '../services/scmCosting.js'
import { calcMonthAvg, listCostingPeriods } from '../services/scmMonthAvg.js'
import { up as layerUp } from '../db/migrations/20260918_scm_stock_layer.js'
import { up as periodUp } from '../db/migrations/20260918_scm_costing_period.js'

const AID = 'AS-FIFO'

function createDb(method: 'fifo' | 'lifo' | 'moving_avg' | 'specified' | 'month_avg') {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_stock (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      qty REAL DEFAULT 0, amount REAL DEFAULT 0, avg_cost REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, move_date TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, direction TEXT, qty REAL, unit_cost REAL,
      amount REAL, batch_no TEXT, balance_qty REAL, balance_amount REAL, balance_avg_cost REAL);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, doc_date TEXT, voucher_id TEXT);
    CREATE TABLE scm_doc_line (id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT, qty REAL, unit_cost REAL);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT, unit TEXT, purchase_price REAL, ref_cost REAL);
    CREATE TABLE scm_warehouse (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
  `)
  layerUp(db)
  periodUp(db)
  db.prepare("INSERT INTO system_params VALUES (?,?,'scm:costing_method',?)").run(uuidv4(), AID, method)
  return db
}
const stock = (db: Database.Database, wh = 'W1', item = 'I1') =>
  db.prepare('SELECT qty, amount, avg_cost FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?').get(AID, wh, item) as any
const layers = (db: Database.Database) => listStockLayers(db, AID, { only_left: false }).map(l => ({ doc_no: l.doc_no, qty_left: l.qty_left, unit_cost: l.unit_cost }))
const ref = (type: string, no: string, date = '2026-06-01', seq = 1) => ({ type, no, seq, date })
function docRow(db: Database.Database, type: string, no: string) {
  const id = uuidv4()
  db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,status) VALUES (?,?,?,?,?)').run(id, AID, type, no, 'audited')
  return id
}

describe('FIFO / LIFO 成本层计价', () => {
  let db: Database.Database

  describe('fifo', () => {
    beforeEach(() => { db = createDb('fifo') })

    it('入库形成层，出库先耗最早层，单价 = 层加权', () => {
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('PI', 'D1', '2026-06-01'))
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 120, ref('PI', 'D2', '2026-06-02'))
      expect(layers(db)).toEqual([{ doc_no: 'D1', qty_left: 10, unit_cost: 100 }, { doc_no: 'D2', qty_left: 10, unit_cost: 120 }])
      // 出 15：10×100 + 5×120 = 1600 → 单价 106.6667
      const { unitCost, move } = applyMovingAvgOut(db, AID, 'W1', 'I1', 15, ref('SO', 'S1', '2026-06-03'))
      expect(move.amount).toBe(1600)
      expect(unitCost).toBe(106.6667)
      expect(layers(db)).toEqual([{ doc_no: 'D1', qty_left: 0, unit_cost: 100 }, { doc_no: 'D2', qty_left: 5, unit_cost: 120 }])
      // 结存 5 × 120 = 600（与移动加权 5×110=550 不同）
      expect(stock(db)).toMatchObject({ qty: 5, amount: 600, avg_cost: 120 })
      expect(db.prepare('SELECT COUNT(*) c FROM scm_stock_layer_use WHERE move_id=?').get(move.id)).toMatchObject({ c: 2 })
    })

    it('反审核出库单恢复层剩余；反审核已被消耗的入库单被拒', () => {
      const d1 = docRow(db, 'PI', 'D1'); docRow(db, 'PI', 'D2'); const s1 = docRow(db, 'SO', 'S1')
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('PI', 'D1', '2026-06-01'))
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 120, ref('PI', 'D2', '2026-06-02'))
      applyMovingAvgOut(db, AID, 'W1', 'I1', 15, ref('SO', 'S1', '2026-06-03'))
      expect(() => reverseDocMoves(db, AID, d1)).toThrow(/已被后续出库消耗/)
      reverseDocMoves(db, AID, s1)
      expect(layers(db)).toEqual([{ doc_no: 'D1', qty_left: 10, unit_cost: 100 }, { doc_no: 'D2', qty_left: 10, unit_cost: 120 }])
      expect(stock(db)).toMatchObject({ qty: 20, amount: 2200 })
      reverseDocMoves(db, AID, d1)
      expect(layers(db)).toEqual([{ doc_no: 'D2', qty_left: 10, unit_cost: 120 }])
      expect(stock(db)).toMatchObject({ qty: 10, amount: 1200, avg_cost: 120 })
    })

    it('切换计价方式前的存量结存自动补为期初层（FIFO 最先耗）', () => {
      db.prepare("UPDATE system_params SET param_value='moving_avg' WHERE param_key='scm:costing_method'").run()
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('PI', 'D0', '2026-05-01'))
      expect(layers(db)).toEqual([])
      db.prepare("UPDATE system_params SET param_value='fifo' WHERE param_key='scm:costing_method'").run()
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 130, ref('PI', 'D1', '2026-06-01'))
      expect(layers(db)).toEqual([{ doc_no: '', qty_left: 10, unit_cost: 100 }, { doc_no: 'D1', qty_left: 10, unit_cost: 130 }])
      const { move } = applyMovingAvgOut(db, AID, 'W1', 'I1', 12, ref('SO', 'S1', '2026-06-02'))
      expect(move.amount).toBe(1260)   // 10×100 + 2×130
      expect(stock(db)).toMatchObject({ qty: 8, amount: 1040 })
    })

    it('允许负库存时层不够的部分按最后耗用层单价兜底', () => {
      applyMovingAvgIn(db, AID, 'W1', 'I1', 5, 100, ref('PI', 'D1'))
      const { move, unitCost } = applyMovingAvgOut(db, AID, 'W1', 'I1', 8, ref('SO', 'S1', '2026-06-02'), { allowNegative: true })
      expect(move.amount).toBe(800)
      expect(unitCost).toBe(100)
      expect(stock(db)).toMatchObject({ qty: -3, amount: -300 })
    })

    it('成本调整按剩余数量分摊到在库层单价，反审核回调', () => {
      const ca = docRow(db, 'CA', 'C1')
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('PI', 'D1', '2026-06-01'))
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 120, ref('PI', 'D2', '2026-06-02'))
      applyMovingAvgOut(db, AID, 'W1', 'I1', 10, ref('SO', 'S1', '2026-06-03'))
      applyCostAdjustment(db, AID, 'W1', 'I1', 50, ref('CA', 'C1', '2026-06-30'))
      expect(layers(db)).toEqual([{ doc_no: 'D1', qty_left: 0, unit_cost: 100 }, { doc_no: 'D2', qty_left: 10, unit_cost: 125 }])
      expect(stock(db)).toMatchObject({ qty: 10, amount: 1250, avg_cost: 125 })
      reverseDocMoves(db, AID, ca)
      expect(layers(db)[1]).toEqual({ doc_no: 'D2', qty_left: 10, unit_cost: 120 })
      expect(stock(db)).toMatchObject({ qty: 10, amount: 1200 })
    })
  })

  describe('lifo', () => {
    beforeEach(() => { db = createDb('lifo') })

    it('出库先耗最新层', () => {
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('PI', 'D1', '2026-06-01'))
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 120, ref('PI', 'D2', '2026-06-02'))
      const { move } = applyMovingAvgOut(db, AID, 'W1', 'I1', 15, ref('SO', 'S1', '2026-06-03'))
      expect(move.amount).toBe(1700)   // 10×120 + 5×100
      expect(layers(db)).toEqual([{ doc_no: 'D1', qty_left: 5, unit_cost: 100 }, { doc_no: 'D2', qty_left: 0, unit_cost: 120 }])
      expect(stock(db)).toMatchObject({ qty: 5, amount: 500, avg_cost: 100 })
    })
  })

  describe('specified（指定成本 / 个别计价）', () => {
    beforeEach(() => { db = createDb('specified') })

    it('出库行指定批次即耗该批次的层；未指定批次按先进先出', () => {
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, { ...ref('PI', 'D1', '2026-06-01'), batchNo: 'B1' })
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 120, { ...ref('PI', 'D2', '2026-06-02'), batchNo: 'B2' })
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 130, ref('PI', 'D3', '2026-06-03'))   // 未填批次 → 批次号 = 单据号
      expect(listStockLayers(db, AID, {}).map(l => l.batch_no)).toEqual(['B1', 'B2', 'D3'])
      const s1 = applyMovingAvgOut(db, AID, 'W1', 'I1', 4, { ...ref('SO', 'S1', '2026-06-04'), batchNo: 'B2' })
      expect(s1.move.amount).toBe(480)          // 4 × 120
      // 指定批次不足：B2 余 6，出 8 → 6×120 + 2×100（其余层先进先出）
      const s2 = applyMovingAvgOut(db, AID, 'W1', 'I1', 8, { ...ref('SO', 'S2', '2026-06-05'), batchNo: 'B2' })
      expect(s2.move.amount).toBe(920)
      // 未指定批次 → 先进先出：B1 余 8 → 5×100
      const s3 = applyMovingAvgOut(db, AID, 'W1', 'I1', 5, ref('SO', 'S3', '2026-06-06'))
      expect(s3.move.amount).toBe(500)
      expect(layers(db)).toEqual([{ doc_no: 'D1', qty_left: 3, unit_cost: 100 }, { doc_no: 'D2', qty_left: 0, unit_cost: 120 }, { doc_no: 'D3', qty_left: 10, unit_cost: 130 }])
      expect(stock(db)).toMatchObject({ qty: 13, amount: 1600 })   // 3×100 + 10×130
    })
  })

  describe('month_avg（全月平均）', () => {
    beforeEach(() => { db = createDb('month_avg') })

    it('期内出库暂估、月末按全月平均统一重算并调整结存与单据行', () => {
      // 期初：5 月入 10@100
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('PI', 'D0', '2026-05-10'))
      // 6 月：出 4（暂估 100）、入 10@130、出 6（暂估 (600+1300)/16=118.75）
      const s1 = docRow(db, 'SO', 'S1'); db.prepare("INSERT INTO scm_doc_line VALUES (?,?,1,'I1',4,0)").run(uuidv4(), s1)
      const o1 = applyMovingAvgOut(db, AID, 'W1', 'I1', 4, ref('SO', 'S1', '2026-06-02'))
      expect(o1.move.amount).toBe(400)
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 130, ref('PI', 'D1', '2026-06-10'))
      const s2 = docRow(db, 'SO', 'S2'); db.prepare("UPDATE scm_doc SET voucher_id='V2' WHERE id=?").run(s2)
      db.prepare("INSERT INTO scm_doc_line VALUES (?,?,1,'I1',6,0)").run(uuidv4(), s2)
      const o2 = applyMovingAvgOut(db, AID, 'W1', 'I1', 6, ref('SO', 'S2', '2026-06-20'))
      expect(o2.move.amount).toBe(712.5)
      expect(db.prepare('SELECT COUNT(*) c FROM scm_stock_layer').get()).toMatchObject({ c: 0 })
      // 试算：全月平均 = (1000 + 1300) / (10 + 10) = 115；出库 10 × 115 = 1150；暂估 1112.5 → 调整 +37.5
      const dry = calcMonthAvg(db, AID, '2026-06', { dryRun: true })
      expect(dry.rows[0]).toMatchObject({ opening_qty: 10, opening_amount: 1000, in_qty: 10, in_amount: 1300, avg_cost: 115, out_qty: 10, old_out_amount: 1112.5, new_out_amount: 1150, delta: 37.5, closing_qty: 10, closing_amount: 1150 })
      expect(stock(db)).toMatchObject({ qty: 10, amount: 1187.5 })   // 试算不写库
      expect(dry.voucher_docs).toEqual([{ doc_id: s2, doc_type: 'SO', doc_no: 'S2', voucher_id: 'V2', delta: expect.any(Number) }])
      // 写入
      const res = calcMonthAvg(db, AID, '2026-06', { user: 'u1' })
      expect(res.out_delta).toBe(37.5)
      expect(stock(db)).toMatchObject({ qty: 10, amount: 1150, avg_cost: 115 })
      const outs = db.prepare("SELECT doc_no, unit_cost, amount, balance_qty, balance_amount FROM scm_stock_move WHERE direction='out' ORDER BY move_date").all() as any[]
      expect(outs).toEqual([
        { doc_no: 'S1', unit_cost: 115, amount: 460, balance_qty: 6, balance_amount: 540 },
        { doc_no: 'S2', unit_cost: 115, amount: 690, balance_qty: 10, balance_amount: 1150 },
      ])
      expect(db.prepare('SELECT unit_cost FROM scm_doc_line WHERE doc_id=?').get(s2)).toMatchObject({ unit_cost: 115 })
      expect(listCostingPeriods(db, AID)[0]).toMatchObject({ period: '2026-06', status: 'calculated', item_count: 1, out_delta: 37.5, calculated_by: 'u1' })
      // 幂等：再算一次无差异
      expect(calcMonthAvg(db, AID, '2026-06', { dryRun: true }).out_delta).toBe(0)
      // 期内再有出库 → 期间置为需重算
      applyMovingAvgOut(db, AID, 'W1', 'I1', 1, ref('SO', 'S3', '2026-06-25'))
      expect(listCostingPeriods(db, AID)[0]).toMatchObject({ status: 'stale' })
    })
  })

  describe('moving_avg', () => {
    beforeEach(() => { db = createDb('moving_avg') })
    it('移动加权平均不写层', () => {
      applyMovingAvgIn(db, AID, 'W1', 'I1', 10, 100, ref('PI', 'D1'))
      applyMovingAvgOut(db, AID, 'W1', 'I1', 4, ref('SO', 'S1'))
      expect(db.prepare('SELECT COUNT(*) c FROM scm_stock_layer').get()).toMatchObject({ c: 0 })
      expect(stock(db)).toMatchObject({ qty: 6, amount: 600 })
    })
  })
})
