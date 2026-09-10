import { describe, it, expect } from 'vitest'
import {
  VOUCHER_SUMMARY_FORMATTER_SRC,
  applyVoucherTableSummary,
  defaultSummaryFields,
  readVoucherTableSummary,
  summableColumnsOf,
} from '@/utils/hiprintVoucherProvider'

const col = (field: string, title: string, checked = true) => ({
  title,
  field,
  columnId: field,
  width: 50,
  align: 'left',
  colspan: 1,
  checked,
})

/** 默认 5 列：摘要 / 科目编码 / 会计科目 / 借方金额 / 贷方金额 */
const baseColumns = () => [
  col('summary', '摘要'),
  col('account_code', '科目编码'),
  col('account_name', '会计科目'),
  col('debit', '借方金额'),
  col('credit', '贷方金额'),
]

describe('summableColumnsOf', () => {
  it('只挑出可累加且已勾选显示的列，排除单价/汇率', () => {
    const columns = [
      ...baseColumns(),
      col('unit_price', '单价'),
      col('exchange_rate', '汇率'),
      col('quantity', '数量'),
      col('foreign_amount', '外币金额', false),
    ]
    expect(summableColumnsOf(columns).map(c => c.field)).toEqual(['debit', 'credit', 'quantity'])
  })
})

describe('applyVoucherTableSummary', () => {
  it('「合计」占满前置列，被跨掉的列 colspan 置 0', () => {
    const out = applyVoucherTableSummary(baseColumns(), {
      enabled: true,
      fields: ['debit', 'credit'],
      label: '合计',
    })
    const byField = Object.fromEntries(out.map(c => [c.field, c]))

    expect(byField.summary.tableSummary).toBe('text')
    expect(byField.summary.tableSummaryText).toBe('合计')
    expect(byField.summary.tableSummaryColspan).toBe(3)
    expect(byField.account_code.tableSummaryColspan).toBe(0)
    expect(byField.account_name.tableSummaryColspan).toBe(0)
    expect(byField.debit.tableSummary).toBe('sum')
    expect(byField.debit.tableSummaryNumFormat).toBe(2)
    expect(byField.credit.tableSummary).toBe('sum')
  })

  it('合计行单元格总跨度等于已勾选列数', () => {
    const columns = [...baseColumns(), col('quantity', '数量')]
    const out = applyVoucherTableSummary(columns, {
      enabled: true,
      fields: ['debit', 'credit'],
      label: '合计',
    })
    // hiprint 对 colspan 为 0 的列不输出 <td>，其余每列输出一个（缺省 colspan 1）
    const span = out
      .filter(c => c.checked !== false)
      .reduce((sum, c) => sum + (c.tableSummaryColspan ?? 1), 0)
    expect(span).toBe(6)
  })

  it('未勾选显示的列不参与跨列计算', () => {
    const columns = baseColumns()
    columns[1].checked = false // 科目编码不显示
    const out = applyVoucherTableSummary(columns, {
      enabled: true,
      fields: ['debit'],
      label: '合计',
    })
    const byField = Object.fromEntries(out.map(c => [c.field, c]))
    expect(byField.summary.tableSummaryColspan).toBe(2)
    expect(byField.account_name.tableSummaryColspan).toBe(0)
    expect(byField.account_code.tableSummaryColspan).toBeUndefined()
  })

  it('第一个已勾选列本身就是合计列时不放标签', () => {
    const out = applyVoucherTableSummary([col('debit', '借方金额'), col('credit', '贷方金额')], {
      enabled: true,
      fields: ['debit', 'credit'],
      label: '合计',
    })
    expect(out.every(c => c.tableSummary === 'sum')).toBe(true)
  })

  it('关闭时清干净所有 tableSummary* 键', () => {
    const on = applyVoucherTableSummary(baseColumns(), {
      enabled: true,
      fields: ['debit', 'credit'],
      label: '合计',
    })
    const off = applyVoucherTableSummary(on, { enabled: false, fields: [], label: '合计' })
    for (const c of off) {
      for (const key of Object.keys(c)) expect(key.startsWith('tableSummary')).toBe(false)
    }
  })

  it('未选任何字段等同于关闭', () => {
    const out = applyVoucherTableSummary(baseColumns(), { enabled: true, fields: [], label: '合计' })
    expect(out.some(c => c.tableSummary)).toBe(false)
  })

  it('不修改入参', () => {
    const src = baseColumns()
    applyVoucherTableSummary(src, { enabled: true, fields: ['debit'], label: '合计' })
    expect(src.some(c => 'tableSummary' in c)).toBe(false)
  })
})

