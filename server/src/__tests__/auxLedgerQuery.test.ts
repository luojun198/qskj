import { describe, expect, it } from 'vitest'
import {
  appendAuxItemMatchParams,
  buildAuxIdSelect,
  buildAuxItemLookup,
  buildAuxItemMatchCondition,
  enrichAuxLedgerEntry,
} from '../utils/auxLedgerQuery.js'

describe('auxLedgerQuery', () => {
  it('buildAuxItemMatchCondition 包含 json 与固定列', () => {
    const sql = buildAuxItemMatchCondition('dept', '?,?,?')
    expect(sql).toContain("json_extract(ve.aux_data, '$.dept.id')")
    expect(sql).toContain('ve.dept_id IN (?,?,?)')
  })

  it('buildAuxItemMatchCondition 兼容类别 UUID 键与项目编码', () => {
    const sql = buildAuxItemMatchCondition('case_no', '?,?', {
      categoryId: 'cat-uuid-1',
      itemCodes: ['000007'],
      matchItemCodesInJsonId: true,
    })
    expect(sql).toContain("json_extract(ve.aux_data, '$.case_no.id')")
    expect(sql).toContain('json_extract(ve.aux_data, \'$."cat-uuid-1".id\')')
    const params: string[] = []
    appendAuxItemMatchParams(params, 'case_no', ['id1', 'id2'], {
      categoryId: 'cat-uuid-1',
      itemCodes: ['000007'],
      matchItemCodesInJsonId: true,
    })
    expect(params).toEqual(['id1', 'id2', 'id1', 'id2', '000007', '000007'])
  })

  it('appendAuxItemMatchParams 对固定列类别重复 itemIds', () => {
    const params: string[] = []
    appendAuxItemMatchParams(params, 'person', ['a', 'b'])
    expect(params).toEqual(['a', 'b', 'a', 'b'])
  })

  it('buildAuxIdSelect 对部门使用 COALESCE', () => {
    expect(buildAuxIdSelect('dept')).toContain('COALESCE')
    expect(buildAuxIdSelect('dept')).toContain('ve.dept_id')
  })

  it('enrichAuxLedgerEntry 从项目表补全名称', () => {
    const lookup = buildAuxItemLookup([
      { id: 'item-1', name: '行政部', category_code: 'dept', code: 'D01' },
    ])
    const entry: Record<string, any> = { aux_id: 'item-1', aux_name: null }
    enrichAuxLedgerEntry(entry, 'dept', new Map([['dept', '部门']]), lookup)
    expect(entry.category_name).toBe('部门')
    expect(entry.aux_name).toBe('行政部')
  })

  it('enrichAuxLedgerEntry 按项目编码补全名称', () => {
    const lookup = buildAuxItemLookup([
      { id: 'item-1', name: '案件A', category_code: 'case_no', code: '000007' },
    ])
    const entry: Record<string, any> = { aux_id: '000007', aux_name: null }
    enrichAuxLedgerEntry(entry, 'case_no', new Map([['case_no', '案件号']]), lookup)
    expect(entry.aux_name).toBe('案件A')
    expect(entry.aux_id).toBe('item-1')
  })
})
