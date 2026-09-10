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
  buildAuxForeignBalanceExportSummaryValues,
  buildAuxForeignBalanceSubtotalRows,
  buildBalanceSheetSummaryValues,
  buildForeignBalanceExportSummaryValues,
  buildForeignBalanceSubtotalRows,
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

  it('buildAuxForeignBalanceExportSummaryValues 单一币种时填写原币合计', () => {
    const values = buildAuxForeignBalanceExportSummaryValues(
      1,
      { init_balance: 700, current_debit: 350, current_credit: 140, end_balance: 910 },
      {
        USD: {
          foreign_init_balance: 100,
          foreign_current_debit: 50,
          foreign_current_credit: 20,
          foreign_end_balance: 130,
        },
      }
    )
    // 科目编码、科目名称、1 个辅助列、币种、汇率、期初 3 列、本期 4 列、期末 3 列
    expect(values).toHaveLength(15)
    expect(values[3]).toBe('USD')
    expect(values[4]).toBe('') // 汇率由小计行给出，合计行留空
    expect(values[5]).toBe('借')
    expect(values[6]).toBe(100)
    expect(values[7]).toBe(700)
    expect(values[8]).toBe(50)
    expect(values[9]).toBe(350)
    expect(values[10]).toBe(20)
    expect(values[11]).toBe(140)
    expect(values[12]).toBe('借')
    expect(values[13]).toBe(130)
    expect(values[14]).toBe(910)
  })

  it('buildAuxForeignBalanceExportSummaryValues 多币种时原币合计留空、本位币仍汇总', () => {
    const values = buildAuxForeignBalanceExportSummaryValues(
      0,
      { init_balance: 880, current_debit: 0, current_credit: 140, end_balance: 1090 },
      {
        USD: { foreign_init_balance: 150, foreign_current_debit: 0, foreign_current_credit: 20, foreign_end_balance: 130 },
        HKD: { foreign_init_balance: 200, foreign_current_debit: 0, foreign_current_credit: 0, foreign_end_balance: 200 },
      }
    )
    expect(values).toHaveLength(14)
    expect(values[2]).toBe('多币种')
    expect(values[5]).toBe('') // 原币期初：多币种不能相加
    expect(values[6]).toBe(880)
    expect(values[7]).toBe('')
    expect(values[9]).toBe('')
    expect(values[10]).toBe(140)
    expect(values[12]).toBe('')
    expect(values[13]).toBe(1090)
  })
})

describe('外币余额表导出行', () => {
  const usd = {
    foreign_init_balance: 100,
    init_balance: 700,
    foreign_current_debit: 50,
    current_debit: 350,
    foreign_current_credit: 20,
    current_credit: 140,
    foreign_year_debit: 60,
    year_debit: 420,
    foreign_year_credit: 20,
    year_credit: 140,
    foreign_end_balance: 130,
    end_balance: 910,
  }
  const hkd = {
    foreign_init_balance: 200,
    init_balance: 180,
    foreign_current_debit: 0,
    current_debit: 0,
    foreign_current_credit: 0,
    current_credit: 0,
    foreign_year_debit: 0,
    year_debit: 0,
    foreign_year_credit: 0,
    year_credit: 0,
    foreign_end_balance: 200,
    end_balance: 180,
  }

  it('单一币种：原币合计照填，18 个叶子列一一对应', () => {
    const values = buildForeignBalanceExportSummaryValues({ USD: usd })
    expect(values).toHaveLength(18)
    expect(values[2]).toBe('USD')
    expect(values[4]).toBe('借')
    expect(values[5]).toBe(100)
    expect(values[6]).toBe(700)
    expect(values[7]).toBe(50)
    expect(values[8]).toBe(350)
    expect(values[11]).toBe(60)
    expect(values[12]).toBe(420)
    expect(values[15]).toBe('借')
    expect(values[16]).toBe(130)
    expect(values[17]).toBe(910)
  })

  it('多币种：原币留空、币种列标注「多币种」，本位币仍汇总', () => {
    const values = buildForeignBalanceExportSummaryValues({ USD: usd, HKD: hkd })
    expect(values[2]).toBe('多币种')
    expect(values[5]).toBe('')
    expect(values[6]).toBe(880)
    expect(values[8]).toBe(350)
    expect(values[16]).toBe('')
    expect(values[17]).toBe(1090)
  })

  it('小计行：单币种不输出，多币种每个币种一行并带汇率', () => {
    expect(buildForeignBalanceSubtotalRows({ USD: usd })).toEqual([])
    const rows = buildForeignBalanceSubtotalRows({ USD: usd, HKD: hkd }, { USD: 7.25 })
    expect(rows).toHaveLength(2)
    expect(rows[0][0]).toBe('USD 小计')
    expect(rows[0][2]).toBe('USD')
    expect(rows[0][3]).toBe('7.2500')
    expect(rows[0][6]).toBe(700)
    expect(rows[0][17]).toBe(910)
    // 没配汇率的币种留空，不能编一个 1 出来
    expect(rows[1][3]).toBe('')
  })
})

describe('辅助项目外币余额表小计行', () => {
  it('多币种时每个币种一行，本位币取后端按币种分桶的合计', () => {
    const rows = buildAuxForeignBalanceSubtotalRows(
      1,
      {
        USD: {
          foreign_init_balance: 100,
          foreign_current_debit: 50,
          foreign_current_credit: 20,
          foreign_end_balance: 130,
          init_balance: 700,
          current_debit: 350,
          current_credit: 140,
          end_balance: 910,
        },
        HKD: {
          foreign_init_balance: 200,
          foreign_current_debit: 0,
          foreign_current_credit: 0,
          foreign_end_balance: 200,
          init_balance: 180,
          current_debit: 0,
          current_credit: 0,
          end_balance: 180,
        },
      },
      { USD: 7.25, HKD: 0.92 }
    )
    expect(rows).toHaveLength(2)
    // 科目编码、科目名称、1 个辅助列、币种、汇率、期初 3、本期 4、期末 3
    expect(rows[0]).toHaveLength(15)
    expect(rows[0][0]).toBe('USD 小计')
    expect(rows[0][3]).toBe('USD')
    expect(rows[0][4]).toBe('7.2500')
    expect(rows[0][6]).toBe(100)
    expect(rows[0][7]).toBe(700)
    expect(rows[0][14]).toBe(910)
  })
})
