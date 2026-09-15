import type { ExportColumnDef } from './exportStyledExcel'
import {
  formatBalanceDirection,
  formatEndBalanceDirection,
  formatInitBalanceDirection,
  formatPositiveAmount,
  formatSignedBalanceAmount,
  splitBalanceToDebitCredit,
  sumBalanceSides,
} from './exportLedgerHelpers'

type ColWidthFn = (key: string, fallback: number) => number

type LedgerBalanceRow = {
  account_code?: string
  account_name?: string
  level?: number
  direction?: string
  init_balance?: number
  end_balance?: number
  current_debit?: number
  current_credit?: number
  year_debit?: number
  year_credit?: number
  [key: string]: string | number | undefined
}

type InitBalanceRow = {
  code?: string
  name?: string
  level?: number
  direction?: string
  opening_debit?: number
  opening_credit?: number
  pre_book_debit?: number
  pre_book_credit?: number
}

type InitBalanceAuxExportRow = Record<string, string | number>

export function buildGeneralLedgerExportColumns(
  colWidth: ColWidthFn,
  hideZero: boolean
): ExportColumnDef<LedgerBalanceRow>[] {
  return [
    {
      label: '科目编码',
      width: colWidth('account_code', 100),
      value: row => row.account_code,
      indent: row => Math.max(0, (row.level || 1) - 1),
    },
    {
      label: '科目名称',
      width: colWidth('account_name', 150),
      value: row => row.account_name,
      indent: row => Math.max(0, (row.level || 1) - 1),
    },
    {
      label: '期初余额',
      children: [
        {
          label: '方向',
          width: colWidth('方向', 60),
          align: 'center',
          value: row => formatInitBalanceDirection({
            init_balance: row.init_balance ?? 0,
            direction: row.direction ?? 'debit',
          }),
        },
        {
          label: '余额',
          width: colWidth('余额', 100),
          align: 'right',
          type: 'amount',
          value: row => formatSignedBalanceAmount(row.init_balance ?? 0, hideZero),
        },
      ],
    },
    {
      label: '本期发生额',
      children: [
        {
          label: '借方',
          width: colWidth('借方', 120),
          align: 'right',
          type: 'amount',
          value: row => formatPositiveAmount(row.current_debit, hideZero),
        },
        {
          label: '贷方',
          width: colWidth('贷方', 120),
          align: 'right',
          type: 'amount',
          value: row => formatPositiveAmount(row.current_credit, hideZero),
        },
      ],
    },
    {
      label: '本年累计发生额',
      children: [
        {
          label: '借方',
          width: colWidth('year_debit', 120),
          align: 'right',
          type: 'amount',
          value: row => formatPositiveAmount(row.year_debit, hideZero),
        },
        {
          label: '贷方',
          width: colWidth('year_credit', 120),
          align: 'right',
          type: 'amount',
          value: row => formatPositiveAmount(row.year_credit, hideZero),
        },
      ],
    },
    {
      label: '期末余额',
      children: [
        {
          label: '方向',
          width: colWidth('end_direction', 60),
          align: 'center',
          value: row => formatEndBalanceDirection({
            end_balance: row.end_balance ?? 0,
            direction: row.direction ?? 'debit',
          }),
        },
        {
          label: '余额',
          width: colWidth('end_balance', 100),
          align: 'right',
          type: 'amount',
          value: row => formatSignedBalanceAmount(row.end_balance ?? 0, hideZero),
        },
      ],
    },
  ]
}

