import type { CashierSummaryNode } from '@/api/cashier'

export interface FlatSummaryRow {
  kind: 'leaf' | 'sub'
  node: CashierSummaryNode
  /** 每个汇总维度一格；小计行的标签放在其所在层级的格子里，其后的格子留空 */
  cells: string[]
}

/**
 * 把汇总树深度优先展开成「每个维度一列」的平铺行：
 * 末层为分组行；上层节点在 showSubtotals 时补一行小计（标签「<名称> 小计」放在它所在层级的列）。
 */
export function flattenSummary(root: CashierSummaryNode, dimCount: number, showSubtotals: boolean): FlatSummaryRow[] {
  const out: FlatSummaryRow[] = []
  const pad = (names: string[]) => [...names, ...Array(Math.max(0, dimCount - names.length)).fill('')]
  const walk = (n: CashierSummaryNode, names: string[]) => {
    const here = [...names, n.name]
    if (n.children?.length) {
      n.children.forEach(c => walk(c, here))
      if (showSubtotals) {
        const cells = pad(here)
        cells[here.length - 1] = `${n.name} 小计`
        out.push({ kind: 'sub', node: n, cells })
      }
    } else {
      out.push({ kind: 'leaf', node: n, cells: pad(here) })
    }
  }
  root.children?.forEach(c => walk(c, []))
  return out
}
