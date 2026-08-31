import Database from 'better-sqlite3'
import { resolve } from 'path'
import { getCashFlowTrialBalance } from '../src/services/cashFlowTrialBalance.js'
import { getBatchBalances } from '../src/services/reportBalance.js'

const db = new Database(resolve(process.cwd(), '../data/finance.db'), { readonly: true })
const sid = 'ffcb6201-d156-4c2b-8527-13ebcf2dcd1a'

console.log('=== 润深衡 深度诊断 ===\n')

for (const includeUnposted of [false, true]) {
  console.log(`--- include_unposted=${includeUnposted} ---`)
  const r = getCashFlowTrialBalance(db, sid, 2026, 5, 'ytd', includeUnposted)
  console.log('summary:', r.summary)
  console.log('items:', r.items.map(i => `${i.code} net=${i.signedNet}`))
  const c3 = r.balanceChecks.find(c => c.id === 'begin_end_cash')
  console.log('校验3:', c3)
  console.log('')
}

console.log('--- 全部现金流量分录(含状态) ---')
const allCf = db
  .prepare(
    `SELECT v.voucher_no, v.status, v.period, ve.account_code, a.is_cash, a.is_bank,
            ve.direction, ve.amount, ve.cash_flow_code, cf.name as cf_name, cf.direction as cf_dir
     FROM voucher_entries ve
     JOIN vouchers v ON v.id=ve.voucher_id
     JOIN accounts a ON a.id=ve.account_id
     LEFT JOIN cash_flow_items cf ON cf.account_set_id=ve.account_set_id AND cf.code=ve.cash_flow_code
     WHERE ve.account_set_id=? AND v.year=2026 AND v.period BETWEEN 1 AND 5
       AND ve.cash_flow_code IS NOT NULL AND TRIM(ve.cash_flow_code)!=''
     ORDER BY v.voucher_date, v.voucher_no, ve.seq`
  )
  .all(sid) as any[]
for (const e of allCf) {
  console.log(
    `${e.voucher_no} [${e.status}] ${e.account_code}(cash=${e.is_cash},bank=${e.is_bank}) ${e.direction} ${e.amount} → ${e.cash_flow_code} ${e.cf_name} (${e.cf_dir})`
  )
}

console.log('\n--- getBatchBalances vs account_balances (1001) ---')
for (const p of [0, 1, 2, 3, 4, 5]) {
  const gb = getBatchBalances(db, sid, ['1001'], 2026, p).get('1001') || 0
  const ab = db
    .prepare(
      `SELECT end_balance, current_debit, current_credit, init_balance FROM account_balances
       WHERE account_set_id=? AND account_code='1001' AND year=2026 AND period=?`
    )
    .get(sid, p) as any
  console.log(`period ${p}: getBatchBalances=${gb.toFixed(2)} account_balances.end=${ab?.end_balance ?? 'N/A'}`)
}

console.log('\n--- 1001 期初 init_balances ---')
const init = db
  .prepare(
    `SELECT * FROM init_balances ib JOIN accounts a ON a.id=ib.account_id
     WHERE ib.account_set_id=? AND a.code='1001' AND ib.year=2026`
  )
  .all(sid)
console.log(init)

console.log('\n--- 从分录手工推算 1001 余额(含audited) ---')
const entries = db
  .prepare(
    `SELECT v.status, ve.direction, ve.amount FROM voucher_entries ve
     JOIN vouchers v ON v.id=ve.voucher_id JOIN accounts a ON a.id=ve.account_id
     WHERE ve.account_set_id=? AND a.code='1001' AND v.year=2026
       AND v.status IN ('draft','audited','posted') AND v.period<=5
     ORDER BY v.voucher_date`
  )
  .all(sid) as any[]
let bal = 10000 // init
for (const e of entries) {
  if (e.direction === 'debit') bal += e.amount
  else bal -= e.amount
  console.log(`  ${e.status} ${e.direction} ${e.amount} → 余额 ${bal}`)
}

console.log('\n--- 从分录手工推算 1001 余额(仅posted) ---')
bal = 10000
const postedOnly = db
  .prepare(
    `SELECT v.status, ve.direction, ve.amount FROM voucher_entries ve
     JOIN vouchers v ON v.id=ve.voucher_id JOIN accounts a ON a.id=ve.account_id
     WHERE ve.account_set_id=? AND a.code='1001' AND v.year=2026
       AND v.status='posted' AND v.period<=5`
  )
  .all(sid) as any[]
if (postedOnly.length === 0) console.log('  无已过账分录，余额保持期初 10000')
else {
  for (const e of postedOnly) {
    if (e.direction === 'debit') bal += e.amount
    else bal -= e.amount
    console.log(`  posted ${e.direction} ${e.amount} → 余额 ${bal}`)
  }
}

console.log('\n--- 1002/1002001 同样对比 ---')
for (const code of ['1002', '1002001', '1002002', '1002003']) {
  const gb5 = getBatchBalances(db, sid, [code], 2026, 5).get(code) || 0
  const ab5 = db
    .prepare(
      `SELECT end_balance FROM account_balances WHERE account_set_id=? AND account_code=? AND year=2026 AND period=5`
    )
    .get(sid, code) as any
  console.log(`${code}: getBatch=${gb5.toFixed(2)} ab.end=${ab5?.end_balance ?? 'N/A'}`)
}

db.close()
