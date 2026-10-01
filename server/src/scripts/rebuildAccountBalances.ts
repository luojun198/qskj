/**
 * 一次性脚本：根据 voucher_entries（status='posted' 的凭证）和 init_balances
 * 全量重建 account_balances 表。
 *
 * 用法：
 *   npm run --workspace=server scripts:rebuild-balances
 *   或带可选账套 ID：npm run --workspace=server scripts:rebuild-balances -- <accountSetId>
 *
 * 作用：
 *   - 修复历史结转/反结转流程中产生的 account_balances 脏数据（如 current_debit/credit 翻倍）
 *   - 外部导入（ACD 等）直接写入已记账凭证后补齐余额表
 *
 * 实现见 services/accountBalanceRebuild.ts（与 ACD 导入共用同一口径）。幂等，可重复运行。
 */
import { getDb } from '../db/index.js'
import { isDirectScriptRun } from '../utils/isDirectScriptRun.js'
import { rebuildAccountBalances } from '../services/accountBalanceRebuild.js'

type AccountSetRow = { id: string; name: string }

async function run() {
  const db = getDb()
  const targetSetId = process.argv[2]?.trim() || ''

  const accountSets = db
    .prepare(
      targetSetId
        ? `SELECT id, name FROM account_sets WHERE id=?`
        : `SELECT id, name FROM account_sets ORDER BY created_at ASC`
    )
    .all(...(targetSetId ? [targetSetId] : [])) as AccountSetRow[]

  if (accountSets.length === 0) {
    console.error('[rebuild-balances] 没有找到目标账套')
    process.exit(1)
  }

  console.log(`[rebuild-balances] 共 ${accountSets.length} 个账套待处理`)

  for (const accountSet of accountSets) {
    console.log(`\n[rebuild-balances] === ${accountSet.name} (${accountSet.id}) ===`)
    const result = rebuildAccountBalances(db, accountSet.id)
    console.log(`[rebuild-balances]   写入 ${result.rows} 行 account_balances`)
  }

  console.log('[rebuild-balances] 完成')
}

if (isDirectScriptRun('rebuildAccountBalances')) {
  run().catch(err => {
    console.error('[rebuild-balances] 运行失败：', err)
    process.exit(1)
  })
}
