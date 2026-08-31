import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { querySalesOrderRelations } from '../services/scmSalesOrderRelations.js'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc (id TEXT PRIMARY KEY,account_set_id TEXT,doc_type TEXT,doc_no TEXT,doc_date TEXT,partner_code TEXT,total_qty REAL DEFAULT 0,total_amount REAL DEFAULT 0,status TEXT,source_doc_id TEXT,plan_id TEXT);
    CREATE TABLE scm_doc_line (id TEXT PRIMARY KEY,account_set_id TEXT,doc_id TEXT,seq INTEGER,item_code TEXT,qty REAL DEFAULT 0,amount REAL DEFAULT 0,source_line_id TEXT,arap_source_log_id TEXT);
    CREATE TABLE scm_partner (id TEXT,account_set_id TEXT,code TEXT,name TEXT);
    CREATE TABLE scm_item (id TEXT,account_set_id TEXT,code TEXT,name TEXT);
    CREATE TABLE scm_mrp_source (id TEXT,account_set_id TEXT,mrp_doc_id TEXT,source_kind TEXT,source_id TEXT);
    CREATE TABLE scm_production_plan (id TEXT PRIMARY KEY,account_set_id TEXT,code TEXT,plan_type TEXT,item_code TEXT,plan_qty REAL,finished_qty REAL DEFAULT 0,supplier_code TEXT,status TEXT,start_date TEXT,end_date TEXT,source_doc_id TEXT);
    CREATE TABLE scm_production_plan_product (id TEXT,account_set_id TEXT,plan_id TEXT,source_line_id TEXT,source_doc_id TEXT,plan_qty REAL);
    CREATE TABLE scm_work_report (id TEXT,account_set_id TEXT,plan_id TEXT,report_no TEXT,report_date TEXT,item_code TEXT,qty REAL,scrap_qty REAL,status TEXT);
    CREATE TABLE scm_qc_doc (id TEXT,account_set_id TEXT,qc_no TEXT,qc_type TEXT,qc_date TEXT,source_doc_id TEXT,partner_code TEXT,result TEXT,status TEXT);
    CREATE TABLE scm_ar_ap_log (id TEXT,account_set_id TEXT,doc_type TEXT,doc_no TEXT);
  `)
  return db
}

function insDoc(db: Database.Database, id: string, type: string, source: string | null = null, planId: string | null = null, aid = 'A1') {
  db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, aid, type, `${type}-${id}`, '2026-07-18', null, 10, 100, 'audited', source, planId)
  db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?,?,?)').run(`${id}-L1`, aid, id, 1, 'I1', 10, 100, null, null)
}

function flatten(rows: any[]): any[] {
  return rows.flatMap(row => [row, ...flatten(row.children || [])])
}

describe('销售订单关联大表', () => {
  it('递归归集销售订单到 MRP、缺料、采购订单和采购入库', () => {
    const db = createDb()
    db.prepare("INSERT INTO scm_item VALUES ('I','A1','I1','成品A')").run()
    insDoc(db, 'SO1', 'SOa')
    insDoc(db, 'MP1', 'MRP')
    db.prepare("INSERT INTO scm_mrp_source VALUES ('S1','A1','MP1','sales_order','SO1')").run()
    insDoc(db, 'MR1', 'MR', 'MP1')
    insDoc(db, 'PO1', 'PO', 'MR1')
    insDoc(db, 'PI1', 'PI', 'PO1')

    const result = querySalesOrderRelations(db, 'A1')
    const types = flatten(result.roots).map(row => row.doc_type)
    expect(types).toEqual(['SOa', 'MRP', 'MR', 'PO', 'PI'])
    expect(result.roots[0].descendant_count).toBe(4)
  })

  it('归集生产计划、领料、完工、报工和质检', () => {
    const db = createDb()
    db.prepare("INSERT INTO scm_item VALUES ('I','A1','I1','成品A')").run()
    insDoc(db, 'SO1', 'SOa')
    insDoc(db, 'MP1', 'MRP')
    db.prepare("INSERT INTO scm_mrp_source VALUES ('S1','A1','MP1','sales_order','SO1')").run()
    insDoc(db, 'MR1', 'MR', 'MP1')
    db.prepare("INSERT INTO scm_production_plan VALUES ('P1','A1','PP-1','self','I1',10,4,NULL,'released','2026-07-18',NULL,'MR1')").run()
    insDoc(db, 'PL1', 'PL', null, 'P1')
    insDoc(db, 'PF1', 'PF', null, 'P1')
    db.prepare("INSERT INTO scm_work_report VALUES ('W1','A1','P1','WR-1','2026-07-18','I1',4,0,'audited')").run()
    db.prepare("INSERT INTO scm_qc_doc VALUES ('Q1','A1','QC-1','FQC','2026-07-18','PF1',NULL,'pass','audited')").run()

    const rows = flatten(querySalesOrderRelations(db, 'A1').roots)
    expect(rows.map(row => row.doc_type)).toEqual(expect.arrayContaining(['PRODUCTION_PLAN', 'PL', 'PF', 'WORK_REPORT', 'QC']))
  })

  it('多销售订单共用 MRP 时标记共用并保持账套隔离', () => {
    const db = createDb()
    db.prepare("INSERT INTO scm_item VALUES ('I','A1','I1','成品A')").run()
    insDoc(db, 'SO1', 'SOa')
    insDoc(db, 'SO2', 'SOa')
    insDoc(db, 'MP1', 'MRP')
    db.prepare("INSERT INTO scm_mrp_source VALUES ('S1','A1','MP1','sales_order','SO1')").run()
    db.prepare("INSERT INTO scm_mrp_source VALUES ('S2','A1','MP1','sales_order','SO2')").run()
    insDoc(db, 'OTHER', 'SOa', null, null, 'A2')

    const result = querySalesOrderRelations(db, 'A1', { pageSize: 20 })
    expect(result.total).toBe(2)
    for (const root of result.roots) {
      const mrp = flatten([root]).find(row => row.doc_type === 'MRP')
      expect(mrp).toMatchObject({ shared: true, shared_order_count: 2 })
    }
  })

  it('表头与行级重复关联及异常循环不会产生重复节点', () => {
    const db = createDb()
    db.prepare("INSERT INTO scm_item VALUES ('I','A1','I1','成品A')").run()
    insDoc(db, 'SO1', 'SOa')
    insDoc(db, 'MR1', 'MR', 'SO1')
    db.prepare("UPDATE scm_doc_line SET source_line_id='SO1-L1' WHERE id='MR1-L1'").run()
    insDoc(db, 'PO1', 'PO', 'MR1')
    db.prepare("UPDATE scm_doc SET source_doc_id='PO1' WHERE id='SO1'").run()

    const rows = flatten(querySalesOrderRelations(db, 'A1').roots)
    expect(rows.map(row => row.node_id)).toEqual(['doc:SO1', 'doc:MR1', 'doc:PO1'])
    expect(new Set(rows.map(row => row.node_id)).size).toBe(rows.length)
  })

  it('通过往来日志的类型和单号归集销售出库对应的收款单', () => {
    const db = createDb()
    db.prepare("INSERT INTO scm_item VALUES ('I','A1','I1','成品A')").run()
    insDoc(db, 'SO1', 'SOa')
    insDoc(db, 'OUT1', 'SO', 'SO1')
    insDoc(db, 'RCV1', 'RCV')
    db.prepare("INSERT INTO scm_ar_ap_log VALUES ('AR1','A1','SO','SO-OUT1')").run()
    db.prepare("UPDATE scm_doc_line SET arap_source_log_id='AR1' WHERE id='RCV1-L1'").run()

    const rows = flatten(querySalesOrderRelations(db, 'A1').roots)
    expect(rows.map(row => row.doc_type)).toEqual(['SOa', 'SO', 'RCV'])
    expect(rows.find(row => row.doc_type === 'RCV')?.relation_type).toBe('arap_payment')
  })

  it('BFS 节点总量超过 MAX_NODES 上限时返回 truncated=true 并停止发现新节点', () => {
    const db = createDb()
    db.prepare("INSERT INTO scm_item VALUES ('I','A1','I1','成品A')").run()
    // 1 张销售订单，下面挂 3000 张下游单据（直接 source_doc_id 关联），触发节点上限
    insDoc(db, 'SO1', 'SOa')
    for (let i = 0; i < 3000; i += 1) {
      insDoc(db, `D${i}`, 'SO', 'SO1')
    }
    const result = querySalesOrderRelations(db, 'A1')
    expect(result.truncated).toBe(true)
    // 展开后的节点总数不应远超 MAX_NODES（2000）+ 根节点 + 一些边界
    const nodes = flatten(result.roots)
    expect(nodes.length).toBeLessThanOrEqual(2100)
  })
})
