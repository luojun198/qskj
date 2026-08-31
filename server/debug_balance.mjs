import Database from 'better-sqlite3'
import { resolve } from 'path'

const DB_PATH = resolve('D:\\kf\\cw0416\\server\\data\\cw_finance.db')
const db = new Database(DB_PATH)

console.log('=== All tables ===')
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
console.log(JSON.stringify(tables, null, 2))

console.log('\n=== account_balances table info ===')
try {
  const balances = db.prepare('SELECT * FROM account_balances LIMIT 5').all()
  console.log('Sample data:', JSON.stringify(balances, null, 2))
} catch (e) {
  console.log('Error:', e.message)
}

console.log('\n=== accounts for 4001/5001 ===')
const accounts = db.prepare("SELECT * FROM accounts WHERE code IN ('4001', '5001', '1001')").all()
console.log(JSON.stringify(accounts, null, 2))

console.log('\n=== vouchers (last 5) ===')
const vouchers = db.prepare('SELECT * FROM vouchers ORDER BY created_at DESC LIMIT 5').all()
console.log(JSON.stringify(vouchers, null, 2))

console.log('\n=== voucher_entries with 4001/5001 (last 10) ===')
const entries = db
  .prepare(
    `
  SELECT ve.*, a.code, a.name
  FROM voucher_entries ve
  JOIN accounts a ON ve.account_id = a.id
  WHERE ve.account_code IN ('4001', '5001', '1001')
  ORDER BY ve.created_at DESC
  LIMIT 10
`
  )
  .all()
console.log(JSON.stringify(entries, null, 2))

db.close()
