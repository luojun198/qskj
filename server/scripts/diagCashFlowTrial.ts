import Database from 'better-sqlite3'
import { resolve } from 'path'
import { getCashFlowTrialBalance } from '../src/services/cashFlowTrialBalance.js'
import { getCashFlowVoucherCheck } from '../src/services/cashFlowVoucherCheck.js'
import { getBatchBalances } from '../src/services/reportBalance.js'
import { expandFlowAccountCodes } from '../src/services/staticCashFlowExpand.js'
import { getCashFlowConfig, detectStaticReportStandard } from '../src/services/staticReportConfig.js'

const DB_PATH = process.env.DB_PATH || resolve(process.cwd(), '../data/finance.db')
const db = new Database(DB_PATH, { readonly: true })

const sets = db.prepare('SELECT id, name FROM account_sets').all() as Array<{ id: string; name: string }>
console.log('数据库:', DB_PATH)
console.log('账套:', sets)

for (const set of sets) {
  const accountSetId = set.id
  const enable = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='enable_cash_flow'`
    )
    .get(accountSetId) as { param_value?: string } | undefined
  if (enable?.param_value !== 'true') {
    console.log(`\n[${set.name}] 未启用现金流核算，跳过`)
    continue
  }

  const year = 2026
  const period = 5
  const scope = 'ytd' as const

  console.log(`\n${'='.repeat(60)}`)
  console.log(`账套: ${set.name} (${accountSetId})`)
  console.log(`期间: ${year}年 1-${period}月 本年累计`)

  const result = getCashFlowTrialBalance(db, accountSetId, year, period, scope, false)
  const s = result.summary
  console.log('\n--- 试算摘要 ---')
  console.log(`  现金流量净额:     ${s.totalNet.toFixed(2)}`)
  console.log(`  现金科目净变动:   ${s.cashAccountNetChange.toFixed(2)}`)
  console.log(`  差额(流量-分录):  ${s.diff.toFixed(2)}`)
  console.log(`  期初现金(余额表): ${s.beginCash.toFixed(2)}`)
  console.log(`  期末现金(余额表): ${s.endCash.toFixed(2)}`)
  console.log(`  期初+流量=        ${(s.beginCash + s.totalNet).toFixed(2)}`)
  console.log(`  校验3差额:        ${(s.endCash - s.beginCash - s.totalNet).toFixed(2)}`)
  console.log(`  余额表实际变动:   ${(s.endCash - s.beginCash).toFixed(2)}`)

  for (const check of result.balanceChecks) {
    const mark = check.passed ? '✓' : '✗'
    console.log(`  [${mark}] ${check.label}`)
  }

  const std = detectStaticReportStandard(db, accountSetId)
  const config = getCashFlowConfig(std)
  const cashCodes = expandFlowAccountCodes(db, accountSetId, config.cashCodes)
  console.log(`\n--- 现金科目明细 (${config.standardName}) ---`)
  console.log(`  配置前缀: ${config.cashCodes.join(', ')} → 展开 ${cashCodes.length} 个`)

  let beginFromBalance = 0
  let endFromBalance = 0
  for (const code of cashCodes) {
    const b = getBatchBalances(db, accountSetId, [code], year, 0).get(code) || 0
    const e = getBatchBalances(db, accountSetId, [code], year, period).get(code) || 0
    if (Math.abs(b) > 0.01 || Math.abs(e) > 0.01 || Math.abs(e - b) > 0.01) {
      console.log(`  ${code}: 期初 ${b.toFixed(2)} → 期末 ${e.toFixed(2)} (变动 ${(e - b).toFixed(2)})`)
    }
    beginFromBalance += b
    endFromBalance += e
  }

  const isCashBankAccounts = db
    .prepare(
      `SELECT code, name, is_cash, is_bank FROM accounts
       WHERE account_set_id=? AND is_enabled=1 AND (is_cash=1 OR is_bank=1)
       ORDER BY code`
    )
    .all(accountSetId) as Array<{ code: string; name: string; is_cash: number; is_bank: number }>
  console.log('\n--- is_cash/is_bank 科目 ---')
  for (const a of isCashBankAccounts) {
    console.log(`  ${a.code} ${a.name} cash=${a.is_cash} bank=${a.is_bank}`)
  }

  const inConfigNotFlagged = db
    .prepare(
      `SELECT code, name, is_cash, is_bank FROM accounts
       WHERE account_set_id=? AND is_enabled=1
         AND (code LIKE '1001%' OR code LIKE '1002%' OR code LIKE '1012%')
         AND is_cash=0 AND is_bank=0
       ORDER BY code`
    )
    .all(accountSetId) as Array<{ code: string; name: string }>
  if (inConfigNotFlagged.length) {
    console.log('\n--- ⚠ 1001/1002/1012 下未标 is_cash/bank 的科目 ---')
    for (const a of inConfigNotFlagged) {
      const b = getBatchBalances(db, accountSetId, [a.code], year, 0).get(a.code) || 0
      const e = getBatchBalances(db, accountSetId, [a.code], year, period).get(a.code) || 0
      console.log(`  ${a.code} ${a.name}: 期初 ${b.toFixed(2)} 期末 ${e.toFixed(2)} 变动 ${(e - b).toFixed(2)}`)
    }
  }

  const flaggedNotInConfig = isCashBankAccounts.filter(
    a => !cashCodes.some(c => a.code === c || a.code.startsWith(c))
  )
  if (flaggedNotInConfig.length) {
    console.log('\n--- ⚠ is_cash/bank 但不在配置现金科目范围 ---')
    for (const a of flaggedNotInConfig) {
      const net = db
        .prepare(
          `SELECT SUM(CASE WHEN ve.direction='debit' THEN ve.amount ELSE -ve.amount END) as net
           FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
           JOIN accounts a ON a.id=ve.account_id
           WHERE ve.account_set_id=? AND v.year=? AND v.period BETWEEN 1 AND 5
             AND v.status='posted' AND a.code=?`
        )
        .get(accountSetId, year, a.code) as { net: number } | undefined
      console.log(`  ${a.code} ${a.name}: 1-5月分录净额 ${(net?.net || 0).toFixed(2)}`)
    }
  }

  console.log('\n--- 现金流量项目明细 ---')
  for (const item of result.items) {
    console.log(
      `  ${item.code} ${item.name}: 借 ${item.debitTotal.toFixed(2)} 贷 ${item.creditTotal.toFixed(2)} 净 ${item.signedNet.toFixed(2)}`
    )
  }

  const initRows = db
    .prepare(
      `SELECT a.code, a.name, ib.opening_debit, ib.opening_credit, ib.init_balance, ib.init_debit, ib.init_credit
       FROM init_balances ib JOIN accounts a ON a.id = ib.account_id
       WHERE ib.account_set_id=? AND ib.year=? AND ib.period=1 AND ib.aux_item_id=''
         AND (a.code LIKE '1001%' OR a.code LIKE '1002%' OR a.code LIKE '1012%')
       ORDER BY a.code`
    )
    .all(accountSetId, year) as any[]
  if (initRows.length) {
    console.log('\n--- 现金类期初余额(init_balances) ---')
    for (const r of initRows) {
      console.log(
        `  ${r.code} ${r.name}: 期初借 ${r.opening_debit} 期初贷 ${r.opening_credit} init_balance ${r.init_balance}`
      )
    }
  }

  const periodSums = db
    .prepare(
      `SELECT ab.account_code, ab.period,
              ab.init_balance, ab.current_debit, ab.current_credit, ab.end_balance
       FROM account_balances ab
       WHERE ab.account_set_id=? AND ab.year=?
         AND (ab.account_code LIKE '1001%' OR ab.account_code LIKE '1002%' OR ab.account_code LIKE '1012%')
         AND ab.period IN (0,1,2,3,4,5)
       ORDER BY ab.account_code, ab.period`
    )
    .all(accountSetId, year) as any[]

  console.log('\n--- account_balances 逐月(有数据的) ---')
  let lastCode = ''
  for (const r of periodSums) {
    if (Math.abs(r.end_balance) < 0.01 && Math.abs(r.current_debit) < 0.01 && Math.abs(r.current_credit) < 0.01)
      continue
    if (r.account_code !== lastCode) {
      console.log(`  [${r.account_code}]`)
      lastCode = r.account_code
    }
    console.log(
      `    ${r.period}月: 期初${r.init_balance?.toFixed(2)} 借${r.current_debit?.toFixed(2)} 贷${r.current_credit?.toFixed(2)} 期末${r.end_balance?.toFixed(2)}`
    )
  }

  const vouchersNoCf = db
    .prepare(
      `SELECT v.voucher_no, v.voucher_date, ve.account_code, a.name, ve.direction, ve.amount, ve.cash_flow_code
       FROM voucher_entries ve
       JOIN vouchers v ON v.id=ve.voucher_id
       JOIN accounts a ON a.id=ve.account_id
       WHERE ve.account_set_id=? AND v.year=? AND v.period BETWEEN 1 AND 5
         AND v.status='posted' AND (a.is_cash=1 OR a.is_bank=1)
         AND (ve.cash_flow_code IS NULL OR TRIM(ve.cash_flow_code)='')
       ORDER BY v.voucher_date`
    )
    .all(accountSetId, year) as any[]
  console.log(`\n--- 未指定现金流量项目的现金分录: ${vouchersNoCf.length} 笔 ---`)
  for (const r of vouchersNoCf) console.log(`  ${r.voucher_date} ${r.voucher_no} ${r.account_code} ${r.direction} ${r.amount}`)

  const check = getCashFlowVoucherCheck(db, accountSetId, year, period, scope, false)
  console.log('\n--- 凭证检查 ---', check.summary)

  const gap = s.endCash - s.beginCash - s.totalNet
  console.log('\n--- 根因分析 ---')
  if (Math.abs(s.diff) < 0.01 && Math.abs(gap) > 0.01) {
    console.log(`  分录层已配平(流量=${s.totalNet.toFixed(2)}=现金分录${s.cashAccountNetChange.toFixed(2)})`)
    console.log(`  但余额表层: 期末-期初=${(s.endCash - s.beginCash).toFixed(2)} ≠ 流量净额 ${s.totalNet.toFixed(2)}`)
    console.log(`  差额 ${gap.toFixed(2)} 可能来自:`)
    console.log('    1) 期初余额录入与后续凭证累计不一致')
    console.log('    2) 现金科目范围不一致(余额表1001/1002 vs is_cash/is_bank)')
    console.log('    3) account_balances 未与凭证同步重算')
    if (inConfigNotFlagged.length) console.log('    4) 有现金类科目余额计入期初/期末但未参与分录统计')
  }
}

db.close()
