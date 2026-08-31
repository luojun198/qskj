import Database from 'better-sqlite3'
import { getBalance } from '../src/services/reportBalance.js'

const db = new Database('../data/finance.db')
const sid = (db.prepare("SELECT id FROM account_sets WHERE name='新企业会计'").get() as any).id

for (const code of ['1001', '1122']) {
  console.log(`\n--- ${code} ---`)
  const acc = db.prepare('SELECT id, name FROM accounts WHERE account_set_id=? AND code=?').get(sid, code) as any
  const init = db.prepare('SELECT * FROM init_balances WHERE account_set_id=? AND account_id=?').all(sid, acc.id)
  console.log('期初:', JSON.stringify(init, null, 2))
  const entries = db.prepare(`
    SELECT v.voucher_no, v.status, ve.direction, ve.amount, ve.summary
    FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
    WHERE ve.account_id=? ORDER BY v.voucher_no
  `).all(acc.id)
  console.log('分录:', entries)
  console.log('余额 getBalance:', getBalance(db, sid, code, 2026, 5))
}

// 借贷平衡：全部科目
console.log('\n=== 全部一级科目余额 ===')
const topAccounts = db.prepare(`
  SELECT code, name, direction FROM accounts
  WHERE account_set_id=? AND (parent_id IS NULL OR parent_id='')
  ORDER BY code
`).all(sid) as any[]
let d = 0, c = 0
for (const a of topAccounts) {
  const bal = getBalance(db, sid, a.code, 2026, 5)
  if (Math.abs(bal) > 0.001) {
    console.log(`  ${a.code} ${a.name}: ${bal}`)
    if (a.direction === 'debit') d += bal
    else c += bal
  }
}
console.log(`借方余额合计 ${d}, 贷方余额合计 ${c}, 差 ${(d - c).toFixed(2)}`)
