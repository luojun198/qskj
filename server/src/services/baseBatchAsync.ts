import { v4 as uuidv4 } from 'uuid'
import type { Database } from 'better-sqlite3'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { resolve } from 'path'
import { createTask, updateTask } from './taskQueue.js'
import { getDeployDir } from '../db/index.js'
import { saveInitBalanceBatchItems, type InitBalanceBatchItem } from './initBalanceBatch.js'
import {
  assertInitBalanceEditable,
  assertInitBalanceAuxEditable,
  clearAuxInitBalances,
  clearDirectInitBalances,
  type AuxInitClearScope,
  type InitBalanceClearMode,
} from './initBalanceClear.js'
import {
  formatAuxItemDisplayLabel,
  getAuxItemDeleteBlockReason,
  getAuxItemDisplayLabelById,
} from './auxDeleteGuard.js'
import { AccountService } from './accountService.js'
import { normalizeImportCode, normalizeImportText } from './baseValidation.js'
import {
  formatAccountDisplayLabel,
  formatRowLabel,
} from '../utils/displayLabel.js'
import {
  createThrottledReporter,
  shouldYieldEventLoop,
  yieldEventLoop,
} from '../utils/batchProgress.js'
import {
  saveInitBalanceAuxDetails,
  type InitBalanceAuxLineInput,
} from './initBalanceAux.js'
import {
  createAccountParentLookup,
  createAuxItemExistsCheckers,
  runInDbTransactionChunks,
} from '../utils/bulkImportHelpers.js'
import { parseAccountAuxCategoryIds, parseAuxItemIdParts } from '../utils/auxItemId.js'

export function runProgressTask(
  type: Parameters<typeof createTask>[0],
  accountSetId: string,
  runner: (taskId: string, report: (processed: number, total: number, success: number, failed: number) => void) => Promise<{ message: string; result?: unknown }>
): string {
  const task = createTask(type, accountSetId)

  setImmediate(async () => {
    try {
      updateTask(task.id, { status: 'processing' })
      const report = (processed: number, total: number, success: number, failed: number) => {
        const progress = total > 0 ? Math.floor((processed / total) * 100) : 0
        updateTask(task.id, { processed, total, success, failed, progress })
      }
      const outcome = await runner(task.id, report)
      updateTask(task.id, {
        status: 'completed',
        progress: 100,
        message: outcome.message,
        result: outcome.result,
      })
    } catch (error: any) {
      updateTask(task.id, {
        status: 'failed',
        message: error.message || '批量操作失败',
      })
    }
  })

  return task.id
}

export function batchInitBalanceImportAsync(
  db: Database,
  accountSetId: string,
  year: number,
  items: InitBalanceBatchItem[]
) {
  assertInitBalanceEditable(db, accountSetId, year)
  return runProgressTask('init-balance-import', accountSetId, async (_taskId, report) => {
    const throttledReport = createThrottledReporter(report, items.length)
    throttledReport(0, 0, 0, true)
    const result = saveInitBalanceBatchItems(db, accountSetId, year, items, {
      onProgress: (processed, _total, success, failed) => {
        throttledReport(processed, success, failed)
      },
    })
    throttledReport(items.length, result.success, result.failed, true)
    return {
      message: `批量导入完成：成功 ${result.success} 条，失败 ${result.failed} 条`,
      result: {
        ...result,
        errors: result.errors.slice(0, 10),
      },
    }
  })
}

export function batchInitBalanceClearAsync(
  db: Database,
  accountSetId: string,
  year: number,
  mode: InitBalanceClearMode,
  accountIds?: string[]
) {
  if (mode === 'aux') {
    assertInitBalanceAuxEditable(db, accountSetId, year)
  } else {
    assertInitBalanceEditable(db, accountSetId, year)
  }
  return runProgressTask('init-balance-clear', accountSetId, async (_taskId, report) => {
    report(0, 1, 0, 0)
    if (mode === 'aux') {
      const result = clearAuxInitBalances(db, accountSetId, year, 'all_accounts')
      report(1, 1, result.deletedCount, 0)
      return {
        message: `已清理 ${result.deletedCount} 条辅助期初明细，涉及 ${result.affectedAccounts} 个科目`,
        result,
      }
    }
    const result = clearDirectInitBalances(db, accountSetId, year, { accountIds })
    report(1, 1, result.deletedCount, 0)
    return {
      message: `已清理 ${result.deletedCount} 条科目期初记录`,
      result,
    }
  })
}

