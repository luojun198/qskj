import { v4 as uuidv4 } from 'uuid'
import dayjs from 'dayjs'
import type { Database } from 'better-sqlite3'
import {
  buildVoucherEntryPayloads,
  VOUCHER_ENTRY_INSERT_SQL,
  calculateVoucherTotals,
  getNextVoucherNo,
  getPeriodClosingRecord,
  isPeriodClosed,
  loadVoucherAuxiliaryData,
  type VoucherEntryInput,
} from './voucherEntry.js'
import {
  applyVoucherPosting,
  buildAuxItemId,
  loadVoucherEntries,
  type VoucherEntryLike,
  type VoucherLike,
  type PostingContext,
} from './voucherPosting.js'
import { applyAuxItemIdToEntryFields } from '../utils/auxItemId.js'
import { isYearlyTransferDue } from '../utils/transferPeriodType.js'
import { yuanToCents, MONEY_EPSILON } from '../utils/amountUtils.js'

export const AUTO_TRANSFER_TYPE = 'income-expense'

export interface AutoTransferPreviewEntry extends VoucherEntryInput {}

type TransferBalanceRow = {
  account_id: string
  account_code: string
  account_name: string
  end_balance?: number | null
  aux_item_id?: string | null
}

function appendTransferEntry(
  entries: AutoTransferPreviewEntry[],
  base: {
    account_id: string
    account_code: string
    account_name: string
    direction: 'debit' | 'credit'
    amount: number
    summary: string
  },
  auxItemId?: string | null
) {
  entries.push({
    ...base,
    ...(applyAuxItemIdToEntryFields(auxItemId || '') as Partial<AutoTransferPreviewEntry>),
  })
}

export function validateAutoTransferPeriod(year: number, period: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return '年度必须为 2000-2100 之间的整数'
  }
  if (!Number.isInteger(period) || period < 1 || period > 12) {
    return '期间必须为 1-12 月'
  }
  return null
}

export function getAutoTransferVoucherDate(year: number, period: number) {
  return dayjs(`${year}-${String(period).padStart(2, '0')}-01`)
    .endOf('month')
    .format('YYYY-MM-DD')
}

export function buildAutoTransferRemark(year: number, period: number) {
  return `${year}年${period}期自动结转`
}

export function getAutoTransferSummary(period: number, type: 'income' | 'expense' | 'balance') {
  if (type === 'income') return `${period}月收入结转`
  if (type === 'expense') return `${period}月费用结转`
  return `${period}月结转平衡`
}

/**
 * FIX-005 / P0-7：按会计准则识别"损益结转"涉及的收入/费用/本年利润科目。
 *
 * 三套准则下的编码体系完全不同，旧实现写死 4xxx 收入 / 5xxx 费用 / 3001 平衡，
 * 仅适配政府会计制度，在企业准则、小企业准则下会全部错乱。
 *
 * 各准则识别规则（保持与 detectStaticReportStandard 一致）：
 *   - enterprise（新企业会计准则）
 *     · 收入：6001–6303 等以 6 打头的贷方科目（含主营业务收入、营业外收入、投资收益等）
 *     · 费用：6401–6801 以 6 打头的借方科目（主营业务成本、销售/管理/财务费用、营业外支出、所得税等）
 *     · 平衡科目：本年利润 4103（兼容 4101）
 *   - small_business（小企业会计准则 2013）
 *     · 收入：5001 / 5051 / 5111 / 5301 等 5 打头的贷方科目
 *     · 费用：5401 / 5402 / 5403 / 5501 / 5502 / 5503 / 5601 / 5701 等 5 打头的借方科目
 *     · 平衡科目：本年利润 3131（部分版本 3103）
 *   - government（政府会计制度，财务会计口径）
 *     · 收入：4xxx 全部（财政拨款收入 / 事业收入 / 上级补助收入 等）
 *     · 费用：5xxx 全部（业务活动费用 / 单位管理费用 等）
 *     · 平衡科目：本期盈余 3201（兼容旧版"累计盈余 3001"）
 *
 * 实际识别采用两层判断：① 编码前缀；② 科目自身借贷方向。
 * 这样即使用户准则下科目细分有出入，按借贷方向自动归类也能避免错配。
 */
export type AutoTransferStandard = 'enterprise' | 'small_business' | 'government'

export interface AutoTransferAccount {
  id: string
  code: string
  name: string
  direction: string
}

/**
 * 取本年利润 / 累计盈余 类平衡科目候选编码列表（按准则）
 */
function getDefaultBalanceAccountCodes(standard: AutoTransferStandard): string[] {
  switch (standard) {
    case 'enterprise':
      return ['4103', '4101']
    case 'small_business':
      return ['3131', '3103']
    case 'government':
      return ['3201', '3001']
    default:
      return ['4103']
  }
}

/**
 * 损益科目前缀（与 staticReportConfig.getProfitLossAccountCodePrefixes 保持一致）
 */
function getProfitLossPrefixes(standard: AutoTransferStandard): string[] {
  switch (standard) {
    case 'enterprise':
      return ['6']
    case 'small_business':
      return ['5']
    case 'government':
      return ['4', '5']
    default:
      return ['6']
  }
}

/**
 * 按准则识别收入 / 费用 / 平衡科目（推荐新调用方使用此 API）。
 */
export function getProfitLossTransferAccounts(
  accounts: AutoTransferAccount[],
  opts: {
    standard: AutoTransferStandard
    preferredTargetCodes?: string[]
  }
) {
  const prefixes = getProfitLossPrefixes(opts.standard)
  const profitLossAccounts = accounts.filter(account =>
    prefixes.some(p => account.code.startsWith(p))
  )
  // 双判定：编码 + 借贷方向。收入是贷方科目；费用是借方科目。
  // 兼顾用户自定义科目时编码前缀不规范的情况。
  const incomeAccounts = profitLossAccounts.filter(account => account.direction === 'credit')
  const expenseAccounts = profitLossAccounts.filter(account => account.direction === 'debit')

  const preferredCodes = (opts.preferredTargetCodes ?? []).map(c => String(c).trim()).filter(Boolean)
  const defaultBalanceCodes = getDefaultBalanceAccountCodes(opts.standard)
  const balanceAccount =
    preferredCodes
      .map(code => accounts.find(account => account.code === code))
      .find((a): a is AutoTransferAccount => Boolean(a)) ||
    defaultBalanceCodes
      .map(code => accounts.find(account => account.code === code))
      .find((a): a is AutoTransferAccount => Boolean(a)) ||
    null

  return { incomeAccounts, expenseAccounts, balanceAccount }
}

/**
 * @deprecated 旧签名硬编码为政府会计制度规则，已被 getProfitLossTransferAccounts 取代。
 * 保留仅为外部调用兼容；新代码请显式传 standard 参数。
 */
export function getIncomeExpenseTransferAccounts(
  accounts: AutoTransferAccount[],
  preferredTargetCodes: string[] = []
) {
  return getProfitLossTransferAccounts(accounts, {
    standard: 'government',
    preferredTargetCodes,
  })
}

export function getAutoTransferTargetAccountCodes(params: {
  db: { prepare: (sql: string) => { all: (...args: any[]) => any[] } }
  accountSetId: string
}) {
  const rows = params.db
    .prepare(
      `SELECT param_key, param_value
       FROM system_params
       WHERE account_set_id=?
         AND param_key IN ('auto_transfer:balance_account_code', 'auto_transfer:surplus_account_code')
       ORDER BY CASE param_key
         WHEN 'auto_transfer:balance_account_code' THEN 1
         WHEN 'auto_transfer:surplus_account_code' THEN 2
         ELSE 99
       END`
    )
    .all(params.accountSetId) as Array<{ param_key?: string | null; param_value?: string | null }>

  return rows.map(row => String(row?.param_value || '').trim()).filter(code => Boolean(code))
}

