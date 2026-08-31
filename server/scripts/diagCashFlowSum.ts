import Database from 'better-sqlite3'
import { resolve } from 'path'
import { getBatchBalances } from '../src/services/reportBalance.js'
import { expandFlowAccountCodes } from '../src/services/staticCashFlowExpand.js'
import { getCashFlowConfig, detectStaticReportStandard } from '../src/services/staticReportConfig.js'

const db = new Database(resolve(process.cwd(), '../data/finance.db'), { readonly: true })
const sid = 'ffcb6201-d156-4c2b-8527-13ebcf2dcd1a'
const std = detectStaticReportStandard(db, sid)
const codes = expandFlowAccountCodes(db, sid, getCashFlowConfig(std).cashCodes)

let gbEnd = 0
let abEndField = 0
console.log('code | getBatch(5) | ab.end(5) | ab借-贷')
for (const code of codes) {
  const gb = getBatchBalances(db, sid, [code], 2026, 5).get(code) || 0
  const ab = db
    .prepare(
      `SELECT end_balance, init_balance, current_debit, current_credit
       FROM account_balances WHERE account_set_id=? AND account_code=? AND year=2026 AND period=5`
    )
    .get(sid, code) as any
  console.log(code, gb.toFixed(2), ab?.end_balance ?? '-', ab ? `${ab.current_debit}-${ab.current_credit}` : '-')
  gbEnd += gb
  abEndField += ab?.end_balance ?? gb
}
console.log('配置现金科目 getBatch合计:', gbEnd.toFixed(2))
console.log('配置现金科目 ab.end合计:', abEndField.toFixed(2))

const net = db
  .prepare(
    `SELECT SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END) as n
     FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id JOIN accounts a ON a.id=ve.account_id
     WHERE ve.account_set_id=? AND v.year=2026 AND v.period BETWEEN 1 AND 5
       AND v.status IN ('draft','audited','posted') AND (a.is_cash=1 OR a.is_bank=1)`
  )
  .get(sid) as { n: number }
console.log('含未记账现金分录净额:', net?.n)
console.log('期初210000 + 净额 =', 210000 + (net?.n || 0))

db.close()