describe('readVoucherTableSummary', () => {
  it('与 apply 往返一致', () => {
    const config = { enabled: true, fields: ['debit', 'credit'], label: '本页合计' }
    expect(readVoucherTableSummary(applyVoucherTableSummary(baseColumns(), config))).toEqual(config)
  })

  it('老模板（无 tableSummary）读出关闭状态', () => {
    expect(readVoucherTableSummary(baseColumns())).toEqual({
      enabled: false,
      fields: [],
      label: '合计',
    })
  })
})

describe('VOUCHER_SUMMARY_FORMATTER_SRC', () => {
  // hiprint 走 eval("tableSummaryFormatter=" + src)，这里用等价方式取出函数
  const formatter = new Function(`return ${VOUCHER_SUMMARY_FORMATTER_SRC}`)() as (
    column: Record<string, unknown>,
    nums: number[],
    allData: Array<Record<string, unknown>>
  ) => string

  it('能对带千分位的金额字符串求和（hiprint 内置解析在这里会得到 NaN）', () => {
    expect(Number('1,000.00')).toBeNaN()
    const html = formatter({ field: 'debit', tableSummaryNumFormat: 2 }, [], [
      { debit: '1,000.00' },
      { debit: '' },
      { debit: '2,500.50' },
    ])
    expect(html).toContain('3,500.50')
    expect(html).toMatch(/^<td [^>]*>.*<\/td>$/)
  })

  it('按列的小数位格式化，缺省 2 位', () => {
    const qty = formatter({ field: 'quantity', tableSummaryNumFormat: 4 }, [], [
      { quantity: '1.5' },
      { quantity: '2.25' },
    ])
    expect(qty).toContain('3.7500')
    const fallback = formatter({ field: 'debit' }, [], [{ debit: '1' }])
    expect(fallback).toContain('1.00')
  })

  it('沿用列上的对齐与跨列设置', () => {
    const html = formatter(
      { field: 'debit', tableSummaryAlign: 'center', tableSummaryColspan: 2 },
      [],
      [{ debit: '1.00' }]
    )
    expect(html).toContain('text-align: center')
    expect(html).toContain('colspan="2"')
  })

  it('空数据合计为 0，不会出 NaN', () => {
    expect(formatter({ field: 'debit' }, [], [])).toContain('0.00')
    expect(formatter({ field: 'debit' }, [], [{}, { debit: '不是数字' }])).not.toContain('NaN')
  })
})

describe('defaultSummaryFields', () => {
  it('优先借/贷方金额', () => {
    expect(defaultSummaryFields(['debit', 'credit', 'quantity'])).toEqual(['debit', 'credit'])
  })

  it('借/贷不在候选里时退回第一个候选列', () => {
    expect(defaultSummaryFields(['quantity', 'foreign_amount'])).toEqual(['quantity'])
  })

  it('没有候选列时返回空', () => {
    expect(defaultSummaryFields([])).toEqual([])
  })

  /**
   * 回归：开关状态是由「有没有列设了 tableSummary」反推的，所以打开开关时若一列都没选，
   * 写回等于没写、回读又把开关重置成关闭 —— 表现就是「显示合计行」勾不上。
   * defaultSummaryFields 的存在就是为了堵住这个来回。
   */
  it('打开开关时补默认选择，才不会被回读重置成关闭', () => {
    const columns = baseColumns()
    const candidates = summableColumnsOf(columns).map(c => c.field)

    const withoutPreset = applyVoucherTableSummary(columns, {
      enabled: true,
      fields: [],
      label: '合计',
    })
    expect(readVoucherTableSummary(withoutPreset).enabled).toBe(false)

    const withPreset = applyVoucherTableSummary(columns, {
      enabled: true,
      fields: defaultSummaryFields(candidates),
      label: '合计',
    })
    expect(readVoucherTableSummary(withPreset).enabled).toBe(true)
  })
})
