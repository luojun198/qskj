import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware as auth, AuthRequest } from '../middleware/auth.js'
import multer from 'multer'
import { executeTemplateSheets } from '../services/reportTemplateExecutor.js'
import { FORMULA_REFERENCE } from '../services/reportFormula.js'
import {
  AcdStandardReportImportError,
  importAcdStandardReports,
  previewAcdStandardReports,
} from '../services/acdStandardReportImport.js'
import { rewriteFormulaForRowCol, type RowColOperation } from '../services/reportFormulaRewrite.js'
import { resolveReportUnitName } from '../services/reportUnitName.js'
import { randomUUID } from 'crypto'

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

// 公式速查：公式栏的 fx 弹层用，列出引擎支持的全部函数
router.get('/formula-reference', auth, (_req: AuthRequest, res) => {
  res.json({ code: 0, data: FORMULA_REFERENCE })
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
        // cell_type 必须带上：数字常量格（行次列的 5/6/7）要靠它进入求值，否则 =B12+1 读到的是空
        'SELECT id, row_index, col_index, text_value, formula_text, cell_type, format_text, style_key, side FROM rh_standard_report_cells WHERE report_id = ? ORDER BY row_index ASC, col_index ASC'
      )
      .all(req.params.id) as {
      id: string
      row_index: number
      col_index: number
      text_value: string | null
      formula_text: string | null
      cell_type: string | null
      format_text: string | null
      style_key: string | null
      side: string | null
    }[]

    const sheetId = 'sheet1'
    const templateCells = rawCells.map(cell => ({
      id: cell.id,
      report_sheet_id: sheetId,
      row_index: cell.row_index,
      col_index: cell.col_index,
      cell_type: cell.cell_type || (cell.formula_text ? 'formula' : 'text'),
      text_value: cell.text_value,
      formula_text: cell.formula_text,
      format_text: cell.format_text ?? null,
      style_key: cell.style_key ?? null,
      side: cell.side ?? null,
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
        unitName: resolveReportUnitName(db, req.accountSetId!),
        accountScope: req.accountScope,
      }
    )

    const cells = (executedSheet?.cells || []).map((cell: any) => ({
      row_index: cell.row_index,
      col_index: cell.col_index,
      display_value: cell.display_value,
      numeric_value: cell.numeric_value,
      status: cell.status,
      // FIX-144：出错格带地址与原因，前端汇总提示
      address: cell.address,
      error: cell.status === 'error' ? cell.error : null,
    }))

    const maxRow = cells.reduce((max, cell) => Math.max(max, cell.row_index), 0)
    const maxCol = cells.reduce((max, cell) => Math.max(max, cell.col_index), 0)
    const errorCount = executedSheet?.error_count ?? cells.filter(c => c.status === 'error').length

    res.json({ code: 0, data: { year, period, maxRow, maxCol, cells, errorCount } })
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

/** 取当前账套下归属校验通过的报表；找不到返回 undefined */
function getOwnedReport(db: any, reportId: string, accountSetId: string | undefined) {
  return db
    .prepare('SELECT * FROM rh_standard_reports WHERE id = ? AND account_set_id = ?')
    .get(reportId, accountSetId) as { id: string; name: string; code: string } | undefined
}

/** 允许写入的单元格字段。cell_type 的合法取值与 report_cells 保持一致。 */
const CELL_WRITABLE_FIELDS = [
  'cell_type',
  'text_value',
  'formula_text',
  'format_text',
  'style_key',
  'side',
  'merge_info',
  'col_width',
  'row_height',
] as const

const VALID_CELL_TYPES = new Set(['text', 'formula', 'number', 'empty', 'merged'])

// 批量保存单元格（新增/更新）
router.put('/:id/cells', auth, (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const report = getOwnedReport(db, req.params.id, req.accountSetId)
    if (!report) {
      return res.status(404).json({ code: 404, message: '未找到报表' })
    }

    const cells = Array.isArray(req.body?.cells) ? req.body.cells : null
    if (!cells) {
      return res.status(400).json({ code: 400, message: 'cells 必须为数组' })
    }

    for (const cell of cells) {
      if (!Number.isInteger(cell?.row_index) || cell.row_index < 0) {
        return res.status(400).json({ code: 400, message: 'row_index 必须为非负整数' })
      }
      if (!Number.isInteger(cell?.col_index) || cell.col_index < 0) {
        return res.status(400).json({ code: 400, message: 'col_index 必须为非负整数' })
      }
      if (cell.cell_type !== undefined && !VALID_CELL_TYPES.has(cell.cell_type)) {
        return res.status(400).json({ code: 400, message: '非法的 cell_type: ' + cell.cell_type })
      }
    }

    const selectExisting = db.prepare(
      'SELECT * FROM rh_standard_report_cells WHERE report_id = ? AND row_index = ? AND col_index = ?'
    )

    const save = db.transaction(() => {
      for (const cell of cells) {
        const existing = selectExisting.get(report.id, cell.row_index, cell.col_index) as
          | Record<string, unknown>
          | undefined

        // 未传的字段保留旧值（新建时为 null）——注意不要照搬 reportTemplate.ts 的 insertStmt，
        // 那里把 style_key / side 硬写 NULL，导致「给空格子设样式再保存」会丢样式。
        const merged: Record<string, unknown> = {}
        for (const field of CELL_WRITABLE_FIELDS) {
          merged[field] = cell[field] !== undefined ? cell[field] : (existing?.[field] ?? null)
        }
        // 未显式指定 cell_type 时，按有无公式推断
        if (cell.cell_type === undefined && cell.formula_text !== undefined) {
          merged.cell_type = cell.formula_text ? 'formula' : 'text'
        }
        if (!merged.cell_type) merged.cell_type = 'text'

        if (existing) {
          db.prepare(
            `UPDATE rh_standard_report_cells
             SET cell_type = ?, text_value = ?, formula_text = ?, format_text = ?, style_key = ?,
                 side = ?, merge_info = ?, col_width = ?, row_height = ?, updated_at = datetime('now')
             WHERE id = ?`
          ).run(
            merged.cell_type,
            merged.text_value,
            merged.formula_text,
            merged.format_text,
            merged.style_key,
            merged.side,
            merged.merge_info,
            merged.col_width,
            merged.row_height,
            existing.id
          )
        } else {
          db.prepare(
            `INSERT INTO rh_standard_report_cells
               (id, report_id, row_index, col_index, cell_type, text_value, formula_text,
                format_text, style_key, side, merge_info, col_width, row_height, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          ).run(
            randomUUID(),
            report.id,
            cell.row_index,
            cell.col_index,
            merged.cell_type,
            merged.text_value,
            merged.formula_text,
            merged.format_text,
            merged.style_key,
            merged.side,
            merged.merge_info,
            merged.col_width,
            merged.row_height
          )
        }
      }
      db.prepare("UPDATE rh_standard_reports SET updated_at = datetime('now') WHERE id = ?").run(
        report.id
      )
    })

    save()
    res.json({ code: 0, message: '保存成功', data: { saved: cells.length } })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message })
  }
})

// 保存列宽 / 行高
router.patch('/:id/layout', auth, (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const report = getOwnedReport(db, req.params.id, req.accountSetId)
    if (!report) {
      return res.status(404).json({ code: 404, message: '未找到报表' })
    }

    const { col_widths, row_heights, default_col_width, default_row_height } = req.body || {}
    for (const entry of [
      ['col_widths', col_widths],
      ['row_heights', row_heights],
    ] as Array<[string, unknown]>) {
      const [name, value] = entry
      if (value !== undefined && value !== null && !Array.isArray(value)) {
        return res.status(400).json({ code: 400, message: name + ' 必须为数组' })
      }
    }

    db.prepare(
      `UPDATE rh_standard_reports
       SET col_widths = COALESCE(?, col_widths),
           row_heights = COALESCE(?, row_heights),
           default_col_width = COALESCE(?, default_col_width),
           default_row_height = COALESCE(?, default_row_height),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      col_widths === undefined || col_widths === null ? null : JSON.stringify(col_widths),
      row_heights === undefined || row_heights === null ? null : JSON.stringify(row_heights),
      Number.isFinite(default_col_width) ? default_col_width : null,
      Number.isFinite(default_row_height) ? default_row_height : null,
      report.id
    )

    res.json({ code: 0, message: '保存成功' })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message })
  }
})

// 插入 / 删除 行列（含公式引用平移）
router.post('/:id/rowcol', auth, (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const report = getOwnedReport(db, req.params.id, req.accountSetId)
    if (!report) {
      return res.status(404).json({ code: 404, message: '未找到报表' })
    }

    const action = String(req.body?.action || '')
    const index = Number(req.body?.index)
    const count = req.body?.count === undefined ? 1 : Number(req.body.count)

    if (!['insert_row', 'delete_row', 'insert_col', 'delete_col'].includes(action)) {
      return res
        .status(400)
        .json({ code: 400, message: 'action 必须为 insert_row/delete_row/insert_col/delete_col' })
    }
    if (!Number.isInteger(index) || index < 0) {
      return res.status(400).json({ code: 400, message: 'index 必须为非负整数' })
    }
    if (!Number.isInteger(count) || count < 1) {
      return res.status(400).json({ code: 400, message: 'count 必须为正整数' })
    }

    const isRow = action.endsWith('_row')
    const axisColumn = isRow ? 'row_index' : 'col_index'
    const operation: RowColOperation = {
      type: action.startsWith('insert') ? 'insert' : 'delete',
      axis: isRow ? 'row' : 'col',
      index,
      count,
    }

    const apply = db.transaction(() => {
      // 先重写公式：引用坐标与单元格自身位置无关，但必须在同一事务内完成，
      // 否则插删后既有的 =B5+B6 会静默指向错误的行列。
      const formulaCells = db
        .prepare(
          `SELECT id, formula_text FROM rh_standard_report_cells
           WHERE report_id = ? AND formula_text IS NOT NULL AND length(formula_text) > 0`
        )
        .all(report.id) as Array<{ id: string; formula_text: string }>
      const updateFormula = db.prepare(
        "UPDATE rh_standard_report_cells SET formula_text = ?, updated_at = datetime('now') WHERE id = ?"
      )
      for (const cell of formulaCells) {
        const next = rewriteFormulaForRowCol(cell.formula_text, operation)
        if (next !== cell.formula_text) updateFormula.run(next, cell.id)
      }

      // 再移动 / 删除单元格
      if (operation.type === 'insert') {
        db.prepare(
          `UPDATE rh_standard_report_cells SET ${axisColumn} = ${axisColumn} + ?, updated_at = datetime('now')
           WHERE report_id = ? AND ${axisColumn} >= ?`
        ).run(count, report.id, index)
      } else {
        db.prepare(
          `DELETE FROM rh_standard_report_cells
           WHERE report_id = ? AND ${axisColumn} >= ? AND ${axisColumn} < ?`
        ).run(report.id, index, index + count)
        db.prepare(
          `UPDATE rh_standard_report_cells SET ${axisColumn} = ${axisColumn} - ?, updated_at = datetime('now')
           WHERE report_id = ? AND ${axisColumn} >= ?`
        ).run(count, report.id, index + count)
      }

      db.prepare("UPDATE rh_standard_reports SET updated_at = datetime('now') WHERE id = ?").run(
        report.id
      )
    })

    apply()
    res.json({ code: 0, message: '操作成功' })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message })
  }
})

