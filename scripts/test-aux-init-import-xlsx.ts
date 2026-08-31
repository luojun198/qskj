/**
 * 测试辅助期初 10W Excel 解析（与 InitBalanceAux.vue 相同流程）
 * 用法: npx tsx scripts/test-aux-init-import-xlsx.ts [xlsx路径] [account_id]
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import Database from 'better-sqlite3'
import * as XLSX from 'xlsx'

const DEFAULT_FILE = 'C:\\Users\\Administrator\\Desktop\\1\\辅助期初模板 10W测试.xlsx'
const DEFAULT_ACCOUNT_ID = '7eb5c991-f651-4b80-b0aa-9baf82e9fa14'

const filePath = resolve(process.argv[2] || DEFAULT_FILE)
const accountId = process.argv[3] || DEFAULT_ACCOUNT_ID
const dbPath = resolve(process.cwd(), 'data', 'finance.db')

async function main() {
  if (!existsSync(filePath)) {
    console.error('文件不存在:', filePath)
    process.exit(1)
  }
  if (!existsSync(dbPath)) {
    console.error('数据库不存在:', dbPath)
    process.exit(1)
  }

  const stat = readFileSync(filePath)
  console.log('文件:', filePath)
  console.log('大小:', (stat.length / 1024 / 1024).toFixed(2), 'MB')
  console.log('科目 ID:', accountId)

  const t0 = Date.now()
  console.log('\n[1/3] 读取 Excel…')
  const workbook = XLSX.read(stat, { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  console.log(`  行数: ${rawData.length}, 耗时: ${Date.now() - t0}ms`)
  if (rawData.length === 0) {
    console.error('无数据行')
    process.exit(1)
  }
  console.log('  表头样例:', Object.keys(rawData[0] as object).slice(0, 8).join(', '))

  const db = new Database(dbPath, { readonly: true })
  const account = db
    .prepare('SELECT id, code, name, aux_types FROM accounts WHERE id = ? AND account_set_id IS NOT NULL')
    .get(accountId) as { id: string; code: string; name: string; aux_types: string | null } | undefined

  if (!account) {
    const anySet = db.prepare('SELECT account_set_id FROM accounts WHERE id = ?').get(accountId) as
      | { account_set_id: string }
      | undefined
    if (!anySet) {
      console.error('科目不存在:', accountId)
      process.exit(1)
    }
  }

  const row = db.prepare('SELECT account_set_id, aux_types FROM accounts WHERE id = ?').get(accountId) as
    | { account_set_id: string; aux_types: string | null }
    | undefined
  if (!row) {
    console.error('科目不存在:', accountId)
    process.exit(1)
  }

  let auxTypeIds: string[] = []
  try {
    auxTypeIds = row.aux_types ? (JSON.parse(row.aux_types) as string[]) : []
  } catch {
    auxTypeIds = []
  }

  const categories = auxTypeIds.length
    ? (db
        .prepare(`SELECT id, code, name FROM aux_categories WHERE id IN (${auxTypeIds.map(() => '?').join(',')})`)
        .all(...auxTypeIds) as Array<{ id: string; code: string; name: string }>)
    : []

  console.log(`\n科目: ${account?.code || '?'} ${account?.name || ''}`)
  console.log('辅助类别:', categories.map(c => c.name).join('、') || '(无)')

  const itemsByCategory: Record<string, Array<{ id: string; code?: string; name?: string }>> = {}
  for (const cat of categories) {
    const items = db
      .prepare('SELECT id, code, name FROM aux_items WHERE account_set_id = ? AND type = ?')
      .all(row.account_set_id, cat.id) as Array<{ id: string; code: string; name: string }>
    itemsByCategory[cat.id] = items
    console.log(`  ${cat.name}: ${items.length} 个核算项目`)
  }

  const {
    validateAuxImportTemplateHeaders,
    parseAuxImportRowsAsync,
    countAuxImportImportable,
    buildAuxImportPrecheck,
  } = await import('../client/src/utils/initBalanceAuxImport.ts')

  const headerWarn = validateAuxImportTemplateHeaders(rawData[0], categories)
  if (headerWarn) {
    console.warn('\n表头警告:', headerWarn)
  }

  console.log('\n[2/3] 分块校验解析…')
  const t1 = Date.now()
  let lastPct = -1
  const { rows, blankSkipped } = await parseAuxImportRowsAsync(rawData, categories, itemsByCategory, {
    allowPendingCreate: false,
    onProgress: pct => {
      if (pct >= lastPct + 20 || pct === 100) {
        lastPct = pct
        console.log(`  进度: ${pct}%`)
      }
    },
  })
  console.log(`  有效行: ${rows.length}, 跳过空行: ${blankSkipped}, 耗时: ${Date.now() - t1}ms`)

  const matched = countAuxImportImportable(rows, false)
  const precheck = buildAuxImportPrecheck(rows)
  console.log('\n[3/3] 预检结果')
  console.log(`  可导入: ${matched}`)
  console.log(`  已匹配: ${precheck.readyCount}`)
  console.log(`  缺项目: ${precheck.missingItemCount}`)
  console.log(`  不唯一: ${precheck.ambiguousCount}`)
  console.log(`  其他问题: ${precheck.otherIssueCount}`)

  const firstError = rows.find(r => !r.matched && r.error)
  if (firstError) {
    console.log('\n首条失败样例:', `第${firstError.rowIndex}行`, firstError.error)
  }

  console.log(`\n总耗时: ${Date.now() - t0}ms`)
  console.log(matched > 0 ? '\n✅ 解析成功，存在可导入行' : '\n❌ 解析完成但无可导入行')

  db.close()
  process.exit(matched > 0 ? 0 : 2)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
