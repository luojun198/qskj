/** 根据名称判断是否为年末/年度结转类型 */
export function isYearlyTransferTypeName(name: string): boolean {
  const text = String(name || '').trim()
  if (!text) return false
  return /年末|年结|年度/.test(text)
}

/** 解析结转类型执行周期（兼容导入错误、名称含「年度」但 period_type 仍为 monthly 的历史数据） */
export function resolveTransferPeriodType(type: {
  period_type?: string | null
  periodType?: string | null
  name?: string | null
}): 'monthly' | 'yearly' {
  const stored = String(type.period_type ?? type.periodType ?? '')
    .trim()
    .toLowerCase()
  if (stored === 'yearly') return 'yearly'
  if (stored === 'monthly') {
    return isYearlyTransferTypeName(String(type.name || '')) ? 'yearly' : 'monthly'
  }
  return isYearlyTransferTypeName(String(type.name || '')) ? 'yearly' : 'monthly'
}

export function isYearlyTransferDue(period: number, type: { period_type?: string | null; name?: string | null }) {
  return resolveTransferPeriodType(type) === 'yearly' && period !== 12
}