export function batchAuxInitClearAsync(
  db: Database,
  accountSetId: string,
  year: number,
  scope: AuxInitClearScope,
  options: { accountId: string; categoryCode?: string }
) {
  assertInitBalanceAuxEditable(db, accountSetId, year)
  return runProgressTask('aux-init-clear', accountSetId, async (_taskId, report) => {
    report(0, 1, 0, 0)
    const result = clearAuxInitBalances(db, accountSetId, year, scope, options)
    report(1, 1, result.deletedCount, 0)
    return {
      message:
        scope === 'category'
          ? `已清理当前类目 ${result.deletedCount} 条辅助期初明细`
          : `已清理当前科目 ${result.deletedCount} 条辅助期初明细`,
      result,
    }
  })
}

export function batchAuxItemsDeleteByCategoryAsync(
  db: Database,
  accountSetId: string,
  type: string,
  status?: string
) {
  return runProgressTask('aux-items-delete', accountSetId, async (_taskId, report) => {
    const conditions = ['account_set_id=?', 'type=?']
    const params: string[] = [accountSetId, type]
    if (status) {
      conditions.push('status=?')
      params.push(status)
    }
    const ids = (
      db.prepare(`SELECT id FROM aux_items WHERE ${conditions.join(' AND ')}`).all(...params) as Array<{
        id: string
      }>
    ).map(r => r.id)

    if (ids.length === 0) {
      report(1, 1, 0, 0)
      return {
        message: '没有可删除的项目',
        result: { successCount: 0, failCount: 0, failedItems: [] },
      }
    }

    const deleteStmt = db.prepare('DELETE FROM aux_items WHERE id=?')
    let success = 0
    let failed = 0
    const errors: Array<{
      id: string
      label: string
      error: string
      block?: ReturnType<typeof getAuxItemDeleteBlockReason>
    }> = []
    const total = ids.length
    const throttledReport = createThrottledReporter(report, total)
    throttledReport(0, 0, 0, true)

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const check = getAuxItemDeleteBlockReason(db, accountSetId, id)
      const label = check.item
        ? formatAuxItemDisplayLabel(check.item)
        : getAuxItemDisplayLabelById(db, id)
      if (check.blocked) {
        failed++
        if (errors.length < 100) {
          errors.push({ id, label, error: check.message || '无法删除', block: check })
        }
      } else {
        try {
          deleteStmt.run(id)
          success++
        } catch (error: any) {
          failed++
          if (errors.length < 100) {
            errors.push({ id, label, error: error.message || '删除失败' })
          }
        }
      }
      throttledReport(i + 1, success, failed)
      if (shouldYieldEventLoop(i + 1)) {
        await yieldEventLoop()
      }
    }
    throttledReport(total, success, failed, true)

    return {
      message: `批量删除完成：成功 ${success} 个，跳过 ${failed} 个`,
      result: { successCount: success, failCount: failed, failedItems: errors.slice(0, 10) },
    }
  })
}

export function batchAuxItemsDeleteAsync(db: Database, accountSetId: string, ids: string[]) {
  return runProgressTask('aux-items-delete', accountSetId, async (_taskId, report) => {
    const deleteStmt = db.prepare('DELETE FROM aux_items WHERE id=?')
    let success = 0
    let failed = 0
    const errors: Array<{
      id: string
      label: string
      error: string
      block?: ReturnType<typeof getAuxItemDeleteBlockReason>
    }> = []
    const total = ids.length
    const throttledReport = createThrottledReporter(report, total)
    throttledReport(0, 0, 0, true)

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const check = getAuxItemDeleteBlockReason(db, accountSetId, id)
      const label = check.item
        ? formatAuxItemDisplayLabel(check.item)
        : getAuxItemDisplayLabelById(db, id)
      if (check.blocked) {
        failed++
        if (errors.length < 100) {
          errors.push({ id, label, error: check.message || '无法删除', block: check })
        }
      } else {
        try {
          deleteStmt.run(id)
          success++
        } catch (error: any) {
          failed++
          if (errors.length < 100) {
            errors.push({ id, label, error: error.message || '删除失败' })
          }
        }
      }
      throttledReport(i + 1, success, failed)
      if (shouldYieldEventLoop(i + 1)) {
        await yieldEventLoop()
      }
    }
    throttledReport(total, success, failed, true)

    return {
      message: `批量删除完成：成功 ${success} 个，跳过 ${failed} 个`,
      result: { successCount: success, failCount: failed, failedItems: errors.slice(0, 10) },
    }
  })
}

