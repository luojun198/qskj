import type { Database } from 'better-sqlite3'
import {
  filterAccountIdsByScope,
  type AccountScopeContext,
} from './accountAuthorization.js'

export interface BalanceQueryDb {
  prepare: (sql: string) => {
    get: (...params: Array<string | number>) => any
    all: (...params: Array<string | number>) => any[]
  }
}

/** 四舍五入到2位小数，避免浮点误差产生科学计数法字符串 */
function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * 期初余额按科目汇总：直接取科目汇总行（aux_item_id = ''），不累加辅助明细。
 *
 * 设计依据：保存辅助期初时，initBalanceAux.recalcInitBalanceAuxSummary 会同步维护
 * 一条 aux_item_id='' 的科目汇总行（值 = 该科目任一类目的合计，因为多类目必须相等）。
 *
 * 老逻辑（"有辅助时 SUM aux_item_id != '' 的所有行"）在多辅助类目场景下会重复累加：
 * 例如 dept 类目合计 91 + person 类目合计 91 = 182，但科目实际期初只有 91。
 */
const INIT_BALANCE_BY_ACCOUNT_SQL = `
  SELECT account_id, SUM(init_balance) AS init_balance
  FROM init_balances
  WHERE account_set_id = ?
    AND account_id IN ({placeholders})
    AND year = ?
    AND COALESCE(aux_item_id, '') = ''
  GROUP BY account_id
`

function accountHasSummaryInit(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountId: string,
  year: number
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM init_balances
       WHERE account_set_id = ? AND account_id = ? AND year = ?
         AND COALESCE(aux_item_id, '') = ''
         AND ABS(init_balance) > 0.005
       LIMIT 1`
    )
    .get(accountSetId, accountId, year)
  return Boolean(row)
}

function accountHasPeriodActivity(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountId: string,
  year: number
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM account_balances
       WHERE account_set_id = ? AND account_id = ? AND year = ?
         AND (ABS(current_debit) > 0.005 OR ABS(current_credit) > 0.005)
       LIMIT 1`
    )
    .get(accountSetId, accountId, year)
  return Boolean(row)
}

