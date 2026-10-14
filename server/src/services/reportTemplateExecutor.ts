import { getBalance, getBatchBalances, getPeriodSum, getPeriodRangeSum, getPeriodRangeSumExcludeTransfer, type BalanceQueryDb } from './reportBalance.js'
import { getCashFlowAmount, getCashFlowSupplementAmount } from './cashFlowAmount.js'
import type { AccountScopeContext } from './accountAuthorization.js'
import type { Database } from 'better-sqlite3'
import {
  evaluateFormula,
  collectCellRefs,
  isAnchorFunction,
  FormulaError,
  type FormulaValue,
  type FormulaErrorCode,
} from './reportFormula.js'

type ExecuteContext = {
  db: BalanceQueryDb | Database
  accountSetId: string
  year: number
  period: number
  unitName?: string
  accountScope?: AccountScopeContext
}

type ResolvedPeriodRange = {
  year: number
  fromPeriod: number
  toPeriod: number
}

type TemplateCellInput = {
  id: string
  report_sheet_id: string
  row_index: number
  col_index: number
  cell_type: string
  text_value: string | null
  formula_text: string | null
  format_text: string | null
  style_key: string | null
  side: string | null
}

type ExecutedTemplateCell = TemplateCellInput & {
  address: string
  raw_value: string
  display_value: string
  numeric_value: number | null
  status: 'ok' | 'error'
  error: string | null
}

type TemplateSheetInput = {
  id: string
  report_definition_id: string
  sheet_key: string
  sheet_name: string
  sheet_index: number
  cells: TemplateCellInput[]
}

export type ExecutedTemplateSheet = TemplateSheetInput & {
  cells: ExecutedTemplateCell[]
  /** FIX-144：本表出错单元格数（含被错误格传染的公式格），前端据此提示 */
  error_count: number
}

function getCellAddress(rowIndex: number, colIndex: number) {
  let col = colIndex
  let name = ''
  do {
    name = String.fromCharCode(65 + (col % 26)) + name
    col = Math.floor(col / 26) - 1
  } while (col >= 0)
  return `${name}${rowIndex + 1}`
}

function isNumericValue(value: string) {
  return /^-?\d+(\.\d+)?$/.test(value.trim())
}

function fixedFormatter(digits: number, grouping: boolean) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: grouping,
  })
}

/** 金额默认显示：千分位 + 两位小数，与润衡原报表一致 */
const AMOUNT_FORMATTER = fixedFormatter(2, true)

/**
 * 数值显示格式。
 *
 * format_text 取值兼容两套写法：
 *   - 前端格式工具栏的 token（integer / 2decimal / 4decimal / thousands / percent）
 *   - Excel 风格的格式串（如 `#,##0.00;-#,##0.00;#`），只识别小数位数与千分位
 * 未设置格式时按 isAmount 决定：金额一律两位小数带千分位；
 * 行次之类的序号保持整数原样，避免出现「1.00、2.00」。
 */
function formatNumber(value: number, formatText: string | null, isAmount = false) {
  if (!Number.isFinite(value)) return ''
  const format = (formatText || '').trim()

  if (!format) {
    if (isAmount) return AMOUNT_FORMATTER.format(value)
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
  }

  switch (format) {
    case 'integer':
      return fixedFormatter(0, false).format(value)
    case '2decimal':
      return fixedFormatter(2, false).format(value)
    case '4decimal':
      return fixedFormatter(4, false).format(value)
    case 'thousands':
      return AMOUNT_FORMATTER.format(value)
    case 'percent':
      return `${fixedFormatter(2, false).format(value * 100)}%`
    default:
      break
  }

  // Excel 风格：取正数段，数小数点后 0 的个数，判断是否有千分位逗号
  const positiveSection = format.split(';')[0] || format
  const decimalMatch = /\.(0+)/.exec(positiveSection)
  const digits = decimalMatch ? decimalMatch[1].length : 2
  const grouping = positiveSection.includes(',')
  return fixedFormatter(digits, grouping).format(value)
}

