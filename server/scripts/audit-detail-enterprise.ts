import Database from 'better-sqlite3'
import { getBatchBalances } from '../src/services/reportBalance.js'

const db = new Database('../data/finance.db')
const setId = (db.prepare("SELECT id FROM account_sets WHERE name='新企业会计'").get() as any).id
const year = 2026
const period = 5

console.log('=== 新企业会计 全部已记账凭证 ===')
const vouchers = db.prepare(`
  SELECT v.id, v.voucher_no, v.year, v.period, v.status
  FROM vouchers v WHERE v.account_set_id=? AND v.status='posted'
  ORDER BY v.year, v.period, v.voucher_no
`).all(setId) as any[]

let totalDebit = 0
let totalCredit = 0
for (const v of vouchers) {
  console.log(`\n凭证 ${v.voucher_no} ${v.year}-${v.period}`)
  const entries = db.prepare(`
    SELECT ve.account_code, ve.account_name, ve.direction, ve.amount, ve.summary
    FROM voucher_entries ve WHERE ve.voucher_id=? ORDER BY ve.seq
  `).all(v.id) as any[]
  let d = 0, c = 0
  for (const e of entries) {
    console.log(`  ${e.account_code} ${e.account_name} ${e.direction} ${e.amount}`)
    if (e.direction === 'debit') d += e.amount
    else c += e.amount
  }
  console.log(`  借方合计: ${d}, 贷方合计: ${c}, 差额: ${(d-c).toFixed(2)}`)
  totalDebit += d
  totalCredit += c
}
console.log(`\n全部凭证借方: ${totalDebit}, 贷方: ${totalCredit}`)

console.log('\n=== 有余额的叶子科目 (期初+发生) ===')
const accounts = db.prepare(`
  SELECT code, name, direction FROM accounts
  WHERE account_set_id=? ORDER BY code
`).all(setId) as any[]

const codes = accounts.map(a => a.code)
const balances = getBatchBalances(db, setId, codes, year, period)

let debitBal = 0, creditBal = 0
const nonZero: any[] = []
for (const a of accounts) {
  const bal = balances.get(a.code) || 0
  if (Math.abs(bal) > 0.001) {
    nonZero.push({ ...a, bal })
    if (a.direction === 'debit') debitBal += bal
    else creditBal += bal
  }
}
for (const a of nonZero) {
  console.log(`  ${a.code} ${a.name} (${a.direction}): ${a.bal}`)
}
console.log(`\n借方余额合计: ${debitBal.toFixed(2)}`)
console.log(`贷方余额合计: ${creditBal.toFixed(2)}`)
console.log(`差额: ${(debitBal - creditBal).toFixed(2)}`)

console.log('\n=== 资产负债表模版 未覆盖的有余额科目 ===')
const def = db.prepare("SELECT id FROM report_definitions WHERE account_set_id=? AND code='4'").get(setId) as any
const sheet = db.prepare('SELECT id FROM report_sheets WHERE report_definition_id=? LIMIT 1').get(def.id) as any
const formulas = db.prepare(`
  SELECT formula_text FROM report_cells WHERE report_sheet_id=? AND formula_text IS NOT NULL
`).all(sheet.id) as any[]
const formulaText = formulas.map(f => f.formula_text).join(' ')
for (const a of nonZero) {
  if (!formulaText.includes(a.code)) {
    console.log(`  ⚠ 未在公式中出现: ${a.code} ${a.name} = ${a.bal}`)
  }
}

console.log('\n=== 期初余额表 ===')
const initBal = db.prepare(`
  SELECT ib.*, a.code, a.name FROM init_balances ib
  JOIN accounts a ON a.id = ib.account_id
  WHERE ib.account_set_id=?
`).all(setId) as any[]
for (const ib of initBal) {
  console.log(`  ${ib.code} ${ib.name}: 借 ${ib.debit_amount || 0} 贷 ${ib.credit_amount || 0}`)
}
