import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import { appendAccountScopeCondition } from '../services/accountAuthorization.js'

const router = Router()
router.use(authMiddleware)

interface CoverageSummary {
  totalCodes: number
  hitCount: number
  hitCodes: string[]
  missingCodes: string[]
}

function toNumberOrDefault(value: unknown, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function uniqueSortedCodes(codes: string[]) {
  return Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b))
}

function buildCoverage(codes: string[], presentCodeSet: Set<string>): CoverageSummary {
  const normalized = uniqueSortedCodes(codes)
  const hitCodes = normalized.filter(code => presentCodeSet.has(code))
  const missingCodes = normalized.filter(code => !presentCodeSet.has(code))

  return {
    totalCodes: normalized.length,
    hitCount: hitCodes.length,
    hitCodes,
    missingCodes,
  }
}

router.get('/diagnostics/posting-status', (req: AuthRequest, res) => {
  const db = getDb()
  const { year, period } = req.query
  const now = new Date()
  const resolvedYear = toNumberOrDefault(year, now.getFullYear())
  const resolvedPeriod = toNumberOrDefault(period, now.getMonth() + 1)
  const accountSetId = req.accountSetId || ''

  const latestPostedVoucher = db
    .prepare(
      `
      SELECT year, period, voucher_date, COUNT(*) as voucher_count
      FROM vouchers
      WHERE account_set_id=? AND status='posted'
      GROUP BY year, period, voucher_date
      ORDER BY year DESC, period DESC, voucher_date DESC
      LIMIT 1
    `
    )
    .get(accountSetId) as
    | { year: number; period: number; voucher_date: string; voucher_count: number }
    | undefined

  const postedVoucherCount = db
    .prepare(
      `
      SELECT COUNT(*) as total
      FROM vouchers
      WHERE account_set_id=? AND year=? AND period=? AND status='posted'
    `
    )
    .get(accountSetId, resolvedYear, resolvedPeriod) as { total: number }

  const allVoucherCount = db
    .prepare(
      `
      SELECT COUNT(*) as total
      FROM vouchers
      WHERE account_set_id=? AND year=? AND period=?
    `
    )
    .get(accountSetId, resolvedYear, resolvedPeriod) as { total: number }

  const postedEntryConditions = [
    've.account_set_id=?',
    'v.account_set_id=?',
    'v.year=?',
    'v.period=?',
    "v.status='posted'",
  ]
  const postedEntryParams: Array<string | number> = [
    accountSetId,
    accountSetId,
    resolvedYear,
    resolvedPeriod,
  ]
  appendAccountScopeCondition(req.accountScope, 've.account_id', postedEntryConditions, postedEntryParams)
  const postedEntriesCount = db
    .prepare(
      `
      SELECT COUNT(*) as total
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      WHERE ${postedEntryConditions.join(' AND ')}
    `
    )
    .get(...postedEntryParams) as { total: number }

  const allEntryConditions = [
    've.account_set_id=?',
    'v.account_set_id=?',
    'v.year=?',
    'v.period=?',
  ]
  const allEntryParams: Array<string | number> = [
    accountSetId,
    accountSetId,
    resolvedYear,
    resolvedPeriod,
  ]
  appendAccountScopeCondition(req.accountScope, 've.account_id', allEntryConditions, allEntryParams)
  const allEntriesCount = db
    .prepare(
      `
      SELECT COUNT(*) as total
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      WHERE ${allEntryConditions.join(' AND ')}
    `
    )
    .get(...allEntryParams) as { total: number }

  const balanceRowsCount = db
    .prepare(
      `
      SELECT COUNT(*) as total
      FROM account_balances
      WHERE account_set_id=? AND year=? AND period=?
    `
    )
    .get(accountSetId, resolvedYear, resolvedPeriod) as { total: number }

  const activeBalanceRowsCount = db
    .prepare(
      `
      SELECT COUNT(*) as total
      FROM account_balances
      WHERE account_set_id=? AND year=? AND period=? AND (current_debit <> 0 OR current_credit <> 0)
    `
    )
    .get(accountSetId, resolvedYear, resolvedPeriod) as { total: number }

  const yearInitBalanceRows = db
    .prepare(
      `
      SELECT COUNT(*) as total
      FROM init_balances
      WHERE account_set_id=? AND year=?
    `
    )
    .get(accountSetId, resolvedYear) as { total: number }

  const postedAmountConditions = [...postedEntryConditions]
  const postedAmountParams = [...postedEntryParams]
  const postedVoucherAmount = db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE 0 END) as total_debit,
        SUM(CASE WHEN ve.direction='credit' THEN ve.amount ELSE 0 END) as total_credit
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      WHERE ${postedAmountConditions.join(' AND ')}
    `
    )
    .get(...postedAmountParams) as {
    total_debit: number | null
    total_credit: number | null
  }

  const balanceAmount = db
    .prepare(
      `
      SELECT SUM(current_debit) as total_debit, SUM(current_credit) as total_credit
      FROM account_balances
      WHERE account_set_id=? AND year=? AND period=?
    `
    )
    .get(accountSetId, resolvedYear, resolvedPeriod) as {
    total_debit: number | null
    total_credit: number | null
  }

  const balanceCodeRows = db
    .prepare(
      `
      SELECT DISTINCT account_code
      FROM account_balances
      WHERE account_set_id=? AND year=? AND period=? AND (current_debit <> 0 OR current_credit <> 0)
    `
    )
    .all(accountSetId, resolvedYear, resolvedPeriod) as Array<{ account_code: string }>

  const postedEntryCodeRows = db
    .prepare(
      `
      SELECT DISTINCT ve.account_code
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      WHERE ${postedEntryConditions.join(' AND ')}
    `
    )
    .all(...postedEntryParams) as Array<{ account_code: string }>

  const balanceCodeSet = new Set(balanceCodeRows.map(row => row.account_code))
  const postedEntryCodeSet = new Set(postedEntryCodeRows.map(row => row.account_code))

  const balanceSheetCodes = [
    '1001',
    '1002',
    '1011',
    '1012',
    '1021',
    '1101',
    '1211',
    '1212',
    '1214',
    '1301',
    '1401',
    '1501',
    '1511',
    '1218',
    '1611',
    '1613',
    '1891',
    '1901',
    '1601',
    '1801',
    '1701',
    '1803',
    '1811',
    '1821',
    '2001',
    '2101',
    '2102',
    '2103',
    '2105',
    '2106',
    '2201',
    '2202',
    '2301',
    '2302',
    '2305',
    '2401',
    '2901',
    '2501',
    '2502',
    '2601',
    '3001',
    '3101',
    '3201',
    '3301',
    '3302',
    '3401',
    '3501',
    '1602',
    '1603',
    '1702',
    '1703',
    '1802',
  ]

  const incomeCodes = [
    '4001',
    '4101',
    '4201',
    '4301',
    '4401',
    '4601',
    '4701',
    '4801',
    '4901',
    '5001',
    '5101',
    '5201',
    '5301',
    '5401',
    '5501',
    '5601',
    '5901',
  ]

  const cashFlowCodes = [
    '1001',
    '1002',
    '1012',
    '100201',
    '100202',
    '100203',
    '100204',
    '100205',
    '100209',
    '4001',
    '4101',
    '4201',
    '4401',
    '4601',
    '4701',
    '4801',
    '4901',
    '50010101',
    '50010102',
    '500102',
    '5101',
    '5201',
    '5301',
    '5401',
    '5601',
    '5901',
    '1021',
    '1601',
    '1701',
    '1611',
    '2001',
    '2501',
  ]

  const equityChangeCodes = ['3001', '3101', '3201', '3301', '3302', '3401', '3501']

  const fiscalAppropriationCodes = [
    '400101',
    '400102',
    '400103',
    '400104',
    '400105',
    '121801',
    '121802',
    '500101',
    '500102',
  ]

  const entryOnlyCodes = Array.from(postedEntryCodeSet)
    .filter(code => !balanceCodeSet.has(code))
    .sort((a, b) => a.localeCompare(b))

  const hints: string[] = []
  if (postedVoucherCount.total > 0 && activeBalanceRowsCount.total === 0) {
    hints.push('当期存在已记账凭证，但 account_balances 当期无发生额，需检查记账写入逻辑或 account_set_id 是否一致。')
  }
  if (allVoucherCount.total > 0 && postedVoucherCount.total === 0) {
    hints.push('当期有凭证但没有已记账凭证，辅助余额表会返回空数据（该表强依赖 status=posted）。')
  }
  if (latestPostedVoucher) {
    if (latestPostedVoucher.year !== resolvedYear || latestPostedVoucher.period !== resolvedPeriod) {
      hints.push(
        `最近记账期间是 ${latestPostedVoucher.year}年${latestPostedVoucher.period}月，当前查询期间是 ${resolvedYear}年${resolvedPeriod}月，可能存在期间不一致。`
      )
    }
  } else {
    hints.push('当前账套没有任何已记账凭证。')
  }
  if (entryOnlyCodes.length > 0) {
    hints.push('存在已记账分录科目未出现在 account_balances 当期发生额中，需核对记账聚合口径。')
  }

  res.json({
    code: 0,
    data: {
      accountSetId,
      request: {
        rawYear: year ?? null,
        rawPeriod: period ?? null,
        resolvedYear,
        resolvedPeriod,
        authAccountSetId: accountSetId,
        requestHeaderAccountSetId: req.headers['x-accountset-id'] || null,
      },
      latestPostedPeriod: latestPostedVoucher
        ? {
            year: latestPostedVoucher.year,
            period: latestPostedVoucher.period,
            voucherDate: latestPostedVoucher.voucher_date,
            voucherCount: latestPostedVoucher.voucher_count,
          }
        : null,
      counts: {
        vouchers: {
          total: allVoucherCount.total,
          posted: postedVoucherCount.total,
        },
        voucherEntries: {
          total: allEntriesCount.total,
          postedOnly: postedEntriesCount.total,
        },
        accountBalances: {
          rows: balanceRowsCount.total,
          activeRows: activeBalanceRowsCount.total,
        },
        initBalances: {
          yearRows: yearInitBalanceRows.total,
        },
      },
      amountSummary: {
        postedVoucherEntries: {
          debit: postedVoucherAmount.total_debit || 0,
          credit: postedVoucherAmount.total_credit || 0,
        },
        accountBalances: {
          debit: balanceAmount.total_debit || 0,
          credit: balanceAmount.total_credit || 0,
        },
      },
      reportAccountCoverage: {
        balanceSheet: buildCoverage(balanceSheetCodes, balanceCodeSet),
        incomeStatement: buildCoverage(incomeCodes, balanceCodeSet),
        cashFlow: buildCoverage(cashFlowCodes, balanceCodeSet),
        equityChanges: buildCoverage(equityChangeCodes, balanceCodeSet),
        fiscalAppropriation: buildCoverage(fiscalAppropriationCodes, balanceCodeSet),
        auxBalance: {
          basedOnPostedEntries: buildCoverage(Array.from(postedEntryCodeSet), postedEntryCodeSet),
        },
      },
      codeSetDiff: {
        postedEntryCodesWithoutBalanceRows: entryOnlyCodes,
      },
      hints,
    },
  })
})

// 报表路由已拆分到以下文件：
// - reportBalanceSheet.ts - 资产负债表
// - reportIncomeStatement.ts - 收入费用表、现金流量表
// - reportEquity.ts - 净资产变动表、财政拨款收入支出表
// - reportAux.ts - 辅助余额表
// - reportAi.ts - AI功能

export default router
