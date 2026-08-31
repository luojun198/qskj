import {
  buildImportSummary,
  collectImportIssues,
  type SpreadsheetImportIssue,
} from './spreadsheetImportReport'
import {
  namesMatchForImport,
  normalizeDuplicateKey,
  normalizeImportCell,
  normalizeImportCodeCell,
} from './textNormalize'
import { yieldToMain } from './asyncChunk'

export type { SpreadsheetImportIssue as AccountImportIssue }

export interface AccountImportRow {
  rowIndex: number
  code: string
  name: string
  direction: string
  parent_code: string
  is_cash: number
  is_bank: number
  aux_types: Record<string, any> | null
  aux_desc: string
  is_enabled: number
  matched: boolean
  error?: string
}

export interface AuxCategoryNameLike {
  id: string
  name: string
  default_item_id?: string | null
}

export interface AuxItemNameLike {
  id: string
  type: string
  name: string
}

export function rowHasAccountImportContent(row: Record<string, unknown>): boolean {
  const keys = ['科目编码', '科目名称', '余额方向', '上级科目编码', '现金', '银行', '状态']
  for (const key of keys) {
    if (String(row[key] ?? '').trim()) return true
  }
  for (const k of Object.keys(row)) {
    if (k.startsWith('辅助-') || k.startsWith('默认项目-')) {
      if (String(row[k] ?? '').trim()) return true
    }
  }
  return false
}

export function validateAccountImportTemplateHeaders(
  firstRow: Record<string, unknown> | undefined
): string | null {
  if (!firstRow) return null
  const keys = new Set(Object.keys(firstRow))
  const missing: string[] = []
  if (!keys.has('科目编码')) missing.push('「科目编码」')
  if (!keys.has('科目名称')) missing.push('「科目名称」')
  if (!keys.has('余额方向')) missing.push('「余额方向」')
  if (missing.length > 0) {
    return `模板缺少必填列：${missing.join('、')}。请下载系统模板后填写。`
  }
  return null
}

export function describeAccountRowIssue(row: AccountImportRow): SpreadsheetImportIssue {
  const line = `第 ${row.rowIndex} 行`
  const err = row.error || '无法识别该行数据'

  if (err.includes('编码不能为空')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：缺少科目编码`,
      detail: '科目编码为必填项，请填写后再导入。',
    }
  }
  if (err.includes('名称不能为空')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：缺少科目名称`,
      detail: '科目名称为必填项，请填写后再导入。',
    }
  }
  if (err.includes('余额方向')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：余额方向不正确`,
      detail: '余额方向请填写「借方」或「贷方」。',
    }
  }
  if (err.includes('已存在')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：科目编码重复`,
      detail: `编码「${row.code}」在账套中已存在，或在本文件中重复出现。请修改编码或删除重复行。`,
    }
  }
  if (err.includes('上级科目')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：上级科目未找到`,
      detail: `上级编码「${row.parent_code}」在现有科目或本文件已导入行中不存在。请先维护上级科目，或调整导入顺序。`,
    }
  }
  if (err.includes('默认项目')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：默认核算项目未匹配`,
      detail: err,
    }
  }

  return {
    rowIndex: row.rowIndex,
    title: `${line}：无法导入`,
    detail: err,
  }
}

export function collectAccountImportIssues(rows: AccountImportRow[]): SpreadsheetImportIssue[] {
  return collectImportIssues(rows, describeAccountRowIssue)
}

export { buildImportSummary as buildAccountImportSummary }

export type AccountImportContext = {
  existingCodes: Set<string>
  existingCodeToId: Map<string, string>
  auxCategories: AuxCategoryNameLike[]
  auxItemByCatAndName?: Map<string, Map<string, { id: string; name: string }>>
  auxItems?: AuxItemNameLike[]
  parseAuxCols: (row: Record<string, unknown>) => Record<string, any> | null
  buildAuxDesc: (row: Record<string, unknown>) => string
}

function resolveDefaultAuxItem(
  ctx: AccountImportContext,
  catId: string,
  defaultName: string
): AuxItemNameLike | undefined {
  const key = normalizeDuplicateKey(defaultName)
  const fromIndex = ctx.auxItemByCatAndName?.get(catId)?.get(key)
  if (fromIndex) return { id: fromIndex.id, type: catId, name: fromIndex.name }
  if (ctx.auxItems) {
    return ctx.auxItems.find(i => i.type === catId && namesMatchForImport(i.name, defaultName))
  }
  return undefined
}

