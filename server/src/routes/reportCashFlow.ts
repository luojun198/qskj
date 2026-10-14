/**
 * 静态现金流量表（估算）路由
 *
 * 拆分自 reportIncomeStatement.ts —— 利润表、资产负债表、权益变动表等其他静态报表
 * 已废弃（前端改用动态报表 DynamicReport + report_definitions 模板）；
 * 此处仅保留"现金流量表"作为辅助估算入口（前端菜单：现金流量表(估算)）。
 *
 * 注意：本表仍属于估算口径，正式报送请使用动态报表模板（@xj_je 直接法）。
 */
import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import { getBatchBalances, getBatchPeriodRangeSums } from '../services/reportBalance.js'
import { MONEY_EPSILON } from '../utils/amountUtils.js'
import type { CashFlowReportScope } from '../services/cashFlowIndirectMethod.js'
import {
  collectCashFlowCodes,
  resolveStaticReportStandard,
  getCashFlowConfig,
} from '../services/staticReportConfig.js'
import { buildCashFlowReconciliation } from '../services/cashFlowReconciliation.js'
import {
  expandFlowAccountCodes,
  sumPeriodFlowByPatterns,
} from '../services/staticCashFlowExpand.js'
import { computeCashFlowByMapping, getMainItemAmount } from '../services/cashFlowAutoEngine.js'
import { getEffectiveCashFlowMapping } from '../services/cashFlowAccountMap.js'
import { SUPPLEMENT_ITEMS, SUPPLEMENT_NET_PROFIT_CODE } from '../config/cashFlowAccountDefaults.js'

const router = Router()
router.use(authMiddleware)

function parseReportYear(value: unknown): number {
  let year = Number(value) || new Date().getFullYear()
  if (year < 100) {
    year += 2000
  }
  return year
}

function parseCashFlowScope(value: unknown): CashFlowReportScope {
  return value === 'ytd' ? 'ytd' : 'month'
}

