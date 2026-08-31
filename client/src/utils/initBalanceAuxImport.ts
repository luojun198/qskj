import { buildImportSummary } from './spreadsheetImportReport'
import {
  buildAuxItemLookupIndex,
  lookupAuxItemIndexed,
  type AuxItemLookupIndex,
} from './initBalanceAuxItems'
import { normalizeOpeningDebitCredit } from './initBalanceOpening'
import { normalizeDuplicateKey, normalizeImportCell, normalizeImportCodeCell } from './textNormalize'
import { buildSingleCategoryAuxItemId } from './auxItemId'
import { sumCategoryTotals } from './initBalanceAuxTabRows'
import type { AuxGridRow } from './initBalanceAuxGrid'
import { yieldToMain } from './asyncChunk'
import {
  checkAuxCategoryAmountConsistency,
  type AuxCategoryConsistencyResult,
} from './initBalanceAuxCategoryConsistency'

export type { AuxCategoryConsistencyResult }

export interface AuxCategoryMetaLike {
  id: string
  code: string
  name: string
}

export interface AuxImportItemLike {
  id: string
  code?: string
  name?: string
}

export type AuxImportMatchStatus = 'ready' | 'missing_item' | 'ambiguous' | 'error'

export interface AuxImportPreviewRowLike {
  rowIndex: number
  selection: Record<string, string>
  selection_labels: Record<string, string>
  opening_debit: number
  opening_credit: number
  pre_book_debit: number
  pre_book_credit: number
  matched: boolean
  matchStatus?: AuxImportMatchStatus
  pendingCreate?: { categoryId: string; categoryName: string; name: string }
  error?: string
}

export interface AuxImportIssue {
  rowIndex: number
  title: string
  detail: string
}

export interface AuxImportPrecheckSummary {
  readyCount: number
  missingItemCount: number
  missingItems: Array<{
    categoryId: string
    categoryName: string
    name: string
    rowCount: number
  }>
  ambiguousCount: number
  otherIssueCount: number
}

export interface MissingAuxItemDraft {
  categoryId: string
  name: string
  code: string
  status: string
  remark: string
  field_values: Record<string, string>
}

const AMOUNT_KEYS = ['年初借方', '年初贷方', '帐前借方', '帐前贷方'] as const

export function categoryCodeColumn(cat: AuxCategoryMetaLike) {
  return `${cat.name}编码`
}

export function categoryNameColumn(cat: AuxCategoryMetaLike) {
  return `${cat.name}名称`
}

/** 模板表头是否包含当前科目启用的辅助列 */
export function validateAuxImportTemplateHeaders(
  firstRow: Record<string, unknown> | undefined,
  categories: AuxCategoryMetaLike[]
): string | null {
  if (!firstRow || categories.length === 0) return null
  const keys = new Set(Object.keys(firstRow))
  const missing: string[] = []
  for (const cat of categories) {
    const codeKey = categoryCodeColumn(cat)
    if (!keys.has(codeKey) && !keys.has(categoryNameColumn(cat))) {
      missing.push(`「${cat.name}编码」或「${cat.name}名称」`)
    }
  }
  if (missing.length > 0) {
    return `模板缺少辅助类别列：${missing.join('、')}。请重新下载模板后再填写。`
  }
  if (!keys.has('年初借方') && !keys.has('年初贷方')) {
    return '模板缺少「年初借方」或「年初贷方」列，请使用系统提供的导入模板。'
  }
  return null
}

/** 该行是否在 Excel 中有实质内容（非空行） */
export function rowHasImportContent(
  row: Record<string, unknown>,
  categories: AuxCategoryMetaLike[]
): boolean {
  for (const cat of categories) {
    const code = String(row[categoryCodeColumn(cat)] ?? '').trim()
    const name = String(row[categoryNameColumn(cat)] ?? '').trim()
    if (code || name) return true
  }
  for (const key of AMOUNT_KEYS) {
    const v = row[key]
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      const n = Number(v)
      if (!Number.isNaN(n) && Math.abs(n) > 0.000001) return true
    }
  }
  return false
}

