/**
 * FIX-259：银行对账单任意 Excel 列映射导入 —— 两种金额模式、表头 / 起始行、金额清洗、新增四列、错误行号
 */
import { describe, it, expect } from 'vitest'
import { convertStatementRows, parseAmount, validateMapping } from '../services/bankStatementImport.js'
import { normalizeBizDate } from '../services/cashierPeriodClosing.js'

const resolveDate = (raw: unknown) => normalizeBizDate(raw)

describe('bankStatementImport', () => {
  it('parseAmount：千分位 / 货币符号 / 空值', () => {
    expect(parseAmount('1,234.50')).toBe(1234.5)
    expect(parseAmount('¥ 12,000')).toBe(12000)
    expect(parseAmount('')).toBe(0)
    expect(parseAmount(null)).toBe(0)
    expect(parseAmount(-88)).toBe(-88)
    expect(parseAmount('abc')).toBe(0)
  })

  it('validateMapping：按模式校验必填列', () => {
    expect(validateMapping({}, 'dc')).toBe('未指定日期列')
    expect(validateMapping({ biz_date: 0 }, 'dc')).toBe('借方列、贷方列至少指定一列')
    expect(validateMapping({ biz_date: 0, credit: 2 }, 'dc')).toBeNull()
    expect(validateMapping({ biz_date: 0 }, 'single')).toBe('未指定金额列')
    expect(validateMapping({ biz_date: 0, amount: '3' }, 'single')).toBeNull()
  })

  it('dc 模式：表头行 + 标题行跳过，摘要 / 对方户名 / 账号 / 余额落列，金额去逗号', () => {
    const rows = [
      ['某银行交易明细'],
      ['账号：123'],
      ['交易日期', '摘要', '对方户名', '对方账号', '借方发生额', '贷方发生额', '余额'],
      ['2026-09-01', '货款', '甲公司', '6222001', '', '10,000.00', '50,000.00'],
      ['2026/9/2', '水电费', '供电局', '6222002', '1,200.50', '', '48,799.50'],
      ['合计', '', '', '', '1,200.50', '10,000.00', ''],
    ]
    // 银行视角：贷方发生额 = 本方收入（debit）
    const r = convertStatementRows(rows, {
      mapping: { biz_date: 0, summary: 1, counter_name: 2, counter_account: 3, credit: 4, debit: 5, balance: 6 },
      headerRow: 2, dataStartRow: 3, amountMode: 'dc', resolveDate,
    })
    // 「合计」行静默跳过，不记错误
    expect(r.errors).toEqual([])
    expect(r.records).toHaveLength(2)
    expect(r.records[0]).toMatchObject({
      biz_date: '2026-09-01', debit: 10000, credit: 0, summary: '货款', counter_name: '甲公司', counter_account: '6222001', balance: 50000,
    })
    expect(r.records[1]).toMatchObject({ biz_date: '2026-09-02', debit: 0, credit: 1200.5, balance: 48799.5 })
  })

  it('single 模式：金额列 + 方向标志列', () => {
    const rows = [
      ['日期', '金额', '收/付', '摘要'],
      ['2026-09-03', '500', '收', 'A'],
      ['2026-09-04', '300', '付', 'B'],
      ['2026-09-05', '-200', '收', 'C'],
    ]
    const r = convertStatementRows(rows, {
      mapping: { biz_date: 0, amount: 1, direction: 2, summary: 3 },
      headerRow: 0, dataStartRow: 1, amountMode: 'single', directionInValues: ['收'], resolveDate,
    })
    expect(r.records.map(x => [x.debit, x.credit])).toEqual([[500, 0], [0, 300], [200, 0]])
  })

  it('评审 P2：方向标志为空的行报错，不再默认按支出入账；有方向列但未选收入标志时校验不通过', () => {
    const rows = [['日期', '金额', '方向'], ['2026-09-03', '500', '收'], ['2026-09-04', '300', '']]
    const r = convertStatementRows(rows, {
      mapping: { biz_date: 0, amount: 1, direction: 2 },
      headerRow: 0, dataStartRow: 1, amountMode: 'single', directionInValues: ['收'], resolveDate,
    })
    expect(r.records.map(x => [x.debit, x.credit])).toEqual([[500, 0]])
    expect(r.errors).toEqual([{ row: 3, message: expect.stringContaining('方向标志为空') }])
    expect(validateMapping({ biz_date: 0, amount: 1, direction: 2 }, 'single', [])).toContain('表示收入')
    expect(validateMapping({ biz_date: 0, amount: 1, direction: 2 }, 'single', ['收'])).toBeNull()
  })

  it('single 模式：无方向列按正负号', () => {
    const rows = [['2026-09-03', '500'], ['2026-09-04', '-300']]
    const r = convertStatementRows(rows, {
      mapping: { biz_date: 0, amount: 1 }, headerRow: -1, dataStartRow: 0, amountMode: 'single', resolveDate,
    })
    expect(r.records.map(x => [x.debit, x.credit])).toEqual([[500, 0], [0, 300]])
  })

  it('日期无法识别且不是合计行 → 记录错误行号', () => {
    const rows = [['abc', '1'], ['2026-09-01', '2']]
    const r = convertStatementRows(rows, {
      mapping: { biz_date: 0, debit: 1 }, headerRow: 0, dataStartRow: 1, amountMode: 'dc', resolveDate,
    })
    expect(r.records).toHaveLength(1)
    const r2 = convertStatementRows([['2026-09-01', '2'], ['x', '3']], {
      mapping: { biz_date: 0, debit: 1 }, headerRow: -1, dataStartRow: 0, amountMode: 'dc', resolveDate,
    })
    expect(r2.errors).toEqual([{ row: 2, message: expect.any(String) }])
  })

  it('FIX-255：无表头且首行不是日期时自动跳过；空行 / 无金额无摘要行跳过', () => {
    const rows = [['日期', '借', '贷'], ['2026-09-03', '1', ''], ['', '', ''], ['2026-09-04', '', '']]
    const r = convertStatementRows(rows, {
      mapping: { biz_date: 0, debit: 1, credit: 2 }, headerRow: -1, dataStartRow: 0, amountMode: 'dc', resolveDate,
    })
    expect(r.firstDataRow).toBe(1)
    expect(r.errors).toEqual([])
    expect(r.records).toHaveLength(1)
  })

  it('分片调用结果与整体一致', () => {
    const rows = [['日期', '借'], ...Array.from({ length: 7 }, (_, i) => [`2026-09-${String(i + 1).padStart(2, '0')}`, String(i + 1)])]
    const opts = { mapping: { biz_date: 0, debit: 1 }, headerRow: 0, dataStartRow: 1, amountMode: 'dc' as const, resolveDate }
    const whole = convertStatementRows(rows, opts)
    const parts = [...convertStatementRows(rows, opts, 0, 3).records, ...convertStatementRows(rows, opts, 3, 8).records]
    expect(parts).toEqual(whole.records)
    expect(whole.records).toHaveLength(7)
  })
})