export function buildAutoTransferEntries(params: {
  period: number
  incomeBalances: TransferBalanceRow[]
  expenseBalances: TransferBalanceRow[]
  balanceAccount: { id: string; code: string; name: string } | null
}) {
  const entries: AutoTransferPreviewEntry[] = []
  let totalIncome = 0
  let totalExpense = 0

  for (const balance of params.incomeBalances) {
    const amount = Math.abs(Number(balance.end_balance || 0))
    if (amount <= MONEY_EPSILON) continue
    totalIncome += amount
    appendTransferEntry(
      entries,
      {
        account_id: balance.account_id,
        account_code: balance.account_code,
        account_name: balance.account_name,
        direction: 'debit',
        amount,
        summary: getAutoTransferSummary(params.period, 'income'),
      },
      balance.aux_item_id
    )
  }

  for (const balance of params.expenseBalances) {
    const amount = Math.abs(Number(balance.end_balance || 0))
    if (amount <= MONEY_EPSILON) continue
    totalExpense += amount
    appendTransferEntry(
      entries,
      {
        account_id: balance.account_id,
        account_code: balance.account_code,
        account_name: balance.account_name,
        direction: 'credit',
        amount,
        summary: getAutoTransferSummary(params.period, 'expense'),
      },
      balance.aux_item_id
    )
  }

  const diff = Math.abs(totalIncome - totalExpense)

  if (params.balanceAccount) {
    if (totalIncome > MONEY_EPSILON) {
      entries.push({
        account_id: params.balanceAccount.id,
        account_code: params.balanceAccount.code,
        account_name: params.balanceAccount.name,
        direction: 'credit',
        amount: totalIncome,
        summary: getAutoTransferSummary(params.period, 'income'),
      })
    }

    if (totalExpense > MONEY_EPSILON) {
      entries.push({
        account_id: params.balanceAccount.id,
        account_code: params.balanceAccount.code,
        account_name: params.balanceAccount.name,
        direction: 'debit',
        amount: totalExpense,
        summary: getAutoTransferSummary(params.period, 'expense'),
      })
    }
  }

  return {
    entries,
    totalIncome,
    totalExpense,
    imbalance: diff > MONEY_EPSILON ? diff : 0,
    hasImbalance: diff > MONEY_EPSILON,
  }
}

type TransferItemConfig = {
  id: string
  type_code: string
  summary: string | null
  from_code: string | null
  from_name: string | null
  to_code: string | null
  to_name: string | null
  transfer_type: 'all' | 'partial'
  ratio: number | null
  sort_order: number | null
}

type TransferPreviewStatus = 'ready' | 'empty' | 'generated' | 'notYetDue' | 'unbalanced'

export function listTransferConfigItems(params: {
  db: { prepare: (sql: string) => { all: (...args: any[]) => any[] } }
  accountSetId: string
}) {
  return params.db
    .prepare(
      `SELECT id, type_code, summary, from_code, from_name, to_code, to_name, transfer_type, ratio, sort_order
       FROM transfer_items
       WHERE account_set_id=?
       ORDER BY type_code ASC, sort_order ASC, id ASC`
    )
    .all(params.accountSetId) as TransferItemConfig[]
}

/**
 * 检查科目是否为父科目（有子科目）
 */
function isParentAccount(params: {
  db: { prepare: (sql: string) => { get: (...args: any[]) => any } }
  accountSetId: string
  accountId: string
}) {
  const result = params.db
    .prepare(
      `SELECT COUNT(*) as child_count FROM accounts
       WHERE account_set_id=? AND parent_id=? AND is_enabled=1`
    )
    .get(params.accountSetId, params.accountId) as { child_count: number } | null
  return (result?.child_count || 0) > 0
}

/**
 * 获取父科目的所有子科目余额（不包括父科目本身）
 */
function getChildrenBalances(params: {
  db: { prepare: (sql: string) => { all: (...args: any[]) => any[] } }
  accountSetId: string
  year: number
  period: number
  accountId: string
}) {
  return params.db
    .prepare(
      `WITH RECURSIVE descendants AS (
         SELECT id, code, name
         FROM accounts
         WHERE account_set_id=? AND parent_id=? AND is_enabled=1
         UNION ALL
         SELECT c.id, c.code, c.name
         FROM accounts c
         JOIN descendants d ON d.id = c.parent_id
         WHERE c.account_set_id=? AND c.is_enabled=1
       ),
       leaf_accounts AS (
         SELECT d.id
         FROM descendants d
         WHERE NOT EXISTS (
           SELECT 1 FROM accounts c
           WHERE c.account_set_id=? AND c.parent_id=d.id AND c.is_enabled=1
         )
       )
       SELECT ab.account_id, ab.account_code, ab.account_name,
              COALESCE(ab.aux_item_id, '') as aux_item_id,
              MAX(COALESCE(ab.init_balance, 0))
              + SUM(
                  CASE WHEN a.direction = 'debit'
                    THEN ab.current_debit - ab.current_credit
                    ELSE ab.current_credit - ab.current_debit
                  END
                ) as end_balance
       FROM account_balances ab
       JOIN accounts a ON a.id = ab.account_id AND a.account_set_id = ab.account_set_id
       JOIN leaf_accounts la ON la.id = ab.account_id
       WHERE ab.account_set_id=? AND ab.year=? AND ab.period<=?
       GROUP BY ab.account_id, ab.account_code, ab.account_name, COALESCE(ab.aux_item_id, '')
       ORDER BY ab.account_code ASC, ab.aux_item_id ASC`
    )
    .all(
      params.accountSetId,
      params.accountId,
      params.accountSetId,
      params.accountSetId,
      params.accountSetId,
      params.year,
      params.period
    ) as TransferBalanceRow[]
}

// P0-4 / 沿用 FIX-006 口径：account_balances.init_balance 为「年初余额」（各期行相同），
// current_* 仅为「本期发生额」。故期末余额 = 年初（取一次，用 MAX）+ 截至本期(period<=?)累计发生额；
// 旧实现 period=? 只取当期，漏 1~N-1 期发生额，导致损益无法清零。
const PERIOD_END_BALANCE_SQL = `
  SELECT ab.account_id, ab.account_code, ab.account_name,
         COALESCE(ab.aux_item_id, '') as aux_item_id,
         MAX(COALESCE(ab.init_balance, 0))
         + SUM(
             CASE WHEN a.direction = 'debit'
               THEN ab.current_debit - ab.current_credit
               ELSE ab.current_credit - ab.current_debit
             END
           ) as end_balance
  FROM account_balances ab
  JOIN accounts a ON a.id = ab.account_id AND a.account_set_id = ab.account_set_id
  WHERE ab.account_set_id=? AND ab.year=? AND ab.period<=? AND ab.account_code=?
  GROUP BY ab.account_id, ab.account_code, ab.account_name, COALESCE(ab.aux_item_id, '')
  ORDER BY ab.aux_item_id ASC
`

export function getPeriodEndBalanceByCode(params: {
  db: { prepare: (sql: string) => { get: (...args: any[]) => any; all: (...args: any[]) => any[] } }
  accountSetId: string
  year: number
  period: number
  accountCode: string
}): TransferBalanceRow | null | TransferBalanceRow[] {
  const account = params.db
    .prepare(
      `SELECT id, code, name, is_aux FROM accounts
       WHERE account_set_id=? AND code=? AND is_enabled=1`
    )
    .get(params.accountSetId, params.accountCode) as {
    id: string
    code: string
    name: string
    is_aux?: number
  } | null

  if (!account) {
    return null
  }

  const hasChildren = isParentAccount({
    db: params.db,
    accountSetId: params.accountSetId,
    accountId: account.id,
  })

  if (hasChildren) {
    return getChildrenBalances({
      db: params.db,
      accountSetId: params.accountSetId,
      year: params.year,
      period: params.period,
      accountId: account.id,
    })
  }

  const rows = params.db
    .prepare(PERIOD_END_BALANCE_SQL)
    .all(
      params.accountSetId,
      params.year,
      params.period,
      params.accountCode
    ) as TransferBalanceRow[]

  const nonZeroRows = rows.filter(row => Math.abs(Number(row.end_balance || 0)) > MONEY_EPSILON)
  if (nonZeroRows.length === 0) return null
  if (account.is_aux === 1 || nonZeroRows.length > 1) return nonZeroRows
  return nonZeroRows[0]
}

function getTransferAmount(item: TransferItemConfig, endBalance: number) {
  const base = Math.abs(endBalance)
  if (base <= MONEY_EPSILON) return 0
  if (item.transfer_type !== 'partial') return base
  const rawRatio = Number(item.ratio ?? 100)
  const ratio = Number.isFinite(rawRatio) ? Math.max(0, Math.min(100, rawRatio)) : 100
  return Number(((base * ratio) / 100).toFixed(2))
}

