import { describe, expect, it } from 'vitest'
import { buildBalanceSheetExportColumns, buildBalanceSheetSummaryValues } from '../ledgerExportBuilders'

/** FIX-133：总分类账导出不得丢弃反方向（负数）余额 */

const colWidth = (_k: string, f: number) => f

function findLeaf(cols: any[], groupLabel: string, leafLabel: string) {
  const group = cols.find(c => c.label === groupLabel)
  return group.children.find((c: any) => c.label === leafLabel)
}

describe('总分类账导出：反方向余额', () => {
  const rows = [
    // 应付账款（贷方科目）出现借方余额 -100 → 借方列 100
    { account_code: '2202', account_name: '应付账款', level: 1, direction: 'credit', init_balance: -100, end_balance: -40 },
    { account_code: '1001', account_name: '库存现金', level: 1, direction: 'debit', init_balance: 300, end_balance: 260 },
  ]

  it('行级：负余额落到对侧列', () => {
    const cols = buildBalanceSheetExportColumns(colWidth, [1])
    expect(findLeaf(cols, '期初余额', '借方').value(rows[0])).toBe(100)
    expect(findLeaf(cols, '期初余额', '贷方').value(rows[0])).toBe('')
    expect(findLeaf(cols, '期末余额', '借方').value(rows[0])).toBe(40)
    expect(findLeaf(cols, '期初余额', '借方').value(rows[1])).toBe(300)
    expect(findLeaf(cols, '期初余额', '贷方').value(rows[1])).toBe('')
  })

  it('合计：与页面分侧口径一致', () => {
    const values = buildBalanceSheetSummaryValues(rows, [1])
    // ['', '', initDebit, initCredit, m1d, m1c, yearD, yearC, endDebit, endCredit]
    expect(values[2]).toBe(400)
    expect(values[3]).toBe('')
    expect(values[8]).toBe(300)
    expect(values[9]).toBe('')
  })
})