export function batchAuxItemsImportAsync(
  db: Database,
  accountSetId: string,
  type: string,
  items: Array<Record<string, unknown>>
) {
  return runProgressTask('aux-items-import', accountSetId, async (_taskId, report) => {
    const category = db.prepare('SELECT * FROM aux_categories WHERE id=?').get(type) as
      | { id: string }
      | undefined
    if (!category) {
      throw new Error('项目类别不存在')
    }

    const fields = db
      .prepare('SELECT * FROM aux_category_fields WHERE category_id=? AND is_enabled=1')
      .all(type) as Array<{ field_key: string; field_name: string; required_in_archive: number }>

    const existsCheck = createAuxItemExistsCheckers(db, accountSetId, type)
    const batchCodes = new Set<string>()
    const batchNames = new Set<string>()

    const insertStmt = db.prepare(
      'INSERT INTO aux_items (id, account_set_id, type, code, name, remark, field_values, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )

    let success = 0
    let failed = 0
    const errors: Array<{ id: string; label: string; error: string }> = []
    const total = items.length
    const throttledReport = createThrottledReporter(report, total)
    throttledReport(0, 0, 0, true)

    const pendingInserts: Array<{
      index: number
      code: string
      name: string
      rowLabel: string
      remark: string
      fieldValuesJson: string
      status: string
    }> = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const code = normalizeImportCode(String(item.code || ''))
      const name = normalizeImportText(String(item.name || ''))
      const rowLabel = code
        ? formatAuxItemDisplayLabel({ code, name })
        : formatRowLabel(i + 1)
      try {
        if (!code || !name) {
          throw new Error('编码和名称不能为空')
        }
        const normalizedName = name
        if (existsCheck.codeExists(code) || batchCodes.has(code)) {
          throw new Error('项目编码已存在')
        }
        if (existsCheck.nameExists(normalizedName) || batchNames.has(normalizedName)) {
          throw new Error('项目名称已存在')
        }
        const fieldValues = (item.field_values as Record<string, unknown>) || {}
        for (const field of fields) {
          if (field.required_in_archive && !fieldValues[field.field_key]) {
            throw new Error(`字段「${field.field_name}」为必填项`)
          }
        }
        pendingInserts.push({
          index: i,
          code,
          name: normalizedName,
          rowLabel,
          remark: String(item.remark || ''),
          fieldValuesJson: JSON.stringify(fieldValues),
          status: String(item.status || 'active'),
        })
        batchCodes.add(code)
        batchNames.add(normalizedName)
      } catch (error: any) {
        failed++
        if (errors.length < 100) {
          errors.push({
            id: code || `row-${i + 1}`,
            label: rowLabel,
            error: error.message || '导入失败',
          })
        }
      }
      throttledReport(i + 1, success, failed)
      if (shouldYieldEventLoop(i + 1)) {
        await yieldEventLoop()
      }
    }

    await runInDbTransactionChunks(
      db,
      pendingInserts,
      500,
      row => {
        try {
          insertStmt.run(
            uuidv4(),
            accountSetId,
            type,
            row.code,
            row.name,
            row.remark,
            row.fieldValuesJson,
            row.status
          )
          success++
        } catch (error: any) {
          failed++
          if (errors.length < 100) {
            errors.push({
              id: row.code || `row-${row.index + 1}`,
              label: row.rowLabel,
              error: error.message || '导入失败',
            })
          }
        }
      },
      {
        onChunkDone: (processed, chunkTotal) => {
          throttledReport(Math.min(items.length, processed), success, failed)
          if (processed < chunkTotal) {
            void yieldEventLoop()
          }
        },
      }
    )
    throttledReport(total, success, failed, true)

    return {
      message: `批量导入完成：成功 ${success} 个，失败 ${failed} 个`,
      result: { successCount: success, failCount: failed, errors: errors.slice(0, 10) },
    }
  })
}

