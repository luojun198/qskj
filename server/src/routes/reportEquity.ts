/**
 * ⚠️ 已废弃 — 请勿在 index.ts 重新挂载
 *
 * 静态净资产变动表 / 财政拨款收入支出表已被动态报表取代。
 * 静态实现依赖 reportBalance.getBalance / getPeriodSum，与
 * account_balances.end_balance 跨期错误共用同一数据源（见代码评审 P0-2/P0-3）。
 */
import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import { getBalance, getPeriodSum } from '../services/reportBalance.js'

const router = Router()
router.use(authMiddleware)

// ===================== 净资产变动表 =====================
// 反映净资产各项目的期初、本期增加、本期减少、期末余额
router.get('/equity-changes', (req: AuthRequest, res) => {
  const db = getDb()
  const { year, period } = req.query
  const y = Number(year) || new Date().getFullYear()
  const p = Number(period) || new Date().getMonth() + 1

  const equityItems = [
    { code: '3001', name: '累计盈余' },
    { code: '3101', name: '专用基金' },
    { code: '3201', name: '权益法调整' },
    { code: '3301', name: '本期盈余' },
    { code: '3302', name: '本年盈余分配' },
    { code: '3401', name: '无偿调拨净资产' },
    { code: '3501', name: '以前年度盈余调整' },
  ]

  const result = equityItems.map(item => {
    const beginBal = getBalance(db, req.accountSetId!, item.code, y, 0)
    const currentBal = getBalance(db, req.accountSetId!, item.code, y, p)
    // 本期增加/减少通过发生额推算
    const sum = getPeriodSum(db, req.accountSetId!, item.code, y, p)
    const dir = getBalance(db, req.accountSetId!, item.code, y, 1) >= 0 ? 'credit' : 'debit'
    // 对于贷方余额科目：期末=期初+贷方-借方 => 本期增加=贷方发生, 本期减少=借方发生
    // 对于借方余额科目：期末=期初+借方-贷方 => 本期增加=借方发生, 本期减少=贷方发生
    let increase = 0
    let decrease = 0
    if (dir === 'credit') {
      increase = sum.credit
      decrease = sum.debit
    } else {
      increase = sum.debit
      decrease = sum.credit
    }
    return {
      code: item.code,
      name: item.name,
      beginBalance: beginBal,
      increase,
      decrease,
      endBalance: currentBal,
    }
  })

  res.json({
    code: 0,
    data: {
      year: y,
      period: p,
      reportDate: `${y}年${p}月`,
      items: result,
    },
  })
})

// ===================== 财政拨款收入支出表 =====================
// 专门反映财政拨款收入、支出及结转结余情况
router.get('/fiscal-appropriation', (req: AuthRequest, res) => {
  const db = getDb()
  const { year, period } = req.query
  const y = Number(year) || new Date().getFullYear()
  const p = Number(period) || new Date().getMonth() + 1

  // 财政拨款收入（4001）的明细科目
  const fiscalRevenueCodes = {
    一般公共预算拨款: ['400101'],
    政府性基金预算拨款: ['400102'],
    国有资本经营预算拨款: ['400103'],
    财政直接支付: ['400104'],
    财政授权支付: ['400105'],
  }

  // 财政应返还额度（1218）— 年度未使用完的财政授权支付额度
  const fiscalQuotaCodes = {
    财政直接支付额度: ['121801'],
    财政授权支付额度: ['121802'],
  }

  const calcFiscalRevenue = () => {
    const revenues: Record<string, number> = {}
    let total = 0
    for (const [name, codes] of Object.entries(fiscalRevenueCodes)) {
      let amt = 0
      for (const code of codes) {
        const sum = getPeriodSum(db, req.accountSetId!, code, y, p)
        // 贷方发生额即为实际拨入
        amt += sum.credit
      }
      if (amt !== 0) revenues[name] = amt
      total += amt
    }
    return { revenues, total }
  }

  const calcFiscalQuota = () => {
    const quotas: Record<string, number> = {}
    let total = 0
    for (const [name, codes] of Object.entries(fiscalQuotaCodes)) {
      let amt = 0
      for (const code of codes) {
        amt += getBalance(db, req.accountSetId!, code, y, p)
      }
      if (amt !== 0) quotas[name] = amt
      total += amt
    }
    return { quotas, total }
  }

  const { revenues, total: totalRevenue } = calcFiscalRevenue()
  const { quotas, total: totalQuota } = calcFiscalQuota()

  // 预算支出（使用财政拨款的费用科目）
  const budgetExpenseCodes = {
    基本支出: ['500101'],
    项目支出: ['500102'],
  }
  const expenses: Record<string, number> = {}
  let totalExpense = 0
  for (const [name, codes] of Object.entries(budgetExpenseCodes)) {
    let amt = 0
    for (const code of codes) {
      const sum = getPeriodSum(db, req.accountSetId!, code, y, p)
      amt += sum.debit
    }
    if (amt !== 0) expenses[name] = amt
    totalExpense += amt
  }

  res.json({
    code: 0,
    data: {
      year: y,
      period: p,
      reportDate: `${y}年${p}月`,
      fiscalRevenue: revenues,
      totalFiscalRevenue: totalRevenue,
      fiscalQuota: quotas,
      totalFiscalQuota: totalQuota,
      budgetExpense: expenses,
      totalBudgetExpense: totalExpense,
      netFiscalSurplus: totalRevenue - totalExpense,
    },
  })
})

export default router