export function buildGeneralLedgerSummaryValues(
  summaryRows: Array<Record<string, any>>,
  hideZero: boolean
) {
  const initSides = summaryRows.reduce(
    (acc, row) => {
      const balance = row.init_balance || 0
      const amount = Math.abs(balance)
      if (balance === 0) return acc
      if (balance > 0) {
        if (row.direction === 'debit') acc.debit += amount
        else acc.credit += amount
      } else if (row.direction === 'debit') acc.credit += amount
      else acc.debit += amount
      return acc
    },
    { debit: 0, credit: 0 }
  )
  const endSides = summaryRows.reduce(
    (acc, row) => {
      const balance = row.end_balance || 0
      const amount = Math.abs(balance)
      if (balance === 0) return acc
      if (balance > 0) {
        if (row.direction === 'debit') acc.debit += amount
        else acc.credit += amount
      } else if (row.direction === 'debit') acc.credit += amount
      else acc.debit += amount
      return acc
    },
    { debit: 0, credit: 0 }
  )
  const initNet = initSides.debit - initSides.credit
  const endNet = endSides.debit - endSides.credit

  return [
    '',
    '',
    formatBalanceDirection(initNet),
    formatSignedBalanceAmount(initNet, hideZero),
    formatPositiveAmount(
      summaryRows.reduce((sum, row) => sum + (row.current_debit || 0), 0),
      hideZero
    ),
    formatPositiveAmount(
      summaryRows.reduce((sum, row) => sum + (row.current_credit || 0), 0),
      hideZero
    ),
    formatPositiveAmount(
      summaryRows.reduce((sum, row) => sum + (row.year_debit || 0), 0),
      hideZero
    ),
    formatPositiveAmount(
      summaryRows.reduce((sum, row) => sum + (row.year_credit || 0), 0),
      hideZero
    ),
    formatBalanceDirection(endNet),
    formatSignedBalanceAmount(endNet, hideZero),
  ]
}

export function buildBalanceSheetExportColumns(
  colWidth: ColWidthFn,
  displayMonths: number[]
): ExportColumnDef<LedgerBalanceRow>[] {
  const columns: ExportColumnDef<LedgerBalanceRow>[] = [
    {
      label: '科目编码',
      width: colWidth('account_code', 120),
      value: row => row.account_code,
      indent: row => Math.max(0, (row.level || 1) - 1),
    },
    {
      label: '科目名称',
      width: colWidth('account_name', 160),
      value: row => row.account_name,
      indent: row => Math.max(0, (row.level || 1) - 1),
      bold: row => row.level === 1,
    },
    {
      label: '期初余额',
      children: [
        {
          label: '借方',
          width: colWidth('init_debit', 100),
          align: 'right',
          type: 'amount',
          // FIX-133：反方向（负）余额落到对侧列，与页面 splitBalanceToDebitCredit 口径一致
          value: row => splitBalanceToDebitCredit(row.init_balance ?? 0, row.direction || 'debit').debit || '',
        },
        {
          label: '贷方',
          width: colWidth('init_credit', 100),
          align: 'right',
          type: 'amount',
          value: row => splitBalanceToDebitCredit(row.init_balance ?? 0, row.direction || 'debit').credit || '',
        },
      ],
    },
  ]

  for (const month of displayMonths) {
    columns.push({
      label: `${month}月`,
      children: [
        {
          label: '借方',
          width: colWidth(`month${month}_debit`, 100),
          align: 'right',
          type: 'amount',
          value: row => row[`month${month}_debit`] || '',
        },
        {
          label: '贷方',
          width: colWidth(`month${month}_credit`, 100),
          align: 'right',
          type: 'amount',
          value: row => row[`month${month}_credit`] || '',
        },
      ],
    })
  }

  columns.push(
    {
      label: '本年累计',
      children: [
        {
          label: '借方',
          width: colWidth('year_debit', 100),
          align: 'right',
          type: 'amount',
          value: row => ((row.year_debit ?? 0) > 0 ? row.year_debit : ''),
        },
        {
          label: '贷方',
          width: colWidth('year_credit', 100),
          align: 'right',
          type: 'amount',
          value: row => ((row.year_credit ?? 0) > 0 ? row.year_credit : ''),
        },
      ],
    },
    {
      label: '期末余额',
      children: [
        {
          label: '借方',
          width: colWidth('end_debit', 100),
          align: 'right',
          type: 'amount',
          value: row => splitBalanceToDebitCredit(row.end_balance ?? 0, row.direction || 'debit').debit || '',
        },
        {
          label: '贷方',
          width: colWidth('end_credit', 100),
          align: 'right',
          type: 'amount',
          value: row => splitBalanceToDebitCredit(row.end_balance ?? 0, row.direction || 'debit').credit || '',
        },
      ],
    }
  )

  return columns
}

