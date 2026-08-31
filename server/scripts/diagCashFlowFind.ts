import Database from 'better-sqlite3'
import { resolve } from 'path'

const db = new Database(resolve(process.cwd(), '../data/finance.db'), { readonly: true })

const sets = db.prepare('SELECT id, name FROM account_sets').all() as any[]

for (const set of sets) {
  const id = set.id
  const cfCount = db
    .prepare(
      `SELECT COUNT(*) as c FROM voucher_entries ve
       JOIN vouchers v ON v.id=ve.voucher_id
       WHERE ve.account_set_id=? AND v.year=2026 AND ve.cash_flow_code IS NOT NULL AND TRIM(ve.cash_flow_code)!=''`
    )
    .get(id) as any
  const cashPosted = db
    .prepare(
      `SELECT COUNT(*) as c FROM voucher_entries ve
       JOIN vouchers v ON v.id=ve.voucher_id
       JOIN accounts a ON a.id=ve.account_id
       WHERE ve.account_set_id=? AND v.year=2026 AND v.status='posted'
         AND (a.is_cash=1 OR a.is_bank=1)`
    )
    .get(id) as any
  if (cfCount.c > 0 || cashPosted.c > 0) {
    console.log(`\n${set.name} (${id})`)
    console.log(`  含现金流量分录: ${cfCount.c}, 现金/银行已过账分录: ${cashPosted.c}`)

    const items = db
      .prepare(
        `SELECT ve.cash_flow_code, cf.name, SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END) as net
         FROM voucher_entries ve
         JOIN vouchers v ON v.id=ve.voucher_id
         LEFT JOIN cash_flow_items cf ON cf.account_set_id=ve.account_set_id AND cf.code=ve.cash_flow_code
         WHERE ve.account_set_id=? AND v.year=2026 AND v.period BETWEEN 1 AND 5 AND v.status='posted'
           AND ve.cash_flow_code IS NOT NULL AND TRIM(ve.cash_flow_code)!=''
         GROUP BY ve.cash_flow_code ORDER BY ve.cash_flow_code`
      )
      .all(id) as any[]
    for (const i of items) console.log(`    ${i.cash_flow_code} ${i.name || ''}: net ${Number(i.net).toFixed(2)}`)

    const cashNet = db
      .prepare(
        `SELECT SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END) as net
         FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
         JOIN accounts a ON a.id=ve.account_id
         WHERE ve.account_set_id=? AND v.year=2026 AND v.period BETWEEN 1 AND 5 AND v.status='posted'
           AND (a.is_cash=1 OR a.is_bank=1)`
      )
      .get(id) as any
    console.log(`  现金/银行分录净额 1-5月: ${Number(cashNet?.net || 0).toFixed(2)}`)
  }
}

// Deep dive 润深衡 - account_balances vs getBalance inconsistency for 1001
console.log('\n\n=== 润深衡 account_balances 异常 ===')
const sid = 'ffcb6201-d156-4c2b-8527-13ebcf2dcd1a'
const ab1001 = db
  .prepare(
    `SELECT * FROM account_balances WHERE account_set_id=? AND account_code='1001' AND year=2026 ORDER BY period`
  )
  .all(sid)
console.log('1001 account_balances:', ab1001)

const entries1001 = db
  .prepare(
    `SELECT v.voucher_no, v.voucher_date, v.period, v.status, ve.direction, ve.amount, ve.cash_flow_code
     FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
     JOIN accounts a ON a.id=ve.account_id
     WHERE ve.account_set_id=? AND a.code='1001' AND v.year=2026
     ORDER BY v.voucher_date, v.voucher_no`
  )
  .all(sid)
console.log('1001 全部分录:', entries1001)

db.close()