export function buildAuxImportPrecheck(
  rows: AuxImportPreviewRowLike[]
): AuxImportPrecheckSummary {
  const missingMap = new Map<
    string,
    { categoryId: string; categoryName: string; name: string; rowCount: number }
  >()
  let readyCount = 0
  let missingItemCount = 0
  let ambiguousCount = 0
  let otherIssueCount = 0

  for (const row of rows) {
    if (row.matched || row.matchStatus === 'ready') {
      readyCount++
      continue
    }
    if (row.matchStatus === 'missing_item' && row.pendingCreate) {
      missingItemCount++
      const key = `${row.pendingCreate.categoryId}::${normalizeDuplicateKey(row.pendingCreate.name)}`
      const existing = missingMap.get(key)
      if (existing) {
        existing.rowCount++
      } else {
        missingMap.set(key, {
          categoryId: row.pendingCreate.categoryId,
          categoryName: row.pendingCreate.categoryName,
          name: row.pendingCreate.name,
          rowCount: 1,
        })
      }
      continue
    }
    if (row.matchStatus === 'ambiguous') {
      ambiguousCount++
      continue
    }
    otherIssueCount++
  }

  return {
    readyCount,
    missingItemCount,
    missingItems: [...missingMap.values()].sort((a, b) =>
      a.categoryName.localeCompare(b.categoryName, 'zh-CN')
    ),
    ambiguousCount,
    otherIssueCount,
  }
}

/** 为联动创建生成待导入核算项目（编码规则与核算项目页一致） */
export function buildMissingAuxItemDrafts(
  missingItems: Array<{ categoryId: string; name: string }>,
  itemsByCategory: Record<string, AuxImportItemLike[]>
): MissingAuxItemDraft[] {
  const grouped = new Map<string, Set<string>>()
  for (const item of missingItems) {
    const name = normalizeImportCell(item.name)
    if (!name) continue
    const key = normalizeDuplicateKey(name)
    const set = grouped.get(item.categoryId) || new Set<string>()
    if (!set.has(key)) {
      set.add(key)
    }
    grouped.set(item.categoryId, set)
  }

  const drafts: MissingAuxItemDraft[] = []
  for (const [categoryId, nameKeys] of grouped) {
    const existing = itemsByCategory[categoryId] || []
    let maxCode = existing.reduce((max, item) => {
      const codeNum = Number.parseInt(String(item.code || ''), 10)
      return Number.isNaN(codeNum) ? max : Math.max(max, codeNum)
    }, 0)
    let counter = maxCode + 1

    for (const nameKey of nameKeys) {
      const source = missingItems.find(
        m =>
          m.categoryId === categoryId && normalizeDuplicateKey(normalizeImportCell(m.name)) === nameKey
      )
      const name = normalizeImportCell(source?.name || '')
      if (!name) continue
      drafts.push({
        categoryId,
        name,
        code: String(counter++).padStart(6, '0'),
        status: 'active',
        remark: '',
        field_values: {},
      })
    }
  }
  return drafts
}

function buildCategoryLookupIndexes(
  categories: AuxCategoryMetaLike[],
  itemsByCategory: Record<string, AuxImportItemLike[]>
): Map<string, AuxItemLookupIndex> {
  const indexes = new Map<string, AuxItemLookupIndex>()
  for (const cat of categories) {
    indexes.set(cat.id, buildAuxItemLookupIndex(itemsByCategory[cat.id] || []))
  }
  return indexes
}

