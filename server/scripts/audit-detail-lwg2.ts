import Database from 'better-sqlite3'
import { executeTemplateSheets } from '../src/services/reportTemplateExecutor.js'

const db = new Database('../data/finance.db')
const setId = (db.prepare("SELECT id FROM account_sets WHERE name='老污龟办公室'").get() as any).id
const year = 2026
const period = 5

// 检查资产负债表 8 非零值来源
const def8 = db.prepare("SELECT id, name FROM report_definitions WHERE account_set_id=? AND code='8'").get(setId) as any
const sheets = db.prepare('SELECT * FROM report_sheets WHERE report_definition_id=?').all(def8.id) as any[]
const cellsBySheet = new Map<string, any[]>()
for (const s of sheets) {
  cellsBySheet.set(s.id, db.prepare('SELECT * FROM report_cells WHERE report_sheet_id=?').all(s.id))
}
const result = executeTemplateSheets(
  sheets.map(s => ({ ...s, cells: cellsBySheet.get(s.id) || [] })),
  { db, accountSetId: setId, year, period }
)
const nonZero = result.flatMap(s => s.cells).filter(c => c.numeric_value != null && Math.abs(c.numeric_value) > 0.001)
console.log(`【老污龟办公室】资产负债表 非零单元格 ${nonZero.length} 个:`)
for (const c of nonZero.slice(0, 20)) {
  console.log(`  ${c.address}: ${c.numeric_value} | ${c.formula_text || c.text_value}`)
}

// 检查 290101/100202 是否在报表公式中
console.log('\n已记账科目 290101/100202 是否出现在各报表公式:')
const defs = db.prepare('SELECT id, code, name FROM report_definitions WHERE account_set_id=? ORDER BY code').all(setId) as any[]
for (const d of defs) {
  const sh = db.prepare('SELECT id FROM report_sheets WHERE report_definition_id=?').all(d.id) as any[]
  const formulas = sh.flatMap(s =>
    (db.prepare('SELECT formula_text FROM report_cells WHERE report_sheet_id=?').all(s.id) as any[])
      .map(c => c.formula_text).filter(Boolean)
  ).join(' ')
  const has290 = formulas.includes('290101') || formulas.includes('2901')
  const has100202 = formulas.includes('100202') || formulas.includes('1002')
  console.log(`  [${d.code}] ${d.name}: 2901=${has290} 1002=${has100202}`)
}

// 501 等三位码在 ACD 中是什么
console.log('\n账套中是否存在 501/516/517 等科目:')
for (const code of ['501', '516', '517', '4001', '4101', '6001', '8101']) {
  const acc = db.prepare('SELECT code, name FROM accounts WHERE account_set_id=? AND code=?').get(setId, code)
  console.log(`  ${code}: ${acc ? (acc as any).name : '不存在'}`)
}
