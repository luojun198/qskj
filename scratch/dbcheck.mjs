import Database from 'better-sqlite3'
const path = process.argv[2]
const db = new Database(path, { readonly: true })
const out = []
const log = (...a) => out.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
function q(label, sql, ...args) { try { log('### ' + label); for (const r of db.prepare(sql).all(...args)) log('  ', r) } catch (e) { log('### ' + label + ' ERR ' + e.message) } }
q('account_sets', 'SELECT id,name,code FROM account_sets')
q('cashier_journal by set', 'SELECT account_set_id, COUNT(*) n, SUM(acd_raw IS NOT NULL) acd_rows, SUM(reconciled) recon, SUM(voucher_no IS NOT NULL) with_voucher FROM cashier_journal GROUP BY account_set_id')
q('cashier_init_balance by set', 'SELECT account_set_id, COUNT(*) n FROM cashier_init_balance GROUP BY account_set_id')
q('bank_statement by set', 'SELECT account_set_id, COUNT(*) n, SUM(matched) matched, SUM(acd_raw IS NOT NULL) acd_rows FROM bank_statement GROUP BY account_set_id')
q('settle_type by set', 'SELECT account_set_id, COUNT(*) n FROM settle_type GROUP BY account_set_id')
q('cash-bank accounts by set', 'SELECT account_set_id, SUM(is_cash) cash, SUM(is_bank) bank, COUNT(*) total FROM accounts GROUP BY account_set_id')
q('sample gzm acd rows', "SELECT account_code,biz_date,summary,debit,credit,reconciled,json_extract(acd_raw,'$[12]') gzm_raw FROM cashier_journal WHERE acd_raw IS NOT NULL LIMIT 10")
q('sample bank acd rows', "SELECT account_code,biz_date,debit,credit,matched,json_extract(acd_raw,'$[7]') dzbz_raw FROM bank_statement WHERE acd_raw IS NOT NULL LIMIT 10")
console.log(out.join('\n'))
