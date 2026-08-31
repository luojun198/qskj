import type { ExportColumnDef } from './exportStyledExcel'
import {
  formatBalanceDirection,
  formatEndBalanceDirection,
  formatInitBalanceDirection,
  formatPositiveAmount,
  formatSignedBalanceAmount,
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
          value: row =>
            row.direction === 'debit' && (row.init_balance ?? 0) > 0 ? row.init_balance : '',
        },
        {
          label: '贷方',
          width: colWidth('init_credit', 100),
          align: 'right',
          type: 'amount',
          value: row =>
            row.direction === 'credit' && (row.init_balance ?? 0) > 0 ? row.init_balance : '',
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
          value: row =>
            row.direction === 'debit' && (row.end_balance ?? 0) > 0 ? row.end_balance : '',
        },
        {
          label: '贷方',
          width: colWidth('end_credit', 100),
          align: 'right',
          type: 'amount',
          value: row =>
            row.direction === 'credit' && (row.end_balance ?? 0) > 0 ? row.end_balance : '',
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
  const calcInitDebit = leaf.reduce(
    (s, r) => s + (r.direction === 'debit' && r.init_balance > 0 ? r.init_balance : 0),
    0
  )
  const calcInitCredit = leaf.reduce(
    (s, r) => s + (r.direction === 'credit' && r.init_balance > 0 ? r.init_balance : 0),
    0
  )
  const calcEndDebit = leaf.reduce(
    (s, r) => s + (r.direction === 'debit' && r.end_balance > 0 ? r.end_balance : 0),
    0
  )
  const calcEndCredit = leaf.reduce(
    (s, r) => s + (r.direction === 'credit' && r.end_balance > 0 ? r.end_balance : 0),
    0
  )
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