export function buildBalanceSheetSummaryValues(data: Array<Record<string, any>>, displayMonths: number[]) {
  // 叶节点 = 数据集中没有任何以本科目编码为前缀的子项，避免父子科目重复求和
  const leaf = data.filter(
    r => !data.some(o => o.account_code !== r.account_code && o.account_code.startsWith(r.account_code))
  )
  // FIX-133：合计分侧累加，反方向余额计入对侧，与页面合计一致
  const sideRows = leaf as Array<{ init_balance?: number; end_balance?: number; direction: string }>
  const initSides = sumBalanceSides(sideRows, 'init_balance')
  const endSides = sumBalanceSides(sideRows, 'end_balance')
  const calcInitDebit = initSides.debit
  const calcInitCredit = initSides.credit
  const calcEndDebit = endSides.debit
  const calcEndCredit = endSides.credit
  const calcYearDebit = leaf.reduce((s, r) => s + (r.year_debit || 0), 0)
  const calcYearCredit = leaf.reduce((s, r) => s + (r.year_credit || 0), 0)

  const values: (string | number)[] = ['', '', calcInitDebit || '', calcInitCredit || '']
  for (const month of displayMonths) {
    values.push(
      leaf.reduce((s, r) => s + (r[`month${month}_debit`] || 0), 0),
      leaf.reduce((s, r) => s + (r[`month${month}_credit`] || 0), 0)
    )
  }
  values.push(
    calcYearDebit || '',
    calcYearCredit || '',
    calcEndDebit || '',
    calcEndCredit || ''
  )
  return values
}

export function buildInitBalanceExportColumns(isMidYear: boolean): ExportColumnDef<InitBalanceRow>[] {
  const columns: ExportColumnDef<InitBalanceRow>[] = [
    {
      label: '编码',
      width: 96,
      value: row => row.code,
      indent: row => Math.max(0, (row.level || 1) - 1),
    },
    {
      label: '科目',
      width: 180,
      value: row => row.name,
      indent: row => Math.max(0, (row.level || 1) - 1),
    },
    {
      label: '方向',
      width: 60,
      align: 'center',
      value: row => (row.direction === 'debit' ? '借' : '贷'),
    },
    {
      label: '年初借',
      width: 110,
      align: 'right',
      type: 'amount',
      value: row => row.opening_debit || 0,
    },
    {
      label: '年初贷',
      width: 110,
      align: 'right',
      type: 'amount',
      value: row => row.opening_credit || 0,
    },
  ]
  if (isMidYear) {
    columns.push(
      {
        label: '账前借',
        width: 110,
        align: 'right',
        type: 'amount',
        value: row => row.pre_book_debit || 0,
      },
      {
        label: '账前贷',
        width: 110,
        align: 'right',
        type: 'amount',
        value: row => row.pre_book_credit || 0,
      }
    )
  }
  return columns
}

export function buildInitBalanceAuxExportColumns(
  categories: Array<{ name: string; id: string }>,
  isMidYear: boolean,
  account?: { code: string; name: string }
): ExportColumnDef<InitBalanceAuxExportRow>[] {
  const columns: ExportColumnDef<InitBalanceAuxExportRow>[] = []
  if (account) {
    columns.push(
      { label: '科目编码', width: 100, value: () => account.code },
      { label: '科目名称', width: 140, value: () => account.name }
    )
  }
  for (const cat of categories) {
    columns.push(
      { label: `${cat.name}编码`, width: 100, value: row => row[`${cat.name}编码`] ?? '' },
      { label: `${cat.name}名称`, width: 120, value: row => row[`${cat.name}名称`] ?? '' }
    )
  }
  columns.push(
    {
      label: '年初借方',
      width: 110,
      align: 'right',
      type: 'amount',
      value: row => row['年初借方'] ?? 0,
    },
    {
      label: '年初贷方',
      width: 110,
      align: 'right',
      type: 'amount',
      value: row => row['年初贷方'] ?? 0,
    }
  )
  if (isMidYear) {
    columns.push(
      {
        label: '帐前借方',
        width: 110,
        align: 'right',
        type: 'amount',
        value: row => row['帐前借方'] ?? 0,
      },
      {
        label: '帐前贷方',
        width: 110,
        align: 'right',
        type: 'amount',
        value: row => row['帐前贷方'] ?? 0,
      }
    )
  }
  return columns
}

