import Database from 'better-sqlite3'
import { getBalance } from '../src/services/reportBalance.js'
import { INIT_BALANCE_GROUP_BY_ACCOUNT_SQL } from '../src/services/ledgerQuery.js'

const db = new Database('../data/finance.db')
const sid = (db.prepare("SELECT id FROM account_sets WHERE name='新企业会计'").get() as any).id
const acc = db.prepare('SELECT id FROM accounts WHERE account_set_id=? AND code=?').get(sid, '1001') as any

const wrong = db.prepare(`
  SELECT SUM(init_balance) as s FROM init_balances WHERE account_id=? AND year=2026
`).get(acc.id) as any

const rows = db.prepare(INIT_BALANCE_GROUP_BY_ACCOUNT_SQL.replace('WHERE year = ? AND account_set_id = ?', 'WHERE year = ? AND account_set_id = ? AND account_id = ?'))
// Actually the SQL groups all accounts - let me run it properly

const correctRows = db.prepare(`
  SELECT account_id,
    CASE
      WHEN COUNT(CASE WHEN aux_item_id != '' THEN 1 END) > 0
      THEN SUM(CASE WHEN aux_item_id != '' THEN init_balance ELSE 0 END)
      ELSE SUM(CASE WHEN COALESCE(aux_item_id, '') = '' THEN init_balance ELSE 0 END)
    END as init_balance
  FROM init_balances
  WHERE account_set_id = ? AND year = 2026 AND account_id = ?
  GROUP BY account_id
`).get(sid, 2026, acc.id) as any

console.log('Wrong SUM:', wrong.s)
console.log('LedgerQuery logic:', correctRows?.init_balance)
console.log('getBalance period 0:', getBalance(db, sid, '1001', 2026, 0))
console.log('getBalance period 5:', getBalance(db, sid, '1001', 2026, 5))
