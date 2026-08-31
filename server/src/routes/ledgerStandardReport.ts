import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware as auth, AuthRequest } from '../middleware/auth.js'
import multer from 'multer'
import { executeTemplateSheets } from '../services/reportTemplateExecutor.js'
import {
  AcdStandardReportImportError,
  importAcdStandardReports,
  previewAcdStandardReports,
} from '../services/acdStandardReportImport.js'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for ACD
})

// 获取标准报表列表
router.get('/', auth, (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const reports = db
      .prepare(
        'SELECT * FROM rh_standard_reports WHERE account_set_id = ? ORDER BY sort_order ASC, created_at ASC'
      )
      .all(req.accountSetId)
    res.json({ code: 0, data: reports })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message })
  }
})

// 预览 ACD 中可重新导入的标准报表，不写入数据库。
router.post('/import-preview', auth, upload.single('file'), (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请上传 ACD 文件' })
    }

    const preview = previewAcdStandardReports(req.file.buffer)
    res.json({
      code: 0,
      data: { reports: preview.reports, warnings: preview.warnings },
    })
  } catch (error: any) {
    console.error('[standard-report] ACD 预览失败:', error)
    const status = error instanceof AcdStandardReportImportError ? 400 : 500
    res.status(status).json({ code: status, message: error.message })
  }
})

// 按报表编码选择性重新导入；未选择的现有报表保持不变。
router.post('/upload', auth, upload.single('file'), (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请上传 ACD 文件' })
    }

    let reportCodes: unknown
    try {
      reportCodes = JSON.parse(String(req.body.report_codes || '[]'))
    } catch {
      return res.status(400).json({ code: 400, message: '报表选择参数格式错误' })
    }
    if (!Array.isArray(reportCodes) || reportCodes.length === 0) {
      return res.status(400).json({ code: 400, message: '请至少选择一张标准报表' })
    }
    if (!reportCodes.every(code => typeof code === 'string' && code.trim())) {
      return res.status(400).json({ code: 400, message: '报表编码无效' })
    }

    const result = importAcdStandardReports(
      getDb(),
      req.accountSetId!,
      req.file.buffer,
      reportCodes as string[]
    )
    res.json({
      code: 0,
      message: `成功更新 ${result.reports.length} 张标准报表`,
      data: result.reports,
      warnings: result.warnings,
    })
  } catch (error: any) {
    console.error('[standard-report] ACD 重新导入失败:', error)
    const status = error instanceof AcdStandardReportImportError ? 400 : 500
    res.status(status).json({ code: status, message: error.message })
  }
})

// 获取单个标准报表详情（包含公式和文字）
router.get('/:id', auth, (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const report = db
      .prepare('SELECT * FROM rh_standard_reports WHERE id = ? AND account_set_id = ?')
      .get(req.params.id, req.accountSetId)
    
    if (!report) {
      return res.status(404).json({ code: 404, message: '报表不存在' })
    }

    const cells = db
      .prepare('SELECT * FROM rh_standard_report_cells WHERE report_id = ? ORDER BY row_index ASC, col_index ASC')
      .all(req.params.id)

    res.json({ code: 0, data: { ...report, cells } })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message })
  }
})

// 计算标准报表（按年/期，用主报表系统同款公式引擎求值）
router.get('/:id/compute', auth, (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const report = db
      .prepare('SELECT * FROM rh_standard_reports WHERE id = ? AND account_set_id = ?')
      .get(req.params.id, req.accountSetId) as
      | { id: string; name: string }
      | undefined

    if (!report) {
      return res.status(404).json({ code: 404, message: '报表不存在' })
    }

    // 解析年/期：缺省取账套会计年度 + 12 期（年末，适配资产负债表）
    const accountSet = db
      .prepare('SELECT name, fiscal_year FROM account_sets WHERE id = ?')
      .get(req.accountSetId) as { name?: string; fiscal_year?: number } | undefined

    const year = Number.parseInt(String(req.query.year ?? ''), 10) || accountSet?.fiscal_year || new Date().getFullYear()
    let period = Number.parseInt(String(req.query.period ?? ''), 10)
    if (!Number.isInteger(period) || period < 1 || period > 12) period = 12

    const rawCells = db
      .prepare(
        'SELECT id, row_index, col_index, text_value, formula_text FROM rh_standard_report_cells WHERE report_id = ? ORDER BY row_index ASC, col_index ASC'
      )
      .all(req.params.id) as {
      id: string
      row_index: number
      col_index: number
      text_value: string | null
      formula_text: string | null
    }[]

    const sheetId = 'sheet1'
    const templateCells = rawCells.map(cell => ({
      id: cell.id,
      report_sheet_id: sheetId,
      row_index: cell.row_index,
      col_index: cell.col_index,
      cell_type: cell.formula_text ? 'formula' : 'text',
      text_value: cell.text_value,
      formula_text: cell.formula_text,
      format_text: null,
      style_key: null,
      side: null,
    }))

    const [executedSheet] = executeTemplateSheets(
      [
        {
          id: sheetId,
          report_definition_id: report.id,
          sheet_key: sheetId,
          sheet_name: report.name,
          sheet_index: 0,
          cells: templateCells,
        },
      ],
      {
        db,
        accountSetId: req.accountSetId!,
        year,
        period,
        unitName: accountSet?.name || '',
        accountScope: req.accountScope,
      }
    )

    const cells = (executedSheet?.cells || []).map((cell: any) => ({
      row_index: cell.row_index,
      col_index: cell.col_index,
      display_value: cell.display_value,
      numeric_value: cell.numeric_value,
      status: cell.status,
    }))

    const maxRow = cells.reduce((max, cell) => Math.max(max, cell.row_index), 0)
    const maxCol = cells.reduce((max, cell) => Math.max(max, cell.col_index), 0)

    res.json({ code: 0, data: { year, period, maxRow, maxCol, cells } })
  } catch (error: any) {
    console.error('[standard-report] 报表计算失败:', error)
    res.status(500).json({ code: 500, message: error.message })
  }
})

// 删除标准报表
router.delete('/:id', auth, (req: AuthRequest, res) => {
  try {
    const db = getDb()
    // 先校验报表归属，避免跨账套用他账套 report id 清空其单元格
    const owned = db
      .prepare('SELECT id FROM rh_standard_reports WHERE id = ? AND account_set_id = ?')
      .get(req.params.id, req.accountSetId)
    if (!owned) {
      return res.status(404).json({ code: 404, message: '报表不存在' })
    }
    db.transaction(() => {
      db.prepare('DELETE FROM rh_standard_report_cells WHERE report_id = ?').run(req.params.id)
      db.prepare('DELETE FROM rh_standard_reports WHERE id = ? AND account_set_id = ?').run(req.params.id, req.accountSetId)
    })()
    res.json({ code: 0, message: '删除成功' })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message })
  }
})

export default router
