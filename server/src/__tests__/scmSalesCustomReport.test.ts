import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSalesReportMeta, runSalesReportQuery } from '../services/scmSalesCustomReport.js'

describe('销售自定义报表查询服务', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_doc (
        id TEXT, account_set_id TEXT, doc_type TEXT, doc_date TEXT, doc_no TEXT,
        partner_code TEXT, biz_person TEXT, dept_code TEXT, warehouse_code TEXT,
        currency TEXT, contract_no TEXT, invoice_no TEXT, status TEXT, cancel_flag INTEGER,
        field_values TEXT
      );
      CREATE TABLE scm_doc_line (
        id TEXT, doc_id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT,
        spec TEXT, unit TEXT, batch_no TEXT, remark TEXT, price REAL, qty REAL, amount REAL,
        tax_amount REAL, discount_amount REAL, unit_cost REAL, field_values TEXT
      );
      CREATE TABLE scm_partner (
        account_set_id TEXT, code TEXT, name TEXT, region_code TEXT, province TEXT, city TEXT, county TEXT,
        partner_type TEXT, enabled INTEGER
      );
      CREATE TABLE scm_item (
        account_set_id TEXT, code TEXT, name TEXT, spec TEXT, unit TEXT, category_code TEXT,
        subcategory_code TEXT, item_type TEXT, field_values TEXT, enabled INTEGER
      );
      CREATE TABLE scm_warehouse (account_set_id TEXT, code TEXT, name TEXT, enabled INTEGER);
      CREATE TABLE scm_item_category (account_set_id TEXT, code TEXT, name TEXT);
      CREATE TABLE scm_doc_field_defs (
        account_set_id TEXT, doc_type TEXT, position TEXT, field_key TEXT, field_name TEXT,
        field_type TEXT, options_json TEXT, is_enabled INTEGER, is_visible INTEGER, sort_order INTEGER
      );
      CREATE TABLE scm_item_field_defs (
        account_set_id TEXT, field_key TEXT, field_name TEXT, field_type TEXT, options_json TEXT,
        is_enabled INTEGER, sort_order INTEGER
      );
    `)
    db.prepare('INSERT INTO scm_partner VALUES (?,?,?,?,?,?,?,?,?)').run('a1', 'C01', '甲客户', '华东', '浙江', '杭州', '西湖', 'customer', 1)
    db.prepare('INSERT INTO scm_item_category VALUES (?,?,?)').run('a1', 'CAT', '成品')
    db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?,?,?,?,?,?)').run('a1', 'I01', '产品A', 'S1', '件', 'CAT', null, '9', '{"brand":"自有"}', 1)
    db.prepare('INSERT INTO scm_warehouse VALUES (?,?,?,?)').run('a1', 'W1', '成品仓', 1)
    db.prepare('INSERT INTO scm_doc_field_defs VALUES (?,?,?,?,?,?,?,?,?,?)').run('a1', 'SO', 'head', 'channel', '销售渠道', 'select', '["直营网"]', 1, 1, 1)
    db.prepare('INSERT INTO scm_item_field_defs VALUES (?,?,?,?,?,?,?)').run('a1', 'brand', '品牌', 'text', '[]', 1, 1)

    const insertDoc = db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    const insertLine = db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    insertDoc.run('so1', 'a1', 'SO', '2026-07-01', 'SO-001', 'C01', '张三', 'D1', 'W1', 'CNY', '', '', 'audited', 0, '{"channel":"直营网"}')
    insertLine.run('l1', 'so1', 'a1', 'W1', 'I01', 'S1', '件', 'B1', '', 100, 10, 1000, 130, 20, 60, '{}')
    insertDoc.run('sr1', 'a1', 'SR', '2026-07-03', 'SR-001', 'C01', '张三', 'D1', 'W1', 'CNY', '', '', 'audited', 0, '{}')
    insertLine.run('l2', 'sr1', 'a1', 'W1', 'I01', 'S1', '件', 'B1', '', 100, 2, 200, 26, 0, 60, '{}')
    insertDoc.run('draft', 'a1', 'SO', '2026-07-04', 'SO-草稿', 'C01', '', '', 'W1', 'CNY', '', '', 'draft', 0, '{}')
    insertLine.run('l3', 'draft', 'a1', 'W1', 'I01', '', '件', '', '', 999, 1, 999, 0, 0, 0, '{}')
    insertDoc.run('other', 'a2', 'SO', '2026-07-05', 'SO-跨账套', 'C01', '', '', 'W1', 'CNY', '', '', 'audited', 0, '{}')
    insertLine.run('l4', 'other', 'a2', 'W1', 'I01', '', '件', '', '', 999, 1, 999, 0, 0, 0, '{}')
  })

  afterEach(() => db.close())

  it('按销售出库减销售退货计算净额、成本和毛利', () => {
    const result = runSalesReportQuery(db, 'a1', {
      mode: 'summary', dimensions: [], metrics: ['qty', 'sales_amount', 'tax_amount', 'discount_amount', 'cost_amount', 'profit', 'profit_rate'],
    })
    expect(result.total).toBe(1)
    expect(result.rows[0]).toMatchObject({ qty: 8, sales_amount: 800, tax_amount: 104, discount_amount: 20, cost_amount: 480, profit: 320, profit_rate: 40 })
  })

  it('支持 AND/OR、日期区间和多选筛选', () => {
    const result = runSalesReportQuery(db, 'a1', {
      mode: 'detail', fields: ['doc_no', 'sales_amount'],
      filters: {
        logic: 'and', children: [
          { field: 'doc_date', operator: 'between', value: '2026-07-01', value2: '2026-07-03' },
          { logic: 'or', children: [
            { field: 'source_type', operator: 'in', value: ['SR'] },
            { field: 'doc_no', operator: 'eq', value: '不存在' },
          ] },
        ],
      },
    })
    expect(result.rows).toEqual([{ _doc_id: 'sr1', doc_no: 'SR-001', sales_amount: -200 }])
  })

  it('支持自定义字段元数据、筛选和维度', () => {
    const meta = getSalesReportMeta(db, 'a1')
    expect(meta.fields.some(field => field.key === 'doc_custom:channel')).toBe(true)
    expect(meta.fields.some(field => field.key === 'item_custom:brand')).toBe(true)
    const result = runSalesReportQuery(db, 'a1', {
      mode: 'summary', dimensions: ['doc_custom:channel', 'item_custom:brand'], metrics: ['sales_amount'],
      filters: { children: [{ field: 'doc_custom:channel', operator: 'eq', value: '直营网' }] },
    })
    expect(result.rows[0]).toMatchObject({ 'doc_custom:channel': '直营网', 'item_custom:brand': '自有', sales_amount: 1000 })
  })

  it('拒绝客户端伪造字段、非法运算符和超限维度', () => {
    expect(() => runSalesReportQuery(db, 'a1', {
      filters: { children: [{ field: 'drop table', operator: 'eq', value: 1 }] },
    })).toThrow('筛选字段无效')
    expect(() => runSalesReportQuery(db, 'a1', {
      filters: { children: [{ field: 'sales_amount', operator: 'contains', value: '1' }] },
    })).toThrow('不支持运算符')
    const result = runSalesReportQuery(db, 'a1', {
      mode: 'summary', dimensions: ['day', 'week', 'month', 'quarter', 'year', 'partner_name', 'item_name'], metrics: ['sales_amount'],
    })
    expect(result.columns.filter(column => column.role === 'dimension')).toHaveLength(6)
    expect(result.ignored_fields).toContain('item_name')
  })
})
