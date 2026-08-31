import Database from 'better-sqlite3'

const db = new Database('../data/finance.db')
const id = 'c97058df-65d2-4402-b57c-95479944764d'

const init = db.prepare(`
  SELECT SUM(CASE WHEN a.direction='debit' THEN ib.init_balance ELSE -ib.init_balance END) as net
  FROM init_balances ib JOIN accounts a ON a.id=ib.account_id
  WHERE ib.account_set_id=? AND ib.year=2026
`).get(id) as any

const posted = db.prepare(`
  SELECT SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END) as net
  FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
  WHERE v.account_set_id=? AND v.status='posted' AND v.year=2026 AND v.period<=5
`).get(id) as any

console.log('init net (debit positive):', init?.net)
console.log('posted net:', posted?.net)

const byAccount = db.prepare(`
  SELECT a.code, a.name, a.direction,
    COALESCE((SELECT SUM(init_balance) FROM init_balances ib WHERE ib.account_id=a.id AND ib.year=2026),0) as init,
    COALESCE((SELECT SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END)
      FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
      WHERE ve.account_id=a.id AND v.status='posted' AND v.year=2026 AND v.period<=5),0) as movement
  FROM accounts a
  WHERE a.account_set_id=? AND a.is_enabled=1
  AND (init != 0 OR movement != 0)
  ORDER BY a.code
`).all(id)

console.log('\nAccounts with activity:')
let td=0, tc=0
for (const r of byAccount as any[]) {
  const bal = r.direction==='debit' ? r.init+r.movement : -(r.init+r.movement)
  // natural balance
  const natural = r.direction==='debit' ? r.init + (db.prepare(`SELECT SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END) as m FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id WHERE ve.account_id=(SELECT id FROM accounts WHERE account_set_id=? AND code=?) AND v.status='posted' AND v.year=2026 AND v.period<=5`).get(id, r.code) as any)?.m || 0) : 0
  console.log(r.code, r.name, 'init', r.init, 'mov', r.movement)
}
