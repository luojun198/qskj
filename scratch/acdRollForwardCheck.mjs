import Database from 'better-sqlite3'
import { resolve } from 'path'

const db = new Database(resolve(import.meta.dirname, 'acd-test-db/finance.db'), { readonly: true })
const asId = db.prepare(`SELECT id FROM account_sets WHERE import_source='acd' ORDER BY created_at DESC LIMIT 1`).get().id

const rows = db
  .prepare(
    `SELECT a.code, a.name, a.direction,
       COALESCE((SELECT init_balance FROM init_balances WHERE account_set_id=a.account_set_id AND account_id=a.id AND year=2025 AND aux_item_id=''),0) AS open2025,
       COALESCE((SELECT init_balance FROM init_balances WHERE account_set_id=a.account_set_id AND account_id=a.id AND year=2026 AND aux_item_id=''),0) AS open2026,
       COALESCE((SELECT SUM(CASE WHEN ve.direction=a.direction THEN ve.amount ELSE -ve.amount END)
                 FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
                 WHERE ve.account_id=a.id AND v.year=2025 AND v.period=12),0) AS dec_move
     FROM accounts a
     WHERE a.account_set_id=? AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id=a.id)
       AND substr(a.code,1,1) IN ('1','2','3','4')
     ORDER BY a.code`
  )
  .all(asId)

let ok = 0
const bad = []
for (const r of rows) {
  const expected = Math.round((r.open2025 + r.dec_move) * 100) / 100
  const actual = Math.round(r.open2026 * 100) / 100
  if (Math.abs(expected - actual) < 0.005) ok++
  else bad.push({ code: r.code, name: r.name, open2025: r.open2025, dec_move: r.dec_move, expected, open2026: actual })
}
console.log(`leaf balance-sheet accounts checked: ${rows.length}, roll-forward ok: ${ok}, mismatched: ${bad.length}`)
for (const b of bad) console.log(JSON.stringify(b))
