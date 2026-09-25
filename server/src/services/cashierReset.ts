/**
 * FIX-264：出纳初始化——一步到位清空本账套出纳数据。
 *
 * - 出纳生成的凭证（source='cashier'）已记账的，按与「反记账」接口同一口径先反记账（回滚 account_balances），再删除；
 * - 出纳已结账月份一并清除（不再要求先逐月反结账）；
 * - 唯一不能自动处理的是：已记账出纳凭证所在的**总账期间已结账**——那是总账模块的审计冻结，初始化不越权反结总账。
 * 备份与附件文件删除由路由负责（异步 / 文件系统），这里只做数据库部分，便于单测。
 */
import type { Database } from 'better-sqlite3'
import { applyVoucherUnpost, getAllowDirectPost, getRequireAuditEnabled, loadVoucherEntries, validateVoucherForUnpost } from './voucherPosting.js'
import { getPeriodClosingRecord, isPeriodClosed } from './voucherEntry.js'
import { deleteVoucherWithRefs } from './voucherDelete.js'

export interface CashierResetImpact {
  journalRows: number
  vouchers: number
  /** 已记账、将自动反记账的出纳凭证号 */
  postedVouchers: string[]
  /** 将清除的出纳结账月份（YYYY-MM） */
  closedMonths: string[]
  /** 不能自动处理的阻断项：已记账出纳凭证所在的总账已结账期间（YYYY年M期） */
  blockedGlPeriods: string[]
}

function hasTable(db: Database, name: string) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
}

function cashierVouchers(db: Database, asid: string) {
  return db.prepare(
    "SELECT id, voucher_no, status, source, year, period FROM vouchers WHERE account_set_id=? AND source='cashier' ORDER BY voucher_date, voucher_no"
  ).all(asid) as Array<{ id: string; voucher_no: string; status: 'draft' | 'audited' | 'posted'; source: string; year: number; period: number }>
}

export function getCashierResetImpact(db: Database, asid: string): CashierResetImpact {
  const vouchers = cashierVouchers(db, asid)
  const posted = vouchers.filter(v => v.status === 'posted')
  const blocked = new Set<string>()
  for (const v of posted) {
    if (isPeriodClosed(getPeriodClosingRecord({ db, accountSetId: asid, year: v.year, period: v.period }))) {
      blocked.add(`${v.year}年${v.period}期`)
    }
  }
  const closedMonths = hasTable(db, 'cashier_period_closing')
    ? (db.prepare(
        "SELECT year, month FROM cashier_period_closing WHERE account_set_id=? AND status='closed' ORDER BY year, month"
      ).all(asid) as Array<{ year: number; month: number }>).map(r => `${r.year}-${String(r.month).padStart(2, '0')}`)
    : []
  const journalRows = (db.prepare('SELECT COUNT(*) n FROM cashier_journal WHERE account_set_id=?').get(asid) as { n: number }).n
  return {
    journalRows,
    vouchers: vouchers.length,
    postedVouchers: posted.map(v => v.voucher_no),
    closedMonths,
    blockedGlPeriods: [...blocked],
  }
}

/**
 * 清空出纳数据（数据库部分，单事务）。有阻断项时抛错（调用方应先用 getCashierResetImpact 检查）。
 * 返回统计：删除凭证数、其中自动反记账数、清除的结账月数。
 */
export function performCashierReset(db: Database, asid: string): { deletedVouchers: number; unpostedVouchers: number; clearedClosings: number } {
  const impact = getCashierResetImpact(db, asid)
  if (impact.blockedGlPeriods.length) {
    throw new Error(`总账 ${impact.blockedGlPeriods.join('、')} 已结账，其中有已记账的出纳凭证，请先在总账「期末结账」中取消结账后再初始化`)
  }
  const vouchers = cashierVouchers(db, asid)
  const param = (key: string) => db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?').get(asid, key) as any
  const ctx = {
    accountSetId: asid,
    requireAudit: getRequireAuditEnabled(param('require_audit')),
    allowDirectPost: getAllowDirectPost(param('allow_direct_post')),
  }
  let unposted = 0
  db.transaction(() => {
    for (const v of vouchers) {
      if (v.status === 'posted') {
        const err = validateVoucherForUnpost(v)
        if (err) throw new Error(`${v.voucher_no}：${err}`)
        applyVoucherUnpost(db, v, loadVoucherEntries(db, v.id), ctx)
        unposted++
      }
      deleteVoucherWithRefs(db, asid, v)
    }
    if (hasTable(db, 'cashier_attachments')) db.prepare('DELETE FROM cashier_attachments WHERE account_set_id=?').run(asid)
    // FIX-262 新表：对账批次随日记账一起清空，避免孤儿批次
    if (hasTable(db, 'cashier_gl_match')) db.prepare('DELETE FROM cashier_gl_match WHERE account_set_id=?').run(asid)
    db.prepare('DELETE FROM cashier_journal WHERE account_set_id=?').run(asid)
    db.prepare('DELETE FROM cashier_init_balance WHERE account_set_id=?').run(asid)
    if (hasTable(db, 'bank_statement')) db.prepare('DELETE FROM bank_statement WHERE account_set_id=?').run(asid)
    if (hasTable(db, 'cashier_period_closing')) db.prepare('DELETE FROM cashier_period_closing WHERE account_set_id=?').run(asid)
  })()
  return { deletedVouchers: vouchers.length, unpostedVouchers: unposted, clearedClosings: impact.closedMonths.length }
}