function hasTable(db: BalanceQueryDb | Database, tableName: string): boolean {
  try {
    const row = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`
      )
      .get(tableName) as { name?: string } | undefined
    return Boolean(row?.name)
  } catch {
    return false
  }
}

function accountHasVoucherActivity(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountId: string,
  year: number
): boolean {
  if (!hasTable(db, 'voucher_entries') || !hasTable(db, 'vouchers')) {
    return false
  }
  try {
    const row = db
      .prepare(
        `SELECT 1 FROM voucher_entries ve
         JOIN vouchers v ON v.id = ve.voucher_id
         WHERE v.account_set_id = ? AND ve.account_id = ? AND v.year = ?
           AND v.status IN ('draft', 'audited', 'posted')
         LIMIT 1`
      )
      .get(accountSetId, accountId, year)
    return Boolean(row)
  } catch {
    return false
  }
}

function subtreeHasFinancialData(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountIds: string[],
  year: number
): boolean {
  if (accountIds.length === 0) return false
  for (const id of accountIds) {
    if (
      accountHasSummaryInit(db, accountSetId, id, year) ||
      accountHasPeriodActivity(db, accountSetId, id, year) ||
      accountHasVoucherActivity(db, accountSetId, id, year)
    ) {
      return true
    }
  }
  return false
}

/**
 * 把每个 top_code 解析为应参与汇总的 account_id 集合。
 * - 默认取子树叶子科目，避免父子期初重复累加；
 * - 若叶子无任何期初/发生额/凭证，但 top_code 自身有科目汇总行期初或发生额，则回退取 top_code 自身
 *   （常见于期初只录入在 1001 等父科目、未拆到 100101/100102 的场景）。
 */
function expandTopCodesToLeafIds(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  topCodes: string[],
  year: number
): Map<string, { ids: string[]; direction: string }> {
  const meta = new Map<string, { ids: string[]; direction: string }>()
  if (topCodes.length === 0) return meta

  const expandStmt = db.prepare(
    `SELECT a.id, a.code, a.direction
     FROM accounts a
     WHERE a.account_set_id = ?
       AND (a.code = ? OR a.code LIKE ?)
       AND NOT EXISTS (
         SELECT 1 FROM accounts c
         WHERE c.parent_id = a.id
           AND c.account_set_id = a.account_set_id
           AND c.is_enabled = 1
       )`
  )
  const topAccountStmt = db.prepare(
    'SELECT id, direction FROM accounts WHERE account_set_id = ? AND code = ? LIMIT 1'
  )
  const topDirectionStmt = db.prepare(
    'SELECT direction FROM accounts WHERE account_set_id = ? AND code = ? LIMIT 1'
  )

  for (const code of topCodes) {
    const topAccount = topAccountStmt.get(accountSetId, code) as
      | { id: string; direction: string }
      | undefined
    const leaves = expandStmt.all(accountSetId, code, `${code}%`) as Array<{
      id: string
      code: string
      direction: string
    }>
    const topDirRow = topDirectionStmt.get(accountSetId, code) as { direction: string } | undefined
    const direction = topDirRow?.direction || leaves[0]?.direction || topAccount?.direction || 'debit'

    if (leaves.length === 0) {
      if (topAccount) {
        meta.set(code, { ids: [topAccount.id], direction })
      }
      continue
    }

    const leafIds = leaves.map(l => l.id)
    const leavesHaveData = subtreeHasFinancialData(db, accountSetId, leafIds, year)
    const parentHasData =
      topAccount != null &&
      subtreeHasFinancialData(db, accountSetId, [topAccount.id], year)

    if (!leavesHaveData && parentHasData) {
      meta.set(code, { ids: [topAccount!.id], direction })
    } else {
      meta.set(code, { ids: leafIds, direction })
    }
  }
  return meta
}

export function getBalance(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountCode: string,
  year: number,
  period: number,
  accountScope?: AccountScopeContext
): number {
  try {
    return (
      getBatchBalances(db, accountSetId, [accountCode], year, period, accountScope).get(
        accountCode
      ) ?? 0
    )
  } catch {
    return 0
  }
}

export function getPeriodSum(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountCode: string,
  year: number,
  period: number,
  accountScope?: AccountScopeContext
): { debit: number; credit: number } {
  try {
    const safePeriod = Math.min(12, Math.max(0, Math.trunc(period)))
    return (
      getBatchPeriodRangeSums(
        db,
        accountSetId,
        [accountCode],
        year,
        safePeriod,
        safePeriod,
        accountScope
      ).get(accountCode) || { debit: 0, credit: 0 }
    )
  } catch {
    return { debit: 0, credit: 0 }
  }
}

export function getPeriodRangeSum(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountCode: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext
): { debit: number; credit: number } {
  try {
    const from = Math.min(12, Math.max(1, Math.trunc(fromPeriod)))
    const to = Math.min(12, Math.max(from, Math.trunc(toPeriod)))
    return (
      getBatchPeriodRangeSums(db, accountSetId, [accountCode], year, from, to, accountScope).get(
        accountCode
      ) || {
        debit: 0,
        credit: 0,
      }
    )
  } catch {
    return { debit: 0, credit: 0 }
  }
}

/**
 * 批量查询多个科目的余额（优化版，消除 N+1 查询）
 * - 报表配置里的 codes 是父级编码（如 1001），实际数据通常录在叶子子科目（如 100101）；
 *   此函数会把每个 top_code 展开为其子树（仅保留叶子科目），再汇总余额。
 * - 期初采用叶子科目，避免父子期初重复累加；方向沿用 top_code 自身。
 * @param db 数据库连接
 * @param accountSetId 账套 ID
 * @param accountCodes 科目编码数组（顶级编码）
 * @param year 年度
 * @param period 期间
 * @returns 科目编码到余额的映射
 */
export function getBatchBalances(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountCodes: string[],
  year: number,
  period: number,
  accountScope?: AccountScopeContext
): Map<string, number> {
  const result = new Map<string, number>()

  if (accountCodes.length === 0) return result

  try {
    // 1) 展开每个 top_code 的叶子科目集合（含 top_code 自身若为叶子）
    const codeMeta = expandTopCodesToLeafIds(db, accountSetId, accountCodes, year)
    const allIds = filterAccountIdsByScope(
      accountScope,
      Array.from(new Set(Array.from(codeMeta.values()).flatMap(info => info.ids)))
    )

    if (allIds.length === 0) {
      for (const code of accountCodes) {
        if (!result.has(code)) result.set(code, 0)
      }
      return result
    }

    // 2) 一次性查询全部叶子科目的期初 / 期间余额
    const idPlaceholders = allIds.map(() => '?').join(',')

    const initRows = db
      .prepare(INIT_BALANCE_BY_ACCOUNT_SQL.replace('{placeholders}', idPlaceholders))
      .all(accountSetId, ...allIds, year) as Array<{
      account_id: string
      init_balance: number | null
    }>

    const periodRows = db
      .prepare(
        `SELECT account_id,
                SUM(current_debit) AS d,
                SUM(current_credit) AS c
         FROM account_balances
         WHERE account_set_id = ?
           AND account_id IN (${idPlaceholders})
           AND year = ?
           AND period <= ?
         GROUP BY account_id`
      )
      .all(accountSetId, ...allIds, year, period) as Array<{
      account_id: string
      d: number | null
      c: number | null
    }>

    const initById = new Map<string, number>()
    for (const r of initRows) initById.set(r.account_id, Number(r.init_balance) || 0)
    const periodById = new Map<string, { d: number; c: number }>()
    for (const r of periodRows) periodById.set(r.account_id, { d: Number(r.d) || 0, c: Number(r.c) || 0 })

    // P1-15：叶子期初按「叶子自身方向」签名，汇总到方向可能不同的顶层时需翻转符号
    // （发生额用原始 current_debit/credit，方向无关，无需翻转）。
    const dirRows = db
      .prepare(`SELECT id, direction FROM accounts WHERE account_set_id = ? AND id IN (${idPlaceholders})`)
      .all(accountSetId, ...allIds) as Array<{ id: string; direction: string }>
    const dirById = new Map<string, string>()
    for (const r of dirRows) dirById.set(r.id, r.direction)

    // 3) 按 top_code 汇总
    for (const [code, info] of codeMeta) {
      let initSum = 0
      let debitSum = 0
      let creditSum = 0
      for (const id of info.ids) {
        const leafInit = initById.get(id) || 0
        const leafDir = dirById.get(id) || info.direction
        initSum += leafDir === info.direction ? leafInit : -leafInit
        const p = periodById.get(id)
        if (p) {
          debitSum += p.d
          creditSum += p.c
        }
      }
      const balance =
        info.direction === 'debit'
          ? round2(initSum + debitSum - creditSum)
          : round2(initSum + creditSum - debitSum)
      result.set(code, balance)
    }

    // 未被处理的 code（无对应科目）显式置 0
    for (const code of accountCodes) {
      if (!result.has(code)) result.set(code, 0)
    }

    return result
  } catch (err) {
    console.error('批量查询余额失败:', err)
    return result
  }
}

/**
 * 从凭证分录直接汇总区间发生额，排除结转凭证（voucher_types.name = '结转'）
 * 用于 @jqy 函数，取结转前的净发生额
 */
export function getPeriodRangeSumExcludeTransfer(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountCode: string,
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext
): { debit: number; credit: number } {
  try {
    const from = Math.min(12, Math.max(1, Math.trunc(fromPeriod)))
    const to = Math.min(12, Math.max(from, Math.trunc(toPeriod)))
    const codeMeta = expandTopCodesToLeafIds(db, accountSetId, [accountCode], year)
    const leafIds = filterAccountIdsByScope(
      accountScope,
      codeMeta.get(accountCode)?.ids ?? []
    )
    if (leafIds.length === 0) {
      return { debit: 0, credit: 0 }
    }

    const placeholders = leafIds.map(() => '?').join(',')
    const row = db
      .prepare(
        `
      SELECT
        SUM(CASE WHEN ve.direction = 'debit' THEN ve.amount ELSE 0 END) as total_debit,
        SUM(CASE WHEN ve.direction = 'credit' THEN ve.amount ELSE 0 END) as total_credit
      FROM voucher_entries ve
      JOIN vouchers v ON v.id = ve.voucher_id
      JOIN voucher_types vt ON vt.id = v.voucher_type_id
      WHERE v.account_set_id = ?
        AND ve.account_id IN (${placeholders})
        AND v.year = ?
        AND v.period >= ?
        AND v.period <= ?
        AND v.status = 'posted'
        AND vt.name != '结转'
    `
      )
      .get(accountSetId, ...leafIds, year, from, to) as any

    return {
      debit: row?.total_debit || 0,
      credit: row?.total_credit || 0,
    }
  } catch {
    return { debit: 0, credit: 0 }
  }
}

/**
 * 批量查询多个科目的期间发生额（优化版，消除 N+1 查询）
 * @param db 数据库连接
 * @param accountSetId 账套 ID
 * @param accountCodes 科目编码数组
 * @param year 年度
 * @param period 期间
 * @returns 科目编码到发生额的映射
 */
export function getBatchPeriodRangeSums(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountCodes: string[],
  year: number,
  fromPeriod: number,
  toPeriod: number,
  accountScope?: AccountScopeContext
): Map<string, { debit: number; credit: number }> {
  const result = new Map<string, { debit: number; credit: number }>()

  if (accountCodes.length === 0) return result

  try {
    // 与 getBatchBalances 一致：把 top_code 展开为子树叶子，再聚合发生额
    const codeMeta = expandTopCodesToLeafIds(db, accountSetId, accountCodes, year)
    const allIds = filterAccountIdsByScope(
      accountScope,
      Array.from(new Set(Array.from(codeMeta.values()).flatMap(info => info.ids)))
    )

    if (allIds.length === 0) {
      for (const code of accountCodes) {
        if (!result.has(code)) result.set(code, { debit: 0, credit: 0 })
      }
      return result
    }

    const idPlaceholders = allIds.map(() => '?').join(',')
    const periodRows = db
      .prepare(
        `SELECT account_id,
                SUM(current_debit) AS d,
                SUM(current_credit) AS c
         FROM account_balances
         WHERE account_set_id = ?
           AND account_id IN (${idPlaceholders})
           AND year = ?
           AND period >= ?
           AND period <= ?
         GROUP BY account_id`
      )
      .all(accountSetId, ...allIds, year, fromPeriod, toPeriod) as Array<{
      account_id: string
      d: number | null
      c: number | null
    }>

    const periodById = new Map<string, { d: number; c: number }>()
    for (const r of periodRows) periodById.set(r.account_id, { d: Number(r.d) || 0, c: Number(r.c) || 0 })

    for (const [code, info] of codeMeta) {
      let debit = 0
      let credit = 0
      for (const id of info.ids) {
        const p = periodById.get(id)
        if (p) {
          debit += p.d
          credit += p.c
        }
      }
      result.set(code, { debit, credit })
    }

    for (const code of accountCodes) {
      if (!result.has(code)) {
        result.set(code, { debit: 0, credit: 0 })
      }
    }

    return result
  } catch (err) {
    console.error('批量查询区间发生额失败:', err)
    return result
  }
}

/** 累计至指定期间的发生额（1 月至 period） */
export function getBatchPeriodSums(
  db: BalanceQueryDb | Database,
  accountSetId: string,
  accountCodes: string[],
  year: number,
  period: number,
  accountScope?: AccountScopeContext
): Map<string, { debit: number; credit: number }> {
  return getBatchPeriodRangeSums(db, accountSetId, accountCodes, year, 1, period, accountScope)
}
