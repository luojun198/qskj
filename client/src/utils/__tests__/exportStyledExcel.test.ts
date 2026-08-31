import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  formatBalanceDirection,
  formatInitBalanceDirection,
  formatPositiveAmount,
  formatSignedBalanceAmount,
  formatSignedBalanceDisplay,
  getSummaryAccountRows,
} from '@/utils/exportLedgerHelpers'
import {
  buildAuxBalanceExportSummaryValues,
  buildBalanceSheetSummaryValues,
  buildGeneralLedgerSummaryValues,
} from '@/utils/ledgerExportBuilders'
import { ensureWorksheetGridLines } from '@/utils/exportStyledExcel'

describe('ensureWorksheetGridLines', () => {
  it('应为矩形区域内每个单元格（含空单元格）设置四边边框', () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('test')
    worksheet.getCell('A1').value = '标题'
    ensureWorksheetGridLines(worksheet, 2, 3)

    for (const address of ['A1', 'B1', 'C1', 'A2', 'B2', 'C2']) {
      const cell = worksheet.getCell(address)
      expect(cell.border?.top?.style).toBe('thin')
      expect(cell.border?.left?.style).toBe('thin')
      expect(cell.border?.bottom?.style).toBe('thin')
      expect(cell.border?.right?.style).toBe('thin')
      expect(cell.border?.top?.color?.argb).toBe('FF909399')
    }
    expect(worksheet.getCell('C2').value).toBe('')
  })
})

describe('exportLedgerHelpers', () => {
  it('formatBalanceDirection 应返回借/贷/平', () => {
    expect(formatBalanceDirection(100)).toBe('借')
    expect(formatBalanceDirection(-50)).toBe('贷')
    expect(formatBalanceDirection(0)).toBe('平')
  })

  it('formatInitBalanceDirection 应按科目方向解析', () => {
    expect(formatInitBalanceDirection({ init_balance: 100, direction: 'debit' })).toBe('借')
    expect(formatInitBalanceDirection({ init_balance: -100, direction: 'debit' })).toBe('贷')
    expect(formatInitBalanceDirection({ init_balance: 0, direction: 'debit' })).toBe('')
  })

  it('formatPositiveAmount 可隐藏零值', () => {
    expect(formatPositiveAmount(0, true)).toBe('')
    expect(formatPositiveAmount(0, false)).toBe(0)
    expect(formatPositiveAmount(12.5, true)).toBe(12.5)
    expect(formatPositiveAmount(12.567, true)).toBe(12.57)
  })

  it('formatSignedBalanceAmount 应取绝对值并保留两位小数', () => {
    expect(formatSignedBalanceAmount(-123.456)).toBe(123.46)
    expect(formatSignedBalanceAmount(0, true)).toBe('')
  })

  it('formatSignedBalanceDisplay 应格式化为两位小数字符串', () => {
    expect(formatSignedBalanceDisplay(1234.5)).toBe('1,234.50')
    expect(formatSignedBalanceDisplay(-99.999)).toBe('100.00')
    expect(formatSignedBalanceDisplay(0, true)).toBe('')
    expect(formatSignedBalanceDisplay(0)).toBe('0.00')
  })

  it('getSummaryAccountRows 在限定级次时只取顶层', () => {
    const rows = [
      { level: 1, account_code: '1001' },
      { level: 2, account_code: '100101' },
    ]
    expect(getSummaryAccountRows(rows, 2)).toEqual([{ level: 1, account_code: '1001' }])
  })
})

describe('ledgerExportBuilders summary', () => {
  it('buildGeneralLedgerSummaryValues 应输出 10 列合计', () => {
    const summaryRows = [
      {
        init_balance: 100,
        end_balance: 120,
        direction: 'debit',
        current_debit: 20,
        current_credit: 0,
        year_debit: 20,
        year_credit: 0,
      },
    ]
    const values = buildGeneralLedgerSummaryValues(summaryRows, false)
    expect(values).toHaveLength(10)
    expect(values[0]).toBe('')
    expect(values[2]).toBe('借')
  })

  it('buildBalanceSheetSummaryValues 应包含期初与期末合计', () => {
    const values = buildBalanceSheetSummaryValues(
      [{ direction: 'debit', init_balance: 100, end_balance: 80, year_debit: 10, year_credit: 0 }],
      [1]
    )
    expect(values[2]).toBe(100)
    expect(values[3]).toBe('')
  })

  it('buildAuxBalanceExportSummaryValues 应与叶子列数对齐', () => {
    const values = buildAuxBalanceExportSummaryValues(1, {
      init_balance: 100,
      current_debit: 50,
      current_credit: 20,
      end_balance: 130,
    })
    expect(values).toHaveLength(9)
    expect(values[3]).toBe('借')
    expect(values[4]).toBe(100)
    expect(values[5]).toBe(50)
    expect(values[6]).toBe(20)
    expect(values[7]).toBe('借')
    expect(values[8]).toBe(130)
  })
})