function getAsyncExportDir() {
  const dir = resolve(getDeployDir(), 'tmp', 'exports')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function exportAuxItemsAsync(
  db: Database,
  accountSetId: string,
  type: string,
  status?: string
) {
  return runProgressTask('aux-items-export', accountSetId, async (taskId, report) => {
    const category = db
      .prepare('SELECT name FROM aux_categories WHERE id=? AND account_set_id=?')
      .get(type, accountSetId) as { name: string } | undefined
    if (!category) throw new Error('项目类别不存在')

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS count FROM aux_items
         WHERE account_set_id=? AND type=? AND (?='' OR status=?)`
      )
      .get(accountSetId, type, status || '', status || '') as { count: number }
    const total = Number(totalRow?.count || 0)
    report(0, total, 0, 0)

    const fields = db
      .prepare(
        `SELECT field_key, field_name FROM aux_category_fields
         WHERE category_id=? AND is_enabled=1 ORDER BY sort_order, field_key`
      )
      .all(type) as Array<{ field_key: string; field_name: string }>

    const excelModule = await import('exceljs')
    const ExcelJS = (excelModule.default || excelModule) as any
    const safeName = category.name.replace(/[\\/:*?"<>|]/g, '_')
    const fileName = `核算项目_${safeName}_${total}条.xlsx`
    const filePath = resolve(getAsyncExportDir(), `${taskId}.xlsx`)
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: false,
      useSharedStrings: false,
    })
    const sheet = workbook.addWorksheet(safeName.slice(0, 31) || '核算项目')
    sheet.columns = [
      { header: '编码', key: 'code', width: 18 },
      { header: '名称', key: 'name', width: 28 },
      { header: '状态', key: 'status', width: 12 },
      { header: '备注', key: 'remark', width: 30 },
      ...fields.map(field => ({ header: field.field_name, key: field.field_key, width: 18 })),
    ]

    const query = db.prepare(
      `SELECT id, code, name, status, remark, field_values FROM aux_items
       WHERE account_set_id=? AND type=? AND (?='' OR status=?)
         AND (code>? OR (code=? AND id>?))
       ORDER BY code, id LIMIT 1000`
    )
    let lastCode = ''
    let lastId = ''
    let processed = 0
    while (true) {
      const rows = query.all(
        accountSetId,
        type,
        status || '',
        status || '',
        lastCode,
        lastCode,
        lastId
      ) as any[]
      if (rows.length === 0) break
      for (const item of rows) {
        let fieldValues: Record<string, unknown> = {}
        try {
          fieldValues = item.field_values ? JSON.parse(item.field_values) : {}
        } catch {
          fieldValues = {}
        }
        sheet.addRow({
          code: item.code,
          name: item.name,
          status: item.status === 'active' ? '进行中' : '已完成',
          remark: item.remark || '',
          ...fieldValues,
        }).commit()
        processed++
      }
      const last = rows[rows.length - 1]
      lastCode = String(last.code || '')
      lastId = String(last.id || '')
      report(processed, total, processed, 0)
      await yieldEventLoop()
    }
    sheet.commit()
    await workbook.commit()
    report(total, total, total, 0)
    return {
      message: `导出完成，共 ${total} 条`,
      result: { filePath, fileName, downloadUrl: `/api/tasks/${taskId}/download` },
    }
  })
}

export function exportInitBalanceAuxAsync(
  db: Database,
  accountSetId: string,
  accountId: string,
  year: number,
  period = 1
) {
  return runProgressTask('aux-init-export', accountSetId, async (taskId, report) => {
    const account = db
      .prepare('SELECT code, name, aux_types FROM accounts WHERE id=? AND account_set_id=?')
      .get(accountId, accountSetId) as { code: string; name: string; aux_types?: string } | undefined
    if (!account) throw new Error('科目不存在')
    const categoryIds = parseAccountAuxCategoryIds(account.aux_types)
    const categories = db
      .prepare(
        `SELECT id, code, name FROM aux_categories
         WHERE account_set_id=? AND id IN (SELECT value FROM json_each(?))`
      )
      .all(accountSetId, JSON.stringify(categoryIds)) as Array<{ id: string; code: string; name: string }>
    const categoryByCode = new Map(categories.map(category => [category.code, category]))
    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS count FROM init_balances
         WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id!=''`
      )
      .get(accountSetId, accountId, year, period) as { count: number }
    const total = Number(totalRow?.count || 0)
    report(0, total, 0, 0)

    const excelModule = await import('exceljs')
    const ExcelJS = (excelModule.default || excelModule) as any
    const fileName = `辅助期初_${account.code}_${year}年_${total}条.xlsx`
    const filePath = resolve(getAsyncExportDir(), `${taskId}.xlsx`)
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: false,
      useSharedStrings: false,
    })
    const sheet = workbook.addWorksheet('辅助期初')
    sheet.columns = [
      { header: '科目编码', key: 'accountCode', width: 16 },
      { header: '科目名称', key: 'accountName', width: 24 },
      { header: '辅助组合', key: 'auxLabel', width: 46 },
      { header: '年初借方', key: 'openingDebit', width: 16 },
      { header: '年初贷方', key: 'openingCredit', width: 16 },
      { header: '账前借方', key: 'preBookDebit', width: 16 },
      { header: '账前贷方', key: 'preBookCredit', width: 16 },
    ]

    const query = db.prepare(
      `SELECT id, aux_item_id, opening_debit, opening_credit, pre_book_debit, pre_book_credit
       FROM init_balances
       WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id!='' AND id>?
       ORDER BY id LIMIT 1000`
    )
    let lastId = ''
    let processed = 0
    while (true) {
      const rows = query.all(accountSetId, accountId, year, period, lastId) as any[]
      if (rows.length === 0) break
      const tokens = new Set<string>()
      for (const row of rows) {
        for (const token of Object.values(parseAuxItemIdParts(row.aux_item_id))) tokens.add(token)
      }
      const itemRows = tokens.size
        ? (db
            .prepare(
              `SELECT id, type, code, name FROM aux_items
               WHERE account_set_id=? AND id IN (SELECT value FROM json_each(?))`
            )
            .all(accountSetId, JSON.stringify([...tokens])) as Array<{ id: string; type: string; code: string; name: string }>)
        : []
      const itemById = new Map(itemRows.map(item => [item.id, item]))
      for (const row of rows) {
        const parts = parseAuxItemIdParts(row.aux_item_id)
        const labels = Object.entries(parts).map(([categoryCode, token]) => {
          const category = categoryByCode.get(categoryCode)
          const item = itemById.get(token)
          return `${category?.name || categoryCode}:${item ? `${item.code} ${item.name}` : token}`
        })
        sheet.addRow({
          accountCode: account.code,
          accountName: account.name,
          auxLabel: labels.join(' / '),
          openingDebit: Number(row.opening_debit || 0),
          openingCredit: Number(row.opening_credit || 0),
          preBookDebit: Number(row.pre_book_debit || 0),
          preBookCredit: Number(row.pre_book_credit || 0),
        }).commit()
        processed++
      }
      lastId = String(rows[rows.length - 1].id)
      report(processed, total, processed, 0)
      await yieldEventLoop()
    }
    sheet.commit()
    await workbook.commit()
    report(total, total, total, 0)
    return {
      message: `辅助期初导出完成，共 ${total} 条`,
      result: { filePath, fileName, downloadUrl: `/api/tasks/${taskId}/download` },
    }
  })
}

