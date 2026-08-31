import type { Database } from 'better-sqlite3'

export const ACCOUNTING_STANDARD_PARAM_KEY = 'accounting_standard'
export const DASHBOARD_CATEGORY_RULES_PARAM_KEY = 'dashboard_category_rules'

export const ACCOUNTING_STANDARD_OPTIONS = [
  'auto',
  'government',
  'small_business',
  'enterprise',
  'custom',
] as const

export type AccountingStandardParam = (typeof ACCOUNTING_STANDARD_OPTIONS)[number]

export type DashboardCategoryRule = {
  codeRoots: string[]
  nameKeywords: string[]
}

export type DashboardCategoryRules = {
  income: DashboardCategoryRule
  pureExpense: DashboardCategoryRule
  fee: DashboardCategoryRule
  cost: DashboardCategoryRule
}

export type DashboardBudgetRules = {
  income: DashboardCategoryRule
  expense: DashboardCategoryRule
}

/**
 * v2 将政府会计的财务会计和预算会计分开保存，避免平行记账重复计入首页收支。
 * customized=false 表示跟随准则预置，准则模板升级时自动获得新规则。
 */
export type DashboardRuleConfigV2 = {
  version: 2
  customized: boolean
  financial: DashboardCategoryRules
  budget: DashboardBudgetRules
}

export type DashboardRuleMode = 'preset' | 'custom' | 'auto'

const CODE_ROOT_PATTERN = /^[A-Za-z0-9]{1,20}$/

export const DEFAULT_DASHBOARD_CATEGORY_RULES: DashboardCategoryRules = {
  income: { codeRoots: [], nameKeywords: ['收入'] },
  pureExpense: { codeRoots: [], nameKeywords: ['支出'] },
  fee: { codeRoots: [], nameKeywords: ['费用'] },
  cost: { codeRoots: [], nameKeywords: ['成本'] },
}

export const DEFAULT_DASHBOARD_BUDGET_RULES: DashboardBudgetRules = {
  income: { codeRoots: [], nameKeywords: [] },
  expense: { codeRoots: [], nameKeywords: [] },
}

export const ACCOUNTING_STANDARD_LABELS: Record<AccountingStandardParam, string> = {
  auto: '自动识别',
  government: '政府会计制度',
  small_business: '小企业会计准则',
  enterprise: '新企业会计准则',
  custom: '自定义',
}

export function isAccountingStandardParam(value: unknown): value is AccountingStandardParam {
  return (
    typeof value === 'string' &&
    (ACCOUNTING_STANDARD_OPTIONS as readonly string[]).includes(value)
  )
}

export function normalizeCodeRoots(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const roots = input
    .map(item => String(item ?? '').trim())
    .filter(item => item.length > 0)
  return [...new Set(roots)]
}

export function normalizeNameKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const keywords = input
    .map(item => String(item ?? '').trim())
    .filter(item => item.length > 0)
  return [...new Set(keywords)]
}

export function normalizeDashboardCategoryRule(input: unknown): DashboardCategoryRule {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Partial<DashboardCategoryRule>)
      : {}
  return {
    codeRoots: normalizeCodeRoots(source.codeRoots),
    nameKeywords: normalizeNameKeywords(source.nameKeywords),
  }
}

export function normalizeDashboardCategoryRules(input: unknown): DashboardCategoryRules {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Partial<DashboardCategoryRules>)
      : {}
  return {
    income: normalizeDashboardCategoryRule(source.income),
    pureExpense: normalizeDashboardCategoryRule(source.pureExpense),
    fee: normalizeDashboardCategoryRule(source.fee),
    cost: normalizeDashboardCategoryRule(source.cost),
  }
}

export function normalizeDashboardBudgetRules(input: unknown): DashboardBudgetRules {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Partial<DashboardBudgetRules>)
      : {}
  return {
    income: normalizeDashboardCategoryRule(source.income),
    expense: normalizeDashboardCategoryRule(source.expense),
  }
}