function flattenExportLeafColumns<T>(columns: ExportColumnDef<T>[]): ExportColumnDef<T>[] {
  const leaves: ExportColumnDef<T>[] = []
  for (const column of columns) {
    if (column.children?.length) {
      leaves.push(...flattenExportLeafColumns(column.children))
      continue
    }
    leaves.push(column)
  }
  return leaves
}

/** 辅助项目余额表导出合计行：与叶子列数对齐（col0 由导出器写入「合计」） */
export function buildAuxBalanceExportSummaryValues(
  categoryColumnCount: number,
  totals: {
    init_balance?: number
    current_debit?: number
    current_credit?: number
    end_balance?: number
  } | null | undefined
): (string | number)[] {
  const leafCount = 2 + categoryColumnCount + 6
  const values: (string | number)[] = Array(leafCount).fill('')
  const base = 2 + categoryColumnCount
  const initTotal = totals?.init_balance ?? 0
  const endTotal = totals?.end_balance ?? 0
  values[base] = initTotal === 0 ? '' : initTotal > 0 ? '借' : '贷'
  values[base + 1] = formatSignedBalanceAmount(initTotal, false)
  values[base + 2] = totals?.current_debit ?? 0
  values[base + 3] = totals?.current_credit ?? 0
  values[base + 4] = endTotal === 0 ? '' : endTotal > 0 ? '借' : '贷'
  values[base + 5] = formatSignedBalanceAmount(endTotal, false)
  return values
}

export interface AuxForeignTotals {
  foreign_init_balance: number
  foreign_current_debit: number
  foreign_current_credit: number
  foreign_end_balance: number
  /** 本位币各段：多币种时按币种出小计行要用，单币种场景可缺省 */
  init_balance?: number
  current_debit?: number
  current_credit?: number
  end_balance?: number
}

/**
 * 辅助项目外币余额表导出合计行。
 * 叶子列顺序：科目编码、科目名称、各辅助列、币种、汇率、
 * 期初(方向/原币/本位币)、本期(借方原币/借方本位币/贷方原币/贷方本位币)、期末(方向/原币/本位币)。
 * 原币合计只在结果为单一币种时填写；多币种不能相加，留空并在币种列标注。
 */
export function buildAuxForeignBalanceExportSummaryValues(
  categoryColumnCount: number,
  totals: {
    init_balance?: number
    current_debit?: number
    current_credit?: number
    end_balance?: number
  } | null | undefined,
  foreignTotals: Record<string, AuxForeignTotals> | null | undefined
): (string | number)[] {
  const leafCount = 2 + categoryColumnCount + 2 + 3 + 4 + 3
  const values: (string | number)[] = Array(leafCount).fill('')
  const currencyCol = 2 + categoryColumnCount
  // 币种后面还有一列汇率，金额段从币种列 +2 开始
  const base = currencyCol + 2
  const currencyKeys = foreignTotals ? Object.keys(foreignTotals) : []
  const fx = currencyKeys.length === 1 ? foreignTotals![currencyKeys[0]] : null
  values[currencyCol] = fx ? currencyKeys[0] : currencyKeys.length > 1 ? '多币种' : ''

  const initTotal = totals?.init_balance ?? 0
  const endTotal = totals?.end_balance ?? 0
  values[base] = initTotal === 0 ? '' : initTotal > 0 ? '借' : '贷'
  values[base + 1] = fx ? formatSignedBalanceAmount(fx.foreign_init_balance, false) : ''
  values[base + 2] = formatSignedBalanceAmount(initTotal, false)
  values[base + 3] = fx ? fx.foreign_current_debit : ''
  values[base + 4] = totals?.current_debit ?? 0
  values[base + 5] = fx ? fx.foreign_current_credit : ''
  values[base + 6] = totals?.current_credit ?? 0
  values[base + 7] = endTotal === 0 ? '' : endTotal > 0 ? '借' : '贷'
  values[base + 8] = fx ? formatSignedBalanceAmount(fx.foreign_end_balance, false) : ''
  values[base + 9] = formatSignedBalanceAmount(endTotal, false)
  return values
}