function excelCellText(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'object') {
    const rich = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> }
    if (rich.text != null) return String(rich.text).trim()
    if (rich.result != null) return String(rich.result).trim()
    if (Array.isArray(rich.richText)) return rich.richText.map(part => part.text || '').join('').trim()
  }
  return String(value).trim()
}

export function importAuxItemsFileAsync(
  db: Database,
  accountSetId: string,
  type: string,
  filePath: string
) {
  return runProgressTask('aux-items-import-file', accountSetId, async (_taskId, report) => {
    try {
      const category = db.prepare('SELECT id FROM aux_categories WHERE id=? AND account_set_id=?').get(type, accountSetId)
      if (!category) throw new Error('项目类别不存在')
      const fields = db
        .prepare(
          `SELECT field_key, field_name, required_in_archive FROM aux_category_fields
           WHERE category_id=? AND is_enabled=1 ORDER BY sort_order, field_key`
        )
        .all(type) as Array<{ field_key: string; field_name: string; required_in_archive: number }>
      const fieldByName = new Map(fields.map(field => [field.field_name, field]))
      const existsCheck = createAuxItemExistsCheckers(db, accountSetId, type)
      const insert = db.prepare(
        `INSERT INTO aux_items
         (id, account_set_id, type, code, name, remark, field_values, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const maxCodeRow = db
        .prepare('SELECT code FROM aux_items WHERE account_set_id=? AND type=? ORDER BY CAST(code AS INTEGER) DESC LIMIT 1')
        .get(accountSetId, type) as { code?: string } | undefined
      let nextCode = Number.parseInt(String(maxCodeRow?.code || '0'), 10) || 0
      let processed = 0
      let success = 0
      let failed = 0
      const errors: Array<{ id: string; label: string; error: string }> = []
      let headers: string[] = []

      const excelModule = await import('exceljs')
      const ExcelJS = (excelModule.default || excelModule) as any
      const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
        entries: 'emit',
        sharedStrings: 'cache',
        styles: 'ignore',
        hyperlinks: 'ignore',
        worksheets: 'emit',
      })
      for await (const worksheet of reader) {
        for await (const row of worksheet) {
          const values = Array.isArray(row.values) ? row.values.slice(1).map(excelCellText) : []
          if (headers.length === 0) {
            headers = values
            continue
          }
          if (values.every((value: string) => !value)) continue
          processed++
          const record = new Map(headers.map((header, index) => [header, values[index] || '']))
          let code = normalizeImportCode(record.get('编码') || record.get('code') || '')
          const name = normalizeImportText(record.get('名称') || record.get('name') || '')
          if (!code) code = String(++nextCode).padStart(6, '0')
          const rowLabel = formatAuxItemDisplayLabel({ code, name })
          try {
            if (!name) throw new Error('名称不能为空')
            if (existsCheck.codeExists(code)) throw new Error('项目编码已存在')
            if (existsCheck.nameExists(name)) throw new Error('项目名称已存在')
            const fieldValues: Record<string, string> = {}
            for (const [header, value] of record) {
              const field = fieldByName.get(header)
              if (field && value) fieldValues[field.field_key] = value
            }
            for (const field of fields) {
              if (field.required_in_archive && !fieldValues[field.field_key]) {
                throw new Error(`字段“${field.field_name}”为必填项`)
              }
            }
            const rawStatus = record.get('状态') || record.get('status') || '进行中'
            const status = rawStatus === 'active' || rawStatus === '进行中' ? 'active' : 'closed'
            insert.run(
              uuidv4(),
              accountSetId,
              type,
              code,
              name,
              record.get('备注') || record.get('remark') || '',
              JSON.stringify(fieldValues),
              status
            )
            success++
          } catch (error: any) {
            failed++
            if (errors.length < 100) {
              errors.push({ id: code || `row-${processed + 1}`, label: rowLabel, error: error.message || '导入失败' })
            }
          }
          if (processed % 200 === 0) {
            report(processed, processed + 1, success, failed)
            await yieldEventLoop()
          }
        }
        break
      }
      report(processed, processed, success, failed)
      return {
        message: `文件导入完成：成功 ${success} 条，失败 ${failed} 条`,
        result: { successCount: success, failCount: failed, errors: errors.slice(0, 20) },
      }
    } finally {
      if (existsSync(filePath)) {
        try { unlinkSync(filePath) } catch { /* 临时文件由后续维护清理 */ }
      }
    }
  })
}

export function batchAccountsImportAsync(
  db: Database,
  accountSetId: string,
  accounts: Array<Record<string, unknown>>
) {
  return runProgressTask('accounts-import', accountSetId, async (_taskId, report) => {
    const service = new AccountService(db)
    const lookupParent = createAccountParentLookup(db, accountSetId)
    const importedByCode = new Map<string, { id: string; code: string; name: string; level: number; direction: string }>()

    const findParentId = (parentCode: string | null | undefined): string | null => {
      if (!parentCode) return null
      const fromBatch = importedByCode.get(parentCode)
      if (fromBatch) return fromBatch.id
      const fromDb = lookupParent(parentCode)
      return fromDb?.id || null
    }

    let success = 0
    let failed = 0
    const errors: Array<{ id: string; label: string; error: string }> = []
    const total = accounts.length
    const throttledReport = createThrottledReporter(report, total)
    throttledReport(0, 0, 0, true)

    for (let i = 0; i < accounts.length; i++) {
      const item = accounts[i]
      const code = String(item.code || '')
      const name = String(item.name || '')
      const rowLabel = code
        ? formatAccountDisplayLabel({ code, name })
        : formatRowLabel(i + 1)
      try {
        if (!code || !name || !item.direction) {
          throw new Error('编码、名称、方向不能为空')
        }
        if (service.isCodeExists(accountSetId, code)) {
          throw new Error('科目编码已存在')
        }
        if (importedByCode.has(code)) {
          throw new Error('科目编码在本批次中重复')
        }
        const parentCode = item.parent_code as string | undefined
        const parentId = findParentId(parentCode)
        if (parentCode && !parentId) {
          throw new Error(`未找到上级科目编码「${parentCode}」`)
        }
        const parentFromBatch = parentCode ? importedByCode.get(parentCode) : undefined
        const parentFromDb = parentId && !parentFromBatch ? lookupParent(parentCode) : undefined
        const parentLevel = parentFromBatch?.level ?? parentFromDb?.level
        const level = parentLevel != null ? parentLevel + 1 : 1
        const id = service.createAccount({
          account_set_id: accountSetId,
          code,
          name,
          direction: String(item.direction),
          level,
          parent_id: parentId,
          is_aux: Boolean(item.is_aux),
          aux_types: (item.aux_types as Record<string, string> | null) || null,
          is_enabled: item.is_enabled !== undefined ? Boolean(item.is_enabled) : true,
          is_cash: Boolean(item.is_cash),
          is_bank: Boolean(item.is_bank),
          no_negative: Boolean(item.no_negative),
        })
        importedByCode.set(code, { id, code, name, level, direction: String(item.direction) })
        success++
      } catch (error: any) {
        failed++
        if (errors.length < 100) {
          errors.push({
            id: code || `row-${i + 1}`,
            label: rowLabel,
            error: error.message || '导入失败',
          })
        }
      }
      throttledReport(i + 1, success, failed)
      if (shouldYieldEventLoop(i + 1)) {
        await yieldEventLoop()
      }
    }
    throttledReport(total, success, failed, true)

    return {
      message: `批量导入完成：成功 ${success} 条，失败 ${failed} 条`,
      result: { successCount: success, failCount: failed, errors: errors.slice(0, 10) },
    }
  })
}

export function batchInitBalanceAuxSaveAsync(
  db: Database,
  accountSetId: string,
  accountId: string,
  year: number,
  lines: InitBalanceAuxLineInput[],
  period = 1
) {
  assertInitBalanceAuxEditable(db, accountSetId, year)
  return runProgressTask('aux-init-save', accountSetId, async (_taskId, report) => {
    const total = lines.length
    const throttledReport = createThrottledReporter(report, total)
    throttledReport(0, 0, 0, true)
    await yieldEventLoop()

    try {
      const summary = saveInitBalanceAuxDetails(
        db,
        accountSetId,
        accountId,
        year,
        lines,
        period,
        {
          onBuildProgress: processed => {
            throttledReport(processed, processed, 0)
          },
        }
      )
      throttledReport(total, total, 0, true)
      return {
        message: '辅助期初保存成功',
        result: { summary, success: total, failed: 0 },
      }
    } catch (error: any) {
      throttledReport(total, 0, 1, true)
      throw error
    }
  })
}