function parseAuxImportRow(
  row: Record<string, unknown>,
  index: number,
  categories: AuxCategoryMetaLike[],
  categoryIndexes: Map<string, AuxItemLookupIndex>,
  allowPendingCreate: boolean
): { row: AuxImportPreviewRowLike; blank: boolean } {
  if (!rowHasImportContent(row, categories)) {
    return {
      row: {
        rowIndex: index + 2,
        selection: {},
        selection_labels: {},
        opening_debit: 0,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: false,
      },
      blank: true,
    }
  }

  const selection: Record<string, string> = {}
  const selection_labels: Record<string, string> = {}
  let matched = true
  let matchStatus: AuxImportMatchStatus = 'ready'
  let error = ''
  let pendingCreate: AuxImportPreviewRowLike['pendingCreate']

  const filledCats: AuxCategoryMetaLike[] = []
  for (const cat of categories) {
    const codeKey = categoryCodeColumn(cat)
    const nameKey = categoryNameColumn(cat)
    const code = normalizeImportCodeCell(row[codeKey])
    const name = normalizeImportCell(row[nameKey])
    if (!code && !name) continue

    const lookup = lookupAuxItemIndexed(categoryIndexes.get(cat.id)!, code, name)
    if (lookup.status === 'found' || lookup.status === 'name_mismatch') {
      const item = lookup.item
      selection[cat.id] = item.id
      selection_labels[cat.id] = `${cat.name}:${item.name}`
      filledCats.push(cat)
      continue
    }

    if (lookup.status === 'ambiguous') {
      matched = false
      matchStatus = 'ambiguous'
      error = `「${cat.name}」下名称/编码匹配到多个项目，请补充编码以区分`
      break
    }

    if (!code && name && allowPendingCreate) {
      matched = false
      matchStatus = 'missing_item'
      pendingCreate = { categoryId: cat.id, categoryName: cat.name, name }
      error = `核算项目「${name}」尚未建立，可勾选联动创建后导入`
      filledCats.push(cat)
      break
    }

    matched = false
    matchStatus = 'error'
    error =
      code && name
        ? `未找到${cat.name}：编码「${code}」与名称「${name}」均无法匹配`
        : code
          ? `未找到${cat.name}编码「${code}」`
          : `未找到${cat.name}名称「${name}」`
    break
  }

  if (matched && filledCats.length === 0) {
    matched = false
    matchStatus = 'error'
    error = '请至少填写一个辅助类目的项目编码或名称'
  }
  if (matched && filledCats.length > 1) {
    matched = false
    matchStatus = 'error'
    error = '同一行只能填写一个辅助类目（请分 sheet 或分行按类目导入）'
  }

  let opening_debit = Number(row['年初借方']) || 0
  let opening_credit = Number(row['年初贷方']) || 0
  const pre_book_debit = Number(row['帐前借方']) || 0
  const pre_book_credit = Number(row['帐前贷方']) || 0

  if (matched && opening_debit > 0.005 && opening_credit > 0.005) {
    matched = false
    matchStatus = 'error'
    error = '年初借方与年初贷方不能同时填写'
  }

  if (matched) {
    const opening = normalizeOpeningDebitCredit(opening_debit, opening_credit)
    opening_debit = opening.opening_debit
    opening_credit = opening.opening_credit
  }

  const allZero =
    opening_debit === 0 &&
    opening_credit === 0 &&
    pre_book_debit === 0 &&
    pre_book_credit === 0

  if (matched && allZero) {
    matched = false
    matchStatus = 'error'
    error = '金额不能全为 0'
  }

  return {
    blank: false,
    row: {
      rowIndex: index + 2,
      selection,
      selection_labels,
      opening_debit,
      opening_credit,
      pre_book_debit,
      pre_book_credit,
      matched,
      matchStatus: matched ? 'ready' : matchStatus,
      pendingCreate,
      error: matched ? undefined : error,
    },
  }
}

export function parseAuxImportRows(
  rawData: Record<string, unknown>[],
  categories: AuxCategoryMetaLike[],
  itemsByCategory: Record<string, AuxImportItemLike[]>,
  options?: { allowPendingCreate?: boolean }
): { rows: AuxImportPreviewRowLike[]; blankSkipped: number } {
  const allowPendingCreate = options?.allowPendingCreate ?? false
  const categoryIndexes = buildCategoryLookupIndexes(categories, itemsByCategory)
  const results: AuxImportPreviewRowLike[] = []
  let blankSkipped = 0

  rawData.forEach((row, index) => {
    const parsed = parseAuxImportRow(row, index, categories, categoryIndexes, allowPendingCreate)
    if (parsed.blank) {
      blankSkipped++
      return
    }
    results.push(parsed.row)
  })

  return { rows: results, blankSkipped }
}

/** 分块异步解析，十万级 Excel 不阻塞 UI */
export async function parseAuxImportRowsAsync(
  rawData: Record<string, unknown>[],
  categories: AuxCategoryMetaLike[],
  itemsByCategory: Record<string, AuxImportItemLike[]>,
  options?: {
    allowPendingCreate?: boolean
    chunkSize?: number
    onProgress?: (percent: number) => void
  }
): Promise<{ rows: AuxImportPreviewRowLike[]; blankSkipped: number }> {
  const allowPendingCreate = options?.allowPendingCreate ?? false
  const chunkSize = options?.chunkSize ?? 2000
  const categoryIndexes = buildCategoryLookupIndexes(categories, itemsByCategory)
  const results: AuxImportPreviewRowLike[] = []
  let blankSkipped = 0
  const total = rawData.length

  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total)
    for (let index = start; index < end; index++) {
      const parsed = parseAuxImportRow(
        rawData[index],
        index,
        categories,
        categoryIndexes,
        allowPendingCreate
      )
      if (parsed.blank) {
        blankSkipped++
      } else {
        results.push(parsed.row)
      }
    }
    options?.onProgress?.(total > 0 ? Math.floor((end / total) * 100) : 100)
    await yieldToMain()
  }

  options?.onProgress?.(100)
  return { rows: results, blankSkipped }
}

