/**
 * 端到端检查：空库 + 生产同款初始化 → ACD 导入 → 输出建账日期 / 期初 / 结账期间等诊断。
 * 用法（在 server 目录下）：
 *   node --import tsx/esm ../scratch/acdImportCheck.mjs <acd路径> [db目录]
 */
import { readFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import Database from 'better-sqlite3'

const root = resolve(import.meta.dirname, '..')
const dbDir = resolve(process.argv[3] || join(root, 'scratch/acd-test-db'))
const dbPath = join(dbDir, 'finance.db')
const acdPath = resolve(process.argv[2])

mkdirSync(dbDir, { recursive: true })
for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  if (existsSync(p)) rmSync(p)
}

process.env.DB_PATH = dbPath
process.env.DB_DIR = dbDir
process.env.SCHEMA_DIR = join(root, 'server/src/db')
process.env.SEED_DEFAULT_ACCOUNT_SET = 'false'

const { initDatabase, getDb } = await import('../server/src/db/index.ts')
const { upgradeDatabaseCompatibility } = await import('../server/src/db/databaseCompatibility.ts')
const { acdImportService } = await import('../server/src/services/acdImport.ts')

initDatabase()
upgradeDatabaseCompatibility()

const acdBuffer = readFileSync(acdPath)
const fiscalYear = new Date().getFullYear()
const result = await acdImportService({
  acdBuffer,
  name: '导入检查',
  code: `AS${Date.now()}`,
  fiscalYear,
  startDate: `${fiscalYear}-01-01`,
})
const asId = result.accountSetId
const db = getDb()

const out = []
const log = (...a) => out.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))

log('=== account_sets ===')
log(db.prepare('SELECT name, code, fiscal_year, start_date, import_source FROM account_sets WHERE id=?').get(asId))
log('=== system_params (start_date / current period) ===')
log(
  db
    .prepare(
      `SELECT param_key, param_value FROM system_params WHERE account_set_id=? AND param_key IN ('start_date','current_year','current_period','account_levels','account_code_lengths','unit_name')`
    )
    .all(asId)
)
log('=== period_closing ===')
log(db.prepare('SELECT year, period, status FROM period_closing WHERE account_set_id=? ORDER BY year, period').all(asId))

