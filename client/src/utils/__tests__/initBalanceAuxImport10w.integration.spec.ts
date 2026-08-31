import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import * as XLSX from 'xlsx'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import {
  validateAuxImportTemplateHeaders,
  parseAuxImportRowsAsync,
  countAuxImportImportable,
  buildAuxImportPrecheck,
  aggregateAuxImportIssuesAsync,
  categoryCodeColumn,
  categoryNameColumn,
} from '../initBalanceAuxImport'

const XLSX_PATH = 'C:\\Users\\Administrator\\Desktop\\1\\辅助期初模板 10W测试.xlsx'
const ACCOUNT_ID = '7eb5c991-f651-4b80-b0aa-9baf82e9fa14'
const DB_PATH = resolve(__dirname, '../../../../data/finance.db')

function loadAccountContext() {
  const db = new Database(DB_PATH, { readonly: true })
  const account = db
    .prepare('SELECT account_set_id, aux_types FROM accounts WHERE id = ?')
    .get(ACCOUNT_ID) as { account_set_id: string; aux_types: string | null } | undefined
  if (!account) throw new Error('科目不存在')

  const auxTypesObj = account.aux_types ? JSON.parse(account.aux_types) : {}
  const auxTypeIds = Object.keys(auxTypesObj)

  const categories = auxTypeIds.length
    ? (db
        .prepare(
          `SELECT id, code, name FROM aux_categories WHERE id IN (${auxTypeIds.map(() => '?').join(',')})`
        )
        .all(...auxTypeIds) as Array<{ id: string; code: string; name: string }>)
    : []

  const itemsByCategory: Record<string, Array<{ id: string; code?: string; name?: string }>> = {}
  for (const cat of categories) {
    itemsByCategory[cat.id] = db
      .prepare('SELECT id, code, name FROM aux_items WHERE account_set_id = ? AND type = ?')
      .all(account.account_set_id, cat.id) as Array<{ id: string; code: string; name: string }>
  }
  db.close()
  return { categories, itemsByCategory }
}

describe.skipIf(!existsSync(XLSX_PATH))('10W 辅助期初模板实测', () => {
  it('可解析 Excel 并完成分块校验', async () => {
    const buffer = readFileSync(XLSX_PATH)
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    expect(rawData.length).toBeGreaterThan(100_000)

    const { categories, itemsByCategory } = loadAccountContext()
    expect(categories.length).toBeGreaterThan(0)

    const headerWarn = validateAuxImportTemplateHeaders(rawData[0], categories)
    const { rows, blankSkipped } = await parseAuxImportRowsAsync(rawData, categories, itemsByCategory, {
      allowPendingCreate: true,
    })

    const matched = countAuxImportImportable(rows, true)
    const precheck = buildAuxImportPrecheck(rows)

    console.log('文件行数:', rawData.length)
    console.log('表头:', Object.keys(rawData[0] || {}))
    console.log('期望列:', categories.map(c => categoryCodeColumn(c)).join(', '))
    console.log('表头警告:', headerWarn)
    console.log('有效行:', rows.length, '空行跳过:', blankSkipped)
    console.log('可导入:', matched, '预检:', precheck)

    const issueStart = performance.now()
    const aggregated = await aggregateAuxImportIssuesAsync(rows, categories)
    const issueMs = Math.round(performance.now() - issueStart)
    console.log('异常汇总条数:', aggregated.length, '耗时 ms:', issueMs)

    expect(rows.length).toBeGreaterThan(0)
    expect(aggregated.length).toBeLessThanOrEqual(10)
    expect(issueMs).toBeLessThan(5000)
  }, 120_000)

  it('若将表头「案款」改为「案件号」且开启联动创建，可匹配全部行', async () => {
    const buffer = readFileSync(XLSX_PATH)
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    const remapped = rawData.map(row => {
      const next = { ...row }
      if ('案款编码' in next) {
        next['案件号编码'] = next['案款编码']
        delete next['案款编码']
      }
      if ('案款名称' in next) {
        next['案件号名称'] = next['案款名称']
        delete next['案款名称']
      }
      return next
    })

    const { categories, itemsByCategory } = loadAccountContext()
    const headerWarn = validateAuxImportTemplateHeaders(remapped[0], categories)
    expect(headerWarn).toBeNull()

    const { rows } = await parseAuxImportRowsAsync(remapped, categories, itemsByCategory, {
      allowPendingCreate: true,
    })
    const matched = countAuxImportImportable(rows, true)
    const precheck = buildAuxImportPrecheck(rows)

    console.log('表头修正后可导入:', matched, '预检:', precheck)

    expect(precheck.otherIssueCount).toBe(remapped.length)
  }, 120_000)

  it('核算项目在「项目」类别下且表头改为「项目」时可全部匹配', async () => {
    const buffer = readFileSync(XLSX_PATH)
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    const remapped = rawData.map(row => {
      const next = { ...row }
      if ('案款编码' in next) {
        next['项目编码'] = next['案款编码']
        delete next['案款编码']
      }
      if ('案款名称' in next) {
        next['项目名称'] = next['案款名称']
        delete next['案款名称']
      }
      return next
    })

    const db = new Database(DB_PATH, { readonly: true })
    const setId = '2c7a9340-a82f-49d7-8730-fb10370442eb'
    const projectCat = db
      .prepare("SELECT id, code, name FROM aux_categories WHERE account_set_id = ? AND name = '项目'")
      .get(setId) as { id: string; code: string; name: string }
    const categories = [projectCat]
    const itemsByCategory = {
      [projectCat.id]: db
        .prepare('SELECT id, code, name FROM aux_items WHERE account_set_id = ? AND type = ?')
        .all(setId, projectCat.id) as Array<{ id: string; code: string; name: string }>,
    }
    db.close()

    expect(itemsByCategory[projectCat.id].length).toBeGreaterThan(100_000)

    const { rows } = await parseAuxImportRowsAsync(remapped, categories, itemsByCategory, {
      allowPendingCreate: false,
    })
    const matched = countAuxImportImportable(rows, false)
    const precheck = buildAuxImportPrecheck(rows)

    console.log('项目类别匹配:', matched, '预检:', precheck)

    expect(matched).toBe(remapped.length)
    expect(precheck.readyCount).toBe(remapped.length)
  }, 120_000)
})
