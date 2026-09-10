/**
 * FIX-104 配套数据修复：为「只有辅助明细行、缺科目汇总行」的期初补建汇总行。
 *
 * 背景：账簿 / 试算 / 报表现在统一按「科目汇总行（aux_item_id=''）优先」取期初，
 * 没有汇总行时才回退累加辅助明细。回退分支在**单辅助类目**下与汇总行等价，
 * 但**多辅助类目**下仍会成倍放大（dept 合计 91 + person 合计 91 = 182）。
 * 汇总行由 initBalanceAux 在保存辅助期初时维护，历史数据 / 旧批量导入可能没写过。
 * 本脚本按现有辅助明细重算并补建汇总行，把回退分支彻底清空。
 *
 * 处理范围：`init_balances` 中存在 aux_item_id != '' 的 (账套, 科目, 年, 期)，
 * 且该组合下没有 aux_item_id='' 的行。已有汇总行的组合一律不动（幂等，可重复执行）。
 * 重算逻辑复用 `initBalanceAux.syncInitBalanceAuxSummary`，即取某一辅助类目的合计，
 * 与界面保存期初时写出的值完全一致。
 *
 * 注意：若某科目的各辅助类目合计本就不相等（历史脏数据），重算取的是其中一个类目的合计，
 * 脚本会把这类组合标为 `inconsistent` 列出，建议人工到期初录入页复核后重新保存。
 *
 * 用法：
 *   # 只看会补哪些，不写库（默认）
 *   npx tsx server/src/scripts/backfillInitBalanceAuxSummary.ts
 *   # 指定账套
 *   npx tsx server/src/scripts/backfillInitBalanceAuxSummary.ts <accountSetId>
 *   # 确认无误后真正写库
 *   npx tsx server/src/scripts/backfillInitBalanceAuxSummary.ts <accountSetId> --apply
 */
import type { Database } from 'better-sqlite3'
import { getDb } from '../db/index.js'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import {
  checkInitBalanceAuxCategoryConsistency,
  syncInitBalanceAuxSummary,
} from '../services/initBalanceAux.js'

export interface SummaryBackfillRow {
  account_set_id: string
  account_id: string
  account_code: string
  account_name: string
  year: number
  period: number
  aux_row_count: number
  aux_total: number
  /** 补建后的汇总行金额（试运行时为按类目重算的预期值） */
  summary_amount: number
  consistent: boolean
}

export interface SummaryBackfillResult {
  rows: SummaryBackfillRow[]
  filled: number
  inconsistent: number
}

export function backfillInitBalanceAuxSummary(
  accountSetId?: string,
  options?: { apply?: boolean; db?: Database }
): SummaryBackfillResult {
  const db = options?.db ?? getDb()
  const apply = options?.apply === true

  const params: Array<string | number> = []
  let scope = ''
  if (accountSetId) {
    scope = 'AND ib.account_set_id = ?'
    params.push(accountSetId)
  }

  // 有辅助明细、但同一 (账套, 科目, 年, 期) 下没有汇总行的组合
  const targets = db
    .prepare(
      `SELECT ib.account_set_id, ib.account_id, ib.year, ib.period,
              COUNT(*) AS aux_row_count, SUM(ib.init_balance) AS aux_total,
              a.code AS account_code, a.name AS account_name
       FROM init_balances ib
       JOIN accounts a ON a.id = ib.account_id AND a.account_set_id = ib.account_set_id
       WHERE COALESCE(ib.aux_item_id, '') != ''
         ${scope}
         AND NOT EXISTS (
           SELECT 1 FROM init_balances s
           WHERE s.account_set_id = ib.account_set_id
             AND s.account_id = ib.account_id
             AND s.year = ib.year
             AND s.period = ib.period
             AND COALESCE(s.aux_item_id, '') = ''
         )
       GROUP BY ib.account_set_id, ib.account_id, ib.year, ib.period
       ORDER BY ib.account_set_id, a.code, ib.year, ib.period`
    )
    .all(...params) as Array<{
    account_set_id: string
    account_id: string
    year: number
    period: number
    aux_row_count: number
    aux_total: number
    account_code: string
    account_name: string
  }>

  const readSummary = db.prepare(
    `SELECT init_balance FROM init_balances
     WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND COALESCE(aux_item_id,'')=''`
  )

  const rows: SummaryBackfillRow[] = []

  /** 各辅助类目合计不一致的科目集合，按 (账套, 年, 期) 缓存——一致性检查是账套级的 */
  const mismatchCache = new Map<string, Set<string>>()
  const mismatchedAccounts = (setId: string, year: number, period: number): Set<string> => {
    const key = `${setId}|${year}|${period}`
    const cached = mismatchCache.get(key)
    if (cached) return cached
    let ids = new Set<string>()
    try {
      const check = checkInitBalanceAuxCategoryConsistency(db, setId, year, period)
      ids = new Set(check.mismatches.map((m: { account_id: string }) => m.account_id))
    } catch {
      // 科目配置已变更（辅助类目被删等）无法判定，留空集合，逐科目按一致处理
    }
    mismatchCache.set(key, ids)
    return ids
  }

  const run = db.transaction(() => {
    for (const t of targets) {
      const consistent = !mismatchedAccounts(t.account_set_id, t.year, t.period).has(t.account_id)

      syncInitBalanceAuxSummary(db, t.account_set_id, t.account_id, t.year, t.period)
      const summary = readSummary.get(
        t.account_set_id,
        t.account_id,
        t.year,
        t.period
      ) as { init_balance: number } | undefined

      rows.push({
        account_set_id: t.account_set_id,
        account_id: t.account_id,
        account_code: t.account_code,
        account_name: t.account_name,
        year: t.year,
        period: t.period,
        aux_row_count: Number(t.aux_row_count) || 0,
        aux_total: Number(t.aux_total) || 0,
        summary_amount: Number(summary?.init_balance) || 0,
        consistent,
      })
    }
    if (!apply) {
      // 试运行：算完即回滚，只留下报告
      throw new DryRunRollback()
    }
  })

  try {
    run()
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }

  return {
    rows,
    filled: rows.length,
    inconsistent: rows.filter(r => !r.consistent).length,
  }
}

class DryRunRollback extends Error {}

function isDirectScriptRun(scriptName: string) {
  if (!process.argv[1]) return false
  const currentName = basename(fileURLToPath(import.meta.url)).replace(/\.(cjs|mjs|js|ts)$/i, '')
  const entryName = basename(process.argv[1]).replace(/\.(cjs|mjs|js|ts)$/i, '')
  return currentName === scriptName && entryName === scriptName
}

if (isDirectScriptRun('backfillInitBalanceAuxSummary')) {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const accountSetId = args.find(a => !a.startsWith('--'))
  const result = backfillInitBalanceAuxSummary(accountSetId, { apply })

  for (const r of result.rows) {
    const flag = r.consistent ? '' : '  ⚠各辅助类目合计不一致，请人工复核'
    console.log(
      `补汇总行  ${r.account_code} ${r.account_name}  ${r.year}年${r.period}期  ` +
        `辅助明细 ${r.aux_row_count} 行合计 ${r.aux_total} → 汇总行 ${r.summary_amount}${flag}`
    )
  }
  console.log(
    `\n${apply ? '已写库' : '试运行（未写库，加 --apply 生效）'}：` +
      `待补建 ${result.filled} 组，其中类目合计不一致 ${result.inconsistent} 组`
  )
}
