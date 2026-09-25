/**
 * FIX-261：出纳期初——从总账读入期初余额。
 * 出纳启用日所在月份之前的总账余额 = 总账年初余额 + 当年启用月之前各期凭证发生额
 * （FIX-262：只取已记账凭证，与出纳对账口径一致）。外币科目取原币金额。
 * （FIX-261 的「银行对账单期初」随 FIX-262 对账改为对总账而停用，cashier_init_balance.bank_balance 列保留不再使用。）
 */
import type Database from 'better-sqlite3'
import { calcSignedBalance } from '../utils/accountBalance.js'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * 某科目在出纳启用日之前的总账余额。科目有下级时汇总所有末级。
 * 返回 null 表示总账里没有这个科目。
 */
export function getGlOpeningBalance(
  db: Database.Database, asid: string, accountCode: string, currency: string, initDate: string, baseCurrency: string
): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(initDate)
  if (!m) throw new Error('出纳启用日期格式不正确')
  const year = Number(m[1])
  const month = Number(m[2])
  const leaves = db.prepare(`
    SELECT a.id, a.direction FROM accounts a
    WHERE a.account_set_id=? AND (a.code=? OR a.code LIKE ?)
      AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.account_set_id=a.account_set_id AND c.parent_id=a.id)
  `).all(asid, accountCode, `${accountCode}%`) as Array<{ id: string; direction: 'debit' | 'credit' }>
  if (!leaves.length) return null

  const foreign = currency !== baseCurrency
  const initSql = foreign
    ? `SELECT COALESCE(SUM(foreign_init_balance),0) v FROM init_balances
       WHERE account_set_id=? AND account_id=? AND year=? AND (aux_item_id IS NULL OR aux_item_id='')`
    : `SELECT COALESCE(SUM(init_balance),0) v FROM init_balances
       WHERE account_set_id=? AND account_id=? AND year=? AND (aux_item_id IS NULL OR aux_item_id='')`
  const amt = foreign ? 'COALESCE(ve.foreign_amount,0)' : 've.amount'
  const curCond = foreign ? ' AND UPPER(COALESCE(ve.currency_code,\'\'))=?' : ''
  const flowSql = `
    SELECT COALESCE(SUM(CASE WHEN ve.direction='debit' THEN ${amt} ELSE 0 END),0) d,
           COALESCE(SUM(CASE WHEN ve.direction='credit' THEN ${amt} ELSE 0 END),0) c
    FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
    WHERE ve.account_set_id=? AND ve.account_id=? AND v.year=? AND v.period<? AND v.status='posted'${curCond}`
  const initStmt = db.prepare(initSql)
  const flowStmt = db.prepare(flowSql)

  let total = 0
  for (const a of leaves) {
    const init = (initStmt.get(asid, a.id, year) as { v: number }).v
    const args: unknown[] = [asid, a.id, year, month]
    if (foreign) args.push(currency.toUpperCase())
    const f = flowStmt.get(...args) as { d: number; c: number }
    total += calcSignedBalance(a.direction, init, f.d, f.c)
  }
  return round2(total)
}
