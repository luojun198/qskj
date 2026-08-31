import Database from 'better-sqlite3'
import { executeTemplateSheets } from '../src/services/reportTemplateExecutor.js'
import { getBalance, getBatchBalances } from '../src/services/reportBalance.js'

const db = new Database('../data/finance.db')
const year = 2026
const period = 5

// report definition id=4 可能是全局 id，先查新企业会计 code=4
const def = db.prepare(`
  SELECT rd.id, rd.code, rd.name, a.name as set_name, rd.account_set_id
  FROM report_definitions rd
  JOIN account_sets a ON a.id = rd.account_set_id
  WHERE rd.code='4' AND a.name LIKE '%新企业%'
`).get() as any

console.log('报表:', def)

const sheet = db.prepare('SELECT * FROM report_sheets WHERE report_definition_id=? ORDER BY sheet_index LIMIT 1').get(def.id) as any
const cells = db.prepare('SELECT * FROM report_cells WHERE report_sheet_id=?').all(sheet.id) as any[]

// 找货币资金行
const cashCells = cells.filter(c => 
  (c.text_value && String(c.text_value).includes('货币资金')) ||
  (c.formula_text && /1001|1002|1012|1015/.test(c.formula_text))
)
console.log('\n货币资金相关单元格:')
for (const c of cells) {
  if (c.text_value && String(c.text_value).trim().includes('货币资金')) {
    const row = c.row_index
    const rowCells = cells.filter(x => x.row_index === row)
    for (const rc of rowCells) {
      console.log(`  R${rc.row_index+1}C${rc.col_index+1} label=${rc.text_value} formula=${rc.formula_text}`)
    }
  }
}

const result = executeTemplateSheets([{ ...sheet, cells }], {
  db, accountSetId: def.account_set_id, year, period
})

const cashRow = result[0].cells.filter(c => {
  const label = cells.find(x => x.row_index === c.row_index && x.col_index === 0)?.text_value
  return label && String(label).includes('货币资金')
})
console.log('\n执行结果 货币资金行:')
for (const c of cashRow.sort((a,b) => a.col_index - b.col_index)) {
  console.log(`  ${c.address}: ${c.numeric_value} | ${c.formula_text || c.text_value}`)
}

console.log('\n1001 余额分解:')
const sid = def.account_set_id
const acc = db.prepare('SELECT id FROM accounts WHERE account_set_id=? AND code=?').get(sid, '1001') as any
const inits = db.prepare('SELECT aux_item_id, init_balance FROM init_balances WHERE account_id=? AND year=?').all(acc.id, year)
console.log('  init_balances rows:', inits)
console.log('  SUM init:', inits.reduce((s: number, r: any) => s + r.init_balance, 0))
console.log('  getBalance(1001):', getBalance(db, sid, '1001', year, period))

const abs = db.prepare('SELECT aux_item_id, current_debit, current_credit, end_balance FROM account_balances WHERE account_id=?').all(acc.id)
console.log('  account_balances:', abs)

// 找货币资金公式单元格
const formulaCell = cells.find(c => c.formula_text && /1001/.test(c.formula_text) && c.row_index === cells.find(x => x.text_value?.includes('货币资金'))?.row_index)
if (formulaCell) {
  console.log('\n货币资金公式:', formulaCell.formula_text)
  // 拆解公式中的科目
  const codes = formulaCell.formula_text.match(/\d{4,}/g) || []
  for (const code of [...new Set(codes)]) {
    console.log(`  ${code}: getBalance=${getBalance(db, sid, code, year, period)}`)
  }
}