export function buildEntriesFromTransferItems(params: {
  period: number
  items: TransferItemConfig[]
  accounts: Array<{ id: string; code: string; name: string; direction: string }>
  getBalanceByCode: (code: string) =>
    | { end_balance?: number | null; aux_item_id?: string | null }
    | null
    | Array<{
        account_id: string
        account_code: string
        account_name: string
        end_balance?: number | null
        aux_item_id?: string | null
      }>
}) {
  const entries: AutoTransferPreviewEntry[] = []
  let transferredOutTotal = 0
  let transferredInTotal = 0

  const accountByCode = new Map(params.accounts.map(account => [account.code, account]))
  const accountById = new Map(params.accounts.map(account => [account.id, account]))

  // 分离转入目标、纯转出源、一对一配对。
  // 关键约束：sourceItems 必须排除 pairItems，否则同时存在 targetItem + pairItem 时，
  // pair 项会先被"汇总结转"循环（line 407+）处理一次，又被"一对一"循环（line 504+）
  // 处理一次，导致结转金额翻倍（曾出现 501 → 1002 的损益科目无法清零的 bug）。
  const targetItems = params.items.filter(item => {
    const toCode = String(item.to_code || '').trim()
    const fromCode = String(item.from_code || '').trim()
    return Boolean(toCode) && !fromCode // 仅 to_code
  })

  const sourceItems = params.items.filter(item => {
    const fromCode = String(item.from_code || '').trim()
    const toCode = String(item.to_code || '').trim()
    return Boolean(fromCode) && !toCode // 仅 from_code，不含 pair
  })

  const pairItems = params.items.filter(item => {
    const fromCode = String(item.from_code || '').trim()
    const toCode = String(item.to_code || '').trim()
    return Boolean(fromCode) && Boolean(toCode) // 同时 from_code + to_code
  })

  // 处理汇总结转模式：多个转出源 -> 一个转入目标（与结转维护页约束一致，仅取第一个转入科目）
  if (targetItems.length > 0 && sourceItems.length > 0) {
    const summaryTargets = targetItems.slice(0, 1)
    for (const targetItem of summaryTargets) {
      const toCode = String(targetItem.to_code || '').trim()
      const toAccount = accountByCode.get(toCode)
      if (!toAccount) continue

      let targetTotalAmount = 0
      const targetSummary = String(targetItem.summary || '').trim() || `${params.period}月结转`

      // 转入方向 = 转出源科目的余额方向（保证借贷平衡）。
      // 支出（5xxx，debit 方向）结转：from 用 credit 冲销，to 用 debit 减少本年利润。
      // 收入（4xxx/6xxx，credit 方向）结转：from 用 debit 冲销，to 用 credit 增加本年利润。
      // 同一 type_code 下源科目方向应一致；取第一个产生分录的源方向作为转入方向。
      let sourceDirection: 'debit' | 'credit' | null = null

      // 为每个转出源生成分录
      for (const sourceItem of sourceItems) {
        const fromCode = String(sourceItem.from_code || '').trim()
        const fromAccount = accountByCode.get(fromCode)
        if (!fromAccount) continue

        const balanceResult = params.getBalanceByCode(fromCode)

        // 处理返回数组的情况（父科目）
        if (Array.isArray(balanceResult)) {
          for (const childBalance of balanceResult) {
            const endBalance = Number(childBalance.end_balance || 0)
            const amount = getTransferAmount(sourceItem, endBalance)
            if (amount <= MONEY_EPSILON) continue

            const summary = String(sourceItem.summary || '').trim() || `${params.period}月结转`
            const childAccount = accountById.get(childBalance.account_id)
            if (!childAccount) continue
            const fromDirection = childAccount.direction === 'credit' ? 'debit' : 'credit'
            if (!sourceDirection) sourceDirection = childAccount.direction as 'debit' | 'credit'

            appendTransferEntry(
              entries,
              {
                account_id: childBalance.account_id,
                account_code: childBalance.account_code,
                account_name: childBalance.account_name,
                direction: fromDirection,
                amount,
                summary,
              },
              childBalance.aux_item_id
            )

            targetTotalAmount += amount
            transferredOutTotal += amount
          }
        } else {
          // 处理返回单个对象的情况（明细科目）
          const endBalance = Number(balanceResult?.end_balance || 0)
          const amount = getTransferAmount(sourceItem, endBalance)
          if (amount > MONEY_EPSILON) {
            const summary = String(sourceItem.summary || '').trim() || `${params.period}月结转`
            const fromDirection = fromAccount.direction === 'credit' ? 'debit' : 'credit'
            if (!sourceDirection) sourceDirection = fromAccount.direction as 'debit' | 'credit'

            appendTransferEntry(
              entries,
              {
                account_id: fromAccount.id,
                account_code: fromAccount.code,
                account_name: fromAccount.name,
                direction: fromDirection,
                amount,
                summary,
              },
              balanceResult?.aux_item_id
            )

            targetTotalAmount += amount
            transferredOutTotal += amount
          }
        }
      }

      // 生成转入目标的汇总分录
      if (targetTotalAmount > MONEY_EPSILON) {
        const toDirection: 'debit' | 'credit' =
          sourceDirection || (toAccount.direction === 'credit' ? 'credit' : 'debit')
        entries.push({
          account_id: toAccount.id,
          account_code: toAccount.code,
          account_name: toAccount.name,
          direction: toDirection,
          amount: targetTotalAmount,
          summary: targetSummary,
        })
        transferredInTotal += targetTotalAmount
      }
    }
  }

  // 处理一对一结转模式
  for (const item of pairItems) {
    const fromCode = String(item.from_code || '').trim()
    const toCode = String(item.to_code || '').trim()

    const fromAccount = accountByCode.get(fromCode)
    const toAccount = accountByCode.get(toCode)
    if (!fromAccount || !toAccount) continue

    const balanceResult = params.getBalanceByCode(fromCode)
    const summary = String(item.summary || '').trim() || `${params.period}月结转`

    // 处理返回数组的情况（父科目）
    if (Array.isArray(balanceResult)) {
      let totalAmount = 0

      // 为每个子科目生成转出分录
      for (const childBalance of balanceResult) {
        const endBalance = Number(childBalance.end_balance || 0)
        const amount = getTransferAmount(item, endBalance)
        if (amount <= MONEY_EPSILON) continue

        const childAccount = accountById.get(childBalance.account_id)
        if (!childAccount) continue
        const fromDirection = childAccount.direction === 'credit' ? 'debit' : 'credit'

        appendTransferEntry(
          entries,
          {
            account_id: childBalance.account_id,
            account_code: childBalance.account_code,
            account_name: childBalance.account_name,
            direction: fromDirection,
            amount,
            summary,
          },
          childBalance.aux_item_id
        )

        totalAmount += amount
        transferredOutTotal += amount
      }

      // 生成转入分录（汇总金额）
      // 转入方向 = 转出源（父科目）的余额方向；子科目继承父方向，所以用 fromAccount.direction 即可
      if (totalAmount > MONEY_EPSILON) {
        const toDirection: 'debit' | 'credit' =
          fromAccount.direction === 'credit' ? 'credit' : 'debit'
        entries.push({
          account_id: toAccount.id,
          account_code: toAccount.code,
          account_name: toAccount.name,
          direction: toDirection,
          amount: totalAmount,
          summary,
        })
        transferredInTotal += totalAmount
      }
    } else {
      // 处理返回单个对象的情况（明细科目）
      const endBalance = Number(balanceResult?.end_balance || 0)
      const amount = getTransferAmount(item, endBalance)
      if (amount > MONEY_EPSILON) {
        const fromDirection = fromAccount.direction === 'credit' ? 'debit' : 'credit'
        const toDirection = fromDirection === 'debit' ? 'credit' : 'debit'

        appendTransferEntry(
          entries,
          {
            account_id: fromAccount.id,
            account_code: fromAccount.code,
            account_name: fromAccount.name,
            direction: fromDirection,
            amount,
            summary,
          },
          balanceResult?.aux_item_id
        )
        entries.push({
          account_id: toAccount.id,
          account_code: toAccount.code,
          account_name: toAccount.name,
          direction: toDirection,
          amount,
          summary,
        })

        transferredOutTotal += amount
        transferredInTotal += amount
      }
    }
  }

  return {
    entries,
    transferredOutTotal,
    transferredInTotal,
  }
}

const EXISTING_TRANSFER_RUN_SQL = `
  SELECT atr.*, v.voucher_no, v.status, v.voucher_date, v.total_amount,
         vt.name AS voucher_type_name
  FROM auto_transfer_runs atr
  LEFT JOIN vouchers v ON v.id = atr.voucher_id
  LEFT JOIN voucher_types vt ON vt.id = v.voucher_type_id
  WHERE atr.account_set_id=? AND atr.year=? AND atr.period=? AND atr.transfer_type_code=?
`

function getExistingTransferRunByType(params: {
  db: { prepare: (sql: string) => { get: (...args: any[]) => any } }
  accountSetId: string
  year: number
  period: number
  transferTypeCode: string
}) {
  return params.db
    .prepare(EXISTING_TRANSFER_RUN_SQL)
    .get(params.accountSetId, params.year, params.period, params.transferTypeCode) as any
}