function parseAccountImportRow(
  row: Record<string, unknown>,
  index: number,
  ctx: AccountImportContext,
  batchCodes: Map<string, number>
): AccountImportRow | null {
  if (!rowHasAccountImportContent(row)) return null
  const rowIndex = index + 2
  const code = normalizeImportCodeCell(row['科目编码'])
  const name = normalizeImportCell(row['科目名称'])
  const directionStr = String(row['余额方向'] || '').trim()
  const parentCode = normalizeImportCodeCell(row['上级科目编码'])
  const isCash = String(row['现金'] || '').trim() === '是' ? 1 : 0
  const isBank = String(row['银行'] || '').trim() === '是' ? 1 : 0
  const statusStr = String(row['状态'] || '').trim()
  const isEnabled = statusStr === '禁用' ? 0 : 1
  const auxTypes = ctx.parseAuxCols(row)
  const auxDesc = ctx.buildAuxDesc(row)

  let matched = true
  let error = ''

  if (!code) {
    matched = false
    error = '科目编码不能为空'
  } else if (!name) {
    matched = false
    error = '科目名称不能为空'
  } else if (directionStr !== '借方' && directionStr !== '贷方') {
    matched = false
    error = '余额方向请填写「借方」或「贷方」'
  } else if (ctx.existingCodes.has(code)) {
    matched = false
    error = `科目编码「${code}」在账套中已存在`
  } else if (batchCodes.has(code)) {
    matched = false
    error = `科目编码「${code}」在本文件中重复（首次出现在第 ${batchCodes.get(code)} 行）`
  } else if (parentCode) {
    const parentKnown = ctx.existingCodeToId.has(parentCode) || batchCodes.has(parentCode)
    if (!parentKnown) {
      matched = false
      error = `未找到上级科目编码「${parentCode}」`
    }
  }

  if (matched) {
    for (const cat of ctx.auxCategories) {
      const auxKey = `辅助-${cat.name}`
      const defaultKey = `默认项目-${cat.name}`
      const enabled = String(row[auxKey] || '').trim()
      if (enabled === '是' || enabled === '1' || enabled === 'true') {
        const defaultName = normalizeImportCell(row[defaultKey])
        if (defaultName) {
          const item = resolveDefaultAuxItem(ctx, cat.id, defaultName)
          if (!item) {
            matched = false
            error = `类别「${cat.name}」的默认项目「${defaultName}」未在核算项目中找到`
            break
          }
        }
      }
    }
  }

  const direction = directionStr === '贷方' ? 'credit' : 'debit'
  const result: AccountImportRow = {
    rowIndex,
    code,
    name,
    direction,
    parent_code: parentCode,
    is_cash: isCash,
    is_bank: isBank,
    aux_types: auxTypes,
    aux_desc: auxDesc,
    is_enabled: isEnabled,
    matched,
    error: matched ? undefined : error,
  }

  if (matched && code) {
    batchCodes.set(code, rowIndex)
    ctx.existingCodeToId.set(code, `import-${rowIndex}`)
  }
  return result
}

export function parseAccountImportRows(
  rawData: Record<string, unknown>[],
  ctx: AccountImportContext
): { rows: AccountImportRow[]; blankSkipped: number; templateWarning: string | null } {
  let blankSkipped = 0
  const templateWarning = validateAccountImportTemplateHeaders(rawData[0])
  const rows: AccountImportRow[] = []
  const batchCodes = new Map<string, number>()

  rawData.forEach((row, index) => {
    const parsed = parseAccountImportRow(row, index, ctx, batchCodes)
    if (!parsed) {
      blankSkipped++
      return
    }
    rows.push(parsed)
  })

  return { rows, blankSkipped, templateWarning }
}

/** 分块异步解析，十万级 Excel 不阻塞 UI */
export async function parseAccountImportRowsAsync(
  rawData: Record<string, unknown>[],
  ctx: AccountImportContext,
  options?: { chunkSize?: number; onProgress?: (pct: number) => void }
): Promise<{ rows: AccountImportRow[]; blankSkipped: number; templateWarning: string | null }> {
  const chunkSize = options?.chunkSize ?? 2000
  const templateWarning = validateAccountImportTemplateHeaders(rawData[0])
  const rows: AccountImportRow[] = []
  const batchCodes = new Map<string, number>()
  let blankSkipped = 0
  const total = rawData.length

  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total)
    for (let index = start; index < end; index++) {
      const parsed = parseAccountImportRow(rawData[index], index, ctx, batchCodes)
      if (!parsed) blankSkipped++
      else rows.push(parsed)
    }
    options?.onProgress?.(total > 0 ? Math.floor((end / total) * 100) : 100)
    await yieldToMain()
  }

  options?.onProgress?.(100)
  return { rows, blankSkipped, templateWarning }
}
