import { describe, it, expect } from 'vitest'
import {
  buildAuxImportPrecheck,
  buildAuxImportSummary,
  collectAuxImportIssues,
  aggregateAuxImportIssues,
  aggregateAuxImportIssuesAsync,
  countAuxImportImportable,
  describeAuxImportRowIssue,
  parseAuxImportRows,
  rowHasImportContent,
  validateAuxImportCategoryConsistency,
  validateAuxImportTemplateHeaders,
} from '../initBalanceAuxImport'
import type { AuxGridRow } from '../initBalanceAuxGrid'

const categories = [{ id: 'c1', code: 'dept', name: '部门' }]
const multiCategories = [
  { id: 'c1', code: 'dept', name: '部门' },
  { id: 'c2', code: 'proj', name: '项目' },
]
const itemsByCategory = {
  c1: [{ id: 'i1', code: '000001', name: '办公室' }],
}
const multiItemsByCategory = {
  c1: [{ id: 'i1', code: '000001', name: '办公室' }],
  c2: [{ id: 'i2', code: '000002', name: '项目A' }],
}
const codeByCategoryId = { c1: 'dept', c2: 'proj' }

describe('initBalanceAuxImport', () => {
  it('rowHasImportContent 识别有编码或金额的行', () => {
    expect(rowHasImportContent({ 部门编码: '01' }, categories)).toBe(true)
    expect(rowHasImportContent({ 部门名称: '办公室' }, categories)).toBe(true)
    expect(rowHasImportContent({ 年初借方: 100 }, categories)).toBe(true)
    expect(rowHasImportContent({}, categories)).toBe(false)
  })

  it('parseAuxImportRows 支持仅名称匹配', () => {
    const { rows } = parseAuxImportRows(
      [{ 部门名称: '办公室', 年初借方: 100 }],
      categories,
      itemsByCategory
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].matched).toBe(true)
    expect(rows[0].selection.c1).toBe('i1')
  })

  it('parseAuxImportRows 名称多空格可匹配', () => {
    const { rows } = parseAuxImportRows(
      [{ 部门名称: '办 公室', 年初借方: 100 }],
      categories,
      itemsByCategory
    )
    expect(rows[0].matched).toBe(true)
  })

  it('parseAuxImportRows 无编码无项目时标记 missing_item', () => {
    const { rows } = parseAuxImportRows(
      [{ 部门名称: '新部门', 年初借方: 50 }],
      categories,
      itemsByCategory,
      { allowPendingCreate: true }
    )
    expect(rows[0].matched).toBe(false)
    expect(rows[0].matchStatus).toBe('missing_item')
    expect(rows[0].pendingCreate?.name).toBe('新部门')
  })

  it('buildAuxImportPrecheck 汇总预检', () => {
    const precheck = buildAuxImportPrecheck([
      {
        rowIndex: 2,
        selection: { c1: 'i1' },
        selection_labels: {},
        opening_debit: 1,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: true,
        matchStatus: 'ready',
      },
      {
        rowIndex: 3,
        selection: {},
        selection_labels: {},
        opening_debit: 2,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: false,
        matchStatus: 'missing_item',
        pendingCreate: { categoryId: 'c1', categoryName: '部门', name: '新部门' },
      },
    ])
    expect(precheck.readyCount).toBe(1)
    expect(precheck.missingItemCount).toBe(1)
    expect(precheck.missingItems[0].name).toBe('新部门')
  })

  it('countAuxImportImportable 联动创建时计入待创建行', () => {
    const rows = [
      {
        rowIndex: 2,
        selection: {},
        selection_labels: {},
        opening_debit: 1,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: false,
        matchStatus: 'missing_item' as const,
      },
    ]
    expect(countAuxImportImportable(rows, false)).toBe(0)
    expect(countAuxImportImportable(rows, true)).toBe(1)
  })

  it('describeAuxImportRowIssue 生成自然语言说明', () => {
    const issue = describeAuxImportRowIssue(
      {
        rowIndex: 5,
        selection: {},
        selection_labels: {},
        opening_debit: 0,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: false,
        error: '未找到部门编码「99」',
      },
      categories
    )
    expect(issue.title).toContain('第 5 行')
    expect(issue.detail).toContain('部门')
    expect(issue.detail).toContain('99')
  })

  it('buildAuxImportSummary 部分成功时提示查看异常', () => {
    const s = buildAuxImportSummary({
      contentRowCount: 10,
      validCount: 7,
      issueCount: 3,
      blankSkipped: 2,
      templateWarning: null,
    })
    expect(s.alertType).toBe('warning')
    expect(s.message).toContain('7 行可以导入')
    expect(s.hint).toContain('查看异常说明')
  })

  it('collectAuxImportIssues 跳过 missing_item 行', () => {
    const issues = collectAuxImportIssues(
      [
        {
          rowIndex: 2,
          selection: {},
          selection_labels: {},
          opening_debit: 0,
          opening_credit: 0,
          pre_book_debit: 0,
          pre_book_credit: 0,
          matched: false,
          matchStatus: 'missing_item',
          pendingCreate: { categoryId: 'c1', categoryName: '部门', name: '新部门' },
        },
        {
          rowIndex: 3,
          selection: {},
          selection_labels: {},
          opening_debit: 0,
          opening_credit: 0,
          pre_book_debit: 0,
          pre_book_credit: 0,
          matched: false,
          matchStatus: 'error',
          error: '金额不能全为 0',
        },
      ],
      categories
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].rowIndex).toBe(3)
  })

  it('aggregateAuxImportIssues 合并同类异常', () => {
    const rows = [
      {
        rowIndex: 2,
        selection: {},
        selection_labels: {},
        opening_debit: 0,
        opening_credit: 100,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: false,
        matchStatus: 'error' as const,
        error: '请至少填写一个辅助类目的项目编码或名称',
      },
      {
        rowIndex: 5,
        selection: {},
        selection_labels: {},
        opening_debit: 0,
        opening_credit: 200,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: false,
        matchStatus: 'error' as const,
        error: '请至少填写一个辅助类目的项目编码或名称',
      },
    ]
    const issues = aggregateAuxImportIssues(rows, categories)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain('共 2 行')
    expect(issues[0].detail).toContain('金额')
  })

  it('aggregateAuxImportIssuesAsync 大批量分块汇总', async () => {
    const rows = Array.from({ length: 12000 }, (_, i) => ({
      rowIndex: i + 2,
      selection: {},
      selection_labels: {},
      opening_debit: 0,
      opening_credit: 1,
      pre_book_debit: 0,
      pre_book_credit: 0,
      matched: false,
      matchStatus: 'error' as const,
      error: '请至少填写一个辅助类目的项目编码或名称',
    }))
    const issues = await aggregateAuxImportIssuesAsync(rows, categories, { yieldEvery: 3000 })
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain('12000')
  })

  it('validateAuxImportTemplateHeaders 检测缺列', () => {
    const msg = validateAuxImportTemplateHeaders({ 年初借方: 1 }, categories)
    expect(msg).toContain('部门')
  })

  it('validateAuxImportCategoryConsistency 合并 store 后各类目一致时通过', () => {
    const existingStore = new Map<string, AuxGridRow>([
      [
        'dept:i1',
        {
          key: 'dept:i1',
          selection: { c1: 'i1' },
          opening_debit: 100,
          opening_credit: 0,
          pre_book_debit: 0,
          pre_book_credit: 0,
        },
      ],
    ])
    const importRows = [
      {
        rowIndex: 2,
        selection: { c2: 'i2' },
        selection_labels: {},
        opening_debit: 100,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: true,
        matchStatus: 'ready' as const,
      },
    ]
    const result = validateAuxImportCategoryConsistency({
      categories: multiCategories,
      importRows,
      existingStore,
      codeByCategoryId,
      autoCreateMissing: false,
    })
    expect(result).toBeNull()
  })

  it('validateAuxImportCategoryConsistency 仅导入一个类目且与已有不一致时拒绝', () => {
    const existingStore = new Map<string, AuxGridRow>([
      [
        'dept:i1',
        {
          key: 'dept:i1',
          selection: { c1: 'i1' },
          opening_debit: 100,
          opening_credit: 0,
          pre_book_debit: 0,
          pre_book_credit: 0,
        },
      ],
    ])
    const importRows = [
      {
        rowIndex: 2,
        selection: { c2: 'i2' },
        selection_labels: {},
        opening_debit: 80,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: true,
        matchStatus: 'ready' as const,
      },
    ]
    const result = validateAuxImportCategoryConsistency({
      categories: multiCategories,
      importRows,
      existingStore,
      codeByCategoryId,
      autoCreateMissing: false,
    })
    expect(result).not.toBeNull()
    expect(result!.message).toContain('年初借方')
  })

  it('buildAuxImportSummary 类目不一致时返回 error', () => {
    const s = buildAuxImportSummary({
      contentRowCount: 2,
      validCount: 2,
      issueCount: 0,
      blankSkipped: 0,
      templateWarning: null,
      categoryConsistencyMessage: '各类目合计不一致：年初借方：「部门」100.00 ≠ 「项目」80.00',
    })
    expect(s.alertType).toBe('error')
    expect(s.message).toContain('无法导入')
  })
})
