import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSalesFixedReportMeta, runSalesFixedReport } from '../services/scmSalesFixedReport.js'

describe('固定销售报表服务', () => {
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
    const partner = db.prepare('INSERT INTO scm_partner VALUES (?,?,?,?,?,?,?,?,?)')
    partner.run('a1', 'C01', '甲客户', '华东', '浙江', '杭州', '西湖', 'customer', 1)
    partner.run('a1', 'C02', '乙客户', '华南', '广东', '深圳', '南山', 'customer', 1)
    partner.run('a1', 'C03', '丙客户', '华北', '北京', '北京', '朝阳', 'customer', 1)
    partner.run('a2', 'C99', '跨账套客户', '', '', '', '', 'customer', 1)
    db.prepare('INSERT INTO scm_item_category VALUES (?,?,?)').run('a1', 'CAT1', '成品')
    db.prepare('INSERT INTO scm_item_category VALUES (?,?,?)').run('a1', 'CAT2', '配件')
    const item = db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?,?,?,?,?,?)')
    item.run('a1', 'I01', '产品A', 'A型', '件', 'CAT1', null, '9', '{}', 1)
    item.run('a1', 'I02', '产品B', 'B型', '件', 'CAT2', null, '9', '{}', 1)
    const warehouse = db.prepare('INSERT INTO scm_warehouse VALUES (?,?,?,?)')
    warehouse.run('a1', 'W1', '一号仓', 1)
    warehouse.run('a1', 'W2', '二号仓', 1)

    const insertDoc = db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    const insertLine = db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    insertDoc.run('so1', 'a1', 'SO', '2026-07-01', 'SO-001', 'C01', '张三', 'D1', 'W1', 'CNY', '', '', 'audited', 0, '{}')
    insertLine.run('l1', 'so1', 'a1', 'W1', 'I01', 'A型', '件', 'B01', '首单', 100, 10, 1000, 130, 20, 60, '{}')
    insertDoc.run('sr1', 'a1', 'SR', '2026-07-01', 'SR-001', 'C01', '张三', 'D1', 'W1', 'CNY', '', '', 'audited', 0, '{}')
    insertLine.run('l2', 'sr1', 'a1', 'W1', 'I01', 'A型', '件', 'B01', '退货', 100, 2, 200, 26, 0, 60, '{}')
    insertDoc.run('so2', 'a1', 'SO', '2026-07-03', 'SO-002', 'C02', '李四', 'D2', 'W2', 'CNY', '', '', 'audited', 0, '{}')
    insertLine.run('l3', 'so2', 'a1', 'W2', 'I02', 'B型', '件', 'B02', '', 200, 5, 1000, 130, 10, 80, '{}')
    insertDoc.run('so3', 'a1', 'SO', '2026-07-03', 'SO-003', 'C03', '李四', 'D2', 'W2', 'CNY', '', '', 'audited', 0, '{}')
    insertLine.run('l4', 'so3', 'a1', 'W2', 'I02', 'B型', '件', '', '', 100, 1, 100, 13, 0, 150, '{}')
    insertDoc.run('draft', 'a1', 'SO', '2026-07-03', 'SO-草稿', 'C01', '', '', 'W1', 'CNY', '', '', 'draft', 0, '{}')
    insertLine.run('l5', 'draft', 'a1', 'W1', 'I01', '', '件', '', '', 999, 1, 999, 0, 0, 0, '{}')
    insertDoc.run('other', 'a2', 'SO', '2026-07-03', 'SO-跨账套', 'C99', '', '', 'W1', 'CNY', '', '', 'audited', 0, '{}')
    insertLine.run('l6', 'other', 'a2', 'W1', 'I01', '', '件', '', '', 999, 1, 999, 0, 0, 0, '{}')
  })

  afterEach(() => db.close())

  const filters = { start_date: '2026-07-01', end_date: '2026-07-03', currency: 'CNY' }

  it('返回固定报表、分组及当前账套筛选元数据', () => {
    const meta = getSalesFixedReportMeta(db, 'a1')
    expect(meta.reports.map(report => report.code)).toEqual(['summary', 'detail', 'ranking', 'profit', 'trend'])
    expect(meta.groupings.summary).toContainEqual({ value: 'batch_product', label: '批次 + 产品' })
    expect(meta.options.partners.map(item => item.value)).toEqual(['C01', 'C02', 'C03'])
    expect(meta.options.biz_people).toEqual([{ label: '张三', value: '张三' }, { label: '李四', value: '李四' }])
    expect(meta.options.batches).toEqual([{ label: 'B01', value: 'B01' }, { label: 'B02', value: 'B02' }])
  })

  it('销售汇总表按客户产品统计净额并提供全量合计', () => {
    const result = runSalesFixedReport(db, 'a1', { report_code: 'summary', grouping: 'customer_product', filters })
    expect(result.rows).toHaveLength(3)
    expect(result.rows.find(row => row.partner_code === 'C01')).toMatchObject({ item_code: 'I01', qty: 8, sales_amount: 800, cost_amount: 480, profit: 320 })
    expect(result.summary).toMatchObject({ qty: 14, sales_amount: 1900, cost_amount: 1030, profit: 870 })
    expect(result.columns.find(column => column.key === 'item_name')?.label).toBe('产品名称')
  })

  it('销售明细表固定字段包含毛利率、原单标识和负数退货', () => {
    const result = runSalesFixedReport(db, 'a1', { report_code: 'detail', filters, page: 1, page_size: 20 })
    expect(result.columns.map(column => column.key)).toContain('profit_rate')
    expect(result.rows.find(row => row.doc_no === 'SR-001')).toMatchObject({ _doc_id: 'sr1', qty: -2, sales_amount: -200, profit_rate: 40 })
    expect(result.total).toBe(4)
  })

  it('销售排行榜生成稳定排名、TopN 与指标占比', () => {
    const result = runSalesFixedReport(db, 'a1', {
      report_code: 'ranking', grouping: 'customer', rank_metric: 'sales_amount', top_n: 20, filters,
    })
    expect(result.rows.map(row => row.partner_code)).toEqual(['C02', 'C01', 'C03'])
    expect(result.rows.map(row => row.rank)).toEqual([1, 2, 3])
    expect(result.rows[0].share_rate).toBeCloseTo(52.63, 2)
    expect(result.displayed).toBe(3)
    const margin = runSalesFixedReport(db, 'a1', {
      report_code: 'ranking', grouping: 'customer', rank_metric: 'profit_rate', top_n: 10, filters,
    })
    expect(margin.columns.some(column => column.key === 'share_rate')).toBe(false)
  })

  it('销售毛利分析支持负毛利和毛利率结果过滤', () => {
    const result = runSalesFixedReport(db, 'a1', {
      report_code: 'profit', grouping: 'customer', filters: { ...filters, profit_max: -1 },
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ partner_code: 'C03', profit: -50, profit_rate: -50 })
  })

  it('销售趋势按日补齐无业务日期并限制日统计范围', () => {
    const result = runSalesFixedReport(db, 'a1', {
      report_code: 'trend', period: 'day', chart_metric: 'profit', filters,
    })
    expect(result.rows.map(row => row.day)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
    expect(result.rows[1]).toMatchObject({ sales_amount: 0, qty: 0, cost_amount: 0, profit: 0, profit_rate: null })
    expect(result.chart_metric).toBe('profit')
    expect(() => runSalesFixedReport(db, 'a1', {
      report_code: 'trend', period: 'day', filters: { start_date: '2025-01-01', end_date: '2026-07-03', currency: 'CNY' },
    })).toThrow('最多查询 366 天')
  })

  it('未指定维度可钻取并按空值筛选明细', () => {
    const result = runSalesFixedReport(db, 'a1', {
      report_code: 'detail', filters: { ...filters, empty_fields: ['batch_no'] },
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ doc_no: 'SO-003', batch_no: '未指定' })
  })

  it('拒绝非法报表、分组、排名指标、业务类型和空币种', () => {
    expect(() => runSalesFixedReport(db, 'a1', { report_code: 'bad' as any, filters })).toThrow('编码无效')
    expect(() => runSalesFixedReport(db, 'a1', { report_code: 'summary', grouping: 'bad', filters })).toThrow('统计方式无效')
    expect(() => runSalesFixedReport(db, 'a1', { report_code: 'ranking', rank_metric: 'drop' as any, filters })).toThrow('排名指标无效')
    expect(() => runSalesFixedReport(db, 'a1', { report_code: 'summary', filters: { ...filters, source_types: ['PI' as any] } })).toThrow('业务类型无效')
    expect(() => runSalesFixedReport(db, 'a1', { report_code: 'summary', filters: { ...filters, currency: '' } })).toThrow('请选择币种')
    expect(() => runSalesFixedReport(db, 'a1', { report_code: 'summary', filters: { ...filters, empty_fields: ['drop table' as any] } })).toThrow('空值筛选字段无效')
  })
})
