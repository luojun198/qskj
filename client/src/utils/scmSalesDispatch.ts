import type { ScmDocLine, ScmStockAvailLine } from '@/api/scm'

type SalesDispatchAvailabilityLine = ScmStockAvailLine & {
  remark?: string
  field_values?: Record<string, any>
}

function splitSalesOrderNos(value?: string): string[] {
  return String(value || '').split('、').map(orderNo => orderNo.trim()).filter(Boolean)
}

export interface BuildSalesDispatchOptions {
  /**
   * 是否按可用库存限制发货数量。
   * - false（默认）：按订单正常剩余量带入，库存不足时仍生成草稿行（兼容单订单 StockDispatch 流程）。
   * - true：发货 = min(订单剩余, 可用库存 ship_qty)，库存为 0 的行整行跳过。
   *   用于多订单合并出库等场景，避免生成超出库存的草稿导致审核失败。
   */
  useStockLimit?: boolean
}

/** 将销售订单实时可发量转换为可编辑销售出库明细。 */
export function buildSalesDispatchLines(
  rows: SalesDispatchAvailabilityLine[],
  fallbackWarehouse = '',
  options: BuildSalesDispatchOptions = {},
): Partial<ScmDocLine>[] {
  const useStockLimit = options.useStockLimit ?? false
  return rows
    .filter(row => {
      if (useStockLimit) {
        // 按库存限制：只带入库存可发的行；库存为 0 的行整行跳过
        return (Number(row.ship_qty) || 0) > 0
      }
      return (Number(row.base_remaining ?? row.remain) || 0) > 0
    })
    .map(row => {
      const orderRemain = Number(row.base_remaining ?? row.remain) || 0
      const qty = useStockLimit
        ? Math.max(0, Math.min(orderRemain, Number(row.ship_qty) || 0))
        : orderRemain
      const price = Number(row.price) || 0
      const taxRate = row.tax_rate === null || row.tax_rate === undefined ? null : Number(row.tax_rate)
      return {
        item_code: row.item_code,
        item_name: row.item_name || '',
        spec: row.spec || '',
        warehouse_code: row.warehouse_code || fallbackWarehouse,
        qty,
        price,
        amount: Math.round(qty * price * 100) / 100,
        price_with_tax: Number(row.price_with_tax) || undefined,
        unit_cost: Number(row.unit_cost) || 0,
        tax_rate: taxRate,
        tax_amount: taxRate === null ? null : Math.round(qty * price * taxRate) / 100,
        source_line_id: row.line_id,
        sales_order_no: row.source_doc_no || undefined,
        ...(row.remark ? { remark: row.remark } : {}),
        ...(row.field_values ? { field_values: { ...row.field_values } } : {}),
      }
    })
}

/**
 * 合并出库时按「物料 + 仓库 + 单价 + 税务口径」归并明细。
 * 多来源行无法映射到单一 source_line_id，来源清单保存在 field_values 中供草稿追溯。
 */
export function mergeSalesDispatchLines(lines: Partial<ScmDocLine>[]): Partial<ScmDocLine>[] {
  const merged = new Map<string, Partial<ScmDocLine> & {
    __sourceAllocations?: Array<{ source_line_id: string; qty: number }>
    __salesOrderNos?: Set<string>
  }>()

  for (const line of lines) {
    const key = [
      line.item_code || '', line.warehouse_code || '', line.unit || '',
      Number(line.price) || 0, Number(line.price_with_tax) || 0,
      line.tax_rate ?? '', Number(line.unit_cost) || 0,
    ].join('|')
    const sourceLineId = String(line.source_line_id || '').trim()
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        ...line,
        __sourceAllocations: sourceLineId ? [{ source_line_id: sourceLineId, qty: Number(line.qty) || 0 }] : [],
        __salesOrderNos: new Set(splitSalesOrderNos(line.sales_order_no)),
      })
      continue
    }
    existing.qty = (Number(existing.qty) || 0) + (Number(line.qty) || 0)
    existing.amount = Math.round((Number(existing.qty) || 0) * (Number(existing.price) || 0) * 100) / 100
    if (sourceLineId) existing.__sourceAllocations?.push({ source_line_id: sourceLineId, qty: Number(line.qty) || 0 })
    for (const orderNo of splitSalesOrderNos(line.sales_order_no)) existing.__salesOrderNos?.add(orderNo)
  }

  return Array.from(merged.values()).map(({ __sourceAllocations = [], __salesOrderNos = new Set(), ...line }) => {
    const salesOrderNo = [...__salesOrderNos].sort((left, right) => left.localeCompare(right, 'zh-CN')).join('、')
    const result = salesOrderNo ? { ...line, sales_order_no: salesOrderNo } : line
    if (__sourceAllocations.length < 2) return result
    return {
      ...result,
      source_line_id: undefined,
      field_values: {
        ...(typeof line.field_values === 'object' && line.field_values ? line.field_values : {}),
        source_line_allocations: __sourceAllocations,
      },
    }
  })
}
