import Database from 'better-sqlite3'

const db = new Database('../data/finance.db')
const setId = db.prepare("SELECT id FROM account_sets WHERE name='老污龟办公室'").get() as any

console.log('=== 老污龟办公室 已记账凭证 ===')
const vouchers = db.prepare(`
  SELECT v.id, v.voucher_no, v.year, v.period, v.status, vt.name as type_name
  FROM vouchers v LEFT JOIN voucher_types vt ON vt.id=v.voucher_type_id
  WHERE v.account_set_id=? AND v.status='posted'
  ORDER BY v.year, v.period
`).all(setId.id) as any[]

for (const v of vouchers) {
  console.log(`\n凭证 ${v.voucher_no} ${v.year}-${v.period} [${v.type_name}]`)
  const entries = db.prepare(`
    SELECT ve.account_code, ve.account_name, ve.direction, ve.amount, ve.summary
    FROM voucher_entries ve WHERE ve.voucher_id=?
    ORDER BY ve.seq
  `).all(v.id) as any[]
  for (const e of entries) {
    console.log(`  ${e.account_code} ${e.account_name} ${e.direction} ${e.amount} ${e.summary || ''}`)
  }
}

console.log('\n=== 收入费用表 样例公式 ===')
const def = db.prepare("SELECT id FROM report_definitions WHERE account_set_id=? AND code='3'").get(setId.id) as any
const sheet = db.prepare('SELECT id FROM report_sheets WHERE report_definition_id=? LIMIT 1').get(def.id) as any
const formulas = db.prepare(`
  SELECT row_index, col_index, formula_text FROM report_cells
  WHERE report_sheet_id=? AND formula_text IS NOT NULL AND formula_text != ''
  ORDER BY row_index, col_index LIMIT 15
`).all(sheet.id) as any[]
for (const f of formulas) {
  console.log(`R${f.row_index+1}C${f.col_index+1}: ${f.formula_text}`)
}

console.log('\n=== 资产负债表[8] 非零公式抽样 ===')
const def8 = db.prepare("SELECT id FROM report_definitions WHERE account_set_id=? AND code='8'").get(setId.id) as any
const sheet8 = db.prepare('SELECT id FROM report_sheets WHERE report_definition_id=? LIMIT 1').get(def8.id) as any
const f8 = db.prepare(`
  SELECT formula_text FROM report_cells
  WHERE report_sheet_id=? AND formula_text LIKE '%@%' LIMIT 10
`).all(sheet8.id) as any[]
console.log(f8.map(x => x.formula_text))