/**
 * 该公式算出来的是不是「金额」。
 *
 * ACD 导入不带数字格式，只能从公式本身推断：
 *   - 带 @ 取数函数（余额 / 发生额 / 现金流量）的必然是金额；
 *   - 调用了 SUM 之类函数的是汇总金额；
 *   - 引用了任何一个金额格的（=C7+C8、=C21-C7）也是金额。
 * 行次公式 =B6+1 只引用上一行的序号字面量，不满足任一条件，仍按整数显示。
 */
function isAmountFormula(formulaSource: string, amountCells: Set<string>) {
  if (formulaSource.includes('@')) return true
  if (/[A-Za-z_]+\s*\(/.test(formulaSource)) return true
  return collectCellRefs(formulaSource, isAnchorFunction).some(ref => amountCells.has(ref))
}

function splitArguments(value: string) {
  const result: string[] = []
  let current = ''
  let depth = 0
  for (const char of value) {
    if (char === ',' && depth === 0) {
      result.push(current.trim())
      current = ''
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    current += char
  }
  if (current.trim()) result.push(current.trim())
  return result
}







function getAccountDirection(db: BalanceQueryDb | Database, accountSetId: string, accountCode: string): 'debit' | 'credit' {
  const exact = db
    .prepare(
      `
      SELECT direction
      FROM accounts
      WHERE account_set_id = ? AND code = ?
      LIMIT 1
      `
    )
    .get(accountSetId, accountCode) as { direction?: string } | undefined

  const normalizeDirection = (value: unknown): 'debit' | 'credit' =>
    String(value || '').toLowerCase() === 'credit' ? 'credit' : 'debit'

  if (exact?.direction) {
    return normalizeDirection(exact.direction)
  }

  const grouped = db
    .prepare(
      `
      SELECT direction, COUNT(*) as count
      FROM accounts
      WHERE account_set_id = ? AND code LIKE ?
      GROUP BY direction
      ORDER BY count DESC
      LIMIT 1
      `
    )
    .get(accountSetId, `${accountCode}%`) as { direction?: string } | undefined

  return normalizeDirection(grouped?.direction)
}

/** 将自然方向余额拆到借/贷一侧：与科目方向一致且为正 → 本方向；为负 → 对方方向 */
function splitNaturalBalance(direction: 'debit' | 'credit', naturalBalance: number, side: 'debit' | 'credit') {
  return direction === side ? Math.max(naturalBalance, 0) : Math.max(-naturalBalance, 0)
}

/**
 * 明细口径的借/贷余额（ACD @mjy/@mdy/@mnj/@mnd）：
 * 逐个末级明细科目单独判断余额方向后再汇总，不能先在上级轧差。
 * 例：1122 下 1122002 贷 25,423.80、1122006 借 320.00 → mjy=320、mdy=25,423.80；
 * 若按上级净额（贷 25,103.80）拆分，应收账款取 0、预收账款少 320，资产负债表两边各差 320（FIX-398）
 */
function getDetailSideBalance(
  context: ExecuteContext,
  accountCode: string,
  period: number,
  side: 'debit' | 'credit',
  year = context.year
) {
  const leaves = context.db
    .prepare(
      `
      SELECT a.code, a.direction
      FROM accounts a
      WHERE a.account_set_id = ? AND (a.code = ? OR a.code LIKE ?)
        AND NOT EXISTS (
          SELECT 1 FROM accounts c
          WHERE c.account_set_id = a.account_set_id AND c.code LIKE a.code || '_%'
        )
      `
    )
    .all(context.accountSetId, accountCode, `${accountCode}_%`) as { code: string; direction?: string }[]

  if (leaves.length <= 1) {
    return getSideBalance(context, accountCode, period, side, year)
  }

  const balances = getBatchBalances(
    context.db,
    context.accountSetId,
    leaves.map(leaf => leaf.code),
    year,
    Number(period),
    context.accountScope
  )
  let total = 0
  for (const leaf of leaves) {
    const direction = String(leaf.direction || '').toLowerCase() === 'credit' ? 'credit' : 'debit'
    total += splitNaturalBalance(direction, balances.get(leaf.code) ?? 0, side)
  }
  return Math.round(total * 100) / 100
}

function getSideBalance(
  context: ExecuteContext,
  accountCode: string,
  period: number,
  side: 'debit' | 'credit',
  year = context.year
) {
  const direction = getAccountDirection(context.db, context.accountSetId, accountCode)
  const naturalBalance = getBalance(
    context.db,
    context.accountSetId,
    accountCode,
    year,
    Number(period),
    context.accountScope
  )

  if (side === 'debit') {
    return direction === 'debit'
      ? Math.max(naturalBalance, 0)
      : Math.max(-naturalBalance, 0)
  }

  return direction === 'credit'
    ? Math.max(naturalBalance, 0)
    : Math.max(-naturalBalance, 0)
}

function resolveAcdSinglePeriod(context: ExecuteContext, periodRaw: string): { year: number; period: number } {
  const normalized = String(periodRaw ?? '').trim()
  if (!normalized || normalized === '99') {
    return { year: context.year, period: context.period }
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    return { year: context.year, period: context.period }
  }

  if (parsed >= 100) {
    const periodValue = parsed - 100
    const period =
      periodValue === 99
        ? context.period
        : Math.min(12, Math.max(0, Math.trunc(periodValue)))
    return { year: context.year - 1, period }
  }

  return { year: context.year, period: Math.min(12, Math.max(0, Math.trunc(parsed))) }
}

function resolveAcdPeriodRange(context: ExecuteContext, fromRaw: string, toRaw: string): ResolvedPeriodRange {
  const normalize = (raw: string, fallback: number) => {
    const value = String(raw || '').trim()
    if (!value || value === '99') return fallback
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return parsed
  }

  const fromValue = normalize(fromRaw, context.period)
  const toValue = normalize(toRaw, context.period)
  const isPreviousYear = fromValue >= 100 || toValue >= 100
  const convertPeriod = (value: number) => {
    const period = isPreviousYear ? value - 100 : value
    if (period === 99) return context.period
    return Math.min(12, Math.max(1, Math.trunc(period)))
  }
  const fromPeriod = convertPeriod(fromValue)
  const toPeriod = convertPeriod(toValue)

  return {
    year: isPreviousYear ? context.year - 1 : context.year,
    fromPeriod: Math.min(fromPeriod, toPeriod),
    toPeriod: Math.max(fromPeriod, toPeriod),
  }
}

function hasTable(db: BalanceQueryDb | Database, tableName: string) {
  try {
    const row = db
      .prepare(
        `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1
        `
      )
      .get(tableName) as { name?: string } | undefined
    return Boolean(row?.name)
  } catch {
    return false
  }
}

function getBudgetSurplusAdjustmentAmount(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  itemCode: string,
  year: number,
  fromPeriod: number,
  toPeriod: number
) {
  if (!hasTable(db, 'budget_surplus_adjustments')) {
    return 0
  }

  const row = db
    .prepare(
      `
      SELECT SUM(amount) as amount
      FROM budget_surplus_adjustments
      WHERE account_set_id = ?
        AND year = ?
        AND period >= ?
        AND period <= ?
        AND (item_code = ? OR item_code LIKE ?)
      `
    )
    .get(accountSetId, year, fromPeriod, toPeriod, itemCode, `${itemCode}%`) as
    | { amount: number | null }
    | undefined

  return Number(row?.amount || 0)
}

function callAnchorFunction(rawName: string, rawArgs: string[], context: ExecuteContext): number {
  {
    const name = rawName.toLowerCase()
    const args = rawArgs
    const accountCode = String(args[0] || '').trim()
    // 99 表示当前期间（ACD 报表公式惯例），100+ 表示上年同期
    const periodRaw = args[1] === undefined || args[1] === '' ? '99' : String(args[1]).trim()
    const resolvedPeriod = resolveAcdSinglePeriod(context, periodRaw)

    if (!accountCode) {
      throw new Error(`函数 @${name} 缺少科目编码参数`)
    }

    let result: number
    switch (name) {
      case 'ye': {
        result = getBalance(
          context.db,
          context.accountSetId,
          accountCode,
          resolvedPeriod.year,
          resolvedPeriod.period,
          context.accountScope
        )
        break
      }
      case 'nc': {
        result = getBalance(
          context.db,
          context.accountSetId,
          accountCode,
          context.year,
          0,
          context.accountScope
        )
        break
      }
      case 'df': {
        const sum = getPeriodSum(
          context.db,
          context.accountSetId,
          accountCode,
          resolvedPeriod.year,
          resolvedPeriod.period,
          context.accountScope
        )
        result = sum.credit
        break
      }
      case 'jf': {
        const sum = getPeriodSum(
          context.db,
          context.accountSetId,
          accountCode,
          resolvedPeriod.year,
          resolvedPeriod.period,
          context.accountScope
        )
        result = sum.debit
        break
      }
      case 'jy': {
        result = getSideBalance(context, accountCode, resolvedPeriod.period, 'debit', resolvedPeriod.year)
        break
      }
      case 'mjy': {
        result = getDetailSideBalance(context, accountCode, resolvedPeriod.period, 'debit', resolvedPeriod.year)
        break
      }
      case 'dy': {
        result = getSideBalance(context, accountCode, resolvedPeriod.period, 'credit', resolvedPeriod.year)
        break
      }
      case 'mdy': {
        result = getDetailSideBalance(context, accountCode, resolvedPeriod.period, 'credit', resolvedPeriod.year)
        break
      }
      case 'nj': {
        result = getSideBalance(context, accountCode, 0, 'debit', resolvedPeriod.year)
        break
      }
      case 'mnj': {
        result = getDetailSideBalance(context, accountCode, 0, 'debit', resolvedPeriod.year)
        break
      }
      case 'nd': {
        result = getSideBalance(context, accountCode, 0, 'credit', resolvedPeriod.year)
        break
      }
      case 'mnd': {
        result = getDetailSideBalance(context, accountCode, 0, 'credit', resolvedPeriod.year)
        break
      }
      case 'jqy': {
        // @jqy(科目编码, 起始期间, 截止期间)
        // 99 表示当前期（context.period），数字表示具体月份
        // 排除结转凭证，取结转前净发生额，按科目自然余额方向计算
        const range = resolveAcdPeriodRange(
          context,
          args[1] === undefined || args[1] === '' ? '99' : String(args[1]).trim(),
          args[2] === undefined || args[2] === '' ? '99' : String(args[2]).trim()
        )
        const rangeSum = getPeriodRangeSumExcludeTransfer(
          context.db,
          context.accountSetId,
          accountCode,
          range.year,
          range.fromPeriod,
          range.toPeriod,
          context.accountScope
        )
        const direction = getAccountDirection(context.db, context.accountSetId, accountCode)
        result = direction === 'debit'
          ? rangeSum.debit - rangeSum.credit
          : rangeSum.credit - rangeSum.debit
        break
      }
      case 'jqj':
      case 'jqd': {
        const range = resolveAcdPeriodRange(
          context,
          args[1] === undefined || args[1] === '' ? '99' : String(args[1]).trim(),
          args[2] === undefined || args[2] === '' ? '99' : String(args[2]).trim()
        )
        const rangeSum = getPeriodRangeSumExcludeTransfer(
          context.db,
          context.accountSetId,
          accountCode,
          range.year,
          range.fromPeriod,
          range.toPeriod,
          context.accountScope
        )
        result = name === 'jqj' ? rangeSum.debit : rangeSum.credit
        break
      }
      case 'xj_je':
      case 'xj_fb': {
        const range = resolveAcdPeriodRange(
          context,
          args[1] === undefined || args[1] === '' ? '99' : String(args[1]).trim(),
          args[2] === undefined || args[2] === '' ? '99' : String(args[2]).trim()
        )
        result = (name === 'xj_fb' ? getCashFlowSupplementAmount : getCashFlowAmount)(
          context.db,
          context.accountSetId,
          accountCode,
          range.year,
          range.fromPeriod,
          range.toPeriod,
          context.accountScope
        )
        break
      }
      case 'ys_cy': {
        const range = resolveAcdPeriodRange(
          context,
          args[1] === undefined || args[1] === '' ? '99' : String(args[1]).trim(),
          args[2] === undefined || args[2] === '' ? '99' : String(args[2]).trim()
        )
        result = getBudgetSurplusAdjustmentAmount(
          context.db,
          context.accountSetId,
          accountCode,
          range.year,
          range.fromPeriod,
          range.toPeriod
        )
        break
      }
      default:
        throw new Error(`暂不支持公式函数 @${name}`)
    }

    return result
  }
}



function isFormulaLike(value: string | null) {
  const normalized = String(value || '').trim()
  return normalized.startsWith('=') || normalized.startsWith('@') || normalized.startsWith('＝')
}

function executeFormula(
  formulaText: string,
  context: ExecuteContext,
  cellValues: Map<string, FormulaValue>,
  errorCells: Map<string, FormulaErrorCode> = new Map()
): FormulaValue {
  // `@-ye(...)` 这类把负号写在 @ 后面的历史写法，先归一成 `-@ye(...)`
  const expression = formulaText.replace(/@([+-])\s*([a-z_][\w]*)\(/gi, '$1@$2(')

  return evaluateFormula(
    expression,
    {
      // FIX-144：仿 Excel 让错误沿公式链传播——引用到出错格（含 SUM 区域内）时整格报错，
      // 而不是把出错格当空格跳过，让合计「平衡」在错误数字上
      getCell: address => {
        const code = errorCells.get(address)
        if (code) {
          throw new FormulaError(code, `引用的单元格 ${address} 出错（${code}）`)
        }
        return cellValues.get(address)
      },
      callAnchor: (name, rawArgs) => callAnchorFunction(name, rawArgs, context),
    },
    isAnchorFunction
  )
}


function topoSortCells(cells: TemplateCellInput[]): {
  ordered: TemplateCellInput[]
  circular: Set<string>
} {
  // 建立 address -> cell 映射
  const addrMap = new Map<string, TemplateCellInput>()
  for (const cell of cells) {
    addrMap.set(getCellAddress(cell.row_index, cell.col_index), cell)
  }

  const visited = new Set<string>()
  const result: TemplateCellInput[] = []
  /** 处在循环引用链上的单元格地址；这些格子不能参与求值，否则会算出一个看似正常的错数 */
  const circular = new Set<string>()

  function visit(cell: TemplateCellInput, stack: Set<string>, path: string[]) {
    const addr = getCellAddress(cell.row_index, cell.col_index)
    if (visited.has(addr)) return
    if (stack.has(addr)) {
      // 检测到环：把 path 中自 addr 起的这一段全部标记出来
      const start = path.indexOf(addr)
      if (start >= 0) {
        for (let i = start; i < path.length; i += 1) circular.add(path[i])
      }
      circular.add(addr)
      return
    }
    stack.add(addr)
    path.push(addr)

    const formulaSource = cell.formula_text || cell.text_value || ''
    if (cell.cell_type === 'formula' || isFormulaLike(formulaSource)) {
      for (const ref of collectCellRefs(formulaSource, isAnchorFunction)) {
        const dep = addrMap.get(ref)
        if (dep) visit(dep, stack, path)
      }
    }

    stack.delete(addr)
    path.pop()
    visited.add(addr)
    result.push(cell)
  }

  // 先按行列顺序遍历，保证稳定性
  const sorted = cells.slice().sort((a, b) => a.row_index - b.row_index || a.col_index - b.col_index)
  for (const cell of sorted) {
    visit(cell, new Set(), [])
  }
  return { ordered: result, circular }
}

function applyTextPlaceholders(text: string, context: ExecuteContext): string {
  if (!text || !text.includes('%')) return text
  const month = String(context.period).padStart(2, '0')
  // 报表反映的是期末状态，日期占位符取当期最后一天（如 12 月 → 31 日）
  const day = String(new Date(context.year, context.period, 0).getDate()).padStart(2, '0')
  // 先替换组合形式（%yh%mh%dh 连写，% 被共用），再替换单独形式
  // 每个占位符支持有无尾部 %（如 %U 和 %U% 都能匹配）
  return text
    .replace(/%yh%mh%dh(%|(?=[^a-z]|$))/gi, `${context.year}年${month}月${day}日`)
    .replace(/%yh%mh(%|(?=[^a-z]|$))/gi, `${context.year}年${month}月`)
    .replace(/%yh(%|(?=[^a-z]|$))/gi, `${context.year}年`)
    .replace(/%mh(%|(?=[^a-z]|$))/gi, `${month}月`)
    .replace(/%dh(%|(?=[^a-z]|$))/gi, `${day}日`)
    .replace(/%U(%|(?=[^a-z]|$))/gi, context.unitName || '')
}

function executeCell(
  cell: TemplateCellInput,
  context: ExecuteContext,
  cellValues: Map<string, FormulaValue>,
  circular?: Set<string>,
  amountCells: Set<string> = new Set(),
  errorCells: Map<string, FormulaErrorCode> = new Map()
) {
  const address = getCellAddress(cell.row_index, cell.col_index)
  const formulaSource = cell.formula_text || cell.text_value || ''
  const shouldTreatAsFormula = cell.cell_type === 'formula' || isFormulaLike(formulaSource)
  const rawValue = shouldTreatAsFormula ? formulaSource : cell.text_value || ''

  try {
    if (shouldTreatAsFormula && formulaSource && circular?.has(address)) {
      // 循环引用不能求值：继续算下去只会得到一个看起来正常的错数，必须显式报错
      errorCells.set(address, '#CIRCULAR!')
      return {
        ...cell,
        address,
        raw_value: rawValue,
        display_value: '#CIRCULAR!',
        numeric_value: null,
        status: 'error' as const,
        error: '公式存在循环引用',
      }
    }

    if (shouldTreatAsFormula && formulaSource) {
      const value = executeFormula(formulaSource, context, cellValues, errorCells)
      cellValues.set(address, value)

      // IF(...) 之类可能返回文本或布尔，此时没有数值可言，只出显示值
      if (typeof value !== 'number') {
        const display = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : value
        return {
          ...cell,
          address,
          raw_value: rawValue,
          display_value: display,
          numeric_value: null,
          status: 'ok' as const,
          error: null,
        }
      }

      const isAmount = isAmountFormula(formulaSource, amountCells)
      if (isAmount) amountCells.add(address)
      return {
        ...cell,
        address,
        raw_value: rawValue,
        display_value: formatNumber(value, cell.format_text, isAmount),
        numeric_value: value,
        status: 'ok' as const,
        error: null,
      }
    }

    const textValue = cell.text_value || ''
    if (cell.cell_type === 'number' && isNumericValue(textValue)) {
      const numericValue = Number(textValue)
      cellValues.set(address, numericValue)
      return {
        ...cell,
        address,
        raw_value: rawValue,
        display_value: formatNumber(numericValue, cell.format_text),
        numeric_value: numericValue,
        status: 'ok' as const,
        error: null,
      }
    }

    return {
      ...cell,
      address,
      raw_value: rawValue,
      display_value: applyTextPlaceholders(textValue, context),
      numeric_value: null,
      status: 'ok' as const,
      error: null,
    }
  } catch (error) {
    const code: FormulaErrorCode = error instanceof FormulaError ? error.code : '#ERROR'
    errorCells.set(address, code)
    return {
      ...cell,
      address,
      raw_value: rawValue,
      // 能给出 Excel 错误码就给（#DIV/0! / #NAME? / #VALUE! ...），比笼统的 #ERROR 好定位
      display_value: code,
      numeric_value: null,
      status: 'error' as const,
      error: error instanceof Error ? error.message : '公式执行失败',
    }
  }
}

export function executeTemplateSheets(sheets: TemplateSheetInput[], context: ExecuteContext): ExecutedTemplateSheet[] {
  return sheets
    .slice()
    .sort((a, b) => a.sheet_index - b.sheet_index)
    .map(sheet => {
      const cellValues = new Map<string, FormulaValue>()
      // 已判定为金额的单元格地址；拓扑顺序保证被引用格先于引用它的格入集
      const amountCells = new Set<string>()
      // 拓扑排序：被依赖的单元格先执行，解决 =B6+B8 引用下方单元格的问题
      const { ordered: orderedCells, circular } = topoSortCells(sheet.cells)
      // 按拓扑顺序执行，结果 Map 保持原始行列顺序输出
      const resultMap = new Map<string, ReturnType<typeof executeCell>>()
      const errorCells = new Map<string, FormulaErrorCode>()
      for (const cell of orderedCells) {
        const executed = executeCell(cell, context, cellValues, circular, amountCells, errorCells)
        resultMap.set(executed.address, executed)
      }
      // 按原始行列顺序输出
      const executedCells = sheet.cells
        .slice()
        .sort((a, b) => a.row_index - b.row_index || a.col_index - b.col_index)
        .map(cell => resultMap.get(getCellAddress(cell.row_index, cell.col_index))!)

      return {
        ...sheet,
        cells: executedCells,
        error_count: errorCells.size,
      }
    })
}