export function normalizeDashboardRuleConfig(input: unknown): DashboardRuleConfigV2 {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? (input as any) : {}
  if (source.version === 2 || source.financial || source.budget) {
    return {
      version: 2,
      customized: source.customized === true,
      financial: normalizeDashboardCategoryRules(source.financial),
      budget: normalizeDashboardBudgetRules(source.budget),
    }
  }

  // 兼容旧版扁平结构。此层无法确定准则，不擅自按编码拆分；数据库迁移会按账套准则处理。
  const legacy = normalizeDashboardCategoryRules(source)
  return {
    version: 2,
    customized: hasAnyCodeRoots(legacy),
    financial: {
      income: legacy.income,
      pureExpense: legacy.pureExpense,
      fee: legacy.fee,
      cost: legacy.cost,
    },
    budget: {
      income: { codeRoots: [], nameKeywords: [] },
      expense: { codeRoots: [], nameKeywords: [] },
    },
  }
}

export function parseDashboardRuleConfigJson(raw: unknown): DashboardRuleConfigV2 {
  if (raw == null || raw === '') {
    return normalizeDashboardRuleConfig({
      version: 2,
      customized: false,
      financial: DEFAULT_DASHBOARD_CATEGORY_RULES,
      budget: DEFAULT_DASHBOARD_BUDGET_RULES,
    })
  }
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  return normalizeDashboardRuleConfig(parsed)
}

export function parseDashboardCategoryRulesJson(raw: unknown): DashboardCategoryRules {
  return parseDashboardRuleConfigJson(raw).financial
}

export function hasConfiguredDashboardRule(rule: DashboardCategoryRule): boolean {
  return rule.codeRoots.length > 0 || rule.nameKeywords.length > 0
}

export function hasAnyCodeRoots(rules: DashboardCategoryRules): boolean {
  return [rules.income, rules.pureExpense, rules.fee, rules.cost].some(
    rule => rule.codeRoots.length > 0
  )
}

export function validateDashboardCategoryRules(rules: DashboardCategoryRules): string | null {
  const allRules = [rules.income, rules.pureExpense, rules.fee, rules.cost]
  for (const rule of allRules) {
    for (const root of rule.codeRoots) {
      if (!CODE_ROOT_PATTERN.test(root)) {
        return `科目编码根「${root}」格式无效，仅允许 1-20 位字母或数字`
      }
    }
  }
  const hasAny = allRules.some(hasConfiguredDashboardRule)
  if (!hasAny) {
    return '自定义取数规则至少需配置一类科目的编码根或名称关键字'
  }
  return null
}

export function validateDashboardRuleConfig(config: DashboardRuleConfigV2): string | null {
  const financialError = validateDashboardCategoryRules(config.financial)
  if (financialError) return financialError

  const budgetRules = [config.budget.income, config.budget.expense]
  for (const rule of budgetRules) {
    for (const root of rule.codeRoots) {
      if (!CODE_ROOT_PATTERN.test(root)) {
        return `科目编码根「${root}」格式无效，仅允许 1-20 位字母或数字`
      }
    }
  }

  const buckets: Array<[string, string[]]> = [
    ['财务收入', config.financial.income.codeRoots],
    ['财务支出', config.financial.pureExpense.codeRoots],
    ['费用', config.financial.fee.codeRoots],
    ['成本', config.financial.cost.codeRoots],
    ['预算收入', config.budget.income.codeRoots],
    ['预算支出', config.budget.expense.codeRoots],
  ]
  for (let i = 0; i < buckets.length; i++) {
    for (let j = i + 1; j < buckets.length; j++) {
      const overlap = buckets[i][1].find(code =>
        buckets[j][1].some(other => code.startsWith(other) || other.startsWith(code))
      )
      if (overlap) return `科目 ${overlap} 同时配置在“${buckets[i][0]}”和“${buckets[j][0]}”中`
    }
  }
  return null
}

export function validateDashboardRuleConfigAgainstAccounts(
  db: Database,
  accountSetId: string,
  config: DashboardRuleConfigV2
): string | null {
  const rows = db
    .prepare('SELECT code, name, direction FROM accounts WHERE account_set_id=? AND is_enabled=1')
    .all(accountSetId) as Array<{ code: string; name: string; direction: string }>
  const accountMap = new Map(rows.map(row => [row.code, row]))
  const buckets: Array<[string, DashboardCategoryRule, 'debit' | 'credit']> = [
    ['财务收入', config.financial.income, 'credit'],
    ['财务支出', config.financial.pureExpense, 'debit'],
    ['费用', config.financial.fee, 'debit'],
    ['成本', config.financial.cost, 'debit'],
    ['预算收入', config.budget.income, 'credit'],
    ['预算支出', config.budget.expense, 'debit'],
  ]
  for (const [label, rule, direction] of buckets) {
    for (const code of rule.codeRoots) {
      const account = accountMap.get(code)
      if (!account) return `“${label}”中的科目 ${code} 不存在或已停用`
      if (account.direction !== direction) {
        return `“${label}”中的科目 ${code} ${account.name} 方向应为${direction === 'credit' ? '贷方' : '借方'}`
      }
    }
  }
  return null
}

