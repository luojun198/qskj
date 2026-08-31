import {
  buildImportSummary,
  collectImportIssues,
  type SpreadsheetImportIssue,
} from './spreadsheetImportReport'
import { normalizeDuplicateKey, normalizeImportCell, normalizeImportCodeCell } from './textNormalize'
import { normalizeImportCode } from './textNormalize'
import { yieldToMain } from './asyncChunk'

export type { SpreadsheetImportIssue as ProjectImportIssue }

export interface ProjectImportRow {
  rowIndex: number
  code: string
  name: string
  status: string
  remark: string
  field_values: Record<string, string>
  matched: boolean
  error?: string
}

export function rowHasProjectImportContent(row: Record<string, unknown>): boolean {
  return !!String(row['名称'] ?? '').trim() || !!String(row['编码'] ?? '').trim()
}

export function describeProjectRowIssue(row: ProjectImportRow): SpreadsheetImportIssue {
  const line = `第 ${row.rowIndex} 行`
  const err = row.error || '无法识别该行数据'

  if (err.includes('名称不能为空')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：缺少项目名称`,
      detail: '项目名称为必填项。编码可留空由系统自动生成。',
    }
  }
  if (err.includes('与现有项目重复')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：与已有项目重名`,
      detail: `名称「${row.name}」在当前类别下已存在，请修改名称或先在系统中处理重复项。`,
    }
  }
  if (err.includes('与本文件中')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：文件内项目名称重复`,
      detail: err.replace('与第', '与 Excel 第').replace('行重复', '行的名称重复'),
    }
  }

  return {
    rowIndex: row.rowIndex,
    title: `${line}：无法导入`,
    detail: err,
  }
}

export function collectProjectImportIssues(rows: ProjectImportRow[]): SpreadsheetImportIssue[] {
  return collectImportIssues(rows, describeProjectRowIssue)
}

export { buildImportSummary as buildProjectImportSummary }

export interface ProjectCustomFieldLike {
  field_key: string
  field_name: string
}

export interface ParseProjectImportOptions {
  customFields: ProjectCustomFieldLike[]
  maxCode: number
  normalizeDirection?: (field: ProjectCustomFieldLike, raw: string) => string
}

function parseProjectDraftRow(
  row: Record<string, unknown>,
  index: number,
  customFields: ProjectCustomFieldLike[],
  normalizeDirection?: (field: ProjectCustomFieldLike, raw: string) => string
): { draft: Omit<ProjectImportRow, 'matched' | 'error'> | null; blank: boolean } {
  const name = normalizeImportCell(row['名称'])
  const code = normalizeImportCodeCell(row['编码'])
  if (!name && !code) return { draft: null, blank: true }
  const statusStr = String(row['状态'] || '').trim()
  const status = statusStr === '已完结' || statusStr === 'closed' ? 'closed' : 'active'
  const remark = normalizeImportCell(row['备注'])
  const field_values: Record<string, string> = {}
  for (const field of customFields) {
    const val = String(row[field.field_name] ?? '').trim()
    if (val) {
      field_values[field.field_key] = normalizeDirection
        ? normalizeDirection(field, val)
        : val
    }
  }
  return {
    draft: {
      rowIndex: index + 2,
      code,
      name,
      status,
      remark,
      field_values,
    },
    blank: false,
  }
}

export function parseProjectImportRows(
  rawData: Record<string, unknown>[],
  options: ParseProjectImportOptions
): { rows: ProjectImportRow[]; blankSkipped: number } {
  const seenNames = new Map<string, number>()
  let blankSkipped = 0
  const draftRows: Array<Omit<ProjectImportRow, 'matched' | 'error'>> = []

  rawData.forEach((row, index) => {
    const { draft, blank } = parseProjectDraftRow(
      row,
      index,
      options.customFields,
      options.normalizeDirection
    )
    if (blank) {
      blankSkipped++
      return
    }
    draftRows.push(draft!)
  })

  const rows: ProjectImportRow[] = []
  for (const item of draftRows) {
    let matched = true
    let error = ''
    if (!item.name) {
      matched = false
      error = '项目名称不能为空'
    } else {
      const normalizedName = normalizeDuplicateKey(item.name)
      if (seenNames.has(normalizedName)) {
        matched = false
        error = `与本文件中第 ${seenNames.get(normalizedName)} 行重复`
      } else {
        seenNames.set(normalizedName, item.rowIndex)
      }
    }
    rows.push({ ...item, matched, error: matched ? undefined : error })
  }

  let codeCounter = options.maxCode + 1
  const finalized = rows.map(item => {
    if (!item.matched) return item
    const finalCode = normalizeImportCode(item.code || String(codeCounter++).padStart(6, '0'))
    return { ...item, code: finalCode }
  })

  return { rows: finalized, blankSkipped }
}

/** 分块异步解析，大批量 Excel 不阻塞 UI */
export async function parseProjectImportRowsAsync(
  rawData: Record<string, unknown>[],
  options: ParseProjectImportOptions & { chunkSize?: number; onProgress?: (pct: number) => void }
): Promise<{ rows: ProjectImportRow[]; blankSkipped: number }> {
  const chunkSize = options.chunkSize ?? 2000
  const seenNames = new Map<string, number>()
  let blankSkipped = 0
  const draftRows: Array<Omit<ProjectImportRow, 'matched' | 'error'>> = []
  const total = rawData.length

  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total)
    for (let index = start; index < end; index++) {
      const { draft, blank } = parseProjectDraftRow(
        rawData[index],
        index,
        options.customFields,
        options.normalizeDirection
      )
      if (blank) blankSkipped++
      else draftRows.push(draft!)
    }
    options.onProgress?.(total > 0 ? Math.floor((end / total) * 50) : 50)
    await yieldToMain()
  }

  const rows: ProjectImportRow[] = []
  for (const item of draftRows) {
    let matched = true
    let error = ''
    if (!item.name) {
      matched = false
      error = '项目名称不能为空'
    } else {
      const normalizedName = normalizeDuplicateKey(item.name)
      if (seenNames.has(normalizedName)) {
        matched = false
        error = `与本文件中第 ${seenNames.get(normalizedName)} 行重复`
      } else {
        seenNames.set(normalizedName, item.rowIndex)
      }
    }
    rows.push({ ...item, matched, error: matched ? undefined : error })
  }

  let codeCounter = options.maxCode + 1
  const finalized = rows.map(item => {
    if (!item.matched) return item
    const finalCode = normalizeImportCode(item.code || String(codeCounter++).padStart(6, '0'))
    return { ...item, code: finalCode }
  })

  options.onProgress?.(100)
  return { rows: finalized, blankSkipped }
}

export interface ProjectGapWarning {
  type: 'gap'
  message: string
  gaps: string[]
  suggestion: string
}

export function detectProjectCodeGaps(
  parsed: Array<{ code: string }>
): ProjectGapWarning | null {
  const userProvidedCodes = parsed
    .filter(item => item.code)
    .map(item => Number.parseInt(item.code, 10))
    .filter(code => !Number.isNaN(code))
    .sort((a, b) => a - b)

  if (userProvidedCodes.length <= 1) return null

  const gaps: string[] = []
  for (let i = 1; i < userProvidedCodes.length; i++) {
    const prev = userProvidedCodes[i - 1]
    const curr = userProvidedCodes[i]
    if (curr - prev > 1) {
      gaps.push(`${prev} → ${curr}（缺少 ${curr - prev - 1} 个编号）`)
    }
  }

  if (gaps.length === 0) return null

  return {
    type: 'gap',
    message: '检测到编号不连续',
    gaps,
    suggestion:
      '建议：1) 在 Excel 中补充缺失的编号行；2) 或删除「编码」列让系统自动生成连续编号',
  }
}
