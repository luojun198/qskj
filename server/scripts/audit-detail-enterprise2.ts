import Database from 'better-sqlite3'
import { getBalance } from '../src/services/reportBalance.js'

const db = new Database('../data/finance.db')
const setId = (db.prepare("SELECT id FROM account_sets WHERE name='新企业会计'").get() as any).id
const year = 2026
const period = 5

console.log('=== 期初余额 (init_balances) ===')
const initRows = db.prepare(`
  SELECT a.code, a.name, ib.year, ib.period, ib.init_debit, ib.init_credit, ib.init_balance
  FROM init_balances ib
  JOIN accounts a ON a.id = ib.account_id
  WHERE ib.account_set_id=? AND ib.aux_item_id=''
  ORDER BY a.code
`).all(setId) as any[]
for (const r of initRows) {
  if (r.init_debit || r.init_credit)
    console.log(`  ${r.code} ${r.name}: 借${r.init_debit} 贷${r.init_credit}`)
}
if (!initRows.some(r => r.init_debit || r.init_credit)) console.log('  (无非零期初)')

console.log('\n=== 全部凭证状态 ===')
const allV = db.prepare(`
  SELECT voucher_no, status, year, period FROM vouchers WHERE account_set_id=? ORDER BY voucher_no
`).all(setId) as any[]
for (const v of allV) console.log(`  ${v.voucher_no} ${v.status} ${v.year}-${v.period}`)

console.log('\n=== 关键科目逐科目余额 ===')
for (const code of ['1001','1122','6001001','6602001','4103','4104','4104015','2202','2001']) {
  const bal = getBalance(db, setId, code, year, period)
  const acc = db.prepare('SELECT name, direction, parent_id FROM accounts WHERE account_set_id=? AND code=?').get(setId, code) as any
  console.log(`  ${code} ${acc?.name || '?'}: ${bal} (方向${acc?.direction})`)
}

console.log('\n=== 资产负债表 4104 相关公式 ===')
const def = db.prepare("SELECT id FROM report_definitions WHERE account_set_id=? AND code='4'").get(setId) as any
const sheet = db.prepare('SELECT id FROM report_sheets WHERE report_definition_id=?').get(def.id) as any
const cells = db.prepare(`
  SELECT row_index, col_index, formula_text, text_value FROM report_cells
  WHERE report_sheet_id=? AND (formula_text LIKE '%4104%' OR formula_text LIKE '%4103%' OR text_value LIKE '%未分配%' OR text_value LIKE '%利润%')
  ORDER BY row_index
`).all(sheet.id) as any[]
for (const c of cells) {
  console.log(`  R${c.row_index+1}C${c.col_index+1}: ${c.text_value || ''} | ${c.formula_text || ''}`)
}

console.log('\n=== 执行报表 C47 G47 ===')
import { executeTemplateSheets } from '../src/services/reportTemplateExecutor.js'
const sheets = db.prepare('SELECT * FROM report_sheets WHERE report_definition_id=?').all(def.id) as any[]
const cellsAll = db.prepare('SELECT * FROM report_cells WHERE report_sheet_id=?').all(sheet.id)
const result = executeTemplateSheets([{ ...sheets[0], cells: cellsAll }], { db, accountSetId: setId, year, period })
const interesting = result[0].cells.filter(c => 
  ['C47','G47','C46','G46','C45','G45'].includes(c.address || '') ||
  (c.row_index >= 43 && c.col_index <= 6)
)
for (const c of interesting.sort((a,b) => (a.row_index - b.row_index) || (a.col_index - b.col_index))) {
  if (c.numeric_value != null || c.formula_text)
    console.log(`  ${c.address} R${c.row_index+1}C${c.col_index+1}: ${c.numeric_value} | ${c.text_value || ''} | ${c.formula_text || ''}`)
}
