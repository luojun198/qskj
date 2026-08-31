export type ClientAccountingStandard = 'auto' | 'government' | 'small_business' | 'enterprise'

export function inferAccountingStandardFromTemplateName(name: string): ClientAccountingStandard {
  const normalized = String(name || '').trim()
  if (normalized.includes('行政事业') || normalized.includes('政府')) return 'government'
  if (normalized.includes('小企业')) return 'small_business'
  if (normalized.includes('新企业') || normalized.includes('企业会计')) return 'enterprise'
  return 'auto'
}

export const ACCOUNTING_STANDARD_LABELS: Record<ClientAccountingStandard, string> = {
  auto: '自动识别',
  government: '政府会计制度',
  small_business: '小企业会计准则',
  enterprise: '新企业会计准则',
}
