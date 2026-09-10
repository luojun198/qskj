/** 标准模版（会计准则 → 科目体系 + 配套报表）列表项，对应后端 listStandardTemplatesForClient */
export interface StandardTemplateItem {
  id: string
  name: string
  description: string
  group?: string
  code?: string
  retired?: boolean
  order?: number
  inferredStandard?: string
  excelFiles?: Array<{ name: string; path?: string }>
  summary?: {
    accounts: number
    topLevelAccounts: number
    reports: number
    codeLengths: number[]
    cashFlowItems: number
    transferTypes: number
  } | null
}

export interface StandardTemplateGroup {
  group: string
  retired: boolean
  items: StandardTemplateItem[]
}

export const STANDARD_TEMPLATE_FALLBACK_GROUP = '标准模版'

/**
 * 按分组整理模板列表：
 * - 分组顺序优先按后端 groups，其次按首次出现顺序；
 * - 全部成员都停用的分组视为「停用分组」，放到末尾。
 */
export function groupStandardTemplates(
  templates: StandardTemplateItem[],
  groups: string[] = []
): StandardTemplateGroup[] {
  const order = new Map<string, number>()
  groups.forEach((group, index) => order.set(group, index))
  const buckets = new Map<string, StandardTemplateItem[]>()
  for (const item of templates) {
    const group = String(item.group || '').trim() || STANDARD_TEMPLATE_FALLBACK_GROUP
    if (!order.has(group)) order.set(group, order.size)
    const list = buckets.get(group) || []
    list.push(item)
    buckets.set(group, list)
  }
  const result: StandardTemplateGroup[] = []
  for (const [group, items] of buckets) {
    const sorted = [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    result.push({ group, retired: sorted.every(item => item.retired === true), items: sorted })
  }
  return result.sort((a, b) => {
    if (a.retired !== b.retired) return a.retired ? 1 : -1
    return (order.get(a.group) ?? 0) - (order.get(b.group) ?? 0)
  })
}

/** 默认选中：第一个未停用的模板 */
export function pickDefaultStandardTemplate(templates: StandardTemplateItem[]): string {
  const active = templates.find(item => !item.retired)
  return (active || templates[0])?.id || ''
}

/**
 * 下拉显示用标签：`序号 名称`（序号即 catalog.json 的 code，对应原软件行业代码）。
 * 未登记 code 的模板只显示名称。filterable 搜索走 label，因此输入序号也能命中。
 */
export function formatStandardTemplateLabel(item: StandardTemplateItem): string {
  const code = String(item.code || '').trim()
  return code ? `${code} ${item.name}` : item.name
}

/**
 * 单行展示用的紧凑概况：`245科目 · 38表 · 4-3-3`。
 * 没有 summary 时退回后端 description。
 */
export function formatStandardTemplateMeta(item: StandardTemplateItem): string {
  const summary = item.summary
  if (!summary) return item.description || ''
  const parts: string[] = []
  if (summary.accounts) parts.push(`${summary.accounts}科目`)
  if (summary.reports) parts.push(`${summary.reports}表`)
  if (summary.codeLengths?.length) parts.push(summary.codeLengths.join('-'))
  if (item.excelFiles?.length) parts.push(`Excel${item.excelFiles.length}`)
  return parts.join(' · ')
}
