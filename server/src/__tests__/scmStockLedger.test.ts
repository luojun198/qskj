import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { queryStockLedger } from '../services/scmStockLedger.js'

describe('物料收发明细账', () => {
  it('计算期初、本期收发、逐笔结存并稳定分页', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_stock_move (id TEXT,account_set_id TEXT,move_date TEXT,doc_type TEXT,doc_no TEXT,line_seq INTEGER,warehouse_code TEXT,item_code TEXT,direction TEXT,qty REAL,unit_cost REAL,amount REAL,batch_no TEXT,created_at TEXT);
      CREATE TABLE scm_stock (account_set_id TEXT,warehouse_code TEXT,item_code TEXT,qty REAL,amount REAL);
      CREATE TABLE scm_item (account_set_id TEXT,code TEXT,name TEXT,spec TEXT,unit TEXT,category_code TEXT);
      CREATE TABLE scm_item_category (account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_warehouse (account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_doc (id TEXT,account_set_id TEXT,doc_type TEXT,doc_no TEXT,partner_code TEXT);
      CREATE TABLE scm_partner (account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_doc_type (account_set_id TEXT,code TEXT,name TEXT);
    `)
    db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?,?)').run('A1', 'I1', '物料一', 'S', '件', 'C1')
    db.prepare('INSERT INTO scm_item_category VALUES (?,?,?)').run('A1', 'C1', '原料')
    db.prepare('INSERT INTO scm_warehouse VALUES (?,?,?)').run('A1', 'W1', '主仓')
    db.prepare('INSERT INTO scm_partner VALUES (?,?,?)').run('A1', 'P1', '供应商')
    db.prepare('INSERT INTO scm_doc_type VALUES (?,?,?)').run('A1', 'PI', '采购入库')
    db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?)').run('D1', 'A1', 'PI', 'PI-1', 'P1')
    const ins = db.prepare('INSERT INTO scm_stock_move VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    ins.run('M0', 'A1', '2026-06-30', 'PI', 'PI-0', 1, 'W1', 'I1', 'in', 10, 5, 50, '', '2026-06-30 08:00:00')
    ins.run('M1', 'A1', '2026-07-01', 'PI', 'PI-1', 1, 'W1', 'I1', 'in', 4, 6, 24, '', '2026-07-01 08:00:00')
    ins.run('M2', 'A1', '2026-07-02', 'SO', 'SO-1', 1, 'W1', 'I1', 'out', 3, 5.5, 16.5, '', '2026-07-02 08:00:00')
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?,?)').run('A1', 'W1', 'I1', 11, 57.5)
    const result = queryStockLedger(db, 'A1', { start_date: '2026-07-01', end_date: '2026-07-31', category_code: 'C1', page_size: 10 })
    expect(result.summary).toMatchObject({ opening_qty: 10, opening_amount: 50, in_qty: 4, out_qty: 3, closing_qty: 11, closing_amount: 57.5 })
    expect(result.rows.map(row => row.running_qty)).toEqual([14, 11])
    expect(result.rows[0]).toMatchObject({ doc_type_name: '采购入库', partner_name: '供应商' })
  })

  it('按物料和仓库完整返回各类库存变化流水', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_stock_move (id TEXT,account_set_id TEXT,move_date TEXT,doc_type TEXT,doc_no TEXT,line_seq INTEGER,warehouse_code TEXT,item_code TEXT,direction TEXT,qty REAL,unit_cost REAL,amount REAL,batch_no TEXT,created_at TEXT);
      CREATE TABLE scm_stock (account_set_id TEXT,warehouse_code TEXT,item_code TEXT,qty REAL,amount REAL);
      CREATE TABLE scm_item (account_set_id TEXT,code TEXT,name TEXT,spec TEXT,unit TEXT,category_code TEXT);
      CREATE TABLE scm_item_category (account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_warehouse (account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_doc (id TEXT,account_set_id TEXT,doc_type TEXT,doc_no TEXT,partner_code TEXT);
      CREATE TABLE scm_partner (account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_doc_type (account_set_id TEXT,code TEXT,name TEXT);
    `)
    db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?,?)').run('A1', 'I1', '物料一', 'S', '件', 'C1')
    db.prepare('INSERT INTO scm_warehouse VALUES (?,?,?)').run('A1', 'W1', '主仓')
    db.prepare('INSERT INTO scm_warehouse VALUES (?,?,?)').run('A1', 'W2', '辅仓')
    const insMove = db.prepare('INSERT INTO scm_stock_move VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    const types: Array<[string, string, 'in' | 'out', number]> = [
      ['PI', '采购入库', 'in', 5], ['PF', '完工入库', 'in', 3], ['AS', '组装单', 'in', 2],
      ['DS', '拆卸单', 'out', 1], ['TR', '调拨单', 'in', 4], ['PL', '生产领用', 'out', 2], ['PJ', '退料单', 'in', 1],
    ]
    types.forEach(([code, name, direction, qty], index) => {
      db.prepare('INSERT INTO scm_doc_type VALUES (?,?,?)').run('A1', code, name)
      db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?)').run(`D${index}`, 'A1', code, `${code}-1`, null)
      insMove.run(`M${index}`, 'A1', `2026-07-${String(index + 1).padStart(2, '0')}`, code, `${code}-1`, 1, 'W1', 'I1', direction, qty, 1, qty, '', `2026-07-${String(index + 1).padStart(2, '0')} 08:00:00`)
    })
    insMove.run('OTHER', 'A1', '2026-07-08', 'PI', 'PI-OTHER', 1, 'W2', 'I1', 'in', 99, 1, 99, '', '2026-07-08 09:00:00')
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?,?)').run('A1', 'W1', 'I1', 12, 12)
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?,?)').run('A1', 'W2', 'I1', 99, 99)

    const result = queryStockLedger(db, 'A1', { item_code: 'I1', warehouse_code: 'W1', page_size: 50 })
    expect(result.rows.map(row => row.doc_type)).toEqual(types.map(([code]) => code))
    expect(result.summary).toMatchObject({ in_qty: 15, out_qty: 3, closing_qty: 12 })
  })

  it('还原无入库流水的直接初始化期初库存', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_stock_move (id TEXT,account_set_id TEXT,move_date TEXT,doc_type TEXT,doc_no TEXT,line_seq INTEGER,warehouse_code TEXT,item_code TEXT,direction TEXT,qty REAL,unit_cost REAL,amount REAL,batch_no TEXT,created_at TEXT);
      CREATE TABLE scm_stock (account_set_id TEXT,warehouse_code TEXT,item_code TEXT,qty REAL,amount REAL);
      CREATE TABLE scm_item (account_set_id TEXT,code TEXT,name TEXT,spec TEXT,unit TEXT,category_code TEXT);
      CREATE TABLE scm_item_category (account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_warehouse (account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_doc (id TEXT,account_set_id TEXT,doc_type TEXT,doc_no TEXT,partner_code TEXT);
      CREATE TABLE scm_partner (account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_doc_type (account_set_id TEXT,code TEXT,name TEXT);
    `)
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?,?)').run('A1', 'W1', 'I1', 0, 0)
    db.prepare('INSERT INTO scm_stock_move VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('M1', 'A1', '2026-07-18', 'PL', 'PL-1', 1, 'W1', 'I1', 'out', 20, 100, 2000, '', '2026-07-18 08:00:00')

    const result = queryStockLedger(db, 'A1', { item_code: 'I1', warehouse_code: 'W1', page_size: 50 })
    expect(result.summary).toMatchObject({ opening_qty: 20, opening_amount: 2000, out_qty: 20, closing_qty: 0, closing_amount: 0 })
    expect(result.rows[0]).toMatchObject({ doc_type: 'PL', running_qty: 0, running_amount: 0 })
  })
})
