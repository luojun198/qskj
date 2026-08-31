import {
  buildImportSummary,
  collectImportIssues,
  type SpreadsheetImportIssue,
} from './spreadsheetImportReport'
import { normalizeDuplicateKey, normalizeImportCell, normalizeImportCodeCell } from './textNormalize'
import { yieldToMain } from './asyncChunk'

export type { SpreadsheetImportIssue as InitBalanceImportIssue }

export interface InitBalanceAccountLike {
  id: string
  name: string
  direction: string
  code?: string
}

export interface InitBalanceImportRow {
  rowIndex: number
  code: string
  name: string
  direction: string
  opening_debit: number
  opening_credit: number
  pre_book_debit: number
  pre_book_credit: number
  matched: boolean
  error?: string
  account_id?: string
}

const AMOUNT_KEYS = ['年初借方', '年初贷方', '帐前借方', '帐前贷方'] as const

export function buildInitBalanceNameMap<T extends InitBalanceAccountLike>(
  accounts: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const account of accounts) {
    const key = normalizeDuplicateKey(account.name || '')
    if (!key) continue
    const list = map.get(key) || []
    list.push(account)
    map.set(key, list)
  }
  return map
}

export function rowHasInitBalanceContent(row: Record<string, unknown>): boolean {
  const code = String(row['科目编码'] ?? '').trim()
  const name = String(row['科目名称'] ?? '').trim()
  if (code || name) return true
  for (const key of AMOUNT_KEYS) {
    const v = row[key]
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      const n = Number(v)
      if (!Number.isNaN(n) && Math.abs(n) > 0.000001) return true
    }
  }
  return false
}

export function validateInitBalanceTemplateHeaders(
  firstRow: Record<string, unknown> | undefined,
  isMidYear: boolean
): string | null {
  if (!firstRow) return null
  const keys = new Set(Object.keys(firstRow))
  if (!keys.has('科目编码') && !keys.has('科目名称')) {
    return '模板缺少「科目编码」或「科目名称」列，请使用系统提供的导入模板。'
  }
  if (!keys.has('年初借方') && !keys.has('年初贷方')) {
    return '模板缺少「年初借方」或「年初贷方」列，请使用系统提供的导入模板。'
  }
  if (isMidYear && !keys.has('帐前借方') && !keys.has('帐前贷方')) {
    return '当前为年中开账，模板建议包含「帐前借方」「帐前贷方」列。'
  }
  return null
}

export function describeInitBalanceRowIssue(row: InitBalanceImportRow): SpreadsheetImportIssue {
  const line = `第 ${row.rowIndex} 行`
  const err = row.error || '无法识别该行数据'

  if (err.includes('辅助核算')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：请使用辅助期初录入`,
      detail: `科目「${row.code} ${row.name}」已启用辅助核算，本页 Excel 不导入此类科目。请打开「辅助期初」页面录入。`,
    }
  }

  if (err.includes('匹配到多个科目')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：科目名称不唯一`,
      detail: err,
    }
  }

  if (err.includes('未找到科目名称')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：科目名称未匹配`,
      detail: err,
    }
  }

  if (err.includes('未找到') || err.includes('科目编码')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：科目未匹配`,
      detail:
        err.includes('未找到') && !err.includes('科目编码')
          ? err
          : `编码「${row.code || '（空）'}」在科目表中不存在。请核对编码是否与【会计科目】一致，或改用科目名称匹配。`,
    }
  }

  if (err.includes('年初借方与年初贷方')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：年初借贷不能同填`,
      detail: '年初借方与年初贷方不能同时有金额，请只保留与科目余额方向一致的一侧。',
    }
  }

  if (err.includes('科目编码或名称')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：缺少科目标识`,
      detail: '该行填写了金额但未填写科目编码或科目名称，请至少补充一项或删除该行。',
    }
  }

  return {
    rowIndex: row.rowIndex,
    title: `${line}：无法导入`,
    detail: err,
  }
}

export function collectInitBalanceImportIssues(
  rows: InitBalanceImportRow[]
): SpreadsheetImportIssue[] {
  return collectImportIssues(rows, describeInitBalanceRowIssue)
}

export { buildImportSummary as buildInitBalanceImportSummary }

function resolveInitBalanceAccount<T extends InitBalanceAccountLike>(
  code: string,
  rawName: string,
  codeMap: Map<string, T>,
  nameMap: Map<string, T[]>
): { account?: T; error?: string } {
  const name = normalizeImportCell(rawName)

  if (code) {
    const account = codeMap.get(code)
    if (!account) {
      return { error: `未找到科目编码「${code}」` }
    }
    return { account }
  }

  if (name) {
    const key = normalizeDuplicateKey(name)
    const matches = nameMap.get(key) || []
    if (matches.length === 1) {
      return { account: matches[0] }
    }
    if (matches.length > 1) {
      const codes = matches.map(a => a.code || a.id).join('、')
      return {
        error: `科目名称「${name}」匹配到多个科目（编码：${codes}），请补充科目编码以区分`,
      }
    }
    return { error: `未找到科目名称「${name}」` }
  }

  return { error: '请填写科目编码或科目名称至少一项' }
}

