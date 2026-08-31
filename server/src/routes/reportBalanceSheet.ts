/**
 * ⚠️ 已废弃 — 请勿在 index.ts 重新挂载
 *
 * 静态资产负债表已被动态报表（DynamicReport + report_definitions）取代。
 * 静态实现存在已知 BUG：
 *   - 余额表 / account_balances.end_balance 跨期累计错误（见代码评审 P0-2/P0-3）
 *   - getBatchBalances 在期末余额计算上无法处理结转期间
 * 仅保留源代码用于历史参考，未在 index.ts 中注册路由。
 */
import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import { getBatchBalances } from '../services/reportBalance.js'
import {
  collectBalanceSheetCodes,
  detectStaticReportStandard,
  getBalanceSheetConfig,
  type BalanceSheetGroup,
} from '../services/staticReportConfig.js'

const router = Router()
router.use(authMiddleware)

function parseReportYear(value: unknown): number {
  let year = Number(value) || new Date().getFullYear()
  if (year < 100) {
    year += 2000
  }
  return year
}

function calcGroup(
  balanceMap: Map<string, number>,
  group: BalanceSheetGroup
): { lines: Record<string, number>; total: number } {
  const lines: Record<string, number> = {}
  let total = 0

  for (const code of group.codes) {
    const balance = balanceMap.get(code) || 0
    if (balance !== 0) {
      lines[code] = balance
    }
    total += balance
  }

  for (const code of group.deductCodes || []) {
    const balance = Math.abs(balanceMap.get(code) || 0)
    if (balance !== 0) {
      lines[code] = -balance
    }
    total -= balance
  }

  return { lines, total }
}

function calcCodeGroup(balanceMap: Map<string, number>, codes: string[]) {
  return calcGroup(balanceMap, { codes })
}

router.get('/balance-sheet', (req: AuthRequest, res) => {
  const db = getDb()
  const { year, period } = req.query
  const y = parseReportYear(year)
  const p = Number(period) || new Date().getMonth() + 1
  const accountSetId = req.accountSetId!
  const standard = detectStaticReportStandard(db, accountSetId)
  const config = getBalanceSheetConfig(standard)
  const allCodes = collectBalanceSheetCodes(config)
  const balanceMap = getBatchBalances(db, accountSetId, allCodes, y, p)

  const result: Record<string, Record<string, number>> = {}
  let totalAssets = 0
  for (const [group, groupConfig] of Object.entries(config.assetGroups)) {
    const item = calcGroup(balanceMap, groupConfig)
    result[group] = item.lines
    totalAssets += item.total
  }

  let totalLiabilities = 0
  for (const [group, codes] of Object.entries(config.liabilityGroups)) {
    const item = calcCodeGroup(balanceMap, codes)
    result[group] = item.lines
    totalLiabilities += item.total
  }

  let totalEquity = 0
  for (const [group, codes] of Object.entries(config.equityGroups)) {
    const item = calcCodeGroup(balanceMap, codes)
    result[group] = item.lines
    totalEquity += item.total
  }

  const deductions: Record<string, number> = {}
  for (const group of Object.values(config.assetGroups)) {
    for (const code of group.deductCodes || []) {
      const balance = Math.abs(balanceMap.get(code) || 0)
      if (balance !== 0) {
        deductions[code] = balance
      }
    }
  }

  res.json({
    code: 0,
    data: {
      year: y,
      period: p,
      reportDate: `${y}年${p}月`,
      accountingStandard: config.standard,
      accountingStandardName: config.standardName,
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
      balanced: Math.abs(totalAssets - totalLiabilities - totalEquity) < 0.01,
      items: result,
      deductions,
    },
  })
})

export default router
