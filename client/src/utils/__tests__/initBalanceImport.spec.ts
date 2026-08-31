import { describe, it, expect } from 'vitest'
import {
  buildInitBalanceImportSummary,
  buildInitBalanceNameMap,
  collectInitBalanceImportIssues,
  describeInitBalanceRowIssue,
  parseInitBalanceImportRows,
  rowHasInitBalanceContent,
} from '../initBalanceImport'

describe('initBalanceImport', () => {
  const accounts = [
    { id: 'a1', code: '1001', name: '现金', direction: 'debit' },
    { id: 'a2', code: '2001', name: '应付', direction: 'credit', aux_readonly: 1, has_aux: 1 },
    { id: 'a3', code: '1002', name: '银行存款', direction: 'debit' },
  ]
  const codeMap = new Map(accounts.map(a => [a.code, a] as const))
  const nameMap = buildInitBalanceNameMap(accounts)

  const isAuxLeaf = (a: { id: string }) => a.id === 'a2'

  it('rowHasInitBalanceContent', () => {
    expect(rowHasInitBalanceContent({ 科目编码: '1001' })).toBe(true)
    expect(rowHasInitBalanceContent({ 科目名称: '现金' })).toBe(true)
    expect(rowHasInitBalanceContent({})).toBe(false)
  })

  it('parseInitBalanceImportRows 保留未匹配与辅助科目行', () => {
    const { rows, blankSkipped } = parseInitBalanceImportRows(
      [
        { 科目编码: '9999', 年初借方: 1 },
        { 科目编码: '2001', 年初借方: 2 },
        {},
      ],
      codeMap,
      nameMap,
      isAuxLeaf,
      false
    )
    expect(blankSkipped).toBe(1)
    expect(rows).toHaveLength(2)
    expect(rows[0].matched).toBe(false)
    expect(rows[1].error).toContain('辅助核算')
  })

  it('parseInitBalanceImportRows 支持仅科目名称匹配', () => {
    const { rows } = parseInitBalanceImportRows(
      [{ 科目名称: '银行存款', 年初借方: 100 }],
      codeMap,
      nameMap,
      isAuxLeaf,
      false
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].matched).toBe(true)
    expect(rows[0].account_id).toBe('a3')
    expect(rows[0].code).toBe('1002')
  })

  it('parseInitBalanceImportRows 科目名称多空格可匹配', () => {
    const { rows } = parseInitBalanceImportRows(
      [{ 科目名称: '银行  存款', 年初借方: 100 }],
      codeMap,
      nameMap,
      isAuxLeaf,
      false
    )
    expect(rows[0].matched).toBe(true)
    expect(rows[0].account_id).toBe('a3')
  })

  it('parseInitBalanceImportRows 无编码无名称时报错', () => {
    const { rows } = parseInitBalanceImportRows(
      [{ 年初借方: 100 }],
      codeMap,
      nameMap,
      isAuxLeaf,
      false
    )
    expect(rows[0].matched).toBe(false)
    expect(rows[0].error).toContain('科目编码或科目名称')
  })

  it('describeInitBalanceRowIssue 自然语言', () => {
    const issue = describeInitBalanceRowIssue({
      rowIndex: 3,
      code: '1001',
      name: '现金',
      direction: 'debit',
      opening_debit: 1,
      opening_credit: 1,
      pre_book_debit: 0,
      pre_book_credit: 0,
      matched: false,
      error: '年初借方与年初贷方不能同时填写',
    })
    expect(issue.title).toContain('第 3 行')
    expect(issue.detail).toContain('不能同时')
  })

  it('buildInitBalanceImportSummary 部分成功', () => {
    const s = buildInitBalanceImportSummary({
      contentRowCount: 5,
      validCount: 3,
      issueCount: 2,
      blankSkipped: 1,
      templateWarning: null,
    })
    expect(s.alertType).toBe('warning')
    expect(s.hint).toContain('查看异常说明')
  })

  it('collectInitBalanceImportIssues', () => {
    const issues = collectInitBalanceImportIssues([
      {
        rowIndex: 2,
        code: 'x',
        name: '',
        direction: '',
        opening_debit: 0,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: false,
        error: '未找到科目编码「x」',
      },
      {
        rowIndex: 3,
        code: '1001',
        name: '现金',
        direction: 'debit',
        opening_debit: 1,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 0,
        matched: true,
      },
    ])
    expect(issues).toHaveLength(1)
  })
})
