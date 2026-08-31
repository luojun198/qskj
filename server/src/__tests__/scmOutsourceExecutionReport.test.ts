import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { queryOutsourceExecution } from '../services/scmOutsourceExecutionReport.js'

describe('委外执行及结存表', () => {
  it('汇总发料、标准耗用、加工税费与未付款', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_production_plan (id TEXT,account_set_id TEXT,code TEXT,status TEXT,plan_type TEXT,start_date TEXT,end_date TEXT,supplier_code TEXT,created_at TEXT);
      CREATE TABLE scm_production_plan_product (id TEXT,account_set_id TEXT,plan_id TEXT,item_code TEXT,plan_qty REAL,finished_qty REAL,process_fee REAL,process_tax_rate REAL);
      CREATE TABLE scm_production_plan_line (account_set_id TEXT,plan_id TEXT,product_id TEXT,item_code TEXT,qty REAL,scrap_rate REAL);
      CREATE TABLE scm_partner (account_set_id TEXT,code TEXT,name TEXT);
      CREATE TABLE scm_item (account_set_id TEXT,code TEXT,name TEXT,spec TEXT,unit TEXT);
      CREATE TABLE scm_doc (id TEXT,account_set_id TEXT,plan_id TEXT,doc_type TEXT,doc_no TEXT,status TEXT);
      CREATE TABLE scm_doc_line (doc_id TEXT,item_code TEXT,qty REAL,process_fee REAL,tax_amount REAL);
      CREATE TABLE scm_stock_move (account_set_id TEXT,doc_type TEXT,doc_no TEXT,item_code TEXT,direction TEXT,qty REAL,amount REAL);
      CREATE TABLE scm_ar_ap_log (account_set_id TEXT,doc_type TEXT,doc_no TEXT,amount REAL,verified_amount REAL);
    `)
    db.prepare('INSERT INTO scm_production_plan VALUES (?,?,?,?,?,?,?,?,?)').run('P1', 'A1', 'WO-001', 'released', 'outsource', '2026-07-01', '2026-07-31', 'S1', '2026-07-01')
    db.prepare('INSERT INTO scm_production_plan_product VALUES (?,?,?,?,?,?,?,?)').run('PP1', 'A1', 'P1', 'FG1', 10, 6, 20, 13)
    db.prepare('INSERT INTO scm_production_plan_line VALUES (?,?,?,?,?,?)').run('A1', 'P1', 'PP1', 'RM1', 2, 0)
    db.prepare('INSERT INTO scm_partner VALUES (?,?,?)').run('A1', 'S1', '委外厂')
    db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?)').run('A1', 'FG1', '成品', 'X', '件')
    db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?)').run('WO1', 'A1', 'P1', 'WO', 'WO-1', 'audited')
    db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?)').run('WI1', 'A1', 'P1', 'WI', 'WI-1', 'audited')
    db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?)').run('WI1', 'FG1', 6, 22, 17.16)
    db.prepare('INSERT INTO scm_stock_move VALUES (?,?,?,?,?,?,?)').run('A1', 'WO', 'WO-1', 'RM1', 'out', 15, 150)
    db.prepare('INSERT INTO scm_ar_ap_log VALUES (?,?,?,?,?)').run('A1', 'WI', 'WI-1', 149.16, 50)
    const result = queryOutsourceExecution(db, 'A1')
    expect(result.summary).toMatchObject({ plan_count: 1, plan_qty: 10, finished_qty: 6, remaining_qty: 4, fee_gross: 149.16, outstanding_amount: 99.16 })
    expect(result.rows[0]).toMatchObject({ outsource_issue_qty: 15, outsource_return_qty: 0, issued_material_qty: 15, issued_material_cost: 150, fee_ex_tax: 132, fee_tax: 17.16, theoretical_balance: 'RM1 3' })
  })
})
