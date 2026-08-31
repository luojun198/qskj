import { describe, expect, it } from 'vitest'
import {
  expandFlowAccountCodes,
  sumPeriodFlowByPatterns,
} from '../services/staticCashFlowExpand.js'

function createMockDb(codes: string[]) {
  return {
    prepare: () => ({
      all: () => codes.map(code => ({ code })),
    }),
  } as any
}

describe('staticCashFlowExpand', () => {
  // 修复：expandFlowAccountCodes 只返回最上层匹配科目，剔除被祖先覆盖的下级科目。
  // 下游 getBatchBalances / getBatchPeriodRangeSums 会把每个编码再展开为叶子子树求和，
  // 若父、子同时返回，父科目已含子科目金额，再叠加子科目会导致金额约 2 倍重复计入。
  it('展开时应剔除被祖先覆盖的下级科目，避免下游重复计数', () => {
    const db = createMockDb(['5001', '500101', '5002', '5401'])
    // 5001 是 500101 的祖先 → 只保留 5001（getBatch* 会自行展开其叶子）
    const expanded = expandFlowAccountCodes(db, 'as-1', ['5001'])
    expect(expanded).toEqual(['5001'])
  })

  it('祖先科目不存在时应返回实际存在的下级科目', () => {
    const db = createMockDb(['500101', '500102', '5401'])
    // 配置前缀 5001 无对应科目行，但存在两个下级明细，两者互不为祖先，均保留
    const expanded = expandFlowAccountCodes(db, 'as-1', ['5001'])
    expect(expanded).toEqual(['500101', '500102'])
  })

  it('应按前缀匹配的顶层科目汇总发生额（父子不重复计数）', () => {
    const db = createMockDb(['5001', '500101', '5401'])
    // periodSumMap 由 getBatchPeriodRangeSums 产出：父科目 5001 的值已是其叶子子树汇总
    const periodSumMap = new Map([
      ['5001', { debit: 0, credit: 150 }],
      ['500101', { debit: 0, credit: 150 }],
      ['5401', { debit: 80, credit: 0 }],
    ])
    const inflow = sumPeriodFlowByPatterns(db, 'as-1', ['5001'], false, periodSumMap)
    const outflow = sumPeriodFlowByPatterns(db, 'as-1', ['5401'], true, periodSumMap)
    expect(inflow).toBe(150) // 只计一次 5001，不再叠加 500101
    expect(outflow).toBe(80)
  })
})