router.get('/cash-flow', (req: AuthRequest, res) => {
  const db = getDb()
  const { year, period, scope: scopeQuery } = req.query
  const y = parseReportYear(year)
  const p = Number(period) || new Date().getMonth() + 1
  const scope = parseCashFlowScope(scopeQuery)
  const accountSetId = req.accountSetId!
  const standard = resolveStaticReportStandard(db, accountSetId)
  const config = getCashFlowConfig(standard)
  const flowPatterns = collectCashFlowCodes(config)
  const expandedCodes = expandFlowAccountCodes(db, accountSetId, flowPatterns)
  const fromPeriod = scope === 'ytd' ? 1 : p
  // FIX-143：静态现金流量表按损益/权益科目发生额估算，必须排除结转凭证（结转损益 / 利润分配结转），
  // 否则 3103/5xxx 等行次被结转分录重复命中
  const periodSumMap = getBatchPeriodRangeSums(
    db,
    accountSetId,
    expandedCodes,
    y,
    fromPeriod,
    p,
    req.accountScope,
    { excludeClosing: true }
  )

  const calcPeriodFlow = (patterns: string[], isDebit: boolean): number =>
    sumPeriodFlowByPatterns(db, accountSetId, patterns, isDebit, periodSumMap)

  const operatingActivities: Record<string, number> = {}
  let totalOperatingInflow = 0
  for (const [name, codes] of Object.entries(config.operatingInflowCodes)) {
    const amount = calcPeriodFlow(codes, false)
    if (amount !== 0) {
      operatingActivities[`流入_${name}`] = amount
    }
    totalOperatingInflow += amount
  }

  let totalOperatingOutflow = 0
  for (const [name, codes] of Object.entries(config.operatingOutflowCodes)) {
    const amount = calcPeriodFlow(codes, true)
    if (amount !== 0) {
      operatingActivities[`流出_${name}`] = amount
    }
    totalOperatingOutflow += amount
  }
  const netOperating = totalOperatingInflow - totalOperatingOutflow
  operatingActivities['净额'] = netOperating

  const investingActivities: Record<string, number> = {}
  let totalInvestingInflow = 0
  for (const [name, codes] of Object.entries(config.investingInflowCodes)) {
    const amount = calcPeriodFlow(codes, false)
    if (amount !== 0) {
      investingActivities[`流入_${name}`] = amount
    }
    totalInvestingInflow += amount
  }

  let totalInvestingOutflow = 0
  for (const [name, codes] of Object.entries(config.investingOutflowCodes)) {
    const amount = calcPeriodFlow(codes, true)
    if (amount !== 0) {
      investingActivities[`流出_${name}`] = amount
    }
    totalInvestingOutflow += amount
  }
  const netInvesting = totalInvestingInflow - totalInvestingOutflow
  investingActivities['净额'] = netInvesting

  const financingActivities: Record<string, number> = {}
  let totalFinancingInflow = 0
  for (const [name, codes] of Object.entries(config.financingInflowCodes)) {
    const amount = calcPeriodFlow(codes, false)
    if (amount !== 0) {
      financingActivities[`流入_${name}`] = amount
    }
    totalFinancingInflow += amount
  }

  let totalFinancingOutflow = 0
  for (const [name, codes] of Object.entries(config.financingOutflowCodes)) {
    const amount = calcPeriodFlow(codes, true)
    if (amount !== 0) {
      financingActivities[`流出_${name}`] = amount
    }
    totalFinancingOutflow += amount
  }
  const netFinancing = totalFinancingInflow - totalFinancingOutflow
  financingActivities['净额'] = netFinancing

  const netCashChange = netOperating + netInvesting + netFinancing
  const cashAccountCodes = expandFlowAccountCodes(db, accountSetId, config.cashCodes)
  const beginPeriod = scope === 'month' && p > 1 ? p - 1 : 0
  const beginBalanceMapExpanded = getBatchBalances(
    db,
    accountSetId,
    cashAccountCodes,
    y,
    beginPeriod,
    req.accountScope
  )
  const endBalanceMapExpanded = getBatchBalances(
    db,
    accountSetId,
    cashAccountCodes,
    y,
    p,
    req.accountScope
  )
  let beginCash = 0
  let endCash = 0
  for (const code of cashAccountCodes) {
    beginCash += beginBalanceMapExpanded.get(code) || 0
    endCash += endBalanceMapExpanded.get(code) || 0
  }

  const hasCashBalanceChange = Math.abs(endCash - beginCash) > MONEY_EPSILON
  const hasNetCashChange = Math.abs(netCashChange) > MONEY_EPSILON

  const cashFlowWarnings: string[] = []
  if (!hasCashBalanceChange && !hasNetCashChange) {
    cashFlowWarnings.push(
      '期初与期末现金余额均为零且无现金流量变动，如本期有现金收支业务，请检查科目是否正确标记为现金/银行科目'
    )
  } else if (!hasCashBalanceChange && hasNetCashChange) {
    cashFlowWarnings.push(
      '期初与期末现金余额相等，但存在现金流量净变动，请检查现金科目期初/期末余额取数是否正确'
    )
  }

  const reportPayload = {
    year: y,
    period: p,
    scope,
    reportDate: `${y}年${p}月${scope === 'ytd' ? '（本年累计）' : ''}`,
    accountingStandard: config.standard,
    accountingStandardName: config.standardName,
    operatingActivities,
    investingActivities,
    financingActivities,
    netCashChange,
    beginCash,
    endCash,
    cashBalanceCheck: Math.abs(endCash - beginCash - netCashChange) < 0.01,
    cashFlowWarnings,
  }

  const reconciliation = buildCashFlowReconciliation(
    db,
    accountSetId,
    y,
    p,
    reportPayload,
    scope,
    req.accountScope
  )

  const scopeNote =
    scope === 'month'
      ? '本表为当月科目发生额估算（辅助参考）'
      : '本表为本年累计科目发生额估算（辅助参考）'

  res.json({
    code: 0,
    data: {
      ...reportPayload,
      validation: reconciliation.validation,
      indirectMethod: reconciliation.indirectMethod,
      indirectComparison: reconciliation.indirectComparison,
      directMethod: reconciliation.directMethod,
      comparison: reconciliation.comparison,
      dynamicMethod: reconciliation.dynamicMethod,
      dynamicComparison: reconciliation.dynamicComparison,
      reportSourceNote: `${scopeNote}；正式报送请使用动态报表模板（@xj_je 直接法）`,
    },
  })
})

