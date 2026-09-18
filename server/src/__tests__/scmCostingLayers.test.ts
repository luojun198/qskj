import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { applyMovingAvgIn, applyMovingAvgOut, reverseDocMoves, applyCostAdjustment, listStockLayers } from '../services/scmCosting.js'
import { up as layerUp } from '../db/migrations/20260918_scm_stock_layer.js'

const AID = 'AS-FIFO'

function createDb(method: 'fifo' | 'lifo' | 'moving_avg') {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_stock (id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
      qty REAL DEFAULT 0, amount REAL DEFAULT 0, avg_cost REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE scm_stock_move (id TEXT, account_set_id TEXT, move_date TEXT, doc_type TEXT, doc_no TEXT,
      line_seq INTEGER, warehouse_code TEXT, item_code TEXT, direction TEXT, qty REAL, unit_cost REAL,
      amount REAL, batch_no TEXT, balance_qty REAL, balance_amount REAL, balance_avg_cost REAL);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, status TEXT, doc_date TEXT);
    CREATE TABLE scm_item (id TEXT, account_set_id TEXT, code TEXT, name TEXT, unit TEXT, purchase_price REAL, ref_cost REAL);
    CREATE TABLE scm_warehouse (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
  `)
  layerUp(db)
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
