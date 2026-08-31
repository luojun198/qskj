import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { getPurchaseReceiptOrderNosByLine, getSalesDispatchOrderNosByLine } from '../services/scmSalesDispatchOrderNumbers'

describe('销售发货明细销售订单号', () => {
  let db: Database.Database | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  it('同时解析直接来源和多来源分配，去重后用顿号连接', () => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_doc (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        doc_no TEXT NOT NULL
      );
      CREATE TABLE scm_doc_line (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        doc_id TEXT NOT NULL
      );
      INSERT INTO scm_doc VALUES
        ('SOA1', 'A1', 'SOa', 'SOA-001'),
        ('SOA2', 'A1', 'SOa', 'SOA-002'),
        ('PO1', 'A1', 'PO', 'PO-001'),
        ('SOA3', 'A2', 'SOa', 'SOA-003');
      INSERT INTO scm_doc_line VALUES
        ('ORDER-L1', 'A1', 'SOA1'),
        ('ORDER-L2', 'A1', 'SOA2'),
        ('ORDER-L3', 'A1', 'PO1'),
        ('ORDER-L4', 'A2', 'SOA3');
    `)

    const result = getSalesDispatchOrderNosByLine(db, 'A1', [
      { id: 'SHIP-L1', source_line_id: 'ORDER-L1' },
      {
        id: 'SHIP-L2',
        field_values: {
          source_line_allocations: [
            { source_line_id: 'ORDER-L2', qty: 2 },
            { source_line_id: 'ORDER-L1', qty: 1 },
            { source_line_id: 'ORDER-L2', qty: 3 },
          ],
        },
      },
      { id: 'SHIP-L3', source_line_id: 'ORDER-L3' },
      { id: 'SHIP-L4', source_line_id: 'ORDER-L4' },
    ])

    expect(result.get('SHIP-L1')).toBe('SOA-001')
    expect(result.get('SHIP-L2')).toBe('SOA-001、SOA-002')
    expect(result.has('SHIP-L3')).toBe(false)
    expect(result.has('SHIP-L4')).toBe(false)
  })

  it('忽略损坏的来源分配 JSON', () => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_doc (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        doc_no TEXT NOT NULL
      );
      CREATE TABLE scm_doc_line (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        doc_id TEXT NOT NULL
      );
    `)

    const result = getSalesDispatchOrderNosByLine(db, 'A1', [
      { id: 'SHIP-L1', field_values: '{invalid' },
    ])

    expect(result.size).toBe(0)
  })

  it('销售发货详情接口为每条明细写入聚合订单号', () => {
    const source = readFileSync(new URL('../routes/scmDoc.ts', import.meta.url), 'utf8')

    expect(source).toContain("if (doc.doc_type === 'SO') {")
    expect(source).toContain('getSalesDispatchOrderNosByLine(db, asid(req), lines)')
    expect(source).toContain("line.sales_order_no = orderNos.get(line.id) || ''")
  })

  it('采购入库同时解析直接来源和多来源分配，只返回当前账套采购订单号', () => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_doc (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        doc_no TEXT NOT NULL
      );
      CREATE TABLE scm_doc_line (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        doc_id TEXT NOT NULL
      );
      INSERT INTO scm_doc VALUES
        ('PO1', 'A1', 'PO', 'PO-001'),
        ('PO2', 'A1', 'PO', 'PO-002'),
        ('SOA1', 'A1', 'SOa', 'SOA-001'),
        ('PO3', 'A2', 'PO', 'PO-003');
      INSERT INTO scm_doc_line VALUES
        ('ORDER-L1', 'A1', 'PO1'),
        ('ORDER-L2', 'A1', 'PO2'),
        ('ORDER-L3', 'A1', 'SOA1'),
        ('ORDER-L4', 'A2', 'PO3');
    `)

    const result = getPurchaseReceiptOrderNosByLine(db, 'A1', [
      { id: 'RECEIPT-L1', source_line_id: 'ORDER-L1' },
      {
        id: 'RECEIPT-L2',
        field_values: {
          source_line_allocations: [
            { source_line_id: 'ORDER-L2', qty: 2 },
            { source_line_id: 'ORDER-L1', qty: 1 },
            { source_line_id: 'ORDER-L2', qty: 3 },
          ],
        },
      },
      { id: 'RECEIPT-L3', source_line_id: 'ORDER-L3' },
      { id: 'RECEIPT-L4', source_line_id: 'ORDER-L4' },
    ])

    expect(result.get('RECEIPT-L1')).toBe('PO-001')
    expect(result.get('RECEIPT-L2')).toBe('PO-001、PO-002')
    expect(result.has('RECEIPT-L3')).toBe(false)
    expect(result.has('RECEIPT-L4')).toBe(false)
  })

  it('采购入库详情接口为每条明细写入聚合采购订单号', () => {
    const source = readFileSync(new URL('../routes/scmDoc.ts', import.meta.url), 'utf8')

    expect(source).toContain("if (doc.doc_type === 'PI') {")
    expect(source).toContain('getPurchaseReceiptOrderNosByLine(db, asid(req), lines)')
    expect(source).toContain("line.purchase_order_no = orderNos.get(line.id) || ''")
  })
})