/** 查询指定期间已生成的全部结转凭证（供结转工作台顶部展示） */
export function listGeneratedTransferVouchersForPeriod(params: {
  db: { prepare: (sql: string) => { all: (...args: any[]) => any[] } }
  accountSetId: string
  year: number
  period: number
}) {
  const rows = params.db
    .prepare(
      `SELECT atr.transfer_type_code, atr.voucher_id, v.voucher_no, v.status, v.voucher_date,
              v.total_amount, vt.name AS voucher_type_name,
              tt.name AS transfer_type_name, tt.voucher_type AS transfer_voucher_type
       FROM auto_transfer_runs atr
       LEFT JOIN vouchers v ON v.id = atr.voucher_id
       LEFT JOIN voucher_types vt ON vt.id = v.voucher_type_id
       LEFT JOIN transfer_types tt
         ON tt.account_set_id = atr.account_set_id AND tt.code = atr.transfer_type_code
       WHERE atr.account_set_id=? AND atr.year=? AND atr.period=?
         AND atr.transfer_type_code IS NOT NULL AND trim(atr.transfer_type_code) != ''
       ORDER BY atr.transfer_type_code ASC, datetime(atr.created_at) ASC`
    )
    .all(params.accountSetId, params.year, params.period) as any[]

  return rows.map(row => ({
    transferTypeCode: row.transfer_type_code,
    transferTypeName: row.transfer_type_name || row.transfer_type_code,
    voucherType: row.voucher_type_name || row.transfer_voucher_type || '',
    voucherId: row.voucher_id,
    voucherNo: row.voucher_no || '',
    voucherDate: row.voucher_date || '',
    status: row.status || '',
    totalAmount: Number(row.total_amount || 0),
  }))
}

export function getAutoTransferRun(params: {
  db: { prepare: (sql: string) => { get: (...args: any[]) => any } }
  accountSetId: string
  year: number
  period: number
  transferType?: string
}) {
  return params.db
    .prepare(
      `SELECT atr.*, v.voucher_no, v.status, v.voucher_date
       FROM auto_transfer_runs atr
       LEFT JOIN vouchers v ON v.id = atr.voucher_id
       WHERE atr.account_set_id=? AND atr.year=? AND atr.period=? AND atr.transfer_type=?`
    )
    .get(
      params.accountSetId,
      params.year,
      params.period,
      params.transferType || AUTO_TRANSFER_TYPE
    ) as any
}

export function listAutoTransferCandidateBalances(params: {
  db: { prepare: (sql: string) => { all: (...args: any[]) => any[] } }
  accountSetId: string
  year: number
  period: number
  codePrefix: string
}) {
  return params.db
    .prepare(
      `SELECT account_id, account_code, account_name,
              SUM(COALESCE(init_balance, 0) + current_debit - current_credit) as end_balance
       FROM account_balances ab
       WHERE ab.account_set_id=? AND ab.year=? AND ab.period=? AND ab.account_code LIKE ?
       GROUP BY ab.account_id, ab.account_code, ab.account_name
       ORDER BY ab.account_code ASC`
    )
    .all(params.accountSetId, params.year, params.period, `${params.codePrefix}%`) as any[]
}

export function getAutoTransferStatus(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any; all: (...args: any[]) => any[] }
  }
  accountSetId: string
  year: number
  period: number
}) {
  const closingRecord = getPeriodClosingRecord({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
  })
  const existingRun = getAutoTransferRun({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
  })
  const closed = isPeriodClosed(closingRecord)
  const alreadyGenerated = Boolean(existingRun)
  // 结转凭证已自动记账，允许撤销（撤销时会自动反记账）
  const canRevoke = Boolean(existingRun) && !closed

  return {
    closed,
    existingRun,
    alreadyGenerated,
    canRevoke,
  }
}

function normalizeTransferItems(items: TransferItemConfig[]) {
  const normalized: TransferItemConfig[] = []

  const directItems = items.filter(item => {
    const fromCode = String(item.from_code || '').trim()
    const toCode = String(item.to_code || '').trim()
    return Boolean(fromCode && toCode)
  })
  normalized.push(...directItems)

  const grouped = new Map<string, TransferItemConfig[]>()
  for (const item of items) {
    const typeCode = String(item.type_code || '').trim()
    if (!typeCode) continue
    if (!grouped.has(typeCode)) grouped.set(typeCode, [])
    grouped.get(typeCode)!.push(item)
  }

  for (const [typeCode, groupItems] of grouped.entries()) {
    const hasDirect = groupItems.some(item => {
      const fromCode = String(item.from_code || '').trim()
      const toCode = String(item.to_code || '').trim()
      return Boolean(fromCode && toCode)
    })
    if (hasDirect) continue

    const fromItems = groupItems.filter(item => {
      const fromCode = String(item.from_code || '').trim()
      const toCode = String(item.to_code || '').trim()
      return Boolean(fromCode) && !toCode
    })
    const toItems = groupItems.filter(item => {
      const fromCode = String(item.from_code || '').trim()
      const toCode = String(item.to_code || '').trim()
      return !fromCode && Boolean(toCode)
    })

    if (fromItems.length === 0 || toItems.length === 0) continue

    const target = toItems[0]
    for (const fromItem of fromItems) {
      normalized.push({
        ...fromItem,
        type_code: typeCode,
        summary: fromItem.summary || target.summary,
        to_code: target.to_code,
        to_name: target.to_name,
      })
    }
  }

  return normalized
}

export function buildAutoTransferPreview(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any; all: (...args: any[]) => any[] }
  }
  accountSetId: string
  year: number
  period: number
}) {
  const { closed, existingRun, alreadyGenerated, canRevoke } = getAutoTransferStatus(params)
  if (closed) {
    return {
      alreadyGenerated,
      canRevoke,
      blockedReason: '该期间已结账，不能生成自动结转凭证',
      voucherDate: getAutoTransferVoucherDate(params.year, params.period),
      remark: buildAutoTransferRemark(params.year, params.period),
      entries: [],
      existingRun: existingRun || null,
      totals: { debitTotal: 0, creditTotal: 0, incomeTotal: 0, expenseTotal: 0 },
    }
  }

  if (existingRun) {
    return {
      alreadyGenerated,
      canRevoke,
      blockedReason: '本期自动结转凭证已生成',
      voucherDate:
        existingRun.voucher_date || getAutoTransferVoucherDate(params.year, params.period),
      remark: buildAutoTransferRemark(params.year, params.period),
      entries: [],
      existingRun,
      totals: { debitTotal: 0, creditTotal: 0, incomeTotal: 0, expenseTotal: 0 },
    }
  }

  const accounts = params.db
    .prepare(
      'SELECT id, code, name, direction FROM accounts WHERE account_set_id=? AND is_enabled=1 ORDER BY code ASC'
    )
    .all(params.accountSetId) as any[]

  const transferItems = listTransferConfigItems({
    db: params.db,
    accountSetId: params.accountSetId,
  })

  const normalizedItems = normalizeTransferItems(transferItems)

  const executableItems = normalizedItems.filter(item => {
    const fromCode = String(item.from_code || '').trim()
    const toCode = String(item.to_code || '').trim()
    return Boolean(fromCode || toCode)
  })

  if (executableItems.length === 0) {
    return {
      alreadyGenerated: false,
      canRevoke: false,
      blockedReason: '未配置可执行的结转规则（请在结转类型维护中设置转出/转入科目）',
      voucherDate: getAutoTransferVoucherDate(params.year, params.period),
      remark: buildAutoTransferRemark(params.year, params.period),
      entries: [],
      existingRun: null,
      totals: { debitTotal: 0, creditTotal: 0, incomeTotal: 0, expenseTotal: 0 },
    }
  }

  const balanceCache = new Map<
    string,
    | { end_balance?: number | null }
    | null
    | Array<{
        account_id: string
        account_code: string
        account_name: string
        end_balance?: number | null
      }>
  >()
  const getBalanceByCode = (code: string) => {
    if (balanceCache.has(code)) return balanceCache.get(code) || null
    const balance = getPeriodEndBalanceByCode({
      db: params.db,
      accountSetId: params.accountSetId,
      year: params.year,
      period: params.period,
      accountCode: code,
    })
    balanceCache.set(code, balance)
    return balance
  }

  const preview = buildEntriesFromTransferItems({
    period: params.period,
    items: executableItems,
    accounts,
    getBalanceByCode,
  })
  const totals = calculateVoucherTotals(preview.entries)

  // 检查借贷平衡，修复微小的舍入误差
  const balanceDiff = Math.abs(totals.debitTotal - totals.creditTotal)
  if (balanceDiff > 0.01 && preview.entries.length > 0) {
    if (balanceDiff <= 1.0) {
      // 微小误差：调整最大金额分录的金额来平衡
      const biggestEntry = preview.entries.reduce((a, b) => (a.amount > b.amount ? a : b))
      const deficit = totals.debitTotal - totals.creditTotal
      // 借方不足则增加最大借方分录，贷方不足则增加最大贷方分录
      if (deficit > 0) {
        // 借方多，需要在贷方补
        const creditEntries = preview.entries.filter(e => e.direction === 'credit')
        if (creditEntries.length > 0) {
          creditEntries.reduce((a, b) => (a.amount > b.amount ? a : b)).amount = Number(
            (
              creditEntries.reduce((a, b) => (a.amount > b.amount ? a : b)).amount + deficit
            ).toFixed(2)
          )
        } else {
          // 没有贷方分录，加一条平衡分录
          preview.entries.push({
            account_id: '',
            account_code: '',
            account_name: '结转平衡调整',
            direction: 'credit',
            amount: Number(deficit.toFixed(2)),
            summary: '结转平衡调整',
          })
        }
      } else {
        // 贷方多，需要在借方补
        const debitEntries = preview.entries.filter(e => e.direction === 'debit')
        if (debitEntries.length > 0) {
          debitEntries.reduce((a, b) => (a.amount > b.amount ? a : b)).amount = Number(
            (
              debitEntries.reduce((a, b) => (a.amount > b.amount ? a : b)).amount +
              Math.abs(deficit)
            ).toFixed(2)
          )
        } else {
          preview.entries.push({
            account_id: '',
            account_code: '',
            account_name: '结转平衡调整',
            direction: 'debit',
            amount: Number(Math.abs(deficit).toFixed(2)),
            summary: '结转平衡调整',
          })
        }
      }
    }
    // 重新计算余额
    const newTotals = calculateVoucherTotals(preview.entries)
    totals.debitTotal = newTotals.debitTotal
    totals.creditTotal = newTotals.creditTotal
  }

  return {
    alreadyGenerated: false,
    canRevoke: false,
    blockedReason: preview.entries.length === 0 ? '当前期间没有可结转的数据' : null,
    voucherDate: getAutoTransferVoucherDate(params.year, params.period),
    remark: buildAutoTransferRemark(params.year, params.period),
    entries: preview.entries,
    existingRun: null,
    totals: {
      debitTotal: totals.debitTotal,
      creditTotal: totals.creditTotal,
      incomeTotal: preview.transferredOutTotal,
      expenseTotal: preview.transferredInTotal,
    },
  }
}

