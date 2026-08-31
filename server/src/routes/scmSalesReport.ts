import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { authMiddleware, requirePermission, operationLog, type AuthRequest } from '../middleware/index.js'
import type { ExportColumnSpec } from '../services/styledExcelExport.js'

async function buildStyledXlsxBuffer(options: any) {
  const module = await import('../services/styledExcelExport.js')
  return module.buildStyledXlsxBuffer(options)
}
import {
  getSalesReportMeta,
  getPurchaseReportMeta,
  runSalesReportQuery,
  runPurchaseReportQuery,
  type SalesReportQuery,
} from '../services/scmSalesCustomReport.js'
import {
  getSalesFixedReportMeta,
  runSalesFixedReport,
  salesFixedReportTitle,
  type SalesFixedReportRequest,
} from '../services/scmSalesFixedReport.js'
import {
  getPurchaseFixedReportMeta,
  runPurchaseFixedReport,
  purchaseFixedReportTitle,
  type PurchaseFixedReportRequest,
} from '../services/scmPurchaseFixedReport.js'

const router = Router()
router.use(authMiddleware)
router.use('/scm/report', requirePermission('scm:report'))

const owner = (req: AuthRequest) => ({
  accountSetId: req.accountSetId || '',
  userId: req.userId || '',
})

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function parseConfig(raw: unknown) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

type ReportKey = 'sales' | 'purchase'

function reportKeyOf(value: unknown, fallback: ReportKey = 'sales'): ReportKey {
  if (value == null || value === '') return fallback
  if (value === 'sales' || value === 'purchase') return value
  throw new Error('报表标识无效')
}

function validateSchemeInput(body: any) {
  const name = String(body?.name || '').trim()
  if (!name) throw new Error('请输入方案名称')
  if (name.length > 50) throw new Error('方案名称最多 50 个字符')
  const config = body?.config && typeof body.config === 'object' ? body.config : {}
  const configJson = JSON.stringify(config)
  if (configJson.length > 200_000) throw new Error('查询方案内容过大')
  return { name, configJson, isDefault: body?.is_default === true || body?.is_default === 1 }
}