/**
 * 辅助项目外币余额表「按币种小计」行。多币种时才有意义（单币种的小计等于合计）。
 * 叶子列顺序与 buildAuxForeignBalanceExportSummaryValues 一致。
 */
export function buildAuxForeignBalanceSubtotalRows(
  categoryColumnCount: number,
  foreignTotals: Record<string, AuxForeignTotals> | null | undefined,
  rates?: Record<string, number> | null
): (string | number)[][] {
  const keys = foreignTotals ? Object.keys(foreignTotals) : []
  if (keys.length < 2) return []
  const leafCount = 2 + categoryColumnCount + 2 + 3 + 4 + 3
  const currencyCol = 2 + categoryColumnCount
  const base = currencyCol + 2

  return keys.map(key => {
    const t = foreignTotals![key]
    const values: (string | number)[] = Array(leafCount).fill('')
    values[0] = `${key} 小计`
    values[currencyCol] = key
    values[currencyCol + 1] = rates?.[key] ? Number(rates[key]).toFixed(4) : ''
    const initTotal = t.init_balance ?? 0
    const endTotal = t.end_balance ?? 0
    values[base] = initTotal === 0 ? '' : initTotal > 0 ? '借' : '贷'
    values[base + 1] = formatSignedBalanceAmount(t.foreign_init_balance, false)
    values[base + 2] = formatSignedBalanceAmount(initTotal, false)
    values[base + 3] = t.foreign_current_debit
    values[base + 4] = t.current_debit ?? 0
    values[base + 5] = t.foreign_current_credit
    values[base + 6] = t.current_credit ?? 0
    values[base + 7] = endTotal === 0 ? '' : endTotal > 0 ? '借' : '贷'
    values[base + 8] = formatSignedBalanceAmount(t.foreign_end_balance, false)
    values[base + 9] = formatSignedBalanceAmount(endTotal, false)
    return values
  })
}

/** 辅助项目明细账导出合计行：按可见导出列顺序填充，与界面 show-summary 一致 */
export function buildAuxDetailExportSummaryValues(
  columns: ExportColumnDef[],
  rows: Array<Record<string, any>>,
  formatRunningBalanceDirection: (row: Record<string, any>) => string,
  formatBalanceDisplay: (balance: number | undefined) => string
): (string | number)[] {
  const leaves = flattenExportLeafColumns(columns)
  const normalEntries = rows.filter(
    row => !row.is_monthly_subtotal && !row.is_yearly_subtotal && !row.is_opening_balance
  )
  const lastEntry = normalEntries[normalEntries.length - 1]
  return leaves.map((col, index) => {
    if (index === 0) return ''
    switch (col.label) {
      case '借方':
        return normalEntries.reduce(
          (sum, row) => sum + (row.direction === 'debit' ? row.amount : 0),
          0
        )
      case '贷方':
        return normalEntries.reduce(
          (sum, row) => sum + (row.direction === 'credit' ? row.amount : 0),
          0
        )
      case '方向':
        return lastEntry ? formatRunningBalanceDirection(lastEntry) : ''
      case '余额':
        return lastEntry ? formatBalanceDisplay(lastEntry.running_balance) : formatBalanceDisplay(0)
      default:
        return ''
    }
  })
}

type QuantityBalanceRow = {
  account_code?: string
  account_name?: string
  unit?: string
  level?: number
  direction?: string
  qty_init_balance?: number
  init_balance?: number
  qty_current_debit?: number
  current_debit?: number
  qty_current_credit?: number
  current_credit?: number
  qty_year_debit?: number
  year_debit?: number
  qty_year_credit?: number
  year_credit?: number
  qty_end_balance?: number
  end_unit_price?: number
  end_balance?: number
  [key: string]: string | number | undefined
}