export function validateAccountingStandardParamValue(value: unknown): string | null {
  if (value == null || value === '') return null
  if (!isAccountingStandardParam(value)) {
    return '会计准则参数值无效'
  }
  return null
}

export function validateSystemParamEntry(
  paramKey: string,
  paramValue: string,
  allParams: Array<{ param_key: string; param_value: string }>
): string | null {
  if (paramKey === ACCOUNTING_STANDARD_PARAM_KEY) {
    const error = validateAccountingStandardParamValue(paramValue)
    if (error) return error
    if (paramValue === 'custom') {
      const rulesRaw = allParams.find(item => item.param_key === DASHBOARD_CATEGORY_RULES_PARAM_KEY)
        ?.param_value
      try {
        const config = parseDashboardRuleConfigJson(rulesRaw)
        return validateDashboardRuleConfig(config)
      } catch {
        return '自定义取数规则 JSON 格式无效'
      }
    }
    return null
  }

  if (paramKey === DASHBOARD_CATEGORY_RULES_PARAM_KEY) {
    const standard = allParams.find(item => item.param_key === ACCOUNTING_STANDARD_PARAM_KEY)
      ?.param_value
    try {
      const config = parseDashboardRuleConfigJson(paramValue)
      const rules = config.financial
      if (standard === 'custom') {
        return validateDashboardRuleConfig(config)
      }
      if (hasAnyCodeRoots(rules)) {
        return validateDashboardRuleConfig(config)
      }
      return null
    } catch {
      return '自定义取数规则 JSON 格式无效'
    }
  }

  return null
}

export function getAccountingStandardParam(
  db: Database,
  accountSetId: string
): AccountingStandardParam {
  const row = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = ? LIMIT 1`
    )
    .get(accountSetId, ACCOUNTING_STANDARD_PARAM_KEY) as { param_value?: string } | undefined
  const value = row?.param_value?.trim()
  return isAccountingStandardParam(value) ? value : 'auto'
}

export function getDashboardCategoryRulesParam(
  db: Database,
  accountSetId: string
): DashboardCategoryRules {
  const row = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = ? LIMIT 1`
    )
    .get(accountSetId, DASHBOARD_CATEGORY_RULES_PARAM_KEY) as { param_value?: string } | undefined
  try {
    return parseDashboardCategoryRulesJson(row?.param_value)
  } catch {
    return normalizeDashboardCategoryRules(DEFAULT_DASHBOARD_CATEGORY_RULES)
  }
}

export function getDashboardRuleConfigParam(
  db: Database,
  accountSetId: string
): DashboardRuleConfigV2 {
  const row = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = ? LIMIT 1`
    )
    .get(accountSetId, DASHBOARD_CATEGORY_RULES_PARAM_KEY) as { param_value?: string } | undefined
  try {
    return parseDashboardRuleConfigJson(row?.param_value)
  } catch {
    return parseDashboardRuleConfigJson(null)
  }
}

export function inferAccountingStandardFromTemplateId(templateId: string): AccountingStandardParam {
  const normalized = templateId.trim()
  if (normalized.includes('行政事业') || normalized.includes('政府')) return 'government'
  if (normalized.includes('小企业')) return 'small_business'
  if (normalized.includes('新企业') || normalized.includes('企业会计')) return 'enterprise'
  return 'auto'
}

export function serializeDashboardCategoryRules(rules: DashboardCategoryRules): string {
  return JSON.stringify(normalizeDashboardCategoryRules(rules))
}

export function serializeDashboardRuleConfig(config: DashboardRuleConfigV2): string {
  return JSON.stringify(normalizeDashboardRuleConfig(config))
}