export function parseInitBalanceImportRows<T extends InitBalanceAccountLike>(
  rawData: Record<string, unknown>[],
  codeMap: Map<string, T>,
  nameMap: Map<string, T[]>,
  isAuxLeafAccount: (account: T) => boolean,
  isMidYear: boolean
): { rows: InitBalanceImportRow[]; blankSkipped: number; templateWarning: string | null } {
  let blankSkipped = 0
  const templateWarning = validateInitBalanceTemplateHeaders(rawData[0], isMidYear)
  const rows: InitBalanceImportRow[] = []

  rawData.forEach((row, index) => {
    if (!rowHasInitBalanceContent(row)) {
      blankSkipped++
      return
    }
    const rowIndex = index + 2
    const code = normalizeImportCodeCell(row['科目编码'])
    const rowName = normalizeImportCell(row['科目名称'])
    const resolved = resolveInitBalanceAccount(code, rowName, codeMap, nameMap)

    if (!resolved.account) {
      rows.push({
        rowIndex,
        code,
        name: rowName,
        direction: '',
        opening_debit: Number(row['年初借方']) || 0,
        opening_credit: Number(row['年初贷方']) || 0,
        pre_book_debit: Number(row['帐前借方']) || 0,
        pre_book_credit: Number(row['帐前贷方']) || 0,
        matched: false,
        error: resolved.error,
      })
      return
    }

    const account = resolved.account
    const displayCode = code || String(account.code || '').trim()
    const displayName = rowName || account.name

    if (isAuxLeafAccount(account)) {
      rows.push({
        rowIndex,
        code: displayCode,
        name: displayName,
        direction: account.direction || '',
        opening_debit: Number(row['年初借方']) || 0,
        opening_credit: Number(row['年初贷方']) || 0,
        pre_book_debit: Number(row['帐前借方']) || 0,
        pre_book_credit: Number(row['帐前贷方']) || 0,
        matched: false,
        error: '该科目已启用辅助核算，请使用辅助期初录入',
        account_id: account.id,
      })
      return
    }

    let opening_debit = Number(row['年初借方']) || 0
    let opening_credit = Number(row['年初贷方']) || 0
    let matched = true
    let error = ''

    if (opening_debit > 0.005 && opening_credit > 0.005) {
      matched = false
      error = '年初借方与年初贷方不能同时填写'
    }

    rows.push({
      rowIndex,
      code: displayCode,
      name: displayName,
      direction: account.direction || '',
      opening_debit,
      opening_credit,
      pre_book_debit: Number(row['帐前借方']) || 0,
      pre_book_credit: Number(row['帐前贷方']) || 0,
      matched,
      error: matched ? undefined : error,
      account_id: account.id,
    })
  })

  return { rows, blankSkipped, templateWarning }
}

/** 分块异步解析，大批量 Excel 不阻塞 UI */
export async function parseInitBalanceImportRowsAsync<T extends InitBalanceAccountLike>(
  rawData: Record<string, unknown>[],
  codeMap: Map<string, T>,
  nameMap: Map<string, T[]>,
  isAuxLeafAccount: (account: T) => boolean,
  isMidYear: boolean,
  options?: { chunkSize?: number; onProgress?: (pct: number) => void }
): Promise<{ rows: InitBalanceImportRow[]; blankSkipped: number; templateWarning: string | null }> {
  const chunkSize = options?.chunkSize ?? 2000
  const templateWarning = validateInitBalanceTemplateHeaders(rawData[0], isMidYear)
  const rows: InitBalanceImportRow[] = []
  let blankSkipped = 0
  const total = rawData.length

  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total)
    for (let index = start; index < end; index++) {
      const row = rawData[index]
      if (!rowHasInitBalanceContent(row)) {
        blankSkipped++
        continue
      }
      const rowIndex = index + 2
      const code = normalizeImportCodeCell(row['科目编码'])
      const rowName = normalizeImportCell(row['科目名称'])
      const resolved = resolveInitBalanceAccount(code, rowName, codeMap, nameMap)

      if (!resolved.account) {
        rows.push({
          rowIndex,
          code,
          name: rowName,
          direction: '',
          opening_debit: Number(row['年初借方']) || 0,
          opening_credit: Number(row['年初贷方']) || 0,
          pre_book_debit: Number(row['帐前借方']) || 0,
          pre_book_credit: Number(row['帐前贷方']) || 0,
          matched: false,
          error: resolved.error,
        })
        continue
      }

      const account = resolved.account
      const displayCode = code || String(account.code || '').trim()
      const displayName = rowName || account.name

      if (isAuxLeafAccount(account)) {
        rows.push({
          rowIndex,
          code: displayCode,
          name: displayName,
          direction: account.direction || '',
          opening_debit: Number(row['年初借方']) || 0,
          opening_credit: Number(row['年初贷方']) || 0,
          pre_book_debit: Number(row['帐前借方']) || 0,
          pre_book_credit: Number(row['帐前贷方']) || 0,
          matched: false,
          error: '该科目已启用辅助核算，请使用辅助期初录入',
          account_id: account.id,
        })
        continue
      }

      const opening_debit = Number(row['年初借方']) || 0
      const opening_credit = Number(row['年初贷方']) || 0
      let matched = true
      let error = ''
      if (opening_debit > 0.005 && opening_credit > 0.005) {
        matched = false
        error = '年初借方与年初贷方不能同时填写'
      }

      rows.push({
        rowIndex,
        code: displayCode,
        name: displayName,
        direction: account.direction || '',
        opening_debit,
        opening_credit,
        pre_book_debit: Number(row['帐前借方']) || 0,
        pre_book_credit: Number(row['帐前贷方']) || 0,
        matched,
        error: matched ? undefined : error,
        account_id: account.id,
      })
    }
    options?.onProgress?.(total > 0 ? Math.floor((end / total) * 100) : 100)
    await yieldToMain()
  }

  options?.onProgress?.(100)
  return { rows, blankSkipped, templateWarning }
}
