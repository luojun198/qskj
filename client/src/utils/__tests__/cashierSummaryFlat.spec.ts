import { describe, expect, it } from 'vitest'
import { flattenSummary } from '../cashierSummaryFlat'
import type { CashierSummaryNode } from '@/api/cashier'

const node = (name: string, income: number, children?: CashierSummaryNode[]): CashierSummaryNode => ({
  level: 0, dimension: '', key: name, name, income, expense: 0, net: income, count: 1,
  income_ratio: 0, expense_ratio: 0, path: [], children,
})

describe('flattenSummary：每个维度一列', () => {
  // 部门 → 人员 两级
  const root = node('合计', 300, [
    node('销售部', 200, [node('张三', 120), node('李四', 80)]),
    node('财务部', 100, [node('王五', 100)]),
  ])

  it('分组行每个维度一格，含小计行', () => {
    const rows = flattenSummary(root, 2, true)
    expect(rows.map(r => r.cells)).toEqual([
      ['销售部', '张三'], ['销售部', '李四'], ['销售部 小计', ''],
      ['财务部', '王五'], ['财务部 小计', ''],
    ])
    expect(rows.map(r => r.kind)).toEqual(['leaf', 'leaf', 'sub', 'leaf', 'sub'])
    expect(rows[2].node.income).toBe(200)
  })

  it('不显示小计时只有分组行；单维度没有小计', () => {
    expect(flattenSummary(root, 2, false).map(r => r.cells)).toEqual([['销售部', '张三'], ['销售部', '李四'], ['财务部', '王五']])
    const one = node('合计', 3, [node('A', 1), node('B', 2)])
    expect(flattenSummary(one, 1, true).map(r => r.kind)).toEqual(['leaf', 'leaf'])
  })
})
