import type { SalesReportMeta, SalesReportQueryConfig, SalesReportScheme } from '@/api/scm'

export function createSalesReportConfig(meta: SalesReportMeta): SalesReportQueryConfig {
  return {
    mode: 'summary',
    filters: { logic: 'and', children: [] },
    result_filters: { logic: 'and', children: [] },
    fields: [...meta.defaults.detail_fields],
    dimensions: [...meta.defaults.dimensions],
    metrics: [...meta.defaults.metrics],
    sort: [],
    page: 1,
    page_size: 100,
  }
}

export function normalizeSalesReportScheme(config: Partial<SalesReportQueryConfig>, meta: SalesReportMeta) {
  const defaults = createSalesReportConfig(meta)
  const fieldKeys = new Set(meta.fields.map(field => field.key))
  const dimensionKeys = new Set(meta.dimensions.map(field => field.key))
  const metricKeys = new Set(meta.metrics.map(metric => metric.key))
  const ignored: string[] = []
  const keep = (values: unknown, allowed: Set<string>, fallback: string[], allowEmpty = false) => {
    const input = Array.isArray(values) ? values.map(String) : fallback
    const valid = input.filter(key => allowed.has(key))
    ignored.push(...input.filter(key => !allowed.has(key)))
    return valid.length || allowEmpty ? valid : fallback.filter(key => allowed.has(key))
  }
  const normalized: SalesReportQueryConfig = {
    ...defaults,
    ...config,
    mode: config.mode === 'detail' ? 'detail' : 'summary',
    filters: config.filters?.children ? config.filters : defaults.filters,
    result_filters: config.result_filters?.children ? config.result_filters : defaults.result_filters,
    fields: keep(config.fields, fieldKeys, defaults.fields),
    dimensions: keep(config.dimensions, dimensionKeys, defaults.dimensions, true).slice(0, meta.limits.dimensions),
    metrics: keep(config.metrics, metricKeys, defaults.metrics),
    sort: Array.isArray(config.sort) ? config.sort.filter(item => item && (fieldKeys.has(item.key) || dimensionKeys.has(item.key) || metricKeys.has(item.key))).slice(0, 3) : [],
    page: Math.max(1, Number(config.page) || 1),
    page_size: Math.min(meta.limits.page_size, Math.max(1, Number(config.page_size) || 100)),
  }
  return { config: normalized, ignored: [...new Set(ignored)] }
}

export function getDefaultSalesScheme(schemes: SalesReportScheme[]) {
  return schemes.find(scheme => scheme.is_default) || null
}

export function formatSalesReportValue(value: unknown, type?: string) {
  if (value == null || value === '') return type === 'percent' ? '—' : ''
  if (type === 'percent') return `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`
  if (['amount', 'number'].includes(type || '')) return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: type === 'amount' ? 2 : 0, maximumFractionDigits: type === 'amount' ? 2 : 6 })
  if (type === 'integer') return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  return String(value)
}

export function countSalesFilters(node: any): number {
  if (!node) return 0
  if (typeof node.field === 'string') return 1
  return Array.isArray(node.children) ? node.children.reduce((sum: number, child: any) => sum + countSalesFilters(child), 0) : 0
}
