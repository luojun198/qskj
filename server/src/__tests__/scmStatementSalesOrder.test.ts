import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { getStatementExternalOrderNos, getStatementSalesOrderNos } from '../services/scmStatementSalesOrder.js'

describe('对账单销售订单号', () => {
  it('读取单据头和明细行关联的销售订单号', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, source_doc_id TEXT, field_values TEXT);
      CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, source_line_id TEXT, field_values TEXT);
      INSERT INTO scm_doc VALUES
        ('SOA-1', 'A1', 'SOa', 'SOA-001', NULL, '{}'),
        ('SO-1', 'A1', 'SO', 'SO-001', 'SOA-1', '{}'),
        ('SO-2', 'A1', 'SO', 'SO-002', NULL, '{}'),
        ('SO-3', 'A1', 'SO', 'SO-003', NULL, '{}'),
        ('PO-1', 'A1', 'PO', 'PO-001', NULL, '{}'),
        ('PI-1', 'A1', 'PI', 'PI-001', NULL, '{}');
      INSERT INTO scm_doc_line VALUES
        ('SOA-L1', 'A1', 'SOA-1', NULL, '{}'),
        ('SO-L1', 'A1', 'SO-2', 'SOA-L1', '{}'),
        ('SO-L2', 'A1', 'SO-3', NULL, '{"source_line_allocations":[{"source_line_id":"SOA-L1","qty":1}]}'),
        ('SO-L3', 'A1', 'SO-3', NULL, '{"source_line_allocations":[{"source_line_id":"SOA-L1","qty":1}]}'),
        ('PO-L1', 'A1', 'PO-1', NULL, '{}'),
        ('PI-L1', 'A1', 'PI-1', 'PO-L1', '{}');
    `)

    expect(getStatementSalesOrderNos(db, 'A1', [
      { id: 'SO-1' },
      { id: 'SO-2' },
      { id: 'SO-3' },
      { id: 'PI-1' },
    ])).toEqual(new Map([
      ['SO-1', 'SOA-001'],
      ['SO-2', 'SOA-001'],
      ['SO-3', 'SOA-001'],
      ['PI-1', 'PO-001'],
    ]))
  })

  it('从销售订单字段回填对方订单号', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT, source_doc_id TEXT, field_values TEXT);
      CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, source_line_id TEXT, field_values TEXT);
      INSERT INTO scm_doc VALUES
        ('SOA-1', 'A1', 'SOa', 'SOA-001', NULL, '{"external_order_no":"CUST-001"}'),
        ('SO-1', 'A1', 'SO', 'SO-001', 'SOA-1', '{}');
    `)

    expect(getStatementExternalOrderNos(db, 'A1', [{ id: 'SO-1' }])).toEqual(new Map([
      ['SO-1', 'CUST-001'],
    ]))
  })
})