/**
 * 按结转类型构建预览（单个类型）
 */
export function buildTransferPreviewByType(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any; all: (...args: any[]) => any[] }
  }
  accountSetId: string
  year: number
  period: number
  transferTypeCode: string
}) {
  const accounts = params.db
    .prepare(
      'SELECT id, code, name, direction FROM accounts WHERE account_set_id=? AND is_enabled=1 ORDER BY code ASC'
    )
    .all(params.accountSetId) as any[]
  const accountByCode = new Map(accounts.map(account => [account.code, account]))

  // 只获取指定类型的结转配置项
  const transferItems = listTransferConfigItems({
    db: params.db,
    accountSetId: params.accountSetId,
  }).filter(item => item.type_code === params.transferTypeCode)

  const normalizedItems = normalizeTransferItems(transferItems)

  const executableItems = normalizedItems.filter(item => {
    const fromCode = String(item.from_code || '').trim()
    const toCode = String(item.to_code || '').trim()
    // 汇总模式：转出源只有 from_code，转入目标只有 to_code，两者都需保留
    // 一对一模式：同时有 from_code 和 to_code
    return Boolean(fromCode || toCode)
  })

  if (executableItems.length === 0) {
    return {
      entries: [],
      transferredOutTotal: 0,
      transferredInTotal: 0,
      configuredItemCount: transferItems.length,
      executableItemCount: 0,
      missingAccountCodes: [],
    }
  }

  const missingAccountCodes = Array.from(
    new Set(
      executableItems
        .flatMap(item => [String(item.from_code || '').trim(), String(item.to_code || '').trim()])
        .filter(code => code && !accountByCode.has(code))
    )
  )

  const balanceCache = new Map<
    string,
    | { end_balance?: number | null }
    | null
    | Array<{
        account_id: string
        account_code: string
        account_name: string
        end_balance?: number | null
      }>
  >()
  const getBalanceByCode = (code: string) => {
    if (balanceCache.has(code)) return balanceCache.get(code) || null
    const balance = getPeriodEndBalanceByCode({
      db: params.db,
      accountSetId: params.accountSetId,
      year: params.year,
      period: params.period,
      accountCode: code,
    })
    balanceCache.set(code, balance)
    return balance
  }

  const result = buildEntriesFromTransferItems({
    period: params.period,
    items: executableItems,
    accounts,
    getBalanceByCode,
  })

  return {
    ...result,
    configuredItemCount: transferItems.length,
    executableItemCount: executableItems.length,
    missingAccountCodes,
  }
}

function getPreviewEmptyReason(preview: {
  configuredItemCount?: number
  executableItemCount?: number
  missingAccountCodes?: string[]
}) {
  if (!preview.configuredItemCount) {
    return '该结转类型未配置结转规则'
  }
  if (!preview.executableItemCount) {
    return '结转规则缺少转出或转入科目'
  }
  if (preview.missingAccountCodes?.length) {
    return `规则科目不存在：${preview.missingAccountCodes.join('、')}`
  }
  return '规则科目当前期间无已记账余额'
}

/**
 * 构建所有结转类型的预览
 */
export function buildAllTransferPreviews(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any; all: (...args: any[]) => any[] }
  }
  accountSetId: string
  year: number
  period: number
}) {
  const { closed } = getAutoTransferStatus(params)
  const generatedVouchers = listGeneratedTransferVouchersForPeriod(params)

  // 获取所有结转类型
  const transferTypes = params.db
    .prepare(
      'SELECT code, name, voucher_type, period_type FROM transfer_types WHERE account_set_id=? ORDER BY code'
    )
    .all(params.accountSetId) as Array<{
    code: string
    name: string
    voucher_type: string
    period_type: string
  }>

  if (transferTypes.length === 0) {
    return {
      closed,
      blockedReason: closed ? '该期间已结账，不能生成自动结转凭证' : '未配置结转类型',
      generatedVouchers,
      summary: {
        totalTypes: 0,
        readyCount: 0,
        generatedCount: generatedVouchers.length,
        emptyCount: 0,
        notYetDueCount: 0,
        unbalancedCount: 0,
      },
      previews: [],
    }
  }

  const previews = []

  for (const type of transferTypes) {
    const existingRun = getExistingTransferRunByType({
      db: params.db,
      accountSetId: params.accountSetId,
      year: params.year,
      period: params.period,
      transferTypeCode: type.code,
    })

    if (existingRun) {
      previews.push({
        transferTypeCode: type.code,
        transferTypeName: type.name,
        voucherType: type.voucher_type,
        status: 'generated' as TransferPreviewStatus,
        selectable: false,
        disabledReason: '该结转类型已生成凭证',
        emptyReason: null,
        alreadyGenerated: true,
        existingRun,
        entries: [],
        totals: { debitTotal: 0, creditTotal: 0 },
      })
      continue
    }

    if (closed) {
      previews.push({
        transferTypeCode: type.code,
        transferTypeName: type.name,
        voucherType: type.voucher_type,
        status: 'empty' as TransferPreviewStatus,
        selectable: false,
        disabledReason: '该期间已结账，不能生成结转凭证',
        emptyReason: '该期间已结账',
        alreadyGenerated: false,
        existingRun: null,
        entries: [],
        totals: { debitTotal: 0, creditTotal: 0 },
      })
      continue
    }

    // 年末/年度结转：非 12 月不展示、不可执行
    if (isYearlyTransferDue(params.period, type)) {
      continue
    }

    // 构建该类型的预览
    const preview = buildTransferPreviewByType({
      db: params.db,
      accountSetId: params.accountSetId,
      year: params.year,
      period: params.period,
      transferTypeCode: type.code,
    })

    const totals = calculateVoucherTotals(preview.entries)
    const unbalanced =
      preview.entries.length > 0 && Math.abs(totals.debitTotal - totals.creditTotal) > 0.01
    const status: TransferPreviewStatus = unbalanced
      ? 'unbalanced'
      : preview.entries.length > 0
        ? 'ready'
        : 'empty'
    const emptyReason = preview.entries.length === 0 ? getPreviewEmptyReason(preview) : null

    previews.push({
      transferTypeCode: type.code,
      transferTypeName: type.name,
      voucherType: type.voucher_type,
      status,
      selectable: status === 'ready',
      disabledReason: status === 'ready' ? null : unbalanced ? '借贷不平，不能生成' : emptyReason,
      emptyReason,
      alreadyGenerated: false,
      existingRun: null,
      entries: preview.entries,
      totals: {
        debitTotal: totals.debitTotal,
        creditTotal: totals.creditTotal,
      },
    })
  }

  const readyCount = previews.filter(preview => preview.status === 'ready').length
  const generatedCount = previews.filter(preview => preview.status === 'generated').length
  const emptyCount = previews.filter(preview => preview.status === 'empty').length
  const notYetDueCount = previews.filter(preview => preview.status === 'notYetDue').length
  const unbalancedCount = previews.filter(preview => preview.status === 'unbalanced').length
  const blockedReason = closed
    ? '该期间已结账，不能生成自动结转凭证'
    : readyCount === 0 && generatedCount === 0
      ? '当前期间没有可生成的结转分录'
      : null

  return {
    closed,
    blockedReason,
    generatedVouchers,
    summary: {
      totalTypes: previews.length,
      readyCount,
      generatedCount,
      emptyCount,
      notYetDueCount,
      unbalancedCount,
    },
    previews,
  }
}

