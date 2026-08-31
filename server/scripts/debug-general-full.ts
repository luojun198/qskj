import Database from 'better-sqlite3'
import {
  buildLedgerGeneralQuery,
  supplementMissingParents,
  accumulateParentBalances,
  getCodeLengths,
} from '../src/services/ledgerQuery.js'

const db = new Database('../data/finance.db')

for (const setName of ['新企业会计', '老污龟办公室', '行政']) {
  const sid = (db.prepare('SELECT id FROM account_sets WHERE name=?').get(setName) as any)?.id
  if (!sid) continue

  const query = buildLedgerGeneralQuery({
    accountSetId: sid,
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    includeUnposted: true,
  })

  let list = db.prepare(query.sql).all(...query.params) as any[]
  const codeLengths = getCodeLengths(db, sid)
  list = supplementMissingParents(list, db, sid, codeLengths)
  list = accumulateParentBalances(list, codeLengths)

  const cash = list.filter(r => r.account_code === '1001' || r.account_code.startsWith('1001'))
  console.log(`\n=== ${setName} ===`)
  for (const r of cash) {
    console.log(`  ${r.account_code} init=${r.init_balance} end=${r.end_balance}`)
  }

  // any init that looks like 3x pattern
  const suspicious = list.filter(r => Math.abs(r.init_balance) > 0.001).slice(0, 5)
  for (const r of suspicious) {
    const inits = db.prepare(`
      SELECT SUM(init_balance) as all_sum,
        (SELECT CASE WHEN COUNT(CASE WHEN aux_item_id != '' THEN 1 END) > 0
          THEN SUM(CASE WHEN aux_item_id != '' THEN init_balance ELSE 0 END)
          ELSE SUM(CASE WHEN COALESCE(aux_item_id, '') = '' THEN init_balance ELSE 0 END) END
         FROM init_balances WHERE account_id=a.id AND year=2026) as dedup
      FROM init_balances ib JOIN accounts a ON a.id=ib.account_id
      WHERE a.account_set_id=? AND a.code=? AND ib.year=2026
    `).get(sid, r.account_code) as any
    if (inits && Math.abs(r.init_balance - inits.all_sum) < 0.01 && Math.abs(inits.all_sum - inits.dedup) > 0.01) {
      console.log(`  SUSPICIOUS ${r.account_code}: shown=${r.init_balance} all_sum=${inits.all_sum} dedup=${inits.dedup}`)
    }
  }
}

// pre_book vouchers before start
const sid = (db.prepare("SELECT id FROM account_sets WHERE name='新企业会计'").get() as any).id
console.log('\n=== 1001 年初前凭证（含未记账）===')
const preV = db.prepare(`
  SELECT v.voucher_no, v.status, v.voucher_date, ve.direction, ve.amount
  FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
  JOIN accounts a ON a.id=ve.account_id
  WHERE v.account_set_id=? AND a.code='1001' AND v.voucher_date < '2026-05-01'
  ORDER BY v.voucher_date
`).all(sid)
console.log(preV)

console.log('\n=== init pre_book on 1001 ===')
console.log(db.prepare(`
  SELECT aux_item_id, init_balance, pre_book_debit, pre_book_credit, opening_debit, opening_credit
  FROM init_balances ib JOIN accounts a ON a.id=ib.account_id
  WHERE a.account_set_id=? AND a.code='1001' AND ib.year=2026
`).all(sid))
