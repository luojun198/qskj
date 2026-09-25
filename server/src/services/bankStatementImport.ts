/**
 * 银行对账单导入：把任意工作表行数组按列映射转换为 bank_statement 记录（纯函数，便于测试）
 *
 * FIX-259：映射支持「借方列 + 贷方列」（dc）与「金额列 + 方向标志列 / 正负号」（single）两种模式；
 * 金额去千分位与货币符号；日期解析由调用方注入（路由里带结账期闸）。
 */

export type AmountMode = 'dc' | 'single'
export type StatementField =
  | 'biz_date' | 'debit' | 'credit' | 'amount' | 'direction'
  | 'summary' | 'counter_name' | 'counter_account' | 'balance' | 'bill_no' | 'settle_type'

export interface StatementImportOptions {
  /** 字段 → 列索引 */
  mapping: Record<string, unknown>
  /** 表头行索引，-1 = 无表头 */
  headerRow: number
  /** 首个数据行索引 */
  dataStartRow: number
  amountMode: AmountMode
  /** single 模式下视为收入（借方）的方向标志值 */
  directionInValues?: string[]
  /** 日期解析：返回 YYYY-MM-DD，或抛错（错误信息进 errors） */
  resolveDate: (raw: unknown) => string
}

export interface StatementRecord {
  biz_date: string
  debit: number
  credit: number
  settle_type: string | null
  bill_no: string | null
  summary: string | null
  counter_name: string | null
  counter_account: string | null
  balance: number | null
  /** 源文件行号（从 1 起） */
  row_no?: number
}

export interface StatementImportResult {
  records: StatementRecord[]
  errors: Array<{ row: number; message: string }>
  /** 实际采用的首个数据行（FIX-255 自动跳过表头后可能比传入值大 1） */
  firstDataRow: number
}

/** 金额解析：去千分位逗号 / 空白 / 货币符号，解析失败按 0 */
export function parseAmount(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = parseFloat(String(v).replace(/[,，\s¥￥]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 银行流水末尾常见的合计 / 小计行：日期列填的是「合计」之类文字，静默跳过而不记错误 */
export function isTotalRowText(v: unknown): boolean {
  return /合计|小计|总计|共计/.test(String(v ?? ''))
}

/** 读取映射里的列索引；未映射 / 非法返回 -1 */
export function mappedCol(mapping: Record<string, unknown>, field: StatementField): number {
  const raw = mapping[field]
  if (raw === undefined || raw === null || raw === '') return -1
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : -1
}

/** 校验映射是否满足当前模式的必填列；返回错误文案或 null */
export function validateMapping(
  mapping: Record<string, unknown>,
  mode: AmountMode,
  directionInValues?: string[]
): string | null {
  if (mappedCol(mapping, 'biz_date') < 0) return '未指定日期列'
  if (mode === 'dc' && mappedCol(mapping, 'debit') < 0 && mappedCol(mapping, 'credit') < 0) return '借方列、贷方列至少指定一列'
  if (mode === 'single' && mappedCol(mapping, 'amount') < 0) return '未指定金额列'
  // 评审 P2：指定了方向列却没选「表示收入的标志值」，所有行都会被当成支出
  if (mode === 'single' && mappedCol(mapping, 'direction') >= 0 && directionInValues !== undefined &&
      !directionInValues.some(v => String(v).trim())) {
    return '已指定方向标志列，请选择表示收入（借方）的标志值'
  }
  return null
}

/**
 * 逐行转换。范围 [start, end) 由调用方分片传入（落库时每 5000 行一个事务）。
 * 完全无日期的行静默跳过；借贷都为 0 且无摘要的行视为合计 / 空行跳过。
 */
export function convertStatementRows(
  rows: unknown[][],
  opts: StatementImportOptions,
  start = 0,
  end = rows.length
): StatementImportResult {
  const { mapping, headerRow, amountMode: mode, resolveDate } = opts
  const col = (f: StatementField) => mappedCol(mapping, f)
  const dateCol = col('biz_date')
  const dirCol = col('direction')
  const balanceCol = col('balance')
  const inValues = new Set((opts.directionInValues || []).map(v => String(v).trim()).filter(Boolean))

  // FIX-255：未指定表头行且首个数据行日期列解析不出日期时，把该行当表头跳过
  let firstDataRow = opts.dataStartRow
  if (headerRow < 0 && rows.length > firstDataRow && dateCol >= 0) {
    const firstDate = rows[firstDataRow]?.[dateCol]
    if (firstDate) {
      let looksLikeDate = true
      try { resolveDate(firstDate) } catch { looksLikeDate = false }
      if (!looksLikeDate) firstDataRow += 1
    }
  }

  const text = (row: unknown[], f: StatementField): string | null => {
    const i = col(f)
    if (i < 0) return null
    const s = String(row[i] ?? '').trim()
    return s || null
  }
  const num = (row: unknown[], f: StatementField): number => {
    const i = col(f)
    return i < 0 ? 0 : parseAmount(row[i])
  }

  const records: StatementRecord[] = []
  const errors: Array<{ row: number; message: string }> = []
  for (let i = start; i < end; i++) {
    if (i === headerRow || i < firstDataRow) continue
    const row = rows[i] || []
    const date = row[dateCol]
    if (date === undefined || date === null || date === '') continue
    let bizDate: string
    try {
      bizDate = resolveDate(date)
    } catch (e: any) {
      if (isTotalRowText(date)) continue
      errors.push({ row: i + 1, message: e?.message || '日期格式错误' })
      continue
    }

    let debit = 0
    let credit = 0
    if (mode === 'dc') {
      debit = num(row, 'debit')
      credit = num(row, 'credit')
    } else {
      const amount = num(row, 'amount')
      if (dirCol >= 0) {
        const flag = String(row[dirCol] ?? '').trim()
        // 评审 P2：方向标志为空的行此前一律按「支出」入账，收款被记成付款也无任何提示——改为报行级错误
        if (!flag && amount !== 0) {
          errors.push({ row: i + 1, message: '方向标志为空，无法判断收入还是支出' })
          continue
        }
        if (inValues.has(flag)) debit = Math.abs(amount)
        else credit = Math.abs(amount)
      } else if (amount >= 0) {
        debit = amount
      } else {
        credit = -amount
      }
    }
    const summary = text(row, 'summary')
    if (!debit && !credit && !summary) continue

    records.push({
      biz_date: bizDate,
      debit,
      credit,
      settle_type: text(row, 'settle_type'),
      bill_no: text(row, 'bill_no'),
      summary,
      counter_name: text(row, 'counter_name'),
      counter_account: text(row, 'counter_account'),
      balance: balanceCol >= 0 && String(row[balanceCol] ?? '').trim() !== '' ? parseAmount(row[balanceCol]) : null,
      row_no: i + 1,
    })
  }
  return { records, errors, firstDataRow }
}
