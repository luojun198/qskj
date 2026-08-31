import Database from 'better-sqlite3'
import { buildLedgerGeneralQuery } from '../src/services/ledgerQuery.js'

const db = new Database('../data/finance.db')
const sid = (db.prepare("SELECT id FROM account_sets WHERE name='新企业会计'").get() as any).id

const query = buildLedgerGeneralQuery({
  accountSetId: sid,
  startDate: '2026-05-01',
  endDate: '2026-05-31',
})

const rows = db.prepare(query.sql).all(...query.params) as any[]
const r1001 = rows.find(r => r.account_code === '1001')
console.log('1001 raw from query:', r1001)

const inits = db.prepare(`
  SELECT aux_item_id, init_balance, init_debit, init_credit FROM init_balances ib
  JOIN accounts a ON a.id = ib.account_id
  WHERE a.account_set_id=? AND a.code='1001' AND ib.year=2026
`).all(sid)
console.log('\ninit_balances rows:', inits)

// buildAccountInitBalanceExpr result
const correct = db.prepare(`
  SELECT
    CASE
      WHEN COUNT(CASE WHEN ib.aux_item_id != '' THEN 1 END) > 0
      THEN SUM(CASE WHEN ib.aux_item_id != '' THEN ib.init_balance ELSE 0 END)
      ELSE SUM(CASE WHEN COALESCE(ib.aux_item_id, '') = '' THEN ib.init_balance ELSE 0 END)
    END as init_balance
  FROM init_balances ib
  JOIN accounts a ON a.id = ib.account_id
  WHERE ib.account_set_id=? AND ib.year=2026 AND a.code='1001'
`).get(sid) as any
console.log('\nbuildAccountInitBalanceExpr style:', correct?.init_balance)

// wrong sum all
const wrong = db.prepare(`
  SELECT SUM(ib.init_balance) as s FROM init_balances ib
  JOIN accounts a ON a.id = ib.account_id
  WHERE ib.account_set_id=? AND ib.year=2026 AND a.code='1001'
`).get(sid) as any
console.log('SUM all init_balance:', wrong.s)

// children of 1001
const children = db.prepare(`
  SELECT code, name FROM accounts WHERE account_set_id=? AND parent_id = (
    SELECT id FROM accounts WHERE account_set_id=? AND code='1001'
  )
`).all(sid, sid)
console.log('\n1001 children:', children)