export function describeAuxImportRowIssue(
  row: AuxImportPreviewRowLike,
  categories: AuxCategoryMetaLike[]
): AuxImportIssue {
  const line = `第 ${row.rowIndex} 行`
  const err = row.error || '无法识别该行数据'

  if (row.matchStatus === 'missing_item' && row.pendingCreate) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：核算项目待创建`,
      detail: `「${row.pendingCreate.categoryName}」下尚无「${row.pendingCreate.name}」。可勾选「联动创建缺失核算项目」后一并导入，或先在【核算项目】中维护。`,
    }
  }

  if (row.matchStatus === 'ambiguous') {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：辅助项目不唯一`,
      detail: err,
    }
  }

  if (err.includes('未找到')) {
    const catMatch = categories.find(c => err.includes(c.name))
    const catLabel = catMatch?.name || '辅助类别'
    const quoted = [...err.matchAll(/「([^」]+)」/g)].map(m => m[1])
    if (err.includes('均无法匹配') && quoted.length >= 2) {
      return {
        rowIndex: row.rowIndex,
        title: `${line}：${catLabel}项目未匹配`,
        detail: `在「${catLabel}」下，编码「${quoted[0]}」与名称「${quoted[1]}」都无法对应到已有核算项目。请核对编码、名称是否与系统中一致。`,
      }
    }
    if (err.includes('名称')) {
      const name = quoted[0] || ''
      return {
        rowIndex: row.rowIndex,
        title: `${line}：${catLabel}项目名称未匹配`,
        detail: `在「${catLabel}」下找不到名称为「${name}」的项目。请确认该名称已在核算项目中维护，或启用联动创建。`,
      }
    }
    const code = quoted[0] || ''
    return {
      rowIndex: row.rowIndex,
      title: `${line}：${catLabel}项目未匹配`,
      detail: `在「${catLabel}」下找不到编码为「${code}」的核算项目。请确认该编码已在【核算项目】中维护，且属于当前科目启用的辅助类别。`,
    }
  }

  if (err.includes('至少填写一个')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：未选择辅助项目`,
      detail:
        '这一行填写了金额，但没有填写任何辅助类别的项目编码或名称。请至少填写一个类别下的编码（或名称），再填写年初借贷金额。',
    }
  }

  if (err.includes('同一行只能填写一个')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：辅助类别填写过多`,
      detail:
        '同一行只能对应一个辅助类别的项目。若多个类别都有期初，请分成多行录入，或为每个类别单独使用一个工作表导入。',
    }
  }

  if (err.includes('年初借方与年初贷方')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：年初借贷不能同填`,
      detail: '年初借方与年初贷方不能同时有金额，请只保留与科目方向一致的一侧。',
    }
  }

  if (err.includes('金额不能全为 0')) {
    return {
      rowIndex: row.rowIndex,
      title: `${line}：金额为空`,
      detail: '已识别到辅助项目，但年初借方、年初贷方及帐前借贷均为零。请填写有效金额，或删除该行。',
    }
  }

  return {
    rowIndex: row.rowIndex,
    title: `${line}：无法导入`,
    detail: err,
  }
}

export function collectAuxImportIssues(
  rows: AuxImportPreviewRowLike[],
  categories: AuxCategoryMetaLike[]
): AuxImportIssue[] {
  return rows
    .filter(r => !r.matched && r.matchStatus !== 'missing_item')
    .map(r => describeAuxImportRowIssue(r, categories))
    .sort((a, b) => a.rowIndex - b.rowIndex)
}

/** 异常行分组键（相同原因合并展示，避免十万行逐条生成说明） */
export function buildAuxImportIssueGroupKey(row: AuxImportPreviewRowLike): string {
  return `${row.matchStatus ?? 'error'}::${row.error ?? ''}`
}

function aggregateAuxImportIssueTitle(
  described: AuxImportIssue,
  rowIndices: number[],
  count: number
): string {
  if (count <= 1) return described.title
  const min = rowIndices[0]
  const max = rowIndices[rowIndices.length - 1]
  const suffix = described.title.includes('：')
    ? described.title.split('：').slice(1).join('：')
    : described.title
  return `第 ${min}-${max} 行（共 ${count} 行）：${suffix}`
}

function issuesFromAuxImportGroups(
  groups: Map<string, { rowIndices: number[]; sample: AuxImportPreviewRowLike }>,
  categories: AuxCategoryMetaLike[],
  maxGroups: number
): AuxImportIssue[] {
  const totalIssueRows = [...groups.values()].reduce((sum, g) => sum + g.rowIndices.length, 0)
  if (totalIssueRows === 0) return []

  const sorted = [...groups.entries()]
    .sort((a, b) => b[1].rowIndices.length - a[1].rowIndices.length)
    .slice(0, maxGroups)

  const issues: AuxImportIssue[] = []
  if (groups.size > maxGroups) {
    issues.push({
      rowIndex: 0,
      title: '异常汇总',
      detail: `共有 ${totalIssueRows} 行未能导入，分为 ${groups.size} 类问题。以下按影响行数列出前 ${maxGroups} 类，请按说明修正模板后重新导入。`,
    })
  }

  for (const [, group] of sorted) {
    group.rowIndices.sort((a, b) => a - b)
    const described = describeAuxImportRowIssue(group.sample, categories)
    issues.push({
      rowIndex: group.rowIndices[0],
      title: aggregateAuxImportIssueTitle(described, group.rowIndices, group.rowIndices.length),
      detail: described.detail,
    })
  }

  return issues.sort((a, b) => a.rowIndex - b.rowIndex)
}

/** 将同类异常合并为汇总条目（同步版，适合小数据量或单元测试） */
export function aggregateAuxImportIssues(
  rows: AuxImportPreviewRowLike[],
  categories: AuxCategoryMetaLike[],
  options?: { maxGroups?: number }
): AuxImportIssue[] {
  const maxGroups = options?.maxGroups ?? 100
  const groups = new Map<string, { rowIndices: number[]; sample: AuxImportPreviewRowLike }>()

  for (const row of rows) {
    if (row.matched || row.matchStatus === 'missing_item') continue
    const key = buildAuxImportIssueGroupKey(row)
    let group = groups.get(key)
    if (!group) {
      group = { rowIndices: [], sample: row }
      groups.set(key, group)
    }
    group.rowIndices.push(row.rowIndex)
  }

  return issuesFromAuxImportGroups(groups, categories, maxGroups)
}

/** 分块汇总异常说明，避免大批量导入时阻塞主线程 */
export async function aggregateAuxImportIssuesAsync(
  rows: AuxImportPreviewRowLike[],
  categories: AuxCategoryMetaLike[],
  options?: {
    maxGroups?: number
    yieldEvery?: number
    onProgress?: (pct: number) => void
  }
): Promise<AuxImportIssue[]> {
  const maxGroups = options?.maxGroups ?? 100
  const yieldEvery = options?.yieldEvery ?? 5000
  const groups = new Map<string, { rowIndices: number[]; sample: AuxImportPreviewRowLike }>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.matched || row.matchStatus === 'missing_item') continue
    const key = buildAuxImportIssueGroupKey(row)
    let group = groups.get(key)
    if (!group) {
      group = { rowIndices: [], sample: row }
      groups.set(key, group)
    }
    group.rowIndices.push(row.rowIndex)

    if (i > 0 && i % yieldEvery === 0) {
      options?.onProgress?.(Math.min(85, Math.floor((i / rows.length) * 85)))
      await yieldToMain()
    }
  }

  options?.onProgress?.(90)
  await yieldToMain()
  const result = issuesFromAuxImportGroups(groups, categories, maxGroups)
  options?.onProgress?.(100)
  return result
}

export function countAuxImportImportable(
  rows: AuxImportPreviewRowLike[],
  autoCreateMissing: boolean
): number {
  return rows.filter(
    r => r.matched || (autoCreateMissing && r.matchStatus === 'missing_item')
  ).length
}

/** 将可匹配的导入行合并进 store（与 applyImportPreview 同键规则） */
export function mergeImportRowsIntoStore(
  existingStore: Map<string, AuxGridRow>,
  importRows: AuxImportPreviewRowLike[],
  codeByCategoryId: Record<string, string>
): Map<string, AuxGridRow> {
  const store = new Map(existingStore)
  for (const row of importRows) {
    if (!row.matched) continue
    const catId = Object.keys(row.selection).find(id => row.selection[id])
    if (!catId) continue
    const opening = normalizeOpeningDebitCredit(row.opening_debit, row.opening_credit)
    const itemId = row.selection[catId]
    const key =
      buildSingleCategoryAuxItemId(codeByCategoryId, catId, itemId) ||
      `draft:${catId}:${itemId}`
    store.set(key, {
      key,
      selection: { [catId]: itemId },
      ...opening,
      pre_book_debit: row.pre_book_debit,
      pre_book_credit: row.pre_book_credit,
    })
  }
  return store
}

/**
 * 导入前校验：合并已有表格数据与本次导入行后，各类目四列分项合计必须一致。
 */
export function validateAuxImportCategoryConsistency(params: {
  categories: AuxCategoryMetaLike[]
  importRows: AuxImportPreviewRowLike[]
  existingStore: Map<string, AuxGridRow>
  codeByCategoryId: Record<string, string>
  autoCreateMissing: boolean
}): AuxCategoryConsistencyResult | null {
  const { categories, importRows, existingStore, codeByCategoryId, autoCreateMissing } = params
  if (categories.length <= 1) return null

  const matchedRows = importRows.filter(r => r.matched)
  const pendingRows = autoCreateMissing
    ? importRows.filter(r => r.matchStatus === 'missing_item' && r.pendingCreate)
    : []

  if (matchedRows.length === 0 && pendingRows.length === 0) return null

  const store = mergeImportRowsIntoStore(existingStore, matchedRows, codeByCategoryId)
  const totalsByCategoryId = new Map(
    categories.map(cat => [cat.id, sumCategoryTotals(cat.id, store, false)])
  )

  for (const row of pendingRows) {
    const catId = row.pendingCreate!.categoryId
    const totals = totalsByCategoryId.get(catId)
    if (!totals) continue
    const opening = normalizeOpeningDebitCredit(row.opening_debit, row.opening_credit)
    totals.opening_debit += opening.opening_debit
    totals.opening_credit += opening.opening_credit
    totals.pre_book_debit += row.pre_book_debit || 0
    totals.pre_book_credit += row.pre_book_credit || 0
  }

  return checkAuxCategoryAmountConsistency(categories, totalsByCategoryId)
}

export function buildAuxImportCategoryConsistencyIssue(
  result: AuxCategoryConsistencyResult
): AuxImportIssue {
  return {
    rowIndex: 0,
    title: '各类目合计不一致',
    detail: `${result.message}。请调整 Excel 或页面已有数据，使各辅助类目的年初借方、年初贷方、帐前借方、帐前贷方四列合计分别相等后再导入。`,
  }
}

export function buildAuxImportSummary(params: {
  contentRowCount: number
  validCount: number
  issueCount: number
  blankSkipped: number
  templateWarning: string | null
  pendingCreateCount?: number
  categoryConsistencyMessage?: string | null
}): { alertType: 'success' | 'warning' | 'error'; message: string; hint: string } {
  if (params.categoryConsistencyMessage) {
    return {
      alertType: 'error',
      message: '各类目合计不一致，无法导入',
      hint: params.categoryConsistencyMessage,
    }
  }
  const base = buildImportSummary(params)
  if (params.contentRowCount === 0 && !params.templateWarning) {
    return {
      ...base,
      message: '文件中没有可识别的数据行，请检查是否按模板填写了项目编码/名称与金额。',
    }
  }
  if ((params.pendingCreateCount || 0) > 0) {
    return {
      alertType: params.issueCount > 0 ? 'warning' : 'success',
      message: `${params.validCount} 行可以导入，其中 ${params.pendingCreateCount} 行将联动创建核算项目`,
      hint:
        params.issueCount > 0
          ? '仍有部分行无法导入，请查看异常说明；确认后可导入可匹配行'
          : '确认后将自动创建缺失项目并载入期初，请记得点击「保存全部」',
    }
  }
  if (params.issueCount > 0 && params.validCount > 0) {
    return {
      ...base,
      message: base.message.replace('填写不规范或未匹配', '项目未匹配或填写不规范'),
    }
  }
  return base
}