/** 数量：6 位小数（与页面、参考图一致），0 时按「隐藏零值」留空 */
function formatExportQuantity(value: number | undefined, hideZero: boolean): string {
  const n = Number(value) || 0
  if (!n) return hideZero ? '' : '0.000000'
  return Math.abs(n).toFixed(6)
}

/** 单价：4 位小数 */
function formatExportUnitPrice(value: number | undefined, hideZero: boolean): string {
  const n = Number(value) || 0
  if (!n) return hideZero ? '' : '0.0000'
  return n.toFixed(4)
}

/**
 * 库存数量金额表导出列（两级表头，数量与金额成对）。
 * 结余单价由调用方在 rows 里预先算好写进 end_unit_price，避免此处再除零。
 */
export function buildQuantityBalanceExportColumns(
  colWidth: ColWidthFn,
  hideZero: boolean
): ExportColumnDef<QuantityBalanceRow>[] {
  const qtyCol = (label: string, key: string, fallback: number): ExportColumnDef<QuantityBalanceRow> => ({
    label,
    width: colWidth(key, fallback),
    align: 'right',
    value: row => formatExportQuantity(row[key] as number | undefined, hideZero),
  })
  const amtCol = (label: string, key: string, fallback: number): ExportColumnDef<QuantityBalanceRow> => ({
    label,
    width: colWidth(key, fallback),
    align: 'right',
    type: 'amount',
    value: row => formatPositiveAmount(Number(row[key]) || 0, hideZero),
  })

  return [
    {
      label: '科目编码',
      width: colWidth('account_code', 110),
      value: row => row.account_code,
    },
    {
      label: '科目名称',
      width: colWidth('account_name', 150),
      value: row => row.account_name,
    },
    {
      label: '单位',
      width: colWidth('unit', 60),
      align: 'center',
      value: row => row.unit || '',
    },
    {
      label: '期初',
      children: [
        {
          label: '+/-',
          width: colWidth('init_direction', 50),
          align: 'center',
          value: row =>
            formatInitBalanceDirection({
              init_balance: row.init_balance ?? 0,
              direction: row.direction ?? 'debit',
            }),
        },
        qtyCol('数量', 'qty_init_balance', 110),
        {
          label: '金额',
          width: colWidth('init_balance', 110),
          align: 'right',
          type: 'amount',
          value: row => formatSignedBalanceAmount(row.init_balance ?? 0, hideZero),
        },
      ],
    },
    {
      label: '本期发生额',
      children: [
        qtyCol('借方数量', 'qty_current_debit', 120),
        amtCol('借方金额', 'current_debit', 120),
        qtyCol('贷方数量', 'qty_current_credit', 120),
        amtCol('贷方金额', 'current_credit', 120),
      ],
    },
    {
      label: '本年累计发生额',
      children: [
        qtyCol('借方数量', 'qty_year_debit', 120),
        amtCol('借方金额', 'year_debit', 120),
        qtyCol('贷方数量', 'qty_year_credit', 120),
        amtCol('贷方金额', 'year_credit', 120),
      ],
    },
    {
      label: '结余',
      children: [
        {
          label: '+/-',
          width: colWidth('end_direction', 50),
          align: 'center',
          value: row =>
            formatEndBalanceDirection({
              end_balance: row.end_balance ?? 0,
              direction: row.direction ?? 'debit',
            }),
        },
        qtyCol('数量', 'qty_end_balance', 110),
        {
          label: '单价',
          width: colWidth('end_unit_price', 110),
          align: 'right',
          value: row => formatExportUnitPrice(row.end_unit_price, hideZero),
        },
        {
          label: '金额',
          width: colWidth('end_balance', 110),
          align: 'right',
          type: 'amount',
          value: row => formatSignedBalanceAmount(row.end_balance ?? 0, hideZero),
        },
      ],
    },
  ]
}

type ForeignBalanceRow = {
  account_code?: string
  account_name?: string
  level?: number
  direction?: string
  currency_code?: string
  foreign_init_balance?: number
  init_balance?: number
  foreign_current_debit?: number
  current_debit?: number
  foreign_current_credit?: number
  current_credit?: number
  foreign_year_debit?: number
  year_debit?: number
  foreign_year_credit?: number
  year_credit?: number
  foreign_end_balance?: number
  end_balance?: number
  [key: string]: string | number | undefined
}

