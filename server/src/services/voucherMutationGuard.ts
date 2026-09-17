import type { Database } from 'better-sqlite3'
import { getPeriodClosingRecord, isPeriodClosed } from './voucherEntry.js'
import { assertCashierPeriodOpen } from './cashierPeriodClosing.js'

/**
 * 凭证可变性统一守卫（2026-09-17 三模块综合评审 P0-1 / P1-12 ~ P1-15）。
 *
 * 此前来源守卫只在删除 / PUT 上有，总账期间闸只在记账 / 反记账 / 修改 / 冲红上有，
 * 出纳结账闸（cashier_period_closing）在总账侧零引用——已结账月份的出纳凭证仍可被
 * 反记账 / 反审核 / 修改 / 冲红。所有会改写凭证状态或内容的入口统一前置调用本守卫：
 *
 *   1. 来源守卫：固定资产凭证（asset_*）不允许修改 / 删除 / 冲红，出纳凭证不允许删除 / 冲红 /
 *      已审核直改（反审核、反记账放行——出纳与固资模块回收凭证前都要求先在总账反记账）；
 *   2. 总账期间闸：凭证所属期间已结账则拒绝（冲红只看红字凭证目标期间，由调用方传 targetDate）；
 *   3. 出纳期间闸：凭证含现金 / 银行科目分录且所属月份出纳已结账则拒绝。
 */

export type VoucherMutation = 'update' | 'edit_audited' | 'unaudit' | 'unpost' | 'reverse' | 'delete'

export interface MutableVoucherLike {
  id: string
  voucher_no?: string | number | null
  status?: string | null
  source?: string | null
  voucher_date?: string | null
  year?: number | string | null
  period?: number | string | null
}

const OPERATION_LABEL: Record<VoucherMutation, string> = {
  update: '修改',
  edit_audited: '修改',
  unaudit: '反审核',
  unpost: '反记账',
  reverse: '冲红',
  delete: '删除',
}

function hasTable(db: Database, table: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

function isGlPeriodClosed(db: Database, accountSetId: string, year: number | string, period: number | string): boolean {
  if (!hasTable(db, 'period_closing')) return false
  return isPeriodClosed(getPeriodClosingRecord({ db, accountSetId, year, period }))
}

/** 总账期间已结账则抛错；供出纳 / 供应链等外部模块生成凭证前置调用 */
export function assertGlPeriodOpen(
  db: Database,
  accountSetId: string,
  year: number | string,
  period: number | string
): void {
  if (isGlPeriodClosed(db, accountSetId, year, period)) {
    throw new Error(`${year}年${period}期已结账，请先在「期末结账」中取消结账后再操作`)
  }
}

/** 来源守卫：与模块单据强绑定的凭证，只允许在生成它的模块回收 */
export function getSourceImmutableReason(
  voucher: Pick<MutableVoucherLike, 'source'>,
  operation: VoucherMutation
): string | null {
  const source = typeof voucher.source === 'string' ? voucher.source : ''
  if (source.startsWith('asset_')) {
    if (operation === 'delete') {
      return '固定资产生成的凭证不能直接删除，请到固定资产模块反折旧/撤销处置/删除资产后再试'
    }
    if (operation === 'update' || operation === 'edit_audited' || operation === 'reverse') {
      return `固定资产生成的凭证不能${OPERATION_LABEL[operation]}，请到固定资产模块反折旧/撤销处置/撤销变动后重新生成`
    }
  }
  if (source === 'cashier') {
    if (operation === 'delete') {
      return '出纳生成的凭证不能直接删除，请取消对账后再试'
    }
    if (operation === 'reverse') {
      return '出纳生成的凭证不能冲红，请到出纳模块删除日记账后重新生成'
    }
    if (operation === 'edit_audited') {
      return '出纳生成的凭证不能在已审核状态下直接修改，请先反审核'
    }
  }
  return null
}

/** 凭证是否含现金 / 银行科目分录（出纳闸只对这类凭证生效） */
export function isCashVoucher(db: Database, voucherId: string): boolean {
  if (!hasTable(db, 'accounts') || !hasTable(db, 'voucher_entries')) return false
  const row = db
    .prepare(
      `SELECT 1 FROM voucher_entries ve
         JOIN accounts a ON a.id = ve.account_id
        WHERE ve.voucher_id = ? AND (a.is_cash = 1 OR a.is_bank = 1)
        LIMIT 1`
    )
    .get(voucherId)
  return !!row
}

export interface VoucherMutationParams {
  db: Database
  accountSetId: string
  voucher: MutableVoucherLike
  operation: VoucherMutation
  /** 修改 / 冲红时的目标凭证日期（与原日期不同时同样要过闸） */
  targetDate?: string | null
}

/** 返回不可操作的原因；可操作返回 null */
export function getVoucherImmutableReason(params: VoucherMutationParams): string | null {
  const { db, accountSetId, voucher, operation } = params
  const sourceReason = getSourceImmutableReason(voucher, operation)
  if (sourceReason) return sourceReason

  const label = OPERATION_LABEL[operation]

  // 总账期间闸：冲红允许跨期（原凭证期间已结账时在当前期间生成红字），只看目标期间
  if (operation !== 'reverse' && voucher.year != null && voucher.period != null) {
    if (isGlPeriodClosed(db, accountSetId, voucher.year, voucher.period)) {
      return `${voucher.year}年${voucher.period}期已结账，不能${label}凭证`
    }
  }

  // 出纳期间闸
  if (isCashVoucher(db, voucher.id)) {
    const dates = new Set<string>()
    if (operation !== 'reverse' && voucher.voucher_date) dates.add(String(voucher.voucher_date))
    if (params.targetDate) dates.add(String(params.targetDate))
    for (const d of dates) {
      try {
        assertCashierPeriodOpen(db, accountSetId, d)
      } catch (e: any) {
        return `${e?.message || '出纳已结账'}（不能${label}含现金/银行科目的凭证）`
      }
    }
  }
  return null
}

export function assertVoucherMutable(params: VoucherMutationParams): void {
  const reason = getVoucherImmutableReason(params)
  if (reason) throw new Error(reason)
}