log('=== init_balances by year ===')
log(
  db
    .prepare(
      `SELECT year, period, COUNT(*) n, SUM(init_debit) d, SUM(init_credit) c, SUM(opening_debit) od, SUM(opening_credit) oc, SUM(pre_book_debit) pd, SUM(pre_book_credit) pc,
       SUM(CASE WHEN aux_item_id='' THEN 1 ELSE 0 END) direct_rows, SUM(CASE WHEN aux_item_id<>'' THEN 1 ELSE 0 END) aux_rows
       FROM init_balances WHERE account_set_id=? GROUP BY year, period`
    )
    .all(asId)
)
log('=== sample accounts (1601/1602/2241/4104/2221/1122) ===')
log(
  db
    .prepare(
      `SELECT a.code, a.name, a.direction, a.is_aux, a.aux_types, ib.year, ib.init_balance, ib.init_debit, ib.init_credit, ib.opening_debit, ib.opening_credit, ib.pre_book_debit, ib.pre_book_credit, ib.aux_item_id
       FROM accounts a LEFT JOIN init_balances ib ON ib.account_id=a.id
       WHERE a.account_set_id=? AND a.code IN ('1601','1602','2241','4104','2221','1122','2202','1001','1002') ORDER BY a.code, ib.year, ib.aux_item_id`
    )
    .all(asId)
)
log('=== init balance trial (direct rows, leaf only) per year ===')
log(
  db
    .prepare(
      `SELECT ib.year, SUM(ib.init_debit) d, SUM(ib.init_credit) c
       FROM init_balances ib JOIN accounts a ON a.id=ib.account_id
       WHERE ib.account_set_id=? AND ib.aux_item_id='' AND NOT EXISTS (SELECT 1 FROM accounts ch WHERE ch.parent_id=a.id)
       GROUP BY ib.year`
    )
    .all(asId)
)
log('=== aux categories / items ===')
log(
  db
    .prepare(
      `SELECT c.code, COUNT(i.id) items FROM aux_categories c LEFT JOIN aux_items i ON i.type=c.id WHERE c.account_set_id=? GROUP BY c.code`
    )
    .all(asId)
)
log('=== aux accounts aux_types ===')
log(db.prepare(`SELECT code, name, aux_types FROM accounts WHERE account_set_id=? AND is_aux=1 ORDER BY code LIMIT 8`).all(asId))
log('=== aux init detail sample (1122, 2025) ===')
log(
  db
    .prepare(
      `SELECT ib.aux_item_id, ai.code item_code, ai.name item_name, ib.opening_debit, ib.opening_credit, ib.pre_book_debit, ib.pre_book_credit, ib.init_balance
       FROM init_balances ib JOIN accounts a ON a.id=ib.account_id
       LEFT JOIN aux_items ai ON ib.aux_item_id = 'customer:' || ai.id
       WHERE ib.account_set_id=? AND a.code='1122' AND ib.year=2025 AND ib.aux_item_id<>'' ORDER BY ai.code LIMIT 6`
    )
    .all(asId)
)
log('=== aux detail sum vs summary (per aux account, 2025) ===')
log(
  db
    .prepare(
      `SELECT a.code, s.init_balance summary, ROUND(SUM(d.init_balance),2) detail, COUNT(d.id) n
       FROM init_balances s JOIN accounts a ON a.id=s.account_id
       LEFT JOIN init_balances d ON d.account_id=s.account_id AND d.year=s.year AND d.aux_item_id<>''
       WHERE s.account_set_id=? AND s.aux_item_id='' AND s.year=2025 AND a.is_aux=1 GROUP BY s.id ORDER BY a.code`
    )
    .all(asId)
)
log('=== voucher entries with aux ===')
log(
  db
    .prepare(
      `SELECT COUNT(*) total, SUM(CASE WHEN aux_data IS NOT NULL THEN 1 ELSE 0 END) with_aux, SUM(CASE WHEN supplier_id IS NOT NULL THEN 1 ELSE 0 END) with_supplier, SUM(CASE WHEN dept_id IS NOT NULL THEN 1 ELSE 0 END) with_dept FROM voucher_entries WHERE account_set_id=?`
    )
    .get(asId)
)
log('=== voucher no / date / attachments sample (first 6 by type,no) ===')
log(
  db
    .prepare(
      `SELECT v.voucher_no, vt.name type_name, v.voucher_date, v.status, v.attachments, v.posted_at, v.maker_name, v.auditor_name, v.poster_name
       FROM vouchers v LEFT JOIN voucher_types vt ON vt.id=v.voucher_type_id WHERE v.account_set_id=? ORDER BY vt.code, v.voucher_no LIMIT 6`
    )
    .all(asId)
)
log('=== voucher_date distribution ===')
log(db.prepare(`SELECT voucher_date, COUNT(*) n FROM vouchers WHERE account_set_id=? GROUP BY voucher_date ORDER BY voucher_date`).all(asId))
log('=== entry seq sanity: vouchers whose seq is not 1..n ===')
log(
  db
    .prepare(
      `SELECT COUNT(*) bad FROM (SELECT voucher_id, COUNT(*) n, MIN(seq) mn, MAX(seq) mx FROM voucher_entries WHERE account_set_id=? GROUP BY voucher_id HAVING mn<>1 OR mx<>n)`
    )
    .get(asId)
)
log('=== voucher templates ===')
log(db.prepare(`SELECT COUNT(*) n FROM voucher_templates WHERE account_set_id=?`).get(asId))
log(db.prepare(`SELECT template_no, template_name, total_amount, json_array_length(entries_data) lines FROM voucher_templates WHERE account_set_id=? ORDER BY template_no LIMIT 4`).all(asId))
log('=== system params (business) ===')
log(db.prepare(`SELECT param_key, param_value FROM system_params WHERE account_set_id=? AND param_key IN ('enable_cash_flow','require_audit','direct_print','unit_name') ORDER BY param_key`).all(asId))
log(db.prepare(`SELECT credit_code FROM account_sets WHERE id=?`).get(asId))
log(db.prepare(`SELECT COUNT(*) print_templates FROM print_templates WHERE account_set_id=?`).get(asId))
log('=== account_balances summary ===')
log(db.prepare(`SELECT year, period, COUNT(*) n, ROUND(SUM(current_debit),2) d, ROUND(SUM(current_credit),2) c FROM account_balances WHERE account_set_id=? GROUP BY year, period ORDER BY year, period`).all(asId))
log('=== vouchers by year/period ===')
log(
  db
    .prepare(`SELECT year, period, COUNT(*) n FROM vouchers WHERE account_set_id=? GROUP BY year, period ORDER BY year, period`)
    .all(asId)
)
log('=== stats ===')
log({ initBalances: result.stats.initBalances, periodClosing: result.stats.periodClosing, accounts: result.stats.accounts, vouchers: result.stats.vouchers, aux: result.stats.auxiliaryData })
log('=== warnings ===')
for (const w of result.stats.warnings) log(' -', w)

const text = out.join('\n')
console.log(text)
