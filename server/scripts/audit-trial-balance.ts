import Database from 'better-sqlite3'
import { getBalance } from '../src/services/reportBalance.js'

const db = new Database('../data/finance.db')
const sid = (db.prepare("SELECT id FROM account_sets WHERE name='新企业会计'").get() as any).id

for (const code of ['6001001', '6602001', '4103', '4104015']) {
  const acc = db.prepare('SELECT id FROM accounts WHERE account_set_id=? AND code=?').get(sid, code) as any
  console.log(`\n=== ${code} ===`)
  const init = db.prepare('SELECT * FROM init_balances WHERE account_id=?').all(acc.id)
  console.log('init:', init)
  const entries = db.prepare(`
    SELECT v.voucher_no, v.status, ve.direction, ve.amount
    FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
    WHERE ve.account_id=? ORDER BY v.voucher_no
  `).all(acc.id)
  console.log('entries:', entries)
  const ab = db.prepare('SELECT period, current_debit, current_credit, end_balance FROM account_balances WHERE account_id=?').all(acc.id)
  console.log('account_balances:', ab)
  console.log('getBalance:', getBalance(db, sid, code, 2026, 5))
}

console.log('\n=== 试算平衡 ===')
const codes = db.prepare('SELECT code, direction FROM accounts WHERE account_set_id=? ORDER BY code').all(sid) as any[]
let td = 0, tc = 0
for (const a of codes) {
  const b = getBalance(db, sid, a.code, 2026, 5)
  if (Math.abs(b) > 0.001) {
    if (a.direction === 'debit') td += b
    else tc += b
  }
}
console.log(`借方 ${td}, 贷方 ${tc}, 差 ${(td-tc).toFixed(2)}`)
