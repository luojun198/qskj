import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPurchaseFixedReportMeta, runPurchaseFixedReport } from '../services/scmPurchaseFixedReport.js'

describe('采购固定报表查询服务', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_date TEXT, doc_no TEXT, partner_code TEXT, biz_person TEXT, dept_code TEXT, warehouse_code TEXT, currency TEXT, contract_no TEXT, invoice_no TEXT, status TEXT, cancel_flag INTEGER, field_values TEXT);
      CREATE TABLE scm_doc_line (id TEXT, doc_id TEXT, account_set_id TEXT, warehouse_code TEXT, item_code TEXT, spec TEXT, unit TEXT, batch_no TEXT, remark TEXT, price REAL, qty REAL, amount REAL, tax_amount REAL, discount_amount REAL, unit_cost REAL, field_values TEXT);
      CREATE TABLE scm_partner (account_set_id TEXT, code TEXT, name TEXT, region_code TEXT, province TEXT, city TEXT, county TEXT, partner_type TEXT, enabled INTEGER);
      CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, spec TEXT, unit TEXT, category_code TEXT, subcategory_code TEXT, item_type TEXT, field_values TEXT, enabled INTEGER);
      CREATE TABLE scm_warehouse (account_set_id TEXT, code TEXT, name TEXT, enabled INTEGER);
      CREATE TABLE scm_item_category (account_set_id TEXT, code TEXT, name TEXT);
      CREATE TABLE scm_doc_field_defs (account_set_id TEXT, doc_type TEXT, position TEXT, field_key TEXT, field_name TEXT, field_type TEXT, options_json TEXT, is_enabled INTEGER, is_visible INTEGER, sort_order INTEGER);
      CREATE TABLE scm_item_field_defs (account_set_id TEXT, field_key TEXT, field_name TEXT, field_type TEXT, options_json TEXT, is_enabled INTEGER, sort_order INTEGER);
    `)
    const partner = db.prepare('INSERT INTO scm_partner VALUES (?,?,?,?,?,?,?,?,?)')
    partner.run('a1', 'S01', '甲供应商', '华东', '浙江', '宁波', '鄞州', 'supplier', 1)
    partner.run('a1', 'S02', '乙供应商', '华南', '广东', '深圳', '南山', 'supplier', 1)
    partner.run('a2', 'S99', '跨账套供应商', '', '', '', '', 'supplier', 1)
    db.prepare('INSERT INTO scm_item_category VALUES (?,?,?)').run('a1', 'CAT1', '原材料')
    const item = db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?,?,?,?,?,?)')
    item.run('a1', 'I01', '材料A', 'A型', '件', 'CAT1', null, '0', '{}', 1)
    item.run('a1', 'I02', '材料B', 'B型', '件', 'CAT1', null, '0', '{}', 1)
    const warehouse = db.prepare('INSERT INTO scm_warehouse VALUES (?,?,?,?)')
    warehouse.run('a1', 'W1', '一号仓', 1); warehouse.run('a1', 'W2', '二号仓', 1)
    const doc = db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    const line = db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    doc.run('pi1', 'a1', 'PI', '2026-07-01', 'PI-001', 'S01', '李四', 'D1', 'W1', 'CNY', '', '', 'audited', 0, '{}')
    line.run('l1', 'pi1', 'a1', 'W1', 'I01', 'A型', '件', 'B01', '', 100, 10, 1000, 130, 20, 90, '{}')
    doc.run('pr1', 'a1', 'PR', '2026-07-01', 'PR-001', 'S01', '李四', 'D1', 'W1', 'CNY', '', '', 'audited', 0, '{}')
    line.run('l2', 'pr1', 'a1', 'W1', 'I01', 'A型', '件', 'B01', '', 100, 2, 200, 26, 0, 90, '{}')
    doc.run('pi2', 'a1', 'PI', '2026-07-03', 'PI-002', 'S02', '王五', 'D2', 'W2', 'CNY', '', '', 'audited', 0, '{}')
    line.run('l3', 'pi2', 'a1', 'W2', 'I02', 'B型', '件', '', '', 200, 5, 1000, 130, 0, 180, '{}')
    doc.run('draft', 'a1', 'PI', '2026-07-03', 'PI-草稿', 'S01', '', '', 'W1', 'CNY', '', '', 'draft', 0, '{}')
    line.run('l4', 'draft', 'a1', 'W1', 'I01', '', '件', '', '', 999, 1, 999, 0, 0, 0, '{}')
    doc.run('other', 'a2', 'PI', '2026-07-03', 'PI-跨账套', 'S99', '', '', 'W1', 'CNY', '', '', 'audited', 0, '{}')
    line.run('l5', 'other', 'a2', 'W1', 'I01', '', '件', '', '', 999, 1, 999, 0, 0, 0, '{}')
    db.exec('ALTER TABLE scm_doc ADD COLUMN expect_date TEXT; ALTER TABLE scm_doc_line ADD COLUMN source_line_id TEXT;')
  })
  afterEach(() => db.close())
  const filters = { start_date: '2026-07-01', end_date: '2026-07-03', currency: 'CNY' }

  function seedOrderExecution() {
    const addDoc = db.prepare(`INSERT INTO scm_doc
      (id,account_set_id,doc_type,doc_date,doc_no,partner_code,biz_person,dept_code,warehouse_code,currency,status,cancel_flag,field_values,expect_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const addLine = db.prepare(`INSERT INTO scm_doc_line
      (id,doc_id,account_set_id,warehouse_code,item_code,spec,unit,price,qty,amount,tax_amount,discount_amount,unit_cost,field_values,source_line_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const po = (id: string, qty: number, expectDate: string, status = 'audited', cancel = 0, account = 'a1') => {
      addDoc.run(id, account, 'PO', '2026-06-01', `PO-${id}`, 'S01', '李四', 'D1', 'W1', 'CNY', status, cancel, '{}', expectDate)
      addLine.run(`${id}-line`, id, account, 'W1', 'I01', 'A型', '件', 100, qty, qty * 100, 0, 0, 0, '{}', null)
    }
    const pi = (id: string, poId: string | null, qty: number, status = 'audited', cancel = 0) => {
      addDoc.run(id, 'a1', 'PI', '2026-07-10', `PI-${id}`, 'S01', '李四', 'D1', 'W1', 'CNY', status, cancel, '{}', null)
      addLine.run(`${id}-line`, id, 'a1', 'W1', 'I01', 'A型', '件', 100, qty, qty * 100, 0, 0, 0, '{}', poId ? `${poId}-line` : null)
    }
    po('1', 10, '2099-01-01'); pi('1a', '1', 4); pi('1b', '1', 2); pi('1d', '1', 2, 'draft')
    po('2', 5, '2020-01-01')
    po('3', 5, '2099-01-01'); pi('3a', '3', 5)
    addDoc.run('pr3', 'a1', 'PR', '2026-07-12', 'PR-3', 'S01', '李四', 'D1', 'W1', 'CNY', 'audited', 0, '{}', null)
    addLine.run('pr3-line', 'pr3', 'a1', 'W1', 'I01', 'A型', '件', 100, 2, 200, 0, 0, 0, '{}', '3a-line')
    po('4', 5, '2099-01-01'); pi('4a', '4', 6)
    po('5', 3, '2099-01-01'); pi('5d', '5', 2, 'draft')
    po('6', 2, '2099-01-01'); pi('6x', '6', 2, 'audited', 1)
    po('7', 4, '2099-01-01'); pi('7a', '7', 4)
    po('draft-po', 9, '2099-01-01', 'draft')
    po('cancel-po', 9, '2099-01-01', 'audited', 1)
    po('other-po', 9, '2099-01-01', 'audited', 0, 'a2')
    pi('manual', null, 99)
  }

  it('返回六张采购固定报表和供应商筛选元数据', () => {
    const meta = getPurchaseFixedReportMeta(db, 'a1')
    expect(meta.reports.map(item => item.code)).toEqual(['summary', 'detail', 'order_tracking', 'ranking', 'cost', 'trend'])
    expect(meta.groupings.summary).toContainEqual({ value: 'batch_product', label: '批次 + 产品' })
    expect(meta.options.partners.map(item => item.value)).toEqual(['S01', 'S02'])
    expect(meta.defaults.order_tracking_statuses).not.toContain('completed')
  })

  it('采购汇总按供应商产品统计净额、成本和差额', () => {
    const result = runPurchaseFixedReport(db, 'a1', { report_code: 'summary', grouping: 'supplier_product', filters })
    expect(result.rows.find(row => row.partner_code === 'S01')).toMatchObject({ qty: 8, purchase_amount: 800, purchase_cost: 720, cost_variance: 80, variance_rate: 10 })
    expect(result.summary).toMatchObject({ qty: 13, purchase_amount: 1800, purchase_cost: 1620, cost_variance: 180, variance_rate: 10 })
  })

  it('采购明细固定字段、负数退货和差额率正确', () => {
    const result = runPurchaseFixedReport(db, 'a1', { report_code: 'detail', filters })
    expect(result.columns.map(column => column.key)).toContain('variance_rate')
    expect(result.rows.find(row => row.doc_no === 'PI-001')).toMatchObject({ source_type: '采购入库' })
    expect(result.rows.find(row => row.doc_no === 'PR-001')).toMatchObject({ _doc_id: 'pr1', source_type: '采购退货', qty: -2, purchase_amount: -200, cost_variance: -20, variance_rate: 10 })
    expect(result.total).toBe(3)
  })

  it('采购排行榜生成稳定排名和指标占比', () => {
    const result = runPurchaseFixedReport(db, 'a1', { report_code: 'ranking', grouping: 'supplier', rank_metric: 'purchase_amount', top_n: 20, filters })
    expect(result.rows.map(row => row.partner_code)).toEqual(['S02', 'S01'])
    expect(result.rows[0]).toMatchObject({ rank: 1, share_rate: 55.56 })
    const rate = runPurchaseFixedReport(db, 'a1', { report_code: 'ranking', grouping: 'supplier', rank_metric: 'variance_rate', top_n: 10, filters })
    expect(rate.columns.some(column => column.key === 'share_rate')).toBe(false)
  })

  it('采购成本分析支持差额区间过滤', () => {
    const result = runPurchaseFixedReport(db, 'a1', { report_code: 'cost', grouping: 'supplier', filters: { ...filters, variance_min: 100 } })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ partner_code: 'S02', cost_variance: 100 })
  })

  it('采购趋势补齐空日期并限制日统计范围', () => {
    const result = runPurchaseFixedReport(db, 'a1', { report_code: 'trend', period: 'day', chart_metric: 'purchase_amount', filters })
    expect(result.rows.map(row => row.day)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
    expect(result.rows[1]).toMatchObject({ purchase_amount: 0, qty: 0, purchase_cost: 0, cost_variance: 0, variance_rate: null })
    expect(() => runPurchaseFixedReport(db, 'a1', { report_code: 'trend', period: 'day', filters: { start_date: '2025-01-01', end_date: '2026-07-03', currency: 'CNY' } })).toThrow('最多查询 366 天')
  })

  it('未指定批次可钻取，并拒绝非法参数', () => {
    const detail = runPurchaseFixedReport(db, 'a1', { report_code: 'detail', filters: { ...filters, empty_fields: ['batch_no'] } })
    expect(detail.rows).toHaveLength(1)
    expect(detail.rows[0]).toMatchObject({ doc_no: 'PI-002', batch_no: '未指定' })
    expect(() => runPurchaseFixedReport(db, 'a1', { report_code: 'bad' as any, filters })).toThrow('编码无效')
    expect(() => runPurchaseFixedReport(db, 'a1', { report_code: 'summary', grouping: 'bad', filters })).toThrow('统计方式无效')
    expect(() => runPurchaseFixedReport(db, 'a1', { report_code: 'summary', filters: { ...filters, source_types: ['SO' as any] } })).toThrow('业务类型无效')
  })

  it('订单执行表按订单行汇总分批入库、草稿、退货、超量和逾期', () => {
    seedOrderExecution()
    const result = runPurchaseFixedReport(db, 'a1', { report_code: 'order_tracking', filters: { currency: 'CNY' } })
    expect(result.total).toBe(7)
    expect(result.rows.find(row => row.order_no === 'PO-1')).toMatchObject({
      order_qty: 10, pending_receipt_qty: 2, received_qty: 6, returned_qty: 0,
      net_received_qty: 6, unreceived_qty: 4, completion_rate: 60, execution_status_code: 'partial',
    })
    expect(JSON.parse(String(result.rows.find(row => row.order_no === 'PO-1')?._receipt_docs_json))).toHaveLength(2)
    expect(result.rows.find(row => row.order_no === 'PO-2')).toMatchObject({ execution_status_code: 'overdue' })
    expect(result.rows.find(row => row.order_no === 'PO-3')).toMatchObject({ received_qty: 5, returned_qty: 2, net_received_qty: 3, unreceived_qty: 2, net_received_amount: 300, execution_status_code: 'partial' })
    expect(result.rows.find(row => row.order_no === 'PO-4')).toMatchObject({ net_received_qty: 6, over_received_qty: 1, completion_rate: 120, execution_status_code: 'over_received' })
    expect(result.rows.find(row => row.order_no === 'PO-5')).toMatchObject({ pending_receipt_qty: 2, execution_status_code: 'pending' })
    expect(result.rows.find(row => row.order_no === 'PO-6')).toMatchObject({ received_qty: 0, execution_status_code: 'not_received' })
    expect(result.rows.find(row => row.order_no === 'PO-7')).toMatchObject({ execution_status_code: 'completed' })
    expect(result.summary).toMatchObject({ order_count: 7, order_qty: 34, net_received_qty: 19, unreceived_qty: 16, overdue_line_count: 1 })
  })

  it('订单执行表支持默认状态口径、日期筛选、分页排序及完整导出', () => {
    seedOrderExecution()
    const incomplete = runPurchaseFixedReport(db, 'a1', {
      report_code: 'order_tracking',
      filters: { currency: 'CNY', order_statuses: ['not_received', 'pending', 'partial', 'over_received', 'overdue'] },
      sort: [{ key: 'order_qty', direction: 'desc' }], page: 2, page_size: 2,
    })
    expect(incomplete.total).toBe(6)
    expect(incomplete.rows).toHaveLength(2)
    expect(incomplete.summary.order_count).toBe(6)
    const overdue = runPurchaseFixedReport(db, 'a1', {
      report_code: 'order_tracking', filters: { currency: 'CNY', expect_start_date: '2020-01-01', expect_end_date: '2020-12-31' },
    })
    expect(overdue.rows.map(row => row.order_no)).toEqual(['PO-2'])
    const exported = runPurchaseFixedReport(db, 'a1', {
      report_code: 'order_tracking', filters: { currency: 'CNY' }, page: 2, page_size: 2,
    }, { exportAll: true })
    expect(exported.rows).toHaveLength(7)
    expect(exported.page).toBe(1)
    expect(() => runPurchaseFixedReport(db, 'a1', {
      report_code: 'order_tracking', filters: { currency: 'CNY', order_statuses: ['bad' as any] },
    })).toThrow('执行状态无效')
  })
})