/** 外币余额表一个币种的合计（本位币与原币成对，与后端 summary 分桶同构） */
export interface ForeignBalanceTotals {
  foreign_init_balance: number
  init_balance: number
  foreign_current_debit: number
  current_debit: number
  foreign_current_credit: number
  current_credit: number
  foreign_year_debit: number
  year_debit: number
  foreign_year_credit: number
  year_credit: number
  foreign_end_balance: number
  end_balance: number
}

/** 原币金额：2 位小数，0 时按「隐藏零值」留空 */
function formatExportForeignAmount(value: number | undefined, hideZero: boolean): string {
  const n = Number(value) || 0
  if (!n) return hideZero ? '' : '0.00'
  return Math.abs(n).toFixed(2)
}

/**
 * 外币余额表导出列（两级表头，原币与本位币成对）。
 * 汇率由调用方预先写进 rows 的 `exchange_rate`，此处不再查汇率表。
 */
export function buildForeignBalanceExportColumns(
  colWidth: ColWidthFn,
  hideZero: boolean
): ExportColumnDef<ForeignBalanceRow>[] {
  const fxCol = (
    label: string,
    key: string,
    fallback: number
  ): ExportColumnDef<ForeignBalanceRow> => ({
    label,
    width: colWidth(key, fallback),
    align: 'right',
    value: row => formatExportForeignAmount(row[key] as number | undefined, hideZero),
  })
  const amtCol = (
    label: string,
    key: string,
    fallback: number
  ): ExportColumnDef<ForeignBalanceRow> => ({
    label,
    width: colWidth(key, fallback),
    align: 'right',
    type: 'amount',
    value: row => formatPositiveAmount(Number(row[key]) || 0, hideZero),
  })

  return [
    { label: '科目编码', width: colWidth('account_code', 110), value: row => row.account_code },
    { label: '科目名称', width: colWidth('account_name', 150), value: row => row.account_name },
    {
      label: '币种',
      width: colWidth('currency_code', 70),
      align: 'center',
      value: row => row.currency_code || '',
    },
    {
      label: '汇率',
      width: colWidth('exchange_rate', 90),
      align: 'right',
      value: row => (Number(row.exchange_rate) ? Number(row.exchange_rate).toFixed(4) : ''),
    },
    {
      label: '期初余额',
      children: [
        {
          label: '方向',
          width: colWidth('init_direction', 50),
          align: 'center',
          value: row =>
            formatInitBalanceDirection({
              init_balance: row.init_balance ?? 0,
              direction: row.direction ?? 'debit',
            }),
        },
        fxCol('原币', 'foreign_init_balance', 120),
        {
          label: '本位币',
          width: colWidth('init_balance', 120),
          align: 'right',
          type: 'amount',
          value: row => formatSignedBalanceAmount(row.init_balance ?? 0, hideZero),
        },
      ],
    },
    {
      label: '本期发生额',
      children: [
        fxCol('借方原币', 'foreign_current_debit', 120),
        amtCol('借方本位币', 'current_debit', 120),
        fxCol('贷方原币', 'foreign_current_credit', 120),
        amtCol('贷方本位币', 'current_credit', 120),
      ],
    },
    {
      label: '本年累计发生额',
      children: [
        fxCol('借方原币', 'foreign_year_debit', 120),
        amtCol('借方本位币', 'year_debit', 120),
        fxCol('贷方原币', 'foreign_year_credit', 120),
        amtCol('贷方本位币', 'year_credit', 120),
      ],
    },
    {
      label: '期末余额',
      children: [
        {
          label: '方向',
          width: colWidth('end_direction', 50),
          align: 'center',
          value: row =>
            formatEndBalanceDirection({
              end_balance: row.end_balance ?? 0,
              direction: row.direction ?? 'debit',
            }),
        },
        fxCol('原币', 'foreign_end_balance', 120),
        {
          label: '本位币',
          width: colWidth('end_balance', 120),
          align: 'right',
          type: 'amount',
          value: row => formatSignedBalanceAmount(row.end_balance ?? 0, hideZero),
        },
      ],
    },
  ]
}