router.get('/scm/report/sales/custom-meta', (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    res.json({ code: 0, data: getSalesReportMeta(getDb(), accountSetId) })
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.post('/scm/report/sales/custom-query', (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    const result = runSalesReportQuery(getDb(), accountSetId, (req.body || {}) as SalesReportQuery)
    res.json({ code: 0, data: result })
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.post('/scm/report/sales/custom-export', async (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    const result = runSalesReportQuery(getDb(), accountSetId, (req.body || {}) as SalesReportQuery, { exportAll: true })
    const columns: ExportColumnSpec[] = result.columns.map(column => ({
      label: column.label,
      width: column.type === 'text' ? 20 : column.type === 'date' ? 13 : 15,
      align: ['number', 'amount', 'integer', 'percent'].includes(column.type) ? 'right' : 'left',
      type: column.type === 'integer' ? 'integer' : ['number', 'amount', 'percent'].includes(column.type) ? 'number' : 'text',
    }))
    const rows = result.rows.map(row => result.columns.map(column => {
      const value = row[column.key]
      return value == null ? null : typeof value === 'number' || typeof value === 'string' ? value : String(value)
    }))
    const summaryValues = result.columns.map((column, index) => index === 0 ? '合计' : result.summary[column.key] ?? null)
    const buffer = await buildStyledXlsxBuffer({
      sheetName: result.mode === 'summary' ? '销售汇总分析' : '销售明细查询',
      title: result.mode === 'summary' ? '销售自定义汇总分析' : '销售自定义明细查询',
      subtitle: '数据口径：已审核销售出库减销售退货',
      columns,
      rows,
      summaryValues,
      stripe: true,
    })
    const fileName = `销售自定义报表_${new Date().toISOString().slice(0, 10)}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.send(buffer)
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.get('/scm/report/sales/fixed-meta', (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    res.json({ code: 0, data: getSalesFixedReportMeta(getDb(), accountSetId) })
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.post('/scm/report/sales/fixed-query', (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    const result = runSalesFixedReport(getDb(), accountSetId, (req.body || {}) as SalesFixedReportRequest)
    res.json({ code: 0, data: result })
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.post('/scm/report/sales/fixed-export', async (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    const result = runSalesFixedReport(getDb(), accountSetId, (req.body || {}) as SalesFixedReportRequest, { exportAll: true })
    const title = salesFixedReportTitle(result.report_code)
    const columns: ExportColumnSpec[] = result.columns.map(column => ({
      label: column.label,
      width: column.type === 'text' ? 20 : column.type === 'date' ? 13 : 15,
      align: ['number', 'amount', 'integer', 'percent'].includes(column.type) ? 'right' : 'left',
      type: column.type === 'integer' ? 'integer' : ['number', 'amount', 'percent'].includes(column.type) ? 'number' : 'text',
    }))
    const rows = result.rows.map(row => result.columns.map(column => {
      const value = row[column.key]
      return value == null ? null : typeof value === 'number' || typeof value === 'string' ? value : String(value)
    }))
    const summaryValues = result.columns.map((column, index) => index === 0 ? '合计' : result.summary[column.key] ?? null)
    const buffer = await buildStyledXlsxBuffer({
      sheetName: title,
      title,
      subtitle: '数据口径：当前账套已审核销售出库减销售退货；退货按负数冲减',
      columns,
      rows,
      summaryValues,
      stripe: true,
    })
    const fileName = `${title}_${new Date().toISOString().slice(0, 10)}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.send(buffer)
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.get('/scm/report/purchase/custom-meta', (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    res.json({ code: 0, data: getPurchaseReportMeta(getDb(), accountSetId) })
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.post('/scm/report/purchase/custom-query', (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    const result = runPurchaseReportQuery(getDb(), accountSetId, (req.body || {}) as SalesReportQuery)
    res.json({ code: 0, data: result })
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.post('/scm/report/purchase/custom-export', async (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    const result = runPurchaseReportQuery(getDb(), accountSetId, (req.body || {}) as SalesReportQuery, { exportAll: true })
    const columns: ExportColumnSpec[] = result.columns.map(column => ({
      label: column.label,
      width: column.type === 'text' ? 20 : column.type === 'date' ? 13 : 15,
      align: ['number', 'amount', 'integer', 'percent'].includes(column.type) ? 'right' : 'left',
      type: column.type === 'integer' ? 'integer' : ['number', 'amount', 'percent'].includes(column.type) ? 'number' : 'text',
    }))
    const rows = result.rows.map(row => result.columns.map(column => {
      const value = row[column.key]
      return value == null ? null : typeof value === 'number' || typeof value === 'string' ? value : String(value)
    }))
    const summaryValues = result.columns.map((column, index) => index === 0 ? '合计' : result.summary[column.key] ?? null)
    const buffer = await buildStyledXlsxBuffer({
      sheetName: result.mode === 'summary' ? '采购汇总分析' : '采购明细查询',
      title: result.mode === 'summary' ? '采购自定义汇总分析' : '采购自定义明细查询',
      subtitle: '数据口径：已审核采购入库减采购退货',
      columns,
      rows,
      summaryValues,
      stripe: true,
    })
    const fileName = `采购自定义报表_${new Date().toISOString().slice(0, 10)}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.send(buffer)
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.get('/scm/report/purchase/fixed-meta', (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    res.json({ code: 0, data: getPurchaseFixedReportMeta(getDb(), accountSetId) })
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.post('/scm/report/purchase/fixed-query', (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    const result = runPurchaseFixedReport(getDb(), accountSetId, (req.body || {}) as PurchaseFixedReportRequest)
    res.json({ code: 0, data: result })
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.post('/scm/report/purchase/fixed-export', async (req: AuthRequest, res) => {
  try {
    const { accountSetId } = owner(req)
    const result = runPurchaseFixedReport(getDb(), accountSetId, (req.body || {}) as PurchaseFixedReportRequest, { exportAll: true })
    const title = purchaseFixedReportTitle(result.report_code)
    const columns: ExportColumnSpec[] = result.columns.map(column => ({
      label: column.label,
      width: column.type === 'text' ? 20 : column.type === 'date' ? 13 : 15,
      align: ['number', 'amount', 'integer', 'percent'].includes(column.type) ? 'right' : 'left',
      type: column.type === 'integer' ? 'integer' : ['number', 'amount', 'percent'].includes(column.type) ? 'number' : 'text',
    }))
    const rows = result.rows.map(row => result.columns.map(column => {
      const value = row[column.key]
      return value == null ? null : typeof value === 'number' || typeof value === 'string' ? value : String(value)
    }))
    const summaryValues = result.columns.map((column, index) => index === 0 ? '合计' : result.summary[column.key] ?? null)
    const buffer = await buildStyledXlsxBuffer({
      sheetName: title,
      title,
      subtitle: result.report_code === 'order_tracking'
        ? '数据口径：已审核采购订单；已审核入库减已审核退货，草稿入库单独列示；仅按行级来源关系归属'
        : '数据口径：当前账套已审核采购入库减采购退货；退货按负数冲减',
      columns,
      rows,
      summaryValues,
      stripe: true,
    })
    const fileName = `${title}_${new Date().toISOString().slice(0, 10)}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.send(buffer)
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.get('/scm/report/query-schemes', (req: AuthRequest, res) => {
  try {
    const { accountSetId, userId } = owner(req)
    const reportKey = reportKeyOf(req.query.report_key)
    const rows = getDb().prepare(`SELECT id, report_key, name, config_json, is_default, created_at, updated_at
      FROM scm_report_query_scheme
      WHERE account_set_id=? AND user_id=? AND report_key=?
      ORDER BY is_default DESC, updated_at DESC, name`).all(accountSetId, userId, reportKey) as any[]
    res.json({
      code: 0,
      data: rows.map(row => ({
        ...row,
        config: parseConfig(row.config_json),
        config_json: undefined,
        is_default: Boolean(row.is_default),
      })),
    })
  } catch (error) {
    res.status(400).json({ code: 400, message: messageOf(error) })
  }
})

router.post('/scm/report/query-schemes', operationLog('新增购销报表查询方案', '供应链'), (req: AuthRequest, res) => {
  try {
    const { accountSetId, userId } = owner(req)
    const reportKey = reportKeyOf(req.body?.report_key)
    const { name, configJson, isDefault } = validateSchemeInput(req.body)
    const id = uuidv4()
    const db = getDb()
    db.transaction(() => {
      if (isDefault) db.prepare(`UPDATE scm_report_query_scheme SET is_default=0, updated_at=datetime('now')
        WHERE account_set_id=? AND user_id=? AND report_key=?`).run(accountSetId, userId, reportKey)
      db.prepare(`INSERT INTO scm_report_query_scheme
        (id, account_set_id, user_id, report_key, name, config_json, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, accountSetId, userId, reportKey, name, configJson, isDefault ? 1 : 0)
    })()
    res.json({ code: 0, message: '方案保存成功', data: { id } })
  } catch (error) {
    const message = messageOf(error).includes('UNIQUE') ? '当前已有同名方案' : messageOf(error)
    res.status(400).json({ code: 400, message })
  }
})

router.put('/scm/report/query-schemes/:id', operationLog('更新购销报表查询方案', '供应链'), (req: AuthRequest, res) => {
  try {
    const { accountSetId, userId } = owner(req)
    const reportKey = reportKeyOf(req.body?.report_key)
    const { name, configJson, isDefault } = validateSchemeInput(req.body)
    const db = getDb()
    const exists = db.prepare(`SELECT id FROM scm_report_query_scheme
      WHERE id=? AND account_set_id=? AND user_id=? AND report_key=?`).get(req.params.id, accountSetId, userId, reportKey)
    if (!exists) return res.status(404).json({ code: 404, message: '查询方案不存在' })
    db.transaction(() => {
      if (isDefault) db.prepare(`UPDATE scm_report_query_scheme SET is_default=0, updated_at=datetime('now')
        WHERE account_set_id=? AND user_id=? AND report_key=?`).run(accountSetId, userId, reportKey)
      db.prepare(`UPDATE scm_report_query_scheme
        SET name=?, config_json=?, is_default=?, updated_at=datetime('now')
        WHERE id=? AND account_set_id=? AND user_id=? AND report_key=?`)
        .run(name, configJson, isDefault ? 1 : 0, req.params.id, accountSetId, userId, reportKey)
    })()
    res.json({ code: 0, message: '方案更新成功' })
  } catch (error) {
    const message = messageOf(error).includes('UNIQUE') ? '当前已有同名方案' : messageOf(error)
    res.status(400).json({ code: 400, message })
  }
})

router.delete('/scm/report/query-schemes/:id', operationLog('删除购销报表查询方案', '供应链'), (req: AuthRequest, res) => {
  const { accountSetId, userId } = owner(req)
  const result = getDb().prepare(`DELETE FROM scm_report_query_scheme
    WHERE id=? AND account_set_id=? AND user_id=?`).run(req.params.id, accountSetId, userId)
  if (!result.changes) return res.status(404).json({ code: 404, message: '查询方案不存在' })
  res.json({ code: 0, message: '方案删除成功' })
})

export default router