// 新建空白报表
router.post('/', auth, (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const name = String(req.body?.name || '').trim()
    if (!name) {
      return res.status(400).json({ code: 400, message: '报表名称不能为空' })
    }

    // code 取当前账套内数字编码的最大值 +1；遇到占用则继续递增（表上有 UNIQUE(account_set_id, code)）
    const maxRow = db
      .prepare(
        `SELECT MAX(CAST(code AS INTEGER)) AS maxCode FROM rh_standard_reports
         WHERE account_set_id = ? AND code GLOB '[0-9]*'`
      )
      .get(req.accountSetId) as { maxCode: number | null }
    const existsStmt = db.prepare(
      'SELECT 1 FROM rh_standard_reports WHERE account_set_id = ? AND code = ?'
    )
    let nextCode = (maxRow?.maxCode || 0) + 1
    while (existsStmt.get(req.accountSetId, String(nextCode))) {
      nextCode += 1
    }

    const reportId = randomUUID()
    const create = db.transaction(() => {
      db.prepare(
        `INSERT INTO rh_standard_reports
           (id, account_set_id, code, name, source_file, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, datetime('now'), datetime('now'))`
      ).run(reportId, req.accountSetId, String(nextCode), name, nextCode)

      // 放一个标题格，避免网格完全为空；其余单元格由用户在编辑器里补充
      db.prepare(
        `INSERT INTO rh_standard_report_cells
           (id, report_id, row_index, col_index, cell_type, text_value, updated_at)
         VALUES (?, ?, 0, 0, 'text', ?, datetime('now'))`
      ).run(randomUUID(), reportId, name)
    })
    create()

    res.json({ code: 0, message: '创建成功', data: { id: reportId, code: String(nextCode), name } })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message })
  }
})