/**
 * 外币余额表导出合计行。叶子列顺序与 buildForeignBalanceExportColumns 一致：
 * 科目编码、科目名称、币种、汇率、期初(方向/原币/本位币)、
 * 本期(借原/借本/贷原/贷本)、本年累计(借原/借本/贷原/贷本)、期末(方向/原币/本位币)。
 *
 * 本位币各段恒可相加；原币只有在结果为单一币种时才有意义，多币种时留空并在币种列标注。
 */
export function buildForeignBalanceExportSummaryValues(
  totals: Record<string, ForeignBalanceTotals> | null | undefined
): (string | number)[] {
  // 叶子列共 18 列：2 科目 + 币种 + 汇率 + 期初 3 + 本期 4 + 本年累计 4 + 期末 3
  const values: (string | number)[] = Array(18).fill('')
  const keys = totals ? Object.keys(totals) : []
  const fx = keys.length === 1 ? totals![keys[0]] : null
  values[2] = fx ? keys[0] : keys.length > 1 ? '多币种' : ''

  const sum = (field: keyof ForeignBalanceTotals) =>
    keys.reduce((acc, key) => acc + (Number(totals![key][field]) || 0), 0)

  const initTotal = sum('init_balance')
  const endTotal = sum('end_balance')
  values[4] = initTotal === 0 ? '' : initTotal > 0 ? '借' : '贷'
  values[5] = fx ? formatSignedBalanceAmount(fx.foreign_init_balance, false) : ''
  values[6] = formatSignedBalanceAmount(initTotal, false)
  values[7] = fx ? fx.foreign_current_debit : ''
  values[8] = sum('current_debit')
  values[9] = fx ? fx.foreign_current_credit : ''
  values[10] = sum('current_credit')
  values[11] = fx ? fx.foreign_year_debit : ''
  values[12] = sum('year_debit')
  values[13] = fx ? fx.foreign_year_credit : ''
  values[14] = sum('year_credit')
  values[15] = endTotal === 0 ? '' : endTotal > 0 ? '借' : '贷'
  values[16] = fx ? formatSignedBalanceAmount(fx.foreign_end_balance, false) : ''
  values[17] = formatSignedBalanceAmount(endTotal, false)
  return values
}

/**
 * 外币余额表「按币种小计」行。多币种时才输出（单币种的小计就是合计，重复无意义）。
 * 叶子列顺序与 buildForeignBalanceExportColumns / ...SummaryValues 一致，共 18 列。
 */
export function buildForeignBalanceSubtotalRows(
  totals: Record<string, ForeignBalanceTotals> | null | undefined,
  rates?: Record<string, number> | null
): (string | number)[][] {
  const keys = totals ? Object.keys(totals) : []
  if (keys.length < 2) return []

  return keys.map(key => {
    const t = totals![key]
    const values: (string | number)[] = Array(18).fill('')
    values[0] = `${key} 小计`
    values[2] = key
    values[3] = rates?.[key] ? Number(rates[key]).toFixed(4) : ''
    values[4] = t.init_balance === 0 ? '' : t.init_balance > 0 ? '借' : '贷'
    values[5] = formatSignedBalanceAmount(t.foreign_init_balance, false)
    values[6] = formatSignedBalanceAmount(t.init_balance, false)
    values[7] = t.foreign_current_debit
    values[8] = t.current_debit
    values[9] = t.foreign_current_credit
    values[10] = t.current_credit
    values[11] = t.foreign_year_debit
    values[12] = t.year_debit
    values[13] = t.foreign_year_credit
    values[14] = t.year_credit
    values[15] = t.end_balance === 0 ? '' : t.end_balance > 0 ? '借' : '贷'
    values[16] = formatSignedBalanceAmount(t.foreign_end_balance, false)
    values[17] = formatSignedBalanceAmount(t.end_balance, false)
    return values
  })
}
