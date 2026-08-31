import type { Database } from 'better-sqlite3'
import {
  ACCOUNTING_STANDARD_LABELS,
  DEFAULT_DASHBOARD_CATEGORY_RULES,
  getAccountingStandardParam,
  getDashboardRuleConfigParam,
  hasAnyCodeRoots,
  hasConfiguredDashboardRule,
  type DashboardBudgetRules,
  type DashboardCategoryRule,
  type DashboardCategoryRules,
  type DashboardRuleConfigV2,
  type DashboardRuleMode,
} from './accountingStandard.js'
import {
  detectStaticReportStandard,
  getIncomeStatementConfig,
  resolveAccountingStandard,
  type StaticReportStandard,
} from './staticReportConfig.js'

/** 科目自身或任一上级科目名包含 keyword 且方向一致时命中 */
export function buildAccountCategoryPredicate(
  keyword: string,
  direction: 'debit' | 'credit' = 'debit'
): string {
  const safeKeyword = keyword.replace(/'/g, "''")
  return `(a.direction='${direction}' AND (
    a.name LIKE '%${safeKeyword}%'
    OR EXISTS (
      WITH RECURSIVE anc AS (
        SELECT id, name, direction, parent_id, account_set_id
        FROM accounts
        WHERE id = a.id AND account_set_id = a.account_set_id
        UNION ALL
        SELECT p.id, p.name, p.direction, p.parent_id, p.account_set_id
        FROM accounts p
        INNER JOIN anc ON p.id = anc.parent_id AND p.account_set_id = anc.account_set_id
      )
      SELECT 1 FROM anc
      WHERE anc.id != a.id AND anc.name LIKE '%${safeKeyword}%' AND anc.direction='${direction}'
      LIMIT 1
    )
  ))`
}

/** 科目自身或任一上级科目编码匹配 code root 时命中 */
export function buildAccountCodeRootsPredicate(
  roots: string[],
  direction: 'debit' | 'credit' = 'debit'
): string {
  if (roots.length === 0) return '0'
  const directMatch = roots
    .map(root => {
      const safeRoot = root.replace(/'/g, "''")
      return `(a.code = '${safeRoot}' OR a.code LIKE '${safeRoot}%')`
    })
    .join(' OR ')
  const ancestorMatch = roots
    .map(root => {
      const safeRoot = root.replace(/'/g, "''")
      return `(anc.code = '${safeRoot}' OR anc.code LIKE '${safeRoot}%')`
    })
    .join(' OR ')
  return `(a.direction='${direction}' AND (
    (${directMatch})
    OR EXISTS (
      WITH RECURSIVE anc AS (
        SELECT id, code, name, direction, parent_id, account_set_id
        FROM accounts
        WHERE id = a.id AND account_set_id = a.account_set_id
        UNION ALL
        SELECT p.id, p.code, p.name, p.direction, p.parent_id, p.account_set_id
        FROM accounts p
        INNER JOIN anc ON p.id = anc.parent_id AND p.account_set_id = anc.account_set_id
      )
      SELECT 1 FROM anc
      WHERE anc.id != a.id AND (${ancestorMatch})
      LIMIT 1
    )
  ))`
}

function buildCategoryPredicate(
  rule: DashboardCategoryRule,
  direction: 'debit' | 'credit'
): string {
  const parts: string[] = []
  if (rule.codeRoots.length > 0) {
    parts.push(buildAccountCodeRootsPredicate(rule.codeRoots, direction))
  }
  for (const keyword of rule.nameKeywords) {
    parts.push(buildAccountCategoryPredicate(keyword, direction))
  }
  if (parts.length === 0) return '0'
  return `(${parts.join(' OR ')})`
}

function classifyExpenseGroupName(name: string): keyof Pick<DashboardCategoryRules, 'pureExpense' | 'fee' | 'cost'> {
  if (name.includes('成本')) return 'cost'
  if (name.includes('费用')) return 'fee'
  if (name.includes('支出')) return 'pureExpense'
  if (name.includes('损失')) return 'pureExpense'
  return 'pureExpense'
}

type AccountProbe = {
  code: string
  name: string
  direction: string
}

type TemplateGroup = {
  groupName: string
  roots: string[]
}

/** 2019 政府会计制度 — 预算会计科目（双体系取数，按名称匹配现有科目） */
const GOVERNMENT_BUDGET_REVENUE_GROUPS: TemplateGroup[] = [
  { groupName: '财政拨款预算收入', roots: ['6001'] },
  { groupName: '事业预算收入', roots: ['6101'] },
  { groupName: '上级补助预算收入', roots: ['6201'] },
  { groupName: '附属单位上缴预算收入', roots: ['6301'] },
  { groupName: '经营预算收入', roots: ['6401'] },
  { groupName: '债务预算收入', roots: ['6501'] },
  { groupName: '非同级财政拨款预算收入', roots: ['6601'] },
  { groupName: '投资预算收益', roots: ['6602'] },
  { groupName: '其他预算收入', roots: ['6609'] },
]

const GOVERNMENT_BUDGET_EXPENDITURE_GROUPS: TemplateGroup[] = [
  { groupName: '行政支出', roots: ['7101'] },
  { groupName: '事业支出', roots: ['7201'] },
  { groupName: '经营支出', roots: ['7301'] },
  { groupName: '上缴上级支出', roots: ['7401'] },
  { groupName: '对附属单位补助支出', roots: ['7501'] },
  { groupName: '投资支出', roots: ['7601'] },
  { groupName: '债务还本支出', roots: ['7701'] },
  { groupName: '其他支出', roots: ['7901'] },
]

function loadAccountProbes(db: Database, accountSetId: string): AccountProbe[] {
  return db
    .prepare(
      `SELECT code, name, direction
       FROM accounts
       WHERE account_set_id = ?
       ORDER BY code`
    )
    .all(accountSetId) as AccountProbe[]
}

function accountMatchesGroupName(accountName: string, groupName: string): boolean {
  if (accountName.includes(groupName)) return true

  const core = groupName.replace(/(预算收入|预算支出|收入|费用|支出|成本|损失)$/, '').trim()
  if (core.length < 3 || !accountName.includes(core)) return false

  if (groupName.endsWith('收入') && !accountName.includes('收入')) return false
  if (groupName.endsWith('费用') && !accountName.includes('费用')) return false
  if (groupName.endsWith('支出') && !accountName.includes('支出')) return false
  if (groupName.endsWith('成本') && !accountName.includes('成本')) return false
  if (groupName.endsWith('损失') && !accountName.includes('损失')) return false

  return true
}

function pickMinimalCodeRoots(matched: AccountProbe[], templateRoot: string): string[] {
  const exact = matched.find(item => item.code === templateRoot)
  if (exact) return [exact.code]

  const sorted = [...matched].sort((a, b) => a.code.length - b.code.length)
  const selected: string[] = []
  for (const account of sorted) {
    const hasParentInSet = sorted.some(
      other => other.code !== account.code && account.code.startsWith(other.code)
    )
    if (!hasParentInSet) selected.push(account.code)
  }
  return selected
}

function pickCodeRootsFromExistingAccounts(
  accounts: AccountProbe[],
  templateRoots: string[],
  direction: 'credit' | 'debit',
  groupName: string
): string[] {
  const codes = new Set<string>()

  for (const root of templateRoots) {
    const matched = accounts.filter(
      item =>
        item.direction === direction && (item.code === root || item.code.startsWith(root))
    )
    if (matched.length === 0) continue

    const nameMatched = matched.filter(item => accountMatchesGroupName(item.name, groupName))
    if (nameMatched.length === 0) continue

    pickMinimalCodeRoots(nameMatched, root).forEach(code => codes.add(code))
  }

  if (codes.size === 0) {
    accounts
      .filter(item => item.direction === direction && accountMatchesGroupName(item.name, groupName))
      .forEach(item => codes.add(item.code))
  }

  return [...codes]
}

function appendTemplateGroups(
  rules: DashboardCategoryRules,
  accounts: AccountProbe[],
  groups: Record<string, string[]>,
  direction: 'credit' | 'debit',
  bucket?: keyof Pick<DashboardCategoryRules, 'pureExpense' | 'fee' | 'cost'>
) {
  for (const [groupName, templateRoots] of Object.entries(groups)) {
    const codes = pickCodeRootsFromExistingAccounts(accounts, templateRoots, direction, groupName)
    if (bucket) {
      rules[bucket].codeRoots.push(...codes)
    } else {
      rules.income.codeRoots.push(...codes)
    }
  }
}

function dedupeDashboardRules(rules: DashboardCategoryRules): DashboardCategoryRules {
  const keys = ['income', 'pureExpense', 'fee', 'cost'] as const
  const result = {} as DashboardCategoryRules
  for (const key of keys) {
    result[key] = {
      codeRoots: [...new Set(rules[key].codeRoots)],
      nameKeywords: [...rules[key].nameKeywords],
    }
  }
  return result
}

/** 仅保留账套中实际存在的科目编码，不修改科目表数据 */
export function filterDashboardRulesToExistingAccounts(
  db: Database,
  accountSetId: string,
  rules: DashboardCategoryRules,
  accountProbes?: AccountProbe[]
): DashboardCategoryRules {
  const probes = accountProbes ?? loadAccountProbes(db, accountSetId)
  const codeSet = new Set(probes.map(item => item.code))
  const keys = ['income', 'pureExpense', 'fee', 'cost'] as const
  const filtered = {} as DashboardCategoryRules
  for (const key of keys) {
    filtered[key] = {
      codeRoots: rules[key].codeRoots.filter(code => codeSet.has(code)),
      nameKeywords: [...rules[key].nameKeywords],
    }
  }
  return filtered
}

export function buildPresetDashboardCategoryRules(
  db: Database,
  accountSetId: string,
  standard: StaticReportStandard,
  accountProbes?: AccountProbe[]
): DashboardCategoryRules {
  const accounts = accountProbes ?? loadAccountProbes(db, accountSetId)
  const config = getIncomeStatementConfig(standard)
  const rules: DashboardCategoryRules = {
    income: { codeRoots: [], nameKeywords: [] },
    pureExpense: { codeRoots: [], nameKeywords: [] },
    fee: { codeRoots: [], nameKeywords: [] },
    cost: { codeRoots: [], nameKeywords: [] },
  }

  appendTemplateGroups(rules, accounts, config.revenueGroups, 'credit')

  for (const [groupName, templateRoots] of Object.entries(config.expenseGroups)) {
    const bucket = classifyExpenseGroupName(groupName)
    rules[bucket].codeRoots.push(
      ...pickCodeRootsFromExistingAccounts(accounts, templateRoots, 'debit', groupName)
    )
  }

  return dedupeDashboardRules(rules)
}

export function buildPresetDashboardBudgetRules(
  db: Database,
  accountSetId: string,
  standard: StaticReportStandard,
  accountProbes?: AccountProbe[]
): DashboardBudgetRules {
  const rules: DashboardBudgetRules = {
    income: { codeRoots: [], nameKeywords: [] },
    expense: { codeRoots: [], nameKeywords: [] },
  }
  if (standard !== 'government') return rules

  const accounts = accountProbes ?? loadAccountProbes(db, accountSetId)
  for (const group of GOVERNMENT_BUDGET_REVENUE_GROUPS) {
    rules.income.codeRoots.push(
      ...pickCodeRootsFromExistingAccounts(accounts, group.roots, 'credit', group.groupName)
    )
  }
  for (const group of GOVERNMENT_BUDGET_EXPENDITURE_GROUPS) {
    rules.expense.codeRoots.push(
      ...pickCodeRootsFromExistingAccounts(accounts, group.roots, 'debit', group.groupName)
    )
  }
  return {
    income: { ...rules.income, codeRoots: [...new Set(rules.income.codeRoots)] },
    expense: { ...rules.expense, codeRoots: [...new Set(rules.expense.codeRoots)] },
  }
}

function filterBudgetRulesToExistingAccounts(
  rules: DashboardBudgetRules,
  accountProbes: AccountProbe[]
): DashboardBudgetRules {
  const codeSet = new Set(accountProbes.map(item => item.code))
  return {
    income: {
      codeRoots: rules.income.codeRoots.filter(code => codeSet.has(code)),
      nameKeywords: [...rules.income.nameKeywords],
    },
    expense: {
      codeRoots: rules.expense.codeRoots.filter(code => codeSet.has(code)),
      nameKeywords: [...rules.expense.nameKeywords],
    },
  }
}

export type DashboardCategoryPredicates = {
  income: string
  pureExpense: string
  fee: string
  cost: string
  expense: string
}

export type DashboardCategoryConfig = {
  standard: StaticReportStandard | 'custom'
  standardName: string
  dashboardRuleMode: DashboardRuleMode
  resolvedPreset: StaticReportStandard | null
  rules: DashboardCategoryRules
  predicates: DashboardCategoryPredicates
  budgetRules: DashboardBudgetRules
  budgetPredicates: Pick<DashboardCategoryPredicates, 'income' | 'expense'>
  ruleConfig: DashboardRuleConfigV2
}

function buildPredicatesFromRules(rules: DashboardCategoryRules): DashboardCategoryPredicates {
  const income = buildCategoryPredicate(rules.income, 'credit')
  const pureExpense = buildCategoryPredicate(rules.pureExpense, 'debit')
  const fee = buildCategoryPredicate(rules.fee, 'debit')
  const cost = buildCategoryPredicate(rules.cost, 'debit')
  const expense = `(${pureExpense} OR ${fee} OR ${cost})`
  return { income, pureExpense, fee, cost, expense }
}

function buildBudgetPredicates(
  rules: DashboardBudgetRules
): Pick<DashboardCategoryPredicates, 'income' | 'expense'> {
  return {
    income: buildCategoryPredicate(rules.income, 'credit'),
    expense: buildCategoryPredicate(rules.expense, 'debit'),
  }
}

function resolveDashboardRuleMode(
  param: ReturnType<typeof getAccountingStandardParam>
): DashboardRuleMode {
  if (param === 'custom') return 'custom'
  if (param === 'auto') return 'auto'
  return 'preset'
}

function resolveEffectivePresetRules(
  saved: DashboardCategoryRules,
  preset: DashboardCategoryRules
): DashboardCategoryRules {
  const keys = ['income', 'pureExpense', 'fee', 'cost'] as const
  const result = {} as DashboardCategoryRules
  for (const key of keys) {
    if (saved[key].codeRoots.length > 0) {
      result[key] = {
        codeRoots: [...saved[key].codeRoots],
        nameKeywords: [...saved[key].nameKeywords],
      }
    } else {
      result[key] = {
        codeRoots: [...preset[key].codeRoots],
        nameKeywords: [...preset[key].nameKeywords],
      }
    }
  }
  return result
}

export function getDashboardCategoryConfig(
  db: Database,
  accountSetId: string
): DashboardCategoryConfig {
  const param = getAccountingStandardParam(db, accountSetId)
  const dashboardRuleMode = resolveDashboardRuleMode(param)
  const savedConfig = getDashboardRuleConfigParam(db, accountSetId)
  const savedRules = savedConfig.financial
  const savedHasCodeRoots = hasAnyCodeRoots(savedRules)
  const accountProbes = loadAccountProbes(db, accountSetId)

  if (param === 'custom') {
    const normalizedRules = normalizeRulesWithFallback(savedRules)
    const rules = filterDashboardRulesToExistingAccounts(
      db,
      accountSetId,
      normalizedRules,
      accountProbes
    )
    const budgetRules = filterBudgetRulesToExistingAccounts(savedConfig.budget, accountProbes)
    const ruleConfig: DashboardRuleConfigV2 = {
      version: 2,
      customized: true,
      financial: rules,
      budget: budgetRules,
    }
    return {
      standard: 'custom',
      standardName: '自定义规则',
      dashboardRuleMode,
      resolvedPreset: null,
      rules,
      predicates: buildPredicatesFromRules(rules),
      budgetRules,
      budgetPredicates: buildBudgetPredicates(budgetRules),
      ruleConfig,
    }
  }

  const detected = resolveAccountingStandard(db, accountSetId)
  const resolved = detected === 'custom' ? detectStaticReportStandard(db, accountSetId) : detected
  const config = getIncomeStatementConfig(resolved)
  const presetRules = buildPresetDashboardCategoryRules(db, accountSetId, resolved, accountProbes)
  const presetBudgetRules = buildPresetDashboardBudgetRules(db, accountSetId, resolved, accountProbes)
  const mergedRules = savedConfig.customized && savedHasCodeRoots
    ? resolveEffectivePresetRules(savedRules, presetRules)
    : presetRules
  const mergedBudgetRules = savedConfig.customized ? savedConfig.budget : presetBudgetRules
  const rules = filterDashboardRulesToExistingAccounts(db, accountSetId, mergedRules, accountProbes)
  const budgetRules = filterBudgetRulesToExistingAccounts(mergedBudgetRules, accountProbes)
  const ruleConfig: DashboardRuleConfigV2 = {
    version: 2,
    customized: savedConfig.customized,
    financial: rules,
    budget: budgetRules,
  }

  return {
    standard: resolved,
    standardName: config.standardName,
    dashboardRuleMode,
    resolvedPreset: resolved,
    rules,
    predicates: buildPredicatesFromRules(rules),
    budgetRules,
    budgetPredicates: buildBudgetPredicates(budgetRules),
    ruleConfig,
  }
}

function normalizeRulesWithFallback(rules: DashboardCategoryRules): DashboardCategoryRules {
  const normalized = {
    income: { ...rules.income, codeRoots: [...rules.income.codeRoots], nameKeywords: [...rules.income.nameKeywords] },
    pureExpense: {
      ...rules.pureExpense,
      codeRoots: [...rules.pureExpense.codeRoots],
      nameKeywords: [...rules.pureExpense.nameKeywords],
    },
    fee: { ...rules.fee, codeRoots: [...rules.fee.codeRoots], nameKeywords: [...rules.fee.nameKeywords] },
    cost: { ...rules.cost, codeRoots: [...rules.cost.codeRoots], nameKeywords: [...rules.cost.nameKeywords] },
  }

  for (const key of Object.keys(DEFAULT_DASHBOARD_CATEGORY_RULES) as Array<keyof DashboardCategoryRules>) {
    if (!hasConfiguredDashboardRule(normalized[key])) {
      normalized[key] = { ...DEFAULT_DASHBOARD_CATEGORY_RULES[key] }
    }
  }

  return normalized
}

export function getResolvedAccountingStandardName(
  db: Database,
  accountSetId: string
): string {
  const config = getDashboardCategoryConfig(db, accountSetId)
  if (config.dashboardRuleMode === 'auto' && config.resolvedPreset) {
    return `${ACCOUNTING_STANDARD_LABELS.auto}（${config.standardName}）`
  }
  if (config.dashboardRuleMode === 'preset' && config.resolvedPreset) {
    return config.standardName
  }
  if (config.standard === 'custom') {
    return '自定义规则'
  }
  return config.standardName
}
