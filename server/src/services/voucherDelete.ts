import type { Database } from 'better-sqlite3'
import { deleteVoucherRecords } from './voucherEntry.js'
import { getSourceImmutableReason, getVoucherImmutableReason } from './voucherMutationGuard.js'

/**
 * FIX-132：凭证删除守卫与关联清理的单一出口。
 * 此前只有单张删除（DELETE /vouchers/:id）有来源守卫与冲红/调汇/供应链引用清理，
 * 筛选模式批量删除直接跳过，导致出纳/固定资产单据 voucher_id 悬空、红字凭证删除后原凭证永远无法再冲红。
 */

function hasColumn(db: Database, table: string, column: string): boolean {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
  if (!exists) return false
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === column)
}

export interface DeletableVoucherLike {
  id: string
  voucher_no?: string | number | null
  status?: string | null
  source?: string | null
  voucher_date?: string | null
  year?: number | string | null
  period?: number | string | null
}

/**
 * 返回不可删除的原因；可删返回 null。
 * 传入 ctx 时同时校验总账期间闸与出纳期间闸（P1-12）；不传仅做状态 + 来源守卫（删除预览等只读场景）。
 */
export function getVoucherUndeletableReason(
  voucher: DeletableVoucherLike,
  ctx?: { db: Database; accountSetId: string }
): string | null {
  if (voucher.status === 'posted') {
    return '已记账凭证不能删除'
  }
  if (!ctx) return getSourceImmutableReason(voucher, 'delete')
  return getVoucherImmutableReason({ db: ctx.db, accountSetId: ctx.accountSetId, voucher, operation: 'delete' })
}

/** 删除凭证主/分录/附件，并在同一事务内清理对端引用 */
export function deleteVoucherWithRefs(db: Database, accountSetId: string, voucher: DeletableVoucherLike) {
  const run = db.transaction(() => {
    deleteVoucherRecords(db, voucher.id)
    // 期末调汇凭证被手工删除后，释放该期间的调汇记录，允许重新生成
    if (voucher.source === 'fx_reval') {
      db.prepare('DELETE FROM fx_revaluation_runs WHERE account_set_id=? AND voucher_id=?').run(accountSetId, voucher.id)
    }
    // 清理冲红关联的对端引用，避免悬空导致原凭证永远显示「已冲红」而无法再次冲红
    db.prepare('UPDATE vouchers SET reversed_by_voucher_id=NULL WHERE account_set_id=? AND reversed_by_voucher_id=?').run(
      accountSetId,
      voucher.id
    )
    db.prepare('UPDATE vouchers SET reversal_of_voucher_id=NULL WHERE account_set_id=? AND reversal_of_voucher_id=?').run(
      accountSetId,
      voucher.id
    )
    // 供应链单据回写清理：否则单据既不能重新生成凭证、也无法反审核（死锁）
    db.prepare('UPDATE scm_doc SET voucher_id=NULL WHERE account_set_id=? AND voucher_id=?').run(accountSetId, voucher.id)
    // 评审 P2：制费 / 人工吸收差异结转记录（迁移 139）。「转主营成本」的记录只由凭证体现结转效果，凭证删了记录作废（可再次结转）；
    // 「分摊到成品」的记录挂着成本调整单，单据仍在，只断开凭证引用
    if (hasColumn(db, 'scm_overhead_variance_run', 'voucher_id')) {
      db.prepare('DELETE FROM scm_overhead_variance_run WHERE account_set_id=? AND voucher_id=? AND doc_id IS NULL').run(accountSetId, voucher.id)
      db.prepare('UPDATE scm_overhead_variance_run SET voucher_id=NULL WHERE account_set_id=? AND voucher_id=?').run(accountSetId, voucher.id)
    }
    // 出纳日记账关联清理（迁移 127 voucher_id 列；老库无该列时跳过）：凭证没了，日记账应回到"未生成凭证"
    if (hasColumn(db, 'cashier_journal', 'voucher_id')) {
      db.prepare(
        `UPDATE cashier_journal SET voucher_year=NULL, voucher_month=NULL, voucher_type=NULL, voucher_no=NULL, voucher_id=NULL
          WHERE account_set_id=? AND voucher_id=?`
      ).run(accountSetId, voucher.id)
    }
  })
  run()
}

/** 批量删除：先逐张守卫，任一不可删整批拒绝；通过后在一个事务内逐张删除并清理引用 */
export function deleteVouchersWithRefs(db: Database, accountSetId: string, vouchers: DeletableVoucherLike[]) {
  for (const v of vouchers) {
    const reason = getVoucherUndeletableReason(v, { db, accountSetId })
    if (reason) {
      throw new Error(`${reason}：${v.voucher_no || v.id}`)
    }
  }
  const run = db.transaction(() => {
    for (const v of vouchers) deleteVoucherWithRefs(db, accountSetId, v)
  })
  run()
}