type VoucherTypeLookupDb = {
  prepare: (sql: string) => { get: (...args: any[]) => any }
}

/** 按凭证字名称/编码解析 voucher_types.id（支持 ACD 导入的多种凭证字格式） */
export function resolveVoucherTypeIdByRef(params: {
  db: VoucherTypeLookupDb
  accountSetId: string
  voucherTypeRef: string | null | undefined
}) {
  const ref = String(params.voucherTypeRef ?? '').trim()
  const { db, accountSetId } = params

  const findByField = (field: 'name' | 'code', value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return null
    const row = db
      .prepare(
        `SELECT id FROM voucher_types
         WHERE (account_set_id=? OR account_set_id IS NULL) AND trim(${field})=trim(?)
         ORDER BY CASE WHEN account_set_id=? THEN 0 ELSE 1 END, sort_order ASC
         LIMIT 1`
      )
      .get(accountSetId, trimmed, accountSetId) as { id?: string } | undefined
    return row?.id || null
  }

  const tryResolve = (value: string) => findByField('name', value) || findByField('code', value)

  const candidates = new Set<string>()
  if (ref) candidates.add(ref)
  if (ref.endsWith('凭证') && ref.length > 2) {
    candidates.add(ref.slice(0, -2))
  }

  for (const candidate of candidates) {
    const id = tryResolve(candidate)
    if (id) return id
  }

  // ACD jzlx 常用 pzlx 数字代码 2/1，与 pzlx.txt 或凭证字表可能不一致
  if (ref === '2' || ref === '结转') {
    for (const alias of ['2', '结转', '转账', 'ZZ']) {
      const id = tryResolve(alias)
      if (id) return id
    }
  }
  if (ref === '1' || ref === '记账') {
    for (const alias of ['1', '记账', 'JZ']) {
      const id = tryResolve(alias)
      if (id) return id
    }
  }

  for (const fallbackName of ['结转', '转账', '记账']) {
    const id = findByField('name', fallbackName)
    if (id) return id
  }

  const firstType = db
    .prepare(
      `SELECT id FROM voucher_types
       WHERE account_set_id=? OR account_set_id IS NULL
       ORDER BY CASE WHEN account_set_id=? THEN 0 ELSE 1 END, sort_order ASC
       LIMIT 1`
    )
    .get(accountSetId, accountSetId) as { id?: string } | undefined

  return firstType?.id || null
}

/**
 * 根据结转类型获取对应的凭证类型ID
 * 从 transfer_types.voucher_type 字段查找对应的凭证类型
 */
export function getVoucherTypeIdForTransferType(params: {
  db: VoucherTypeLookupDb
  accountSetId: string
  transferTypeCode: string
}) {
  const transferType = params.db
    .prepare('SELECT voucher_type FROM transfer_types WHERE account_set_id=? AND code=?')
    .get(params.accountSetId, params.transferTypeCode) as { voucher_type?: string } | undefined

  return resolveVoucherTypeIdByRef({
    db: params.db,
    accountSetId: params.accountSetId,
    voucherTypeRef: transferType?.voucher_type || '结转',
  })
}

export function getAutoTransferVoucherTypeId(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any }
  }
  accountSetId: string
}) {
  const configured = params.db
    .prepare(
      `SELECT param_value
       FROM system_params
       WHERE account_set_id=? AND param_key='auto_transfer:voucher_type_id'`
    )
    .get(params.accountSetId) as any

  const configuredTypeId = configured?.param_value || null
  if (configuredTypeId) {
    const exists = params.db
      .prepare(
        'SELECT id FROM voucher_types WHERE id=? AND (account_set_id=? OR account_set_id IS NULL)'
      )
      .get(configuredTypeId, params.accountSetId) as any
    if (exists?.id) {
      return configuredTypeId
    }
  }

  const firstType = params.db
    .prepare(
      'SELECT id FROM voucher_types WHERE account_set_id=? OR account_set_id IS NULL ORDER BY account_set_id DESC, sort_order ASC LIMIT 1'
    )
    .get(params.accountSetId) as any

  return firstType?.id || null
}

function isSqliteConstraintError(error: any) {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  return code.startsWith('SQLITE_CONSTRAINT') || message.includes('SQLITE_CONSTRAINT')
}