/**
 * 现金流量表（按「科目现金流量项目」自动计算）：主表直接法 + 补充资料间接法
 */
router.get('/cash-flow/auto', (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const accountSetId = req.accountSetId!
    const y = parseReportYear(req.query.year)
    const p = Math.min(12, Math.max(1, Number(req.query.period) || new Date().getMonth() + 1))
    const scope = parseCashFlowScope(req.query.scope)
    const fromPeriod = scope === 'ytd' ? 1 : p
    const result = computeCashFlowByMapping(db, accountSetId, y, fromPeriod, p, req.accountScope)
    const mapping = getEffectiveCashFlowMapping(db, accountSetId)
    const labels = mapping.profile.activityLabels

    const ACTIVITIES = [
      { key: 'operating', label: labels.operating },
      { key: 'investing', label: labels.investing },
      { key: 'financing', label: labels.financing },
    ] as const
    const mainItems = result.items.filter(i => i.kind !== 'supplement' && i.is_leaf !== 0)
    const sections = ACTIVITIES.map(act => {
      const pick = (flow: 'in' | 'out') =>
        mainItems
          .filter(i => {
            const cls = result.itemClass.get(i.code)
            return cls?.activity === act.key && cls?.flow === flow
          })
          .map(i => ({ code: i.code, name: i.name, amount: getMainItemAmount(result, i.code) }))
      const inflows = pick('in')
      const outflows = pick('out')
      const inflowTotal = Math.round(inflows.reduce((s, i) => s + i.amount, 0) * 100) / 100
      const outflowTotal = Math.round(outflows.reduce((s, i) => s + i.amount, 0) * 100) / 100
      return { key: act.key, label: act.label, inflows, outflows, inflowTotal, outflowTotal, net: result.activities[act.key] }
    })
    const others = mainItems
      .filter(i => {
        const cls = result.itemClass.get(i.code)
        return !cls?.activity || !cls?.flow
      })
      .map(i => ({ code: i.code, name: i.name, amount: getMainItemAmount(result, i.code) }))
      .filter(i => Math.abs(i.amount) >= 0.005)

    // 现金及现金等价物期初 / 期末余额：取最上层的现金类科目，避免上下级重复
    const cashTopCodes = mapping.accounts
      .filter(a => mapping.cashIds.has(a.id) && !(a.parent_id && mapping.cashIds.has(a.parent_id)))
      .map(a => a.code)
    const sumBalance = (period: number) => {
      const map = getBatchBalances(db, accountSetId, cashTopCodes, y, period, req.accountScope)
      return Math.round(cashTopCodes.reduce((s, c) => s + (map.get(c) || 0), 0) * 100) / 100
    }
    const beginCash = sumBalance(fromPeriod - 1)
    const endCash = sumBalance(p)

    // 只有企业会计准则编补充资料（小企业 / 政府 / 民非只有直接法主表）
    const supplement = (mapping.profile.hasSupplement ? SUPPLEMENT_ITEMS : []).map(s => ({
      code: s.code,
      name: s.name,
      amount: result.supplement.get(s.code) || 0,
      computed: s.code === SUPPLEMENT_NET_PROFIT_CODE,
    }))

    res.json({
      code: 0,
      data: {
        year: y,
        period: p,
        scope,
        fromPeriod,
        standard: mapping.standard,
        standardName: mapping.profile.name,
        hasSupplement: mapping.profile.hasSupplement,
        persisted: result.persisted,
        sections,
        others,
        netIncrease: result.activities.net,
        cashChange: result.cashChange,
        beginCash,
        endCash,
        supplement,
        netProfit: result.netProfit,
        indirectOperating: result.indirectOperating,
        directOperating: result.activities.operating,
        indirectDiff: Math.round((result.indirectOperating - result.activities.operating) * 100) / 100,
        unmapped: result.unmapped,
        unmappedTotal: Math.round((result.cashChange - result.activities.net) * 100) / 100,
      },
    })
  } catch (error: any) {
    console.error('现金流量表（自动）计算失败:', error)
    res.status(500).json({ code: 500, message: error.message || '计算失败' })
  }
})

export default router
