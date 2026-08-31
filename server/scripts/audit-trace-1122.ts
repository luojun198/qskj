import Database from 'better-sqlite3'
import { getBalance, getBatchBalances } from '../src/services/reportBalance.js'

const db = new Database('../data/finance.db')
const sid = (db.prepare("SELECT id FROM account_sets WHERE name='新企业会计'").get() as any).id

console.log('=== 1122 科目树 ===')
const children = db.prepare(`
  WITH RECURSIVE tree AS (
    SELECT id, code, name, parent_id, 0 as lvl FROM accounts
    WHERE account_set_id=? AND code='1122'
    UNION ALL
    SELECT a.id, a.code, a.name, a.parent_id, t.lvl+1 FROM accounts a
    JOIN tree t ON a.parent_id=t.id
  )
  SELECT * FROM tree ORDER BY code
`).all(sid) as any[]

for (const a of children) {
  const bal = getBalance(db, sid, a.code, 2026, 5)
  const entries = db.prepare(`
    SELECT SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END) as net
    FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
    WHERE ve.account_id=? AND v.status='posted' AND v.year=2026 AND v.period<=5
  `).get(a.id) as any
  console.log(`  ${'  '.repeat(a.lvl)}${a.code} ${a.name}: getBalance=${bal}, 凭证净额=${entries?.net ?? 0}`)
}

console.log('\n=== 1122 全部分录（含未记账）===')
const acc1122 = db.prepare('SELECT id FROM accounts WHERE account_set_id=? AND code=?').get(sid, '1122') as any
const allEntries = db.prepare(`
  SELECT v.voucher_no, v.status, v.year, v.period, ve.direction, ve.amount
  FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
  WHERE ve.account_id=? OR ve.account_code LIKE '1122%'
  ORDER BY v.voucher_no
`).all(acc1122.id)
console.log(allEntries)

// Raw SQL balance like ledger
console.log('\n=== 1122 原始 SQL 汇总 ===')
const raw = db.prepare(`
  SELECT ve.account_code, ve.direction, SUM(ve.amount) as total
  FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
  WHERE v.account_set_id=? AND v.status='posted' AND ve.account_code LIKE '1122%'
  GROUP BY ve.account_code, ve.direction
`).all(sid)
console.log(raw)

console.log('\n=== 1001 期初汇总 ===')
const inits = db.prepare(`
  SELECT aux_item_id, init_balance, init_debit, init_credit, opening_debit, pre_book_debit
  FROM init_balances ib JOIN accounts a ON a.id=ib.account_id
  WHERE ib.account_set_id=? AND a.code='1001'
`).all(sid)
console.log(inits)
console.log('init_balance sum:', inits.reduce((s: number, r: any) => s + r.init_balance, 0))

console.log('\n=== 1122 account_balances ===')
const rows = db.prepare(`
  SELECT ab.* FROM account_balances ab
  JOIN accounts a ON a.id=ab.account_id
  WHERE ab.account_set_id=? AND a.code='1122'
  ORDER BY ab.year, ab.period
`).all(sid)
console.log(rows)
