import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPurchaseReportMeta, runPurchaseReportQuery } from '../services/scmSalesCustomReport.js'

describe('采购自定义报表查询服务', () => {
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
    db.prepare('INSERT INTO scm_partner VALUES (?,?,?,?,?,?,?,?,?)').run('a1', 'S01', '甲供应商', '华东', '浙江', '宁波', '鄞州', 'supplier', 1)
    db.prepare('INSERT INTO scm_partner VALUES (?,?,?,?,?,?,?,?,?)').run('a1', 'C01', '甲客户', '华南', '广东', '深圳', '南山', 'customer', 1)
    db.prepare('INSERT INTO scm_item_category VALUES (?,?,?)').run('a1', 'CAT', '原材料')
    db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?,?,?,?,?,?)').run('a1', 'I01', '材料A', 'S1', '件', 'CAT', null, '0', '{"grade":"A"}', 1)
    db.prepare('INSERT INTO scm_warehouse VALUES (?,?,?,?)').run('a1', 'W1', '原料仓', 1)
    db.prepare('INSERT INTO scm_doc_field_defs VALUES (?,?,?,?,?,?,?,?,?,?)').run('a1', 'PI', 'head', 'channel', '采购渠道', 'select', '["直采"]', 1, 1, 1)

    const insertDoc = db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    const insertLine = db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    insertDoc.run('pi1', 'a1', 'PI', '2026-07-01', 'PI-001', 'S01', '李四', 'D1', 'W1', 'CNY', '', '', 'audited', 0, '{"channel":"直采"}')
    insertLine.run('l1', 'pi1', 'a1', 'W1', 'I01', 'S1', '件', 'B1', '', 100, 10, 1000, 130, 20, 90, '{}')
    insertDoc.run('pr1', 'a1', 'PR', '2026-07-03', 'PR-001', 'S01', '李四', 'D1', 'W1', 'CNY', '', '', 'audited', 0, '{}')
    insertLine.run('l2', 'pr1', 'a1', 'W1', 'I01', 'S1', '件', 'B1', '', 100, 2, 200, 26, 0, 90, '{}')
    insertDoc.run('draft', 'a1', 'PI', '2026-07-04', 'PI-草稿', 'S01', '', '', 'W1', 'CNY', '', '', 'draft', 0, '{}')
    insertLine.run('l3', 'draft', 'a1', 'W1', 'I01', '', '件', '', '', 999, 1, 999, 0, 0, 0, '{}')
    insertDoc.run('wi1', 'a1', 'WI', '2026-07-05', 'WI-001', 'S01', '', '', 'W1', 'CNY', '', '', 'audited', 0, '{}')
    insertLine.run('l4', 'wi1', 'a1', 'W1', 'I01', '', '件', '', '', 999, 1, 999, 0, 0, 0, '{}')
  })

  afterEach(() => db.close())

  it('按采购入库减采购退货计算净额，并排除草稿和委外入库', () => {
    const result = runPurchaseReportQuery(db, 'a1', {
      mode: 'summary', dimensions: [], metrics: ['qty', 'purchase_amount', 'tax_amount', 'discount_amount', 'purchase_cost', 'avg_price', 'supplier_count'],
    })
    expect(result.total).toBe(1)
    expect(result.rows[0]).toMatchObject({
      qty: 8, purchase_amount: 800, tax_amount: 104, discount_amount: 20,
      purchase_cost: 720, avg_price: 100, supplier_count: 1,
    })
  })

  it('元数据使用供应商、采购员和采购指标，并只返回供应商选项', () => {
    const meta = getPurchaseReportMeta(db, 'a1')
    expect(meta.fields.find(field => field.key === 'partner_code')?.label).toBe('供应商编号')
    expect(meta.fields.find(field => field.key === 'biz_person')?.label).toBe('采购员')
    expect(meta.fields.find(field => field.key === 'partner_code')?.options).toEqual([{ label: 'S01 甲供应商', value: 'S01' }])
    expect(meta.metrics.map(metric => metric.key)).toContain('purchase_amount')
    expect(meta.metrics.map(metric => metric.key)).toEqual(expect.arrayContaining(['cost_variance', 'variance_rate']))
    expect(meta.metrics.map(metric => metric.key)).not.toContain('profit')
    expect(meta.fields.some(field => field.key === 'doc_custom:channel')).toBe(true)
  })

  it('支持采购退货筛选并拒绝销售专属指标', () => {
    const detail = runPurchaseReportQuery(db, 'a1', {
      mode: 'detail', fields: ['doc_no', 'purchase_amount'],
      filters: { children: [{ field: 'source_type', operator: 'eq', value: 'PR' }] },
    })
    expect(detail.rows).toEqual([{ _doc_id: 'pr1', doc_no: 'PR-001', purchase_amount: -200 }])
    const summary = runPurchaseReportQuery(db, 'a1', { mode: 'summary', dimensions: [], metrics: ['profit', 'purchase_amount'] })
    expect(summary.ignored_fields).toContain('profit')
  })

  it('只选择平均采购价时也能正确计算汇总合计', () => {
    const result = runPurchaseReportQuery(db, 'a1', { mode: 'summary', dimensions: ['partner_name'], metrics: ['avg_price'] })
    expect(result.rows[0]).toMatchObject({ partner_name: '甲供应商', avg_price: 100 })
    expect(result.summary.avg_price).toBe(100)
  })

  it('采购差额和差额率按采购金额减入库成本计算', () => {
    const result = runPurchaseReportQuery(db, 'a1', {
      mode: 'summary', dimensions: ['partner_name'], metrics: ['purchase_amount', 'purchase_cost', 'cost_variance', 'variance_rate'],
    })
    expect(result.rows[0]).toMatchObject({ purchase_amount: 800, purchase_cost: 720, cost_variance: 80, variance_rate: 10 })
    expect(result.summary).toMatchObject({ cost_variance: 80, variance_rate: 10 })
  })
})