const VALID_PAPER_SIZES = new Set(['A4', 'A5', 'A3'])
const VALID_ORIENTATIONS = new Set(['portrait', 'landscape'])

// 保存打印页面设置（纸张 / 方向 / 缩放 / 页边距），按报表存
router.patch('/:id/page-setup', auth, (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const report = getOwnedReport(db, req.params.id, req.accountSetId)
    if (!report) {
      return res.status(404).json({ code: 404, message: '未找到报表' })
    }

    const {
      paper_size,
      paper_orientation,
      print_scale,
      margin_top,
      margin_bottom,
      margin_left,
      margin_right,
    } = req.body || {}

    if (paper_size !== undefined && !VALID_PAPER_SIZES.has(paper_size)) {
      return res.status(400).json({ code: 400, message: '纸张只支持 A4 / A5 / A3' })
    }
    if (paper_orientation !== undefined && !VALID_ORIENTATIONS.has(paper_orientation)) {
      return res.status(400).json({ code: 400, message: '方向只支持 portrait / landscape' })
    }
    if (print_scale !== undefined && print_scale !== null) {
      const scale = Number(print_scale)
      if (!Number.isFinite(scale) || scale < 0.3 || scale > 2) {
        return res.status(400).json({ code: 400, message: '缩放比例需在 30% ~ 200% 之间' })
      }
    }
    const margins = { margin_top, margin_bottom, margin_left, margin_right }
    for (const [name, raw] of Object.entries(margins)) {
      if (raw === undefined || raw === null) continue
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0 || value > 50) {
        return res.status(400).json({ code: 400, message: `${name} 需在 0 ~ 50mm 之间` })
      }
    }
    const marginValue = (raw: unknown) =>
      raw === undefined || raw === null ? null : Number(raw)

    db.prepare(
      `UPDATE rh_standard_reports
       SET paper_size = COALESCE(?, paper_size),
           paper_orientation = COALESCE(?, paper_orientation),
           print_scale = COALESCE(?, print_scale),
           margin_top = COALESCE(?, margin_top),
           margin_bottom = COALESCE(?, margin_bottom),
           margin_left = COALESCE(?, margin_left),
           margin_right = COALESCE(?, margin_right),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      paper_size ?? null,
      paper_orientation ?? null,
      print_scale === undefined || print_scale === null ? null : Number(print_scale),
      marginValue(margin_top),
      marginValue(margin_bottom),
      marginValue(margin_left),
      marginValue(margin_right),
      report.id
    )

    res.json({ code: 0, message: '保存成功' })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message })
  }
})

export default router
