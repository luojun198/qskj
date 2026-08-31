import Database from 'better-sqlite3'
import { getBalance } from '../src/services/reportBalance.js'

const db = new Database('../data/finance.db')
const accountSetId = 'c97058df-65d2-4402-b57c-95479944764d'
const year = 2026
const period = 5

const accounts = db.prepare(`
  SELECT a.code, a.name, a.direction
  FROM accounts a
  WHERE a.account_set_id = ? AND a.is_enabled = 1
  ORDER BY a.code
`).all(accountSetId) as any[]

let assetTotal = 0
let liabEquityTotal = 0
const nonZero: any[] = []

for (const a of accounts) {
  const bal = getBalance(db, accountSetId, a.code, year, period)
  if (Math.abs(bal) < 0.01) continue
  nonZero.push({ code: a.code, name: a.name, direction: a.direction, bal })
  if (a.direction === 'debit') assetTotal += bal
  else liabEquityTotal += bal
}

console.log('Non-zero leaf/parent balances:')
for (const r of nonZero) console.log(r.code, r.name, r.direction, r.bal)
console.log('\nSum debit-direction balances:', assetTotal)
console.log('Sum credit-direction balances:', liabEquityTotal)
console.log('Diff:', assetTotal - liabEquityTotal)
