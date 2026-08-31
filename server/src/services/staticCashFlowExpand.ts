import type { Database } from 'better-sqlite3'

/**
 * 将配置中的科目编码前缀展开为账套内实际存在的科目编码（含下级明细）
 */
export function expandFlowAccountCodes(
  db: Database,
  accountSetId: string,
  patterns: string[]
): string[] {
  if (patterns.length === 0) return []

  const rows = db
    .prepare('SELECT code FROM accounts WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ code: string }>

  const matched = new Set<string>()
  for (const pattern of patterns) {
    const prefix = pattern.trim()
    if (!prefix) continue
    for (const row of rows) {
      const code = row.code.trim()
      if (code === prefix || code.startsWith(prefix)) {
        matched.add(code)
      }
    }
  }

  // 仅保留最上层匹配科目：剔除被同集合内某个祖先科目覆盖的下级科目。
  // 下游 getBatchBalances / getBatchPeriodRangeSums 会把每个编码再展开为子树叶子求和，
  // 若父、子同时返回会导致金额按约 2 倍重复计入（FIX：见 debug/修复日志.md）。
  const all = [...matched]
  const topmost = all.filter(
    code => !all.some(other => other !== code && code.startsWith(other))
  )
  return topmost.sort()
}

/** 汇总多个前缀对应科目的当期借贷发生额 */
export function sumPeriodFlowByPatterns(
  db: Database,
  accountSetId: string,
  patterns: string[],
  isDebit: boolean,
  periodSumMap: Map<string, { debit: number; credit: number }>
): number {
  const codes = expandFlowAccountCodes(db, accountSetId, patterns)
  let total = 0
  for (const code of codes) {
    const sum = periodSumMap.get(code) || { debit: 0, credit: 0 }
    total += isDebit ? sum.debit : sum.credit
  }
  return total
}
