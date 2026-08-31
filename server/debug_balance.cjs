const db = require('./src/database/connection').default
const conn = db.getConnection()

console.log('=== account_balances for 4001/5001 ===')
const balances = conn
  .prepare(
    `
  SELECT ab.*, aa.code, aa.name
  FROM account_balances ab
  JOIN account_accounts aa ON ab.account_id = aa.id
  WHERE aa.code IN ('4001', '5001', '1001')
`
  )
  .all()
console.log(JSON.stringify(balances, null, 2))

console.log('\n=== Account Sets ===')
const sets = conn.prepare('SELECT id, year, period FROM account_sets LIMIT 3').all()
console.log(JSON.stringify(sets, null, 2))

console.log('\n=== System params (auto_transfer) ===')
const params = conn
  .prepare(
    `
  SELECT * FROM system_params
  WHERE param_key LIKE 'auto_transfer%'
`
  )
  .all()
console.log(JSON.stringify(params, null, 2))