export function createAutoTransferVoucher(params: {
  db: {
    prepare: (sql: string) => {
      run: (...args: any[]) => void
      get: (...args: any[]) => any
      all: (...args: any[]) => any[]
    }
    transaction: <T extends (...args: any[]) => any>(
      fn: T
    ) => (...args: Parameters<T>) => ReturnType<T>
  }
  accountSetId: string
  userId?: string | null
  userName?: string | null
  year: number
  period: number
}) {
  const preview = buildAutoTransferPreview({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
  })

  if (preview.blockedReason) {
    return {
      error: preview.blockedReason,
      preview,
    }
  }

  const voucherTypeId = getAutoTransferVoucherTypeId({
    db: params.db,
    accountSetId: params.accountSetId,
  })
  const { effectiveTypeId, voucherNo } = getNextVoucherNo({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
    voucherTypeId,
  })

  const voucherId = uuidv4()
  const runId = uuidv4()
  const { categories, itemMap } = loadVoucherAuxiliaryData({
    db: params.db,
    accountSetId: params.accountSetId,
  })

  const insertVoucher = params.db.prepare(`
    INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, total_amount, maker_id, maker_name, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertEntry = params.db.prepare(VOUCHER_ENTRY_INSERT_SQL)
  const insertRun = params.db.prepare(`
    INSERT INTO auto_transfer_runs (id, account_set_id, year, period, transfer_type, voucher_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const createTransaction = params.db.transaction(() => {
    // 创建凭证（状态直接设为已审核）
    insertVoucher.run(
      voucherId,
      params.accountSetId,
      voucherNo,
      effectiveTypeId,
      preview.voucherDate,
      params.year,
      params.period,
      preview.totals.debitTotal,
      params.userId,
      params.userName,
      preview.remark
    )

    // 自动审核（当前 schema 无 audit_time 字段）
    params.db
      .prepare("UPDATE vouchers SET status='audited', auditor_id=?, auditor_name=? WHERE id=?")
      .run(params.userId, params.userName, voucherId)

    const entryPayloads = buildVoucherEntryPayloads({
      db: params.db as any,
      accountSetId: params.accountSetId,
      voucherId,
      entries: preview.entries,
      categories,
      itemMap,
    })
    entryPayloads.forEach(payload => insertEntry.run(...payload))
    insertRun.run(
      runId,
      params.accountSetId,
      params.year,
      params.period,
      AUTO_TRANSFER_TYPE,
      voucherId,
      params.userId || null
    )

    // 自动记账
    const voucher: VoucherLike = {
      id: voucherId,
      year: params.year,
      period: params.period,
      status: 'audited',
    }
    const entries = loadVoucherEntries(params.db, voucherId)
    applyVoucherPosting(params.db, voucher, entries, {
      accountSetId: params.accountSetId,
      userId: params.userId || undefined,
      userName: params.userName || undefined,
      requireAudit: true,
      allowDirectPost: false,
    })
  })

  try {
    createTransaction()
  } catch (error: any) {
    const existingRun = getAutoTransferRun({
      db: params.db,
      accountSetId: params.accountSetId,
      year: params.year,
      period: params.period,
    })
    if (existingRun && isSqliteConstraintError(error)) {
      return {
        error: '本期自动结转凭证已生成',
        preview: {
          ...preview,
          alreadyGenerated: true,
          blockedReason: '本期自动结转凭证已生成',
          existingRun,
          entries: [],
          totals: { debitTotal: 0, creditTotal: 0, incomeTotal: 0, expenseTotal: 0 },
        },
      }
    }
    throw error
  }

  return {
    error: null,
    preview,
    voucherId,
    voucherNo,
    autoPosted: true,
  }
}

/**
 * 为单个结转类型创建凭证
 */
export function createTransferVoucherForType(params: {
  db: Database
  accountSetId: string
  userId?: string | null
  userName?: string | null
  year: number
  period: number
  transferTypeCode: string
}) {
  // 1. 构建该类型的预览
  const preview = buildTransferPreviewByType({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
    transferTypeCode: params.transferTypeCode,
  })

  // 2. 如果没有分录或金额为0，跳过
  if (preview.entries.length === 0) {
    return {
      skipped: true,
      reason: '该结转类型没有可结转的数据',
      voucherId: null,
      voucherNo: null,
    }
  }

  const totals = calculateVoucherTotals(preview.entries)
  if (totals.debitTotal === 0 && totals.creditTotal === 0) {
    return {
      skipped: true,
      reason: '该结转类型的结转金额为0',
      voucherId: null,
      voucherNo: null,
    }
  }

  if (Math.abs(totals.debitTotal - totals.creditTotal) > 0.01) {
    return {
      skipped: true,
      reason: `该结转类型借贷不平（借 ${totals.debitTotal.toFixed(2)} / 贷 ${totals.creditTotal.toFixed(2)}）`,
      voucherId: null,
      voucherNo: null,
    }
  }

  // 3. 获取凭证类型ID
  const voucherTypeId = getVoucherTypeIdForTransferType({
    db: params.db,
    accountSetId: params.accountSetId,
    transferTypeCode: params.transferTypeCode,
  })

  // 4. 生成凭证号
  const { effectiveTypeId, voucherNo } = getNextVoucherNo({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
    voucherTypeId,
  })

  const voucherId = uuidv4()
  const runId = uuidv4()
  const { categories, itemMap } = loadVoucherAuxiliaryData({
    db: params.db,
    accountSetId: params.accountSetId,
  })

  const insertVoucher = params.db.prepare(`
    INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, total_amount, maker_id, maker_name, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertEntry = params.db.prepare(VOUCHER_ENTRY_INSERT_SQL)
  const insertRun = params.db.prepare(`
    INSERT INTO auto_transfer_runs (id, account_set_id, year, period, transfer_type, transfer_type_code, voucher_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const voucherDate = getAutoTransferVoucherDate(params.year, params.period)
  const remark = buildAutoTransferRemark(params.year, params.period)

  const createTransaction = params.db.transaction(() => {
    // 创建凭证（状态直接设为已审核）
    insertVoucher.run(
      voucherId,
      params.accountSetId,
      voucherNo,
      effectiveTypeId,
      voucherDate,
      params.year,
      params.period,
      totals.debitTotal,
      params.userId,
      params.userName,
      remark
    )

    // 自动审核
    params.db
      .prepare("UPDATE vouchers SET status='audited', auditor_id=?, auditor_name=? WHERE id=?")
      .run(params.userId, params.userName, voucherId)

    const entryPayloads = buildVoucherEntryPayloads({
      db: params.db as any,
      accountSetId: params.accountSetId,
      voucherId,
      entries: preview.entries,
      categories,
      itemMap,
    })
    entryPayloads.forEach(payload => insertEntry.run(...payload))

    // 记录结转运行（使用 transfer_type_code）
    insertRun.run(
      runId,
      params.accountSetId,
      params.year,
      params.period,
      AUTO_TRANSFER_TYPE, // 保留旧字段兼容性
      params.transferTypeCode, // 新字段
      voucherId,
      params.userId || null
    )

    // 自动记账（与凭证过账共用 applyVoucherPosting，保证余额更新规则一致）
    const voucher: VoucherLike = {
      id: voucherId,
      year: params.year,
      period: params.period,
      status: 'audited',
    }
    const entries = loadVoucherEntries(params.db, voucherId)
    applyVoucherPosting(params.db, voucher, entries, {
      accountSetId: params.accountSetId,
      userId: params.userId || undefined,
      userName: params.userName || undefined,
      requireAudit: true,
      allowDirectPost: false,
    })
  })

  try {
    createTransaction()
  } catch (error: any) {
    if (isSqliteConstraintError(error)) {
      return {
        error: '凭证号冲突，请重试',
        skipped: false,
        voucherId: null,
        voucherNo: null,
      }
    }
    throw error
  }

  return {
    skipped: false,
    error: null,
    voucherId,
    voucherNo,
    entryCount: preview.entries.length,
  }
}

/**
 * 为所有结转类型创建凭证
 */
export function createAllTransferVouchers(params: {
  db: Database
  accountSetId: string
  userId?: string | null
  userName?: string | null
  year: number
  period: number
  transferTypeCodes?: string[]
}) {
  const { closed } = getAutoTransferStatus({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
  })

  if (closed) {
    return {
      error: '该期间已结账，不能生成自动结转凭证',
      results: [],
    }
  }

  // 获取所有结转类型
  const transferTypes = params.db
    .prepare(
      'SELECT code, name, period_type FROM transfer_types WHERE account_set_id=? ORDER BY code'
    )
    .all(params.accountSetId) as Array<{ code: string; name: string; period_type: string }>

  if (transferTypes.length === 0) {
    return {
      error: '未配置结转类型',
      results: [],
    }
  }

  const hasTypeFilter = Array.isArray(params.transferTypeCodes)
  const selectedCodes = hasTypeFilter
    ? Array.from(
        new Set(
          (params.transferTypeCodes || []).map(code => String(code || '').trim()).filter(Boolean)
        )
      )
    : []
  const selectedCodeSet = new Set(selectedCodes)
  const availableCodes = new Set(transferTypes.map(type => type.code))
  const invalidCodes = selectedCodes.filter(code => !availableCodes.has(code))

  if (hasTypeFilter && selectedCodes.length === 0) {
    return {
      error: '请选择至少一个结转类型',
      results: [],
    }
  }

  if (invalidCodes.length > 0) {
    return {
      error: `结转类型不存在：${invalidCodes.join('、')}`,
      results: [],
    }
  }

  const targetTypes = hasTypeFilter
    ? transferTypes.filter(type => selectedCodeSet.has(type.code))
    : transferTypes

  if (hasTypeFilter && targetTypes.length === 0) {
    return {
      error: '请选择至少一个结转类型',
      results: [],
    }
  }

  const results = []

  for (const type of targetTypes) {
    // 检查该类型是否已生成凭证
    const existingRun = params.db
      .prepare(
        `SELECT id FROM auto_transfer_runs
         WHERE account_set_id=? AND year=? AND period=? AND transfer_type_code=?`
      )
      .get(params.accountSetId, params.year, params.period, type.code) as any

    if (existingRun) {
      results.push({
        transferTypeCode: type.code,
        transferTypeName: type.name,
        skipped: true,
        reason: '该结转类型已生成凭证',
        voucherId: null,
        voucherNo: null,
      })
      continue
    }

    // 年末/年度结转：非 12 月跳过
    if (isYearlyTransferDue(params.period, type)) {
      results.push({
        transferTypeCode: type.code,
        transferTypeName: type.name,
        skipped: true,
        reason: '年末/年度结转，仅12月可执行',
        voucherId: null,
        voucherNo: null,
      })
      continue
    }

    // 为该类型创建凭证
    const result = createTransferVoucherForType({
      db: params.db,
      accountSetId: params.accountSetId,
      userId: params.userId,
      userName: params.userName,
      year: params.year,
      period: params.period,
      transferTypeCode: type.code,
    })

    results.push({
      transferTypeCode: type.code,
      transferTypeName: type.name,
      ...result,
    })
  }

  return {
    error: null,
    results,
  }
}

export function validateAutoTransferRevoke(params: { existingRun: any; closed: boolean }) {
  if (!params.existingRun) {
    return '本期未生成自动结转凭证，无需反结转'
  }
  if (params.closed) {
    return '该期间已结账，不能反结转'
  }
  // 结转凭证已自动记账，撤销时会自动反记账，不再阻止
  return null
}

export function revokeAutoTransferVoucher(params: {
  db: {
    prepare: (sql: string) => {
      run: (...args: any[]) => any
      get: (...args: any[]) => any
      all: (...args: any[]) => any[]
    }
    exec: (sql: string) => void
  }
  accountSetId: string
  year: number
  period: number
}) {
  const { closed, existingRun } = getAutoTransferStatus({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
  })

  const validationError = validateAutoTransferRevoke({ existingRun, closed })
  if (validationError) {
    return { error: validationError }
  }

  const voucherId = existingRun.voucher_id
  const voucher = params.db.prepare('SELECT * FROM vouchers WHERE id=?').get(voucherId) as any
  const entries = params.db
    .prepare('SELECT * FROM voucher_entries WHERE voucher_id=?')
    .all(voucherId) as any[]

  try {
    params.db.exec('BEGIN')

    // 1. 如果已记账，先冲回余额（与已验证成功的脚本一致）
    if (voucher && voucher.status === 'posted') {
      const revertBalanceExact = params.db.prepare(`
        UPDATE account_balances SET
          current_debit = current_debit - ?,
          current_credit = current_credit - ?,
          end_balance = CASE WHEN direction = 'debit'
            THEN COALESCE(init_balance, 0) + (current_debit - ?) - (current_credit - ?)
            ELSE COALESCE(init_balance, 0) + (current_credit - ?) - (current_debit - ?)
          END
        WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id=?
      `)
      const revertBalanceFallback = params.db.prepare(`
        UPDATE account_balances SET
          current_debit = current_debit - ?,
          current_credit = current_credit - ?,
          end_balance = CASE WHEN direction = 'debit'
            THEN COALESCE(init_balance, 0) + (current_debit - ?) - (current_credit - ?)
            ELSE COALESCE(init_balance, 0) + (current_credit - ?) - (current_debit - ?)
          END
        WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND (aux_item_id IS NULL OR aux_item_id='')
      `)
      const cleanupZeroBalance = params.db.prepare(`
        DELETE FROM account_balances
        WHERE account_set_id=? AND year=? AND period=?
          AND current_debit = 0 AND current_credit = 0
          AND COALESCE(init_balance, 0) = 0
      `)
      for (const entry of entries) {
        const isDebit = entry.direction === 'debit'
        const debitAmount = isDebit ? entry.amount : 0
        const creditAmount = isDebit ? 0 : entry.amount
        const auxItemId = buildAuxItemId(entry)

        const result = revertBalanceExact.run(
          debitAmount,
          creditAmount,
          debitAmount,
          creditAmount,
          creditAmount,
          debitAmount,
          voucher.account_set_id,
          entry.account_id,
          voucher.year,
          voucher.period,
          auxItemId
        )

        if (!result.changes || result.changes === 0) {
          revertBalanceFallback.run(
            debitAmount,
            creditAmount,
            debitAmount,
            creditAmount,
            creditAmount,
            debitAmount,
            voucher.account_set_id,
            entry.account_id,
            voucher.year,
            voucher.period
          )
        }
      }
      cleanupZeroBalance.run(voucher.account_set_id, voucher.year, voucher.period)
    }

    // 2. 按已验证成功的顺序删除依赖与主记录
    params.db.prepare('DELETE FROM voucher_attachments WHERE voucher_id=?').run(voucherId)
    params.db.prepare('DELETE FROM voucher_entries WHERE voucher_id=?').run(voucherId)
    params.db.prepare('DELETE FROM auto_transfer_runs WHERE voucher_id=?').run(voucherId)
    params.db.prepare('DELETE FROM vouchers WHERE id=?').run(voucherId)

    params.db.exec('COMMIT')

    return {
      error: null,
      voucherId,
      voucherNo: existingRun.voucher_no,
    }
  } catch (error: any) {
    try {
      params.db.exec('ROLLBACK')
    } catch {}
    throw error
  }
}

/**
 * 反结转：按期间一次性删除全部自动结转凭证
 */
export function revokeAllTransferVouchers(params: {
  db: {
    prepare: (sql: string) => {
      run: (...args: any[]) => any
      get: (...args: any[]) => any
      all: (...args: any[]) => any[]
    }
    exec: (sql: string) => void
  }
  accountSetId: string
  year: number
  period: number
}) {
  const { closed } = getAutoTransferStatus({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
  })

  if (closed) {
    return {
      error: '该期间已结账，不能反结转',
      results: [],
    }
  }

  // 获取该期间所有结转凭证
  const runs = params.db
    .prepare(
      `SELECT atr.*, v.voucher_no, v.status
       FROM auto_transfer_runs atr
       LEFT JOIN vouchers v ON v.id = atr.voucher_id
       WHERE atr.account_set_id=? AND atr.year=? AND atr.period=?`
    )
    .all(params.accountSetId, params.year, params.period) as any[]

  if (runs.length === 0) {
    return {
      error: '本期未生成自动结转凭证，无需反结转',
      results: [],
    }
  }

  const results = []

  for (const run of runs) {
    const voucherId = run.voucher_id
    const voucher = params.db.prepare('SELECT * FROM vouchers WHERE id=?').get(voucherId) as any
    const entries = params.db
      .prepare('SELECT * FROM voucher_entries WHERE voucher_id=?')
      .all(voucherId) as any[]

    try {
      params.db.exec('BEGIN')

      // 1. 如果已记账，先冲回余额
      if (voucher && voucher.status === 'posted') {
        const revertBalanceExact = params.db.prepare(`
          UPDATE account_balances SET
            current_debit = current_debit - ?,
            current_credit = current_credit - ?,
            end_balance = CASE WHEN direction = 'debit'
              THEN COALESCE(init_balance, 0) + (current_debit - ?) - (current_credit - ?)
              ELSE COALESCE(init_balance, 0) + (current_credit - ?) - (current_debit - ?)
            END
          WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id=?
        `)
        const revertBalanceFallback = params.db.prepare(`
          UPDATE account_balances SET
            current_debit = current_debit - ?,
            current_credit = current_credit - ?,
            end_balance = CASE WHEN direction = 'debit'
              THEN COALESCE(init_balance, 0) + (current_debit - ?) - (current_credit - ?)
              ELSE COALESCE(init_balance, 0) + (current_credit - ?) - (current_debit - ?)
            END
          WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND (aux_item_id IS NULL OR aux_item_id='')
        `)
        const cleanupZeroBalance = params.db.prepare(`
          DELETE FROM account_balances
          WHERE account_set_id=? AND year=? AND period=?
            AND current_debit = 0 AND current_credit = 0
            AND COALESCE(init_balance, 0) = 0
        `)
        for (const entry of entries) {
          const isDebit = entry.direction === 'debit'
          const debitAmount = isDebit ? entry.amount : 0
          const creditAmount = isDebit ? 0 : entry.amount
          const auxItemId = buildAuxItemId(entry)

          const result = revertBalanceExact.run(
            debitAmount,
            creditAmount,
            debitAmount,
            creditAmount,
            creditAmount,
            debitAmount,
            voucher.account_set_id,
            entry.account_id,
            voucher.year,
            voucher.period,
            auxItemId
          )

          if (!result.changes || result.changes === 0) {
            revertBalanceFallback.run(
              debitAmount,
              creditAmount,
              debitAmount,
              creditAmount,
              creditAmount,
              debitAmount,
              voucher.account_set_id,
              entry.account_id,
              voucher.year,
              voucher.period
            )
          }
        }
        cleanupZeroBalance.run(voucher.account_set_id, voucher.year, voucher.period)
      }

      // 2. 删除依赖与主记录
      params.db.prepare('DELETE FROM voucher_attachments WHERE voucher_id=?').run(voucherId)
      params.db.prepare('DELETE FROM voucher_entries WHERE voucher_id=?').run(voucherId)
      params.db.prepare('DELETE FROM auto_transfer_runs WHERE voucher_id=?').run(voucherId)
      params.db.prepare('DELETE FROM vouchers WHERE id=?').run(voucherId)

      params.db.exec('COMMIT')

      results.push({
        transferTypeCode: run.transfer_type_code,
        voucherId,
        voucherNo: run.voucher_no,
        success: true,
      })
    } catch (error: any) {
      try {
        params.db.exec('ROLLBACK')
      } catch {}
      results.push({
        transferTypeCode: run.transfer_type_code,
        voucherId,
        voucherNo: run.voucher_no,
        success: false,
        error: error.message,
      })
    }
  }

  return {
    error: null,
    results,
  }
}
