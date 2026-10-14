/**
 * 进销存小数位设置（第六份反馈）：按单据类型 / 报表分别设置「数量 / 单价 / 金额」显示与录入位数。
 *
 * 参数 scm:decimals（JSON）：{ default: {qty, price, amount}, types: { 范围键: {qty?, price?, amount?} } }
 * - 未设置（参数不存在）时沿用原来的显示：数量 / 单价去掉末尾 0，金额两位；
 * - 设置后按位数固定显示（与润衡一致，如 45,000.00）；
 * - 只影响录入与显示，库存成本、往来、凭证仍按原精度计算。
 */

export interface DecimalSetting { qty: number; price: number; amount: number }
export interface DecimalsConfig { default: DecimalSetting; types: Record<string, Partial<DecimalSetting>> }

export const DECIMAL_LIMITS: Record<keyof DecimalSetting, { min: number; max: number; label: string }> = {
  qty: { min: 0, max: 6, label: '数量' },
  price: { min: 0, max: 8, label: '单价' },
  amount: { min: 0, max: 2, label: '金额' },
}

export const DEFAULT_DECIMALS: DecimalSetting = { qty: 3, price: 4, amount: 2 }

/** 可单独设置的范围：单据类型 + 报表（客户点名的都在） */
export const DECIMAL_SCOPES: Array<{ key: string; label: string; group: string }> = [
  { key: 'SQ', label: '销售报价单', group: '销售' },
  { key: 'SOa', label: '销售订单', group: '销售' },
  { key: 'SO', label: '销售出库（发货单）', group: '销售' },
  { key: 'SR', label: '销售退回单', group: '销售' },
  { key: 'RS', label: '销售发票', group: '销售' },
  { key: 'PQ', label: '采购询价单', group: '采购' },
  { key: 'PO', label: '采购订单', group: '采购' },
  { key: 'PI', label: '采购入库单', group: '采购' },
  { key: 'PR', label: '采购退回单', group: '采购' },
  { key: 'RP', label: '采购发票', group: '采购' },
  { key: 'IS', label: '期初入库', group: '库存' },
  { key: 'OI', label: '其它入库单', group: '库存' },
  { key: 'OO', label: '其它出库单', group: '库存' },
  { key: 'TR', label: '调拨单', group: '库存' },
  { key: 'CK', label: '盘点单', group: '库存' },
  { key: 'AS', label: '组装单', group: '生产' },
  { key: 'DS', label: '拆分单', group: '生产' },
  { key: 'PL', label: '领料单', group: '生产' },
  { key: 'PB', label: '补料单', group: '生产' },
  { key: 'PJ', label: '退料单', group: '生产' },
  { key: 'PF', label: '完工入库', group: '生产' },
  { key: 'WO', label: '委外发货', group: '生产' },
  { key: 'WI', label: '委外入库', group: '生产' },
  { key: 'stock', label: '当前库存', group: '报表' },
  { key: 'stock_report', label: '汇总统计表（进销存汇总）', group: '报表' },
  { key: 'stock_ledger', label: '收发台账', group: '报表' },
  { key: 'statement', label: '对账单', group: '报表' },
]

export function parseDecimals(raw: string | null | undefined): DecimalsConfig | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object') return null
    return { default: clampSetting({ ...DEFAULT_DECIMALS, ...(o.default || {}) }), types: o.types && typeof o.types === 'object' ? o.types : {} }
  } catch { return null }
}

export function clampSetting(s: Partial<DecimalSetting>): DecimalSetting {
  const c = (k: keyof DecimalSetting) => {
    const n = Math.trunc(Number(s[k]))
    const { min, max } = DECIMAL_LIMITS[k]
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULT_DECIMALS[k]
  }
  return { qty: c('qty'), price: c('price'), amount: c('amount') }
}

/** 取某范围的位数：范围设置 > 统一设置 > 默认 */
export function resolveDecimals(cfg: DecimalsConfig | null, scope?: string | null): DecimalSetting {
  if (!cfg) return { ...DEFAULT_DECIMALS }
  const t = (scope && cfg.types[scope]) || {}
  return clampSetting({ ...cfg.default, ...t })
}

/**
 * 格式化：fixed=true（已设置小数位）固定位数并加千分位；fixed=false（未设置）沿用旧显示——
 * 数量 / 单价最多 d 位且去掉末尾 0，金额固定两位加千分位。
 */
export function formatDecimal(v: unknown, digits: number, opts: { fixed: boolean; grouping?: boolean; trimWhenAuto?: boolean } = { fixed: true }) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  const grouping = opts.grouping ?? true
  if (!opts.fixed && opts.trimWhenAuto) {
    return n.toLocaleString('zh-CN', { maximumFractionDigits: Math.max(digits, 6), useGrouping: grouping })
  }
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: grouping })
}
