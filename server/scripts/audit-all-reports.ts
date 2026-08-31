import Database from 'better-sqlite3'
import { executeTemplateSheets } from '../src/services/reportTemplateExecutor.js'
import { getBatchBalances } from '../src/services/reportBalance.js'

const db = new Database('../data/finance.db')
const year = 2026
const period = 5

type Issue = {
  level: 'error' | 'warn' | 'info'
  accountSet: string
  reportCode: string
  reportName: string
  message: string
  detail?: string
}

const issues: Issue[] = []

function addIssue(issue: Omit<Issue, 'level'> & { level?: Issue['level'] }) {
  issues.push({ level: issue.level || 'warn', ...issue })
}

const accountSets = db
  .prepare('SELECT id, name FROM account_sets ORDER BY name')
  .all() as Array<{ id: string; name: string }>

console.log(`\n========== 动态报表全账套审计 ==========`)
console.log(`审计期间: ${year}年${period}月`)
console.log(`账套数量: ${accountSets.length}\n`)

let totalReports = 0
let totalErrors = 0
let totalNonZero = 0
let totalZeroData = 0

for (const set of accountSets) {
  const voucherCount = (
    db.prepare('SELECT COUNT(*) as c FROM vouchers WHERE account_set_id=?').get(set.id) as any
  ).c
  const postedCount = (
    db
      .prepare("SELECT COUNT(*) as c FROM vouchers WHERE account_set_id=? AND status='posted'")
      .get(set.id) as any
  ).c

  const definitions = db
    .prepare(
      `SELECT id, code, name, source, is_enabled
       FROM report_definitions
       WHERE account_set_id=?
       ORDER BY CAST(code AS INTEGER), code`
    )
    .all(set.id) as Array<{
    id: string
    code: string
    name: string
    source: string
    is_enabled: number
  }>

  console.log(`\n【${set.name}】凭证 ${voucherCount} 张（已记账 ${postedCount}）| 报表 ${definitions.length} 张`)
  console.log('-'.repeat(72))

  if (definitions.length === 0) {
    addIssue({
      accountSet: set.name,
      reportCode: '-',
      reportName: '-',
      level: 'warn',
      message: '未配置任何动态报表',
    })
    console.log('  ⚠ 未配置报表')
    continue
  }

  for (const def of definitions) {
    totalReports++
    const sheets = db
      .prepare('SELECT * FROM report_sheets WHERE report_definition_id=? ORDER BY sheet_index')
      .all(def.id) as any[]

    if (sheets.length === 0) {
      addIssue({
        accountSet: set.name,
        reportCode: def.code,
        reportName: def.name,
        level: 'error',
        message: '报表无工作表',
      })
      console.log(`  [${def.code}] ${def.name} — ✗ 无工作表`)
      continue
    }

    const cellsBySheet = new Map<string, any[]>()
    let formulaCount = 0
    for (const sheet of sheets) {
      const cells = db
        .prepare('SELECT * FROM report_cells WHERE report_sheet_id=?')
        .all(sheet.id) as any[]
      cellsBySheet.set(sheet.id, cells)
      formulaCount += cells.filter(c => c.formula_text && String(c.formula_text).trim()).length
    }

    let result
    try {
      result = executeTemplateSheets(
        sheets.map(s => ({ ...s, cells: cellsBySheet.get(s.id) || [] })),
        { db, accountSetId: set.id, year, period }
      )
    } catch (err: any) {
      totalErrors++
      addIssue({
        accountSet: set.name,
        reportCode: def.code,
        reportName: def.name,
        level: 'error',
        message: '执行异常',
        detail: err?.message || String(err),
      })
      console.log(`  [${def.code}] ${def.name} — ✗ 执行异常: ${err?.message}`)
      continue
    }

    const allCells = result.flatMap(s => s.cells)
    const errors = allCells.filter(c => c.status === 'error')
    const nonZero = allCells.filter(
      c => c.numeric_value != null && Math.abs(c.numeric_value) > 0.001
    )
    const unsupported = errors.filter(c =>
      /不支持|缺少|无法|非法/.test(String(c.error || ''))
    )

    if (errors.length > 0) {
      totalErrors++
      const samples = errors
        .slice(0, 3)
        .map(c => `${c.address}:${c.formula_text || c.text_value} → ${c.error}`)
        .join(' | ')
      addIssue({
        accountSet: set.name,
        reportCode: def.code,
        reportName: def.name,
        level: 'error',
        message: `${errors.length} 个公式错误 / 共 ${formulaCount} 个公式`,
        detail: samples,
      })
      console.log(
        `  [${def.code}] ${def.name} — ✗ ${errors.length} 个错误 (sheet ${sheets.length}, 公式 ${formulaCount})`
      )
      if (unsupported.length) {
        console.log(`       不支持函数: ${unsupported.length} 个`)
      }
      console.log(`       样例: ${samples}`)
    } else if (nonZero.length === 0 && formulaCount > 0) {
      totalZeroData++
      if (postedCount > 0) {
        addIssue({
          accountSet: set.name,
          reportCode: def.code,
          reportName: def.name,
          level: 'warn',
          message: `有 ${postedCount} 张已记账凭证但报表全为 0（${formulaCount} 个公式）`,
        })
        console.log(
          `  [${def.code}] ${def.name} — ⚠ 全零（账套有已记账凭证, 公式 ${formulaCount}）`
        )
      } else {
        addIssue({
          accountSet: set.name,
          reportCode: def.code,
          reportName: def.name,
          level: 'info',
          message: `无凭证数据，报表全零（正常）`,
        })
        console.log(`  [${def.code}] ${def.name} — ○ 全零（无凭证，正常）`)
      }
    } else {
      totalNonZero++
      console.log(
        `  [${def.code}] ${def.name} — ✓ OK（${nonZero.length} 个非零值, sheet ${sheets.length}, 公式 ${formulaCount}）`
      )
    }

    // 资产负债表类：检查资产合计 vs 负债+权益合计
    if (/资产负债/.test(def.name)) {
      const findCell = (pred: (c: any) => boolean) => allCells.find(pred)
      const assetTotal = findCell(
        c =>
          c.formula_text?.includes('SUM(C') &&
          (c.address?.match(/^C\d+$/) || c.col_index === 2)
      )
      const liabEquityTotal = findCell(
        c =>
          (c.formula_text?.includes('SUM(G') || c.formula_text?.includes('G46+G34')) &&
          (c.address?.match(/^G\d+$/) || c.col_index === 6)
      )
      // 也尝试找 C47/G47 合计行
      const c47 = allCells.find(c => c.address === 'C47' || (c.row_index === 46 && c.col_index === 2))
      const g47 = allCells.find(c => c.address === 'G47' || (c.row_index === 46 && c.col_index === 6))

      const assetVal = c47?.numeric_value ?? assetTotal?.numeric_value
      const leVal = g47?.numeric_value ?? liabEquityTotal?.numeric_value

      if (
        assetVal != null &&
        leVal != null &&
        Math.abs(assetVal - leVal) > 0.02 &&
        Math.abs(assetVal) + Math.abs(leVal) > 0.02
      ) {
        addIssue({
          accountSet: set.name,
          reportCode: def.code,
          reportName: def.name,
          level: 'warn',
          message: `资产负债不平衡：资产合计 ${assetVal} ≠ 负债+权益 ${leVal}（差额 ${(assetVal - leVal).toFixed(2)}）`,
        })
        console.log(
          `       ⚠ 不平衡: 资产 ${assetVal} vs 负债+权益 ${leVal} (差 ${(assetVal - leVal).toFixed(2)})`
        )
      }
    }

    // 检查是否含旧版 3 位预算编码 JQY(501 等) 且无对应科目
    const shortCodeFormulas = allCells.filter(c => {
      const f = String(c.formula_text || '')
      return /@JQY\(\d{3},/i.test(f)
    })
    if (shortCodeFormulas.length > 0) {
      const codes = [
        ...new Set(
          shortCodeFormulas
            .map(c => c.formula_text?.match(/@JQY\((\d{3}),/i)?.[1])
            .filter(Boolean)
        ),
      ]
      const missingAccounts = codes.filter(code => {
        const acc = db
          .prepare('SELECT id FROM accounts WHERE account_set_id=? AND code=?')
          .get(set.id, code)
        return !acc
      })
      if (missingAccounts.length > 0 && postedCount > 0) {
        addIssue({
          accountSet: set.name,
          reportCode: def.code,
          reportName: def.name,
          level: 'warn',
          message: `含 3 位编码 @JQY(${missingAccounts.join('/')},...) 但账套无对应科目，该列可能恒为 0`,
        })
      }
    }
  }

  // 账套级：有凭证但所有报表全零
  const setHasData = postedCount > 0
  if (setHasData && definitions.length > 0) {
    let anyNonZero = false
    for (const def of definitions) {
      const sheets = db
        .prepare('SELECT id FROM report_sheets WHERE report_definition_id=?')
        .all(def.id) as any[]
      const cells = sheets.flatMap(s =>
        db.prepare('SELECT formula_text FROM report_cells WHERE report_sheet_id=?').all(s.id)
      )
      if (cells.some((c: any) => c.formula_text)) {
        // already counted above
      }
    }
  }
}

// 交叉验证：新企业会计关键科目余额
const enterpriseSet = accountSets.find(s => s.name === '新企业会计')
if (enterpriseSet) {
  const codes = ['1001', '1122', '4103', '4104']
  const balances = getBatchBalances(db, enterpriseSet.id, codes, year, period)
  let debitSum = 0
  let creditSum = 0
  for (const code of codes) {
    const acc = db
      .prepare('SELECT direction FROM accounts WHERE account_set_id=? AND code=?')
      .get(enterpriseSet.id, code) as any
    const bal = balances.get(code) || 0
    if (acc?.direction === 'debit') debitSum += bal
    else creditSum += bal
  }
  console.log(`\n【新企业会计】关键科目余额校验:`)
  for (const code of codes) {
    console.log(`  ${code}: ${balances.get(code) || 0}`)
  }
  console.log(`  借方科目合计: ${debitSum}, 贷方科目合计: ${creditSum}, 差额: ${(debitSum - creditSum).toFixed(2)}`)
  if (Math.abs(debitSum - creditSum) > 0.02) {
    addIssue({
      accountSet: '新企业会计',
      reportCode: '-',
      reportName: '-',
      level: 'warn',
      message: `账套本身借贷不平衡（差额 ${(debitSum - creditSum).toFixed(2)}），报表合计可能无法配平`,
    })
  }
}

console.log(`\n========== 审计汇总 ==========`)
console.log(`报表总数: ${totalReports}`)
console.log(`✓ 有数据且无误: ${totalNonZero}`)
console.log(`○ 全零（可能正常）: ${totalZeroData}`)
console.log(`✗ 有公式错误: ${totalErrors}`)

const errors = issues.filter(i => i.level === 'error')
const warns = issues.filter(i => i.level === 'warn')
const infos = issues.filter(i => i.level === 'info')

console.log(`\n问题统计: ${errors.length} 错误, ${warns.length} 警告, ${infos.length} 提示`)

if (errors.length) {
  console.log(`\n--- 错误 (${errors.length}) ---`)
  for (const i of errors) {
    console.log(`[${i.accountSet}] 报表${i.reportCode} ${i.reportName}: ${i.message}`)
    if (i.detail) console.log(`  ${i.detail}`)
  }
}

if (warns.length) {
  console.log(`\n--- 警告 (${warns.length}) ---`)
  for (const i of warns) {
    console.log(`[${i.accountSet}] 报表${i.reportCode} ${i.reportName}: ${i.message}`)
    if (i.detail) console.log(`  ${i.detail}`)
  }
}

process.exit(errors.length > 0 ? 1 : 0)
