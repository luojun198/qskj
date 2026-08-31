import { Router } from 'express'
import crypto from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import { executeTemplateSheets } from '../services/reportTemplateExecutor.js'
import { saveReportTemplateExcelSource } from '../services/reportTemplatePersistence.js'
import {
  createReportTask,
  getReportTask,
  updateReportTask,
  runWithProgress,
} from '../services/reportTaskManager.js'

async function exportReportTemplateToBuffer(...args: any[]) {
  const module = await import('../services/reportTemplateExport.js')
  return (module.exportReportTemplateToBuffer as any)(...args)
}

async function sanitizeTemplateWorkbook(...args: any[]) {
  const module = await import('../services/reportTemplateSanitize.js')
  return (module.sanitizeTemplateWorkbook as any)(...args)
}

async function getSheetContentBounds(...args: any[]) {
  const module = await import('../services/standardTemplateImport.js')
  return (module.getSheetContentBounds as any)(...args)
}

async function readExcelStyleBundle(...args: any[]) {
  const module = await import('../services/standardTemplateImport.js')
  return (module.readExcelStyleBundle as any)(...args)
}

const router = Router()
router.use(authMiddleware)

// Excel 模板上传配置
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1,
  },
})

function sanitizeReportTemplateFilePart(value: string) {
  return value.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim() || 'template'
}

function persistUploadedReportTemplate(params: {
  accountSetId: string
  reportCode: string
  originalName: string
  buffer: Buffer
}) {
  const { accountSetId, reportCode, originalName, buffer } = params
  const ext = originalName.toLowerCase().endsWith('.xls') ? '.xls' : '.xlsx'
  const baseName = sanitizeReportTemplateFilePart(originalName.replace(/\.[^.]+$/, ''))
  const safeCode = sanitizeReportTemplateFilePart(reportCode)
  const dir = join(process.cwd(), 'uploads', 'report-templates', sanitizeReportTemplateFilePart(accountSetId))
  mkdirSync(dir, { recursive: true })
  const fileName = `${safeCode}_${Date.now()}_${baseName}${ext}`
  const fullPath = join(dir, fileName)
  writeFileSync(fullPath, buffer)
  return fullPath
}

function buildCoveredMergeKeys(mergeMap: Map<string, { colSpan: number; rowSpan: number }>) {
  const covered = new Set<string>()
  for (const [key, span] of mergeMap.entries()) {
    const [rowIndex, colIndex] = key.split(':').map(Number)
    for (let dr = 0; dr < span.rowSpan; dr += 1) {
      for (let dc = 0; dc < span.colSpan; dc += 1) {
        if (dr === 0 && dc === 0) continue
        covered.add(`${rowIndex + dr}:${colIndex + dc}`)
      }
    }
  }
  return covered
}

// 报表生成进度查询接口
router.get('/tasks/:taskId', (req: AuthRequest, res) => {
  const { taskId } = req.params
  const task = getReportTask(taskId)
  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在或已过期' })
  }
  res.json({ code: 0, data: task })
})

type ReportDefinitionRow = {
  id: string
  code: string
  name: string
  source: string
  source_file: string | null
  sort_order: number
  is_enabled: number
}

type ReportSheetRow = {
  id: string
  report_definition_id: string
  sheet_key: string
  sheet_name: string
  sheet_index: number
  default_col_width: number | null
  default_row_height: number | null
  col_widths: string | null
  row_heights: string | null
}

type ReportCellRow = {
  id: string
  report_sheet_id: string
  row_index: number
  col_index: number
  cell_type: string
  text_value: string | null
  formula_text: string | null
  format_text: string | null
  style_key: string | null
  side: string | null
  col_width: number | null
  row_height: number | null
  merge_info: string | null
}

type UpdateReportCellPayload = {
  id?: string
  row_index?: number
  col_index?: number
  text_value?: string | null
  formula_text?: string | null
  format_text?: string | null
  style_key?: string | null
  cell_type?: string
  col_width?: number | null
  row_height?: number | null
  merge_info?: string | null
}

const ALLOWED_CELL_TYPES = new Set(['text', 'formula', 'number', 'empty', 'merged'])

function normalizeMergeInfo(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') {
    return null
  }

  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('merge_info 必须是对象，格式为 {"colSpan": number, "rowSpan": number}')
  }

  const colSpanRaw = (parsed as { colSpan?: unknown }).colSpan
  const rowSpanRaw = (parsed as { rowSpan?: unknown }).rowSpan

  const colSpan = colSpanRaw == null ? 1 : Number(colSpanRaw)
  const rowSpan = rowSpanRaw == null ? 1 : Number(rowSpanRaw)

  if (!Number.isInteger(colSpan) || colSpan < 1) {
    throw new Error('merge_info.colSpan 必须是大于等于 1 的整数')
  }
  if (!Number.isInteger(rowSpan) || rowSpan < 1) {
    throw new Error('merge_info.rowSpan 必须是大于等于 1 的整数')
  }

  // No actual merge when both are 1
  if (colSpan === 1 && rowSpan === 1) {
    return null
  }

  return JSON.stringify({ colSpan, rowSpan })
}

function resolveAccountSetId(accountSetId: string, db: ReturnType<typeof getDb>) {
  if (accountSetId) return accountSetId
  const row = db
    .prepare('SELECT id FROM account_sets ORDER BY id ASC LIMIT 1')
    .get() as { id: string } | undefined
  return row?.id ?? ''
}

function getDefinitionByCode(
  db: ReturnType<typeof getDb>,
  accountSetId: string,
  reportCode: string
) {
  return db
    .prepare(
      `
      SELECT id, code, name, source, source_file, sort_order, is_enabled
      FROM report_definitions
      WHERE account_set_id = ? AND code = ?
      LIMIT 1
      `
    )
    .get(accountSetId, reportCode) as ReportDefinitionRow | undefined
}

function getSheetsByDefinitionId(db: ReturnType<typeof getDb>, reportDefinitionId: string) {
  return db
    .prepare(
      `
      SELECT id, report_definition_id, sheet_key, sheet_name, sheet_index, default_col_width, default_row_height, col_widths, row_heights
      FROM report_sheets
      WHERE report_definition_id = ?
      ORDER BY sheet_index ASC, sheet_key ASC
      `
    )
    .all(reportDefinitionId) as ReportSheetRow[]
}

function getCellsBySheetIds(db: ReturnType<typeof getDb>, sheetIds: string[]) {
  return sheetIds.length
    ? (db
        .prepare(
          `
          SELECT id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, format_text, style_key, side, col_width, row_height, merge_info
          FROM report_cells
          WHERE report_sheet_id IN (${sheetIds.map(() => '?').join(', ')})
          ORDER BY report_sheet_id ASC, row_index ASC, col_index ASC
          `
        )
        .all(...sheetIds) as ReportCellRow[])
    : []
}

router.get('/templates', (req: AuthRequest, res) => {
  if (!req.accountSetId) {
    return res.status(400).json({ code: 400, message: '账套未选择，请重新登录' })
  }

  try {
    const accountSetId = req.accountSetId
    const db = getDb()

    const definitions = db
      .prepare(
        `
      SELECT id, code, name, source, source_file, sort_order, is_enabled
      FROM report_definitions
      WHERE account_set_id = ?
      ORDER BY sort_order ASC, code ASC
      `
      )
      .all(accountSetId) as ReportDefinitionRow[]

    const formulaFunctions = db
      .prepare(
        `
      SELECT function_name, handler_key, description
      FROM report_formula_functions
      WHERE account_set_id = ?
      ORDER BY function_name ASC
      `
      )
      .all(accountSetId) as Array<{
      function_name: string
      handler_key: string
      description: string | null
    }>

    res.json({
      code: 0,
      data: definitions.map(definition => ({
        ...definition,
        is_enabled: Boolean(definition.is_enabled),
      })),
      summary: {
        total: definitions.length,
        formulaFunctionCount: formulaFunctions.length,
        formulaFunctions,
      },
    })
  } catch (error: any) {
    console.error('[report/templates]', { accountSetId: req.accountSetId, error })
    return res.status(500).json({
      code: 500,
      message: error?.message || '加载报表模板列表失败',
    })
  }
})

/**
 * 批量更新报表模板导航顺序（sort_order）。
 * - orders 必须覆盖当前账套下的全部报表，且 code 不可重复。
 */
router.put('/templates/sort-order', (req: AuthRequest, res) => {
  const db = getDb()
  const accountSetId = resolveAccountSetId(req.accountSetId || '', db)

  if (!accountSetId) {
    return res.status(400).json({ code: 400, message: '账套不存在' })
  }

  const body = (req.body || {}) as { orders?: unknown }
  if (!Array.isArray(body.orders) || body.orders.length === 0) {
    return res.status(400).json({ code: 400, message: 'orders 必须为非空数组' })
  }

  const parsedOrders: { code: string; sort_order: number }[] = []
  const seenCodes = new Set<string>()

  for (const item of body.orders) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ code: 400, message: 'orders 项格式无效' })
    }
    const code = String((item as { code?: unknown }).code || '').trim()
    const sortOrderRaw = (item as { sort_order?: unknown }).sort_order
    const sort_order = Number(sortOrderRaw)

    if (!code) {
      return res.status(400).json({ code: 400, message: '报表编码不能为空' })
    }
    if (!Number.isInteger(sort_order) || sort_order < 1) {
      return res.status(400).json({ code: 400, message: 'sort_order 必须是大于等于 1 的整数' })
    }
    if (seenCodes.has(code)) {
      return res.status(400).json({ code: 400, message: `报表编码重复: ${code}` })
    }
    seenCodes.add(code)
    parsedOrders.push({ code, sort_order })
  }

  const existing = db
    .prepare(
      `
      SELECT code
      FROM report_definitions
      WHERE account_set_id = ?
      ORDER BY sort_order ASC, code ASC
      `
    )
    .all(accountSetId) as Array<{ code: string }>

  if (existing.length === 0) {
    return res.status(400).json({ code: 400, message: '当前账套没有可排序的报表' })
  }

  if (parsedOrders.length !== existing.length) {
    return res.status(400).json({
      code: 400,
      message: `orders 必须包含全部 ${existing.length} 个报表`,
    })
  }

  const existingCodes = new Set(existing.map(row => row.code))
  for (const item of parsedOrders) {
    if (!existingCodes.has(item.code)) {
      return res.status(400).json({ code: 400, message: `未找到报表: ${item.code}` })
    }
  }

  try {
    db.transaction(() => {
      const updateStmt = db.prepare(
        `UPDATE report_definitions SET sort_order = ?, updated_at = datetime('now') WHERE account_set_id = ? AND code = ?`
      )
      for (const item of parsedOrders) {
        updateStmt.run(item.sort_order, accountSetId, item.code)
      }
    })()
  } catch (error: any) {
    return res.status(500).json({
      code: 500,
      message: error?.message || '更新导航顺序失败',
    })
  }

  const updated = db
    .prepare(
      `
      SELECT code, name, sort_order, is_enabled
      FROM report_definitions
      WHERE account_set_id = ?
      ORDER BY sort_order ASC, code ASC
      `
    )
    .all(accountSetId) as Array<{
    code: string
    name: string
    sort_order: number
    is_enabled: number
  }>

  res.json({
    code: 0,
    message: '导航顺序已更新',
    data: updated.map(row => ({
      ...row,
      is_enabled: Boolean(row.is_enabled),
    })),
  })
})

router.get('/templates/:code', (req: AuthRequest, res) => {
  const accountSetId = req.accountSetId || ''
  const reportCode = String(req.params.code || '').trim()
  const db = getDb()

  if (!reportCode) {
    return res.status(400).json({ code: 400, message: '报表编码不能为空' })
  }

  const resolvedAccountSetId =
    accountSetId ||
    ((
      db.prepare('SELECT id FROM account_sets ORDER BY created_at ASC LIMIT 1').get() as
        | { id: string }
        | undefined
    )?.id ??
      '')

  const definition = db
    .prepare(
      `
      SELECT id, code, name, source, source_file, sort_order, is_enabled
      FROM report_definitions
      WHERE account_set_id = ? AND code = ?
      LIMIT 1
      `
    )
    .get(resolvedAccountSetId, reportCode) as ReportDefinitionRow | undefined

  if (!definition) {
    return res.status(404).json({ code: 404, message: '未找到对应报表模板' })
  }

  const sheets = db
    .prepare(
      `
      SELECT id, report_definition_id, sheet_key, sheet_name, sheet_index, default_col_width, default_row_height, col_widths, row_heights
      FROM report_sheets
      WHERE report_definition_id = ?
      ORDER BY sheet_index ASC, sheet_key ASC
      `
    )
    .all(definition.id) as ReportSheetRow[]

  const sheetIds = sheets.map(sheet => sheet.id)
  const cells = sheetIds.length
    ? (db
        .prepare(
          `
          SELECT id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, format_text, style_key, side, col_width, row_height, merge_info
          FROM report_cells
          WHERE report_sheet_id IN (${sheetIds.map(() => '?').join(', ')})
          ORDER BY report_sheet_id ASC, row_index ASC, col_index ASC
          `
        )
        .all(...sheetIds) as ReportCellRow[])
    : []

  const source = db
    .prepare(
      `
      SELECT source_file, source_type, content_encoding, parse_version, created_at
      FROM report_template_sources
      WHERE report_definition_id = ?
      ORDER BY created_at DESC
      LIMIT 1
      `
    )
    .get(definition.id) as
    | {
        source_file: string
        source_type: string
        content_encoding: string | null
        parse_version: string | null
        created_at: string
      }
    | undefined

  const formulaFunctions = db
    .prepare(
      `
      SELECT function_name, handler_key, description
      FROM report_formula_functions
      WHERE account_set_id = ?
      ORDER BY function_name ASC
      `
    )
    .all(resolvedAccountSetId) as Array<{
    function_name: string
    handler_key: string
    description: string | null
  }>

  const cellsBySheetId = new Map<string, ReportCellRow[]>()
  for (const cell of cells) {
    const bucket = cellsBySheetId.get(cell.report_sheet_id)
    if (bucket) {
      bucket.push(cell)
    } else {
      cellsBySheetId.set(cell.report_sheet_id, [cell])
    }
  }

  res.json({
    code: 0,
    data: {
      definition: {
        ...definition,
        is_enabled: Boolean(definition.is_enabled),
      },
      source: source || null,
      formulaFunctions,
      sheets: sheets.map(sheet => {
        const sheetCells = cellsBySheetId.get(sheet.id) || []
        const maxRowIndex = sheetCells.reduce((max, cell) => Math.max(max, cell.row_index), -1)
        const maxColIndex = sheetCells.reduce((max, cell) => Math.max(max, cell.col_index), -1)
        return {
          ...sheet,
          metrics: {
            cellCount: sheetCells.length,
            rowCount: maxRowIndex + 1,
            colCount: maxColIndex + 1,
          },
          cells: sheetCells,
        }
      }),
    },
  })
})

router.put('/templates/:code/cells', (req: AuthRequest, res) => {
  const reportCode = String(req.params.code || '').trim()
  const { sheetId, cells } = (req.body || {}) as {
    sheetId?: string
    cells?: UpdateReportCellPayload[]
  }
  const db = getDb()
  const resolvedAccountSetId = resolveAccountSetId(req.accountSetId || '', db)

  if (!reportCode) {
    return res.status(400).json({ code: 400, message: '报表编码不能为空' })
  }
  if (!sheetId) {
    return res.status(400).json({ code: 400, message: 'sheetId 不能为空' })
  }
  if (!Array.isArray(cells) || cells.length === 0) {
    return res.status(400).json({ code: 400, message: 'cells 不能为空' })
  }

  const definition = getDefinitionByCode(db, resolvedAccountSetId, reportCode)
  if (!definition) {
    return res.status(404).json({ code: 404, message: '未找到对应报表模板' })
  }

  const sheet = db
    .prepare(
      `
      SELECT id, report_definition_id, sheet_key, sheet_name, sheet_index
      FROM report_sheets
      WHERE id = ? AND report_definition_id = ?
      LIMIT 1
      `
    )
    .get(sheetId, definition.id) as ReportSheetRow | undefined

  if (!sheet) {
    return res.status(404).json({ code: 404, message: '未找到对应工作表' })
  }

  const existingCells = db
    .prepare(
      `
      SELECT id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, format_text, style_key, side, col_width, row_height, merge_info
      FROM report_cells
      WHERE report_sheet_id = ?
      `
    )
    .all(sheetId) as ReportCellRow[]

  const existingById = new Map(existingCells.map(cell => [cell.id, cell]))
  const existingByPosition = new Map(
    existingCells.map(cell => [`${cell.row_index}:${cell.col_index}`, cell])
  )

  const updateStmt = db.prepare(
    `
    UPDATE report_cells
    SET cell_type = ?, text_value = ?, formula_text = ?, format_text = ?, style_key = ?, col_width = ?, row_height = ?, merge_info = ?, updated_at = datetime('now')
    WHERE id = ?
    `
  )

  const insertStmt = db.prepare(
    `
    INSERT INTO report_cells (
      id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, format_text, style_key, side, col_width, row_height, merge_info, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, datetime('now'), datetime('now'))
    `
  )

  const applyChanges = db.transaction((payloads: UpdateReportCellPayload[]) => {
    for (const payload of payloads) {
      const rowIndex = Number(payload.row_index)
      const colIndex = Number(payload.col_index)
      const targetById = payload.id ? existingById.get(payload.id) : undefined
      const targetByPos =
        Number.isInteger(rowIndex) && Number.isInteger(colIndex)
          ? existingByPosition.get(`${rowIndex}:${colIndex}`)
          : undefined
      const target = targetById || targetByPos

      const nextCellType = payload.cell_type || target?.cell_type || 'text'
      if (!ALLOWED_CELL_TYPES.has(nextCellType)) {
        throw new Error(`不支持的单元格类型: ${nextCellType}`)
      }

      const textValue =
        payload.text_value === undefined ? target?.text_value || null : payload.text_value
      const formulaText =
        payload.formula_text === undefined ? target?.formula_text || null : payload.formula_text
      const formatText =
        payload.format_text === undefined ? target?.format_text || null : payload.format_text
      const styleKey =
        payload.style_key === undefined ? target?.style_key || null : payload.style_key
      const colWidth =
        payload.col_width === undefined ? target?.col_width || null : payload.col_width
      const rowHeight =
        payload.row_height === undefined ? target?.row_height || null : payload.row_height
      const mergeInfo =
        payload.merge_info === undefined
          ? normalizeMergeInfo(target?.merge_info || null)
          : normalizeMergeInfo(payload.merge_info)

      if (colWidth != null && (!Number.isFinite(colWidth) || colWidth <= 0)) {
        throw new Error('col_width 必须是大于 0 的数字')
      }
      if (rowHeight != null && (!Number.isFinite(rowHeight) || rowHeight <= 0)) {
        throw new Error('row_height 必须是大于 0 的数字')
      }

      if (target) {
        updateStmt.run(nextCellType, textValue, formulaText, formatText, styleKey, colWidth, rowHeight, mergeInfo, target.id)
        continue
      }

      if (
        !Number.isInteger(rowIndex) ||
        rowIndex < 0 ||
        !Number.isInteger(colIndex) ||
        colIndex < 0
      ) {
        throw new Error('新增单元格必须提供合法的 row_index 和 col_index')
      }

      insertStmt.run(
        crypto.randomUUID(),
        sheetId,
        rowIndex,
        colIndex,
        nextCellType,
        textValue,
        formulaText,
        formatText,
        colWidth,
        rowHeight,
        mergeInfo
      )
    }
  })

  try {
    applyChanges(cells)
  } catch (error) {
    return res
      .status(400)
      .json({ code: 400, message: error instanceof Error ? error.message : '保存模板失败' })
  }

  res.json({ code: 0, message: '模板单元格保存成功' })
})

function normalizeSheetSizeArray(
  input: unknown,
  expectedLength: number,
  minValue: number,
  label: string
): number[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} 必须是数组`)
  }
  if (input.length < expectedLength) {
    throw new Error(`${label} 长度不能小于 ${expectedLength}`)
  }
  return input.slice(0, expectedLength).map((value, index) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < minValue) {
      throw new Error(`${label}[${index}] 必须是大于等于 ${minValue} 的数字`)
    }
    return Math.round(parsed)
  })
}

router.patch('/templates/:code/sheets/:sheetId/layout', (req: AuthRequest, res) => {
  const reportCode = String(req.params.code || '').trim()
  const sheetId = String(req.params.sheetId || '').trim()
  const body = req.body || {}
  const db = getDb()
  const resolvedAccountSetId = resolveAccountSetId(req.accountSetId || '', db)

  if (!reportCode) {
    return res.status(400).json({ code: 400, message: '报表编码不能为空' })
  }
  if (!sheetId) {
    return res.status(400).json({ code: 400, message: 'sheetId 不能为空' })
  }

  const definition = getDefinitionByCode(db, resolvedAccountSetId, reportCode)
  if (!definition) {
    return res.status(404).json({ code: 404, message: '未找到对应报表模板' })
  }

  const sheet = db
    .prepare(
      `
      SELECT id
      FROM report_sheets
      WHERE id = ? AND report_definition_id = ?
      LIMIT 1
      `
    )
    .get(sheetId, definition.id) as { id: string } | undefined

  if (!sheet) {
    return res.status(404).json({ code: 404, message: '未找到对应工作表' })
  }

  const bounds = db
    .prepare(
      `
      SELECT MAX(row_index) AS max_row, MAX(col_index) AS max_col
      FROM report_cells
      WHERE report_sheet_id = ?
      `
    )
    .get(sheetId) as { max_row: number | null; max_col: number | null } | undefined

  const colCount = Math.max((bounds?.max_col ?? -1) + 1, 1)
  const rowCount = Math.max((bounds?.max_row ?? -1) + 1, 1)

  try {
    const colWidths = normalizeSheetSizeArray(body.col_widths, colCount, 24, 'col_widths')
    const rowHeights = normalizeSheetSizeArray(body.row_heights, rowCount, 16, 'row_heights')

    db.prepare(
      `
      UPDATE report_sheets
      SET col_widths = ?, row_heights = ?
      WHERE id = ?
      `
    ).run(JSON.stringify(colWidths), JSON.stringify(rowHeights), sheetId)

    res.json({
      code: 0,
      message: '工作表布局已保存',
      data: {
        sheetId,
        colCount,
        rowCount,
        col_widths: colWidths,
        row_heights: rowHeights,
      },
    })
  } catch (error) {
    return res.status(400).json({
      code: 400,
      message: error instanceof Error ? error.message : '保存工作表布局失败',
    })
  }
})

router.post('/templates/:code/rowcol', (req: AuthRequest, res) => {
  const reportCode = String(req.params.code || '').trim()
  const body = req.body || {}
  const sheetId = body.sheetId
  const action = body.action
  const index = Number(body.index)
  const db = getDb()
  const resolvedAccountSetId = resolveAccountSetId(req.accountSetId || '', db)

  console.log(
    '[rowcol] body:',
    JSON.stringify(body),
    'parsed index:',
    index,
    'isInteger:',
    Number.isInteger(index)
  )

  if (!reportCode) {
    return res.status(400).json({ code: 400, message: '报表编码不能为空' })
  }
  if (!sheetId) {
    return res.status(400).json({ code: 400, message: 'sheetId 不能为空' })
  }
  if (!['insert_row', 'delete_row', 'insert_col', 'delete_col'].includes(action || '')) {
    return res
      .status(400)
      .json({ code: 400, message: 'action 必须为 insert_row/delete_row/insert_col/delete_col' })
  }
  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ code: 400, message: `index 必须为非负整数, 收到: ${index}` })
  }
  const definition = getDefinitionByCode(db, resolvedAccountSetId, reportCode)
  if (!definition) {
    return res.status(404).json({ code: 404, message: '未找到对应报表模板' })
  }

  const sheet = db
    .prepare(
      `
      SELECT id, report_definition_id, sheet_key, sheet_name, sheet_index
      FROM report_sheets
      WHERE id = ? AND report_definition_id = ?
      LIMIT 1
      `
    )
    .get(sheetId, definition.id) as ReportSheetRow | undefined

  if (!sheet) {
    return res.status(404).json({ code: 404, message: '未找到对应工作表' })
  }

  const updateRowIndexes = db.prepare(
    `UPDATE report_cells SET row_index = row_index + 1, updated_at = datetime('now') WHERE report_sheet_id = ? AND row_index >= ?`
  )
  const updateColIndexes = db.prepare(
    `UPDATE report_cells SET col_index = col_index + 1, updated_at = datetime('now') WHERE report_sheet_id = ? AND col_index >= ?`
  )
  const deleteCellsAtIndex = db.prepare(
    `DELETE FROM report_cells WHERE report_sheet_id = ? AND row_index = ?`
  )
  const deleteColCellsAtIndex = db.prepare(
    `DELETE FROM report_cells WHERE report_sheet_id = ? AND col_index = ?`
  )
  const decrementRowIndexes = db.prepare(
    `UPDATE report_cells SET row_index = row_index - 1, updated_at = datetime('now') WHERE report_sheet_id = ? AND row_index > ?`
  )
  const decrementColIndexes = db.prepare(
    `UPDATE report_cells SET col_index = col_index - 1, updated_at = datetime('now') WHERE report_sheet_id = ? AND col_index > ?`
  )

  const applyChanges = db.transaction(() => {
    switch (action) {
      case 'insert_row':
        updateRowIndexes.run(sheetId, index)
        break
      case 'delete_row':
        deleteCellsAtIndex.run(sheetId, index)
        decrementRowIndexes.run(sheetId, index)
        break
      case 'insert_col': {
        const cells = db
          .prepare(
            `SELECT id, col_index FROM report_cells WHERE report_sheet_id = ? AND col_index >= ? ORDER BY col_index DESC`
          )
          .all(sheetId, index) as Array<{ id: string; col_index: number }>
        const updateStmt = db.prepare(
          `UPDATE report_cells SET col_index = ?, updated_at = datetime('now') WHERE id = ?`
        )
        for (const cell of cells) {
          updateStmt.run(cell.col_index + 1, cell.id)
        }
        break
      }
      case 'delete_col':
        deleteColCellsAtIndex.run(sheetId, index)
        decrementColIndexes.run(sheetId, index)
        break
    }
  })

  try {
    applyChanges()
  } catch (error) {
    console.error('[rowcol] error:', error)
    return res
      .status(400)
      .json({ code: 400, message: error instanceof Error ? error.message : '操作失败' })
  }

  res.json({ code: 0, message: '操作成功' })
})

router.post('/templates/import', excelUpload.single('file'), async (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const resolvedAccountSetId = resolveAccountSetId(req.accountSetId || '', db)
    const reportCode = String(req.body?.reportCode || '').trim()
    const reportName = String(req.body?.reportName || '').trim()

    console.log('[import] 开始导入报表，reportCode:', reportCode, 'reportName:', reportName)

    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请选择要上传的 Excel 文件' })
    }

    const uploadedFile = req.file
    const filename = uploadedFile.originalname
    const ext = filename.toLowerCase().split('.').pop()
    console.log('[import] 文件名:', filename, '扩展名:', ext, '文件大小:', req.file.size)

    if (ext !== 'xls' && ext !== 'xlsx') {
      return res.status(400).json({ code: 400, message: `只支持 .xls 或 .xlsx 格式` })
    }

    if (!reportCode) {
      return res.status(400).json({ code: 400, message: '请提供报表编码 reportCode' })
    }

    // 模板净化：仅保留首个 sheet 并清除边界外脏数据。
    // 仅 xlsx 走净化（ExcelJS 不支持 xls 二进制格式）；xls 维持原样，由导出环节提示重存为 xlsx。
    let workingBuffer = uploadedFile.buffer
    if (ext === 'xlsx') {
      try {
        workingBuffer = await sanitizeTemplateWorkbook(uploadedFile.buffer)
      } catch (sanitizeError) {
        console.warn('[import] 模板净化失败，回退使用原始 buffer:', sanitizeError)
        workingBuffer = uploadedFile.buffer
      }
    }

    const persistedSourceFile = persistUploadedReportTemplate({
      accountSetId: resolvedAccountSetId,
      reportCode,
      originalName: filename,
      buffer: workingBuffer,
    })
    const xlsx = await import('xlsx')
    const iconv = (await import('iconv-lite')).default
    const workbook = xlsx.read(workingBuffer, { type: 'buffer', cellStyles: true, codepage: 936 })

    const sheetsToImportNames = workbook.SheetNames.slice(0, 1)
    const contentBoundsBySheet = sheetsToImportNames.map(sheetName =>
      getSheetContentBounds(workbook.Sheets[sheetName])
    )
    const styleBundle = await readExcelStyleBundle(workingBuffer, contentBoundsBySheet)

    const fontMapsBySheet = new Map<number, Map<string, { bold?: boolean; sz?: number; name?: string }>>()
    for (const [sheetIndex, styleMap] of styleBundle.stylesBySheet.entries()) {
      const sheetFontMap = new Map<string, { bold?: boolean; sz?: number; name?: string }>()
      for (const [key, style] of styleMap.entries()) {
        const f = style.font
        if (
          f &&
          (f.bold || (f.size && f.size !== 11) || (f.name && !/^宋体|Calibri$/i.test(f.name)))
        ) {
          sheetFontMap.set(key, { bold: f.bold, sz: f.size, name: f.name })
        }
      }
      fontMapsBySheet.set(sheetIndex, sheetFontMap)
    }
    const excelStyleMergeMaps = new Map<number, Map<string, { colSpan: number; rowSpan: number }>>(
      styleBundle.mergesBySheet
    )

    // Derive report name: explicit param > first sheet name > reportCode
    const effectiveName = reportName || workbook.SheetNames[0]?.replace(/\(定义\)$/g, '').trim() || reportCode

    const applyImport = db.transaction(() => {
      // Upsert report definition: create if not exists, update if exists
      let definition = getDefinitionByCode(db, resolvedAccountSetId, reportCode)
      let definitionId: string

      if (definition) {
        definitionId = definition.id
        db.prepare(
          `UPDATE report_definitions SET name = ?, source = 'xls', source_file = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(effectiveName, persistedSourceFile, definitionId)
        db.prepare(
          `DELETE FROM report_cells WHERE report_sheet_id IN (SELECT id FROM report_sheets WHERE report_definition_id = ?)`
        ).run(definitionId)
        db.prepare(`DELETE FROM report_sheets WHERE report_definition_id = ?`).run(definitionId)
        db.prepare(`DELETE FROM report_template_sources WHERE report_definition_id = ?`).run(definitionId)
      } else {
        definitionId = uuidv4()
        // Determine sort_order
        const maxSort = db
          .prepare('SELECT MAX(sort_order) as max_order FROM report_definitions WHERE account_set_id = ?')
          .get(resolvedAccountSetId) as { max_order: number | null }
        const sortOrder = (maxSort?.max_order ?? 0) + 1

        db.prepare(
          `INSERT INTO report_definitions (id, account_set_id, code, name, source, source_file, sort_order, is_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'xls', ?, ?, 1, datetime('now'), datetime('now'))`
        ).run(definitionId, resolvedAccountSetId, reportCode, effectiveName, persistedSourceFile, sortOrder)
      }

      saveReportTemplateExcelSource(db, definitionId, persistedSourceFile, workingBuffer)

      const sheetsToImport = sheetsToImportNames
      sheetsToImport.forEach((sheetName, sheetIndex) => {
        const fontMap = fontMapsBySheet.get(sheetIndex) || new Map()
        const sheetId = uuidv4()
        const cleanSheetName = sheetName.replace(/\(定义\)$/g, '').trim()

        const sheet = workbook.Sheets[sheetName]

        // --- Extract column widths and row heights ---
        const colWidths: number[] = []
        const rowHeights: number[] = []
        const sheetCols = (sheet['!cols'] || []) as Array<{ wpx?: number; wch?: number; width?: number; hidden?: number }>
        const sheetRows = (sheet['!rows'] || []) as Array<{ hpx?: number; hpt?: number; hidden?: number }>
        for (const col of sheetCols) {
          if (!col) { colWidths.push(64); continue }
          if (col.hidden) { colWidths.push(-1); continue }
          // wpx = pixel width, wch = character width (approx 8px per char)
          colWidths.push(col.wpx || Math.round((col.wch || col.width || 8) * 8))
        }
        for (const row of sheetRows) {
          if (!row) { rowHeights.push(20); continue }
          if (row.hidden) { rowHeights.push(-1); continue }
          rowHeights.push(row.hpx || Math.round((row.hpt || 15) * 1.33))
        }

        // Save sheet with col_widths/row_heights
        const colWidthsJson = colWidths.length > 0 ? JSON.stringify(colWidths) : null
        const rowHeightsJson = rowHeights.length > 0 ? JSON.stringify(rowHeights) : null
        db.prepare(
          `INSERT INTO report_sheets (id, report_definition_id, sheet_key, sheet_name, sheet_index, col_widths, row_heights, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(sheetId, definitionId, `sheet_${sheetIndex + 1}`, cleanSheetName, sheetIndex, colWidthsJson, rowHeightsJson)

        // --- Build merge map ---
        const mergeMap = new Map<string, { colSpan: number; rowSpan: number }>()
        const explicitMerges = (sheet['!merges'] || []) as Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>
        const excelMergeMap = excelStyleMergeMaps.get(sheetIndex) || new Map<string, { colSpan: number; rowSpan: number }>()

        if (explicitMerges.length > 0 || excelMergeMap.size > 0) {
          // .xlsx format: use explicit merge info
          for (const m of explicitMerges) {
            const colSpan = m.e.c - m.s.c + 1
            const rowSpan = m.e.r - m.s.r + 1
            mergeMap.set(`${m.s.r}:${m.s.c}`, { colSpan, rowSpan })
          }
          for (const [key, merge] of excelMergeMap.entries()) {
            if (!mergeMap.has(key)) mergeMap.set(key, merge)
          }
        } else {
          // .xls format: infer merges from data distribution patterns
          // Step 1: find actual data boundaries and build cell map
          const cellMap = new Map<string, any>()
          const rowDataCols = new Map<number, Set<number>>() // row -> set of data columns
          let maxDataR = 0, maxDataC = 0
          for (const key of Object.keys(sheet)) {
            if (key.startsWith('!')) continue
            const rawCell = (sheet as any)[key]
            const addr = xlsx.utils.decode_cell(key)
            cellMap.set(`${addr.r}:${addr.c}`, rawCell)
            if (rawCell && rawCell.v != null && String(rawCell.v).trim() !== '') {
              maxDataR = Math.max(maxDataR, addr.r)
              maxDataC = Math.max(maxDataC, addr.c)
              if (!rowDataCols.has(addr.r)) rowDataCols.set(addr.r, new Set())
              rowDataCols.get(addr.r)!.add(addr.c)
            }
          }

          // Step 2: infer merges using heuristic approach
          const visited = new Set<string>()

          // For each row with data, check if we should infer merges
          for (let r = 0; r <= maxDataR; r++) {
            const colsInRow = rowDataCols.get(r)
            if (!colsInRow || colsInRow.size === 0) continue

            const sortedCols = Array.from(colsInRow).sort((a, b) => a - b)
            const firstCol = sortedCols[0]
            const lastCol = sortedCols[sortedCols.length - 1]

            // If this row has fewer data cells than the "full" row below it,
            // the extra cells might be merged
            // Find the "full" width by looking at the most data-rich rows below
            let effectiveMaxC = maxDataC
            for (let checkR = r + 1; checkR <= maxDataR; checkR++) {
              const checkCols = rowDataCols.get(checkR)
              if (checkCols && checkCols.size > 0) {
                effectiveMaxC = Math.max(...Array.from(checkCols))
                break
              }
            }

            // Heuristic 1: If only one data cell and it's at the left edge,
            // infer it merges right to the effective width
            if (sortedCols.length === 1 && firstCol === 0) {
              const endC = effectiveMaxC
              if (endC > firstCol) {
                mergeMap.set(`${r}:${firstCol}`, { colSpan: endC - firstCol + 1, rowSpan: 1 })
                // Mark all cells in range as visited
                for (let cc = firstCol; cc <= endC; cc++) visited.add(`${r}:${cc}`)
                // Auto-center the merged cell
                continue
              }
            }

            // Heuristic 2: If only one data cell and it's at the right edge (lastCol === effectiveMaxC),
            // infer it merges left to column 0
            if (sortedCols.length === 1 && lastCol === effectiveMaxC && firstCol > 0) {
              const startC = 0
              mergeMap.set(`${r}:${startC}`, { colSpan: lastCol - startC + 1, rowSpan: 1 })
              // Mark all cells in range as visited
              for (let cc = startC; cc <= lastCol; cc++) visited.add(`${r}:${cc}`)
              // Auto-center the merged cell
              continue
            }

            // If data cells are "clustered" (dense within a range),
            // no merge needed for single cells
            // Mark all data cells as visited
            for (const c of sortedCols) visited.add(`${r}:${c}`)
          }
        }
        const coveredMergeKeys = buildCoveredMergeKeys(mergeMap)

        // --- Read with formula support ---
        // Determine effective range: for .xls files, !ref may extend far beyond actual data
        const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1')
        // Find actual data boundary by scanning cells
        let scanMaxR = range.s.r, scanMaxC = range.s.c
        for (const key of Object.keys(sheet)) {
          if (key.startsWith('!')) continue
          const rawCell = (sheet as any)[key]
          if (rawCell && rawCell.t !== 'z' && rawCell.v != null && String(rawCell.v).trim() !== '') {
            const addr = xlsx.utils.decode_cell(key)
            scanMaxR = Math.max(scanMaxR, addr.r)
            scanMaxC = Math.max(scanMaxC, addr.c)
          }
        }
        // Also account for merge regions that may extend beyond data cells
        let mergeMaxR = scanMaxR
        let mergeMaxC = scanMaxC
        for (const [key, m] of mergeMap.entries()) {
          const [sr, sc] = key.split(':').map(Number)
          mergeMaxR = Math.max(mergeMaxR, sr + m.rowSpan - 1)
          mergeMaxC = Math.max(mergeMaxC, sc + m.colSpan - 1)
        }
        const effectiveMaxR = mergeMaxR
        const effectiveMaxC = mergeMaxC

        const insertCell = db.prepare(
          `INSERT INTO report_cells (id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, style_key, col_width, row_height, merge_info, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        )

        // Collect formula functions
        const formulaFunctions = new Set<string>()

        for (let r = range.s.r; r <= effectiveMaxR; r++) {
          for (let c = range.s.c; c <= effectiveMaxC; c++) {
            if (coveredMergeKeys.has(`${r}:${c}`)) continue
            const addr = xlsx.utils.encode_cell({ r, c })
            const rawCell = sheet[addr] as any
            if (!rawCell) continue

            // Determine value
            let cellStr = ''
            if (rawCell.f) {
              cellStr = rawCell.f.startsWith('=') || rawCell.f.startsWith('@') ? rawCell.f : '=' + rawCell.f
            } else {
              cellStr = String(rawCell.v ?? rawCell.w ?? '')
            }
            if (!cellStr && rawCell.t !== 'z') continue
            // Skip z-cells (covered by merges) - they are stored as part of the merge origin
            if (rawCell.t === 'z') continue

            const isFormula = cellStr.startsWith('=') || cellStr.startsWith('@')

            // --- Extract alignment ---
            const styleParts: string[] = []
            const alignment = rawCell.s?.alignment
            if (alignment) {
              if (alignment.horizontal === 'center' || alignment.horizontal === 'centerContinuous') styleParts.push('align-center')
              else if (alignment.horizontal === 'right') styleParts.push('align-right')
              else if (alignment.horizontal === 'left') styleParts.push('align-left')
              if (alignment.vertical === 'center') styleParts.push('valign-middle')
              else if (alignment.vertical === 'bottom') styleParts.push('valign-bottom')
            }

            // --- Extract font properties (from ExcelJS) ---
            const ejFont = fontMap.get(`${r}:${c}`)
            if (ejFont) {
              if (ejFont.bold) styleParts.push('font-bold')
              if (ejFont.sz && ejFont.sz !== 11 && ejFont.sz !== 12) {
                styleParts.push(`font-size-${ejFont.sz}`)
              }
              if (ejFont.name && !/^宋体|Calibri$/i.test(ejFont.name)) {
                const fontMapNames: Record<string, string> = {
                  '楷体': 'KaiTi', '楷体_GB2312': 'KaiTi',
                  '黑体': 'SimHei', '仿宋': 'FangSong', '仿宋_GB2312': 'FangSong',
                  '微软雅黑': 'Microsoft YaHei',
                }
                const mapped = fontMapNames[ejFont.name] || ejFont.name
                styleParts.push(`font-family-${mapped}`)
              }
            }

            // --- Fix mojibake: some .XLS files decode GBK text as Latin-1 ---
            if (cellStr && typeof cellStr === 'string') {
              let needsFix = false
              for (let i = 0; i < cellStr.length; i++) {
                const code = cellStr.charCodeAt(i)
                if (code > 0x7F && code <= 0xFF) { needsFix = true; break }
              }
              if (needsFix) {
                try {
                  const raw = Buffer.alloc(cellStr.length)
                  for (let i = 0; i < cellStr.length; i++) raw[i] = cellStr.charCodeAt(i) & 0xFF
                  const fixed = iconv.decode(raw, 'gbk')
                  // Only apply fix if result contains CJK characters
                  for (let i = 0; i < fixed.length; i++) {
                    if (fixed.charCodeAt(i) >= 0x4E00 && fixed.charCodeAt(i) <= 0x9FFF) {
                      cellStr = fixed
                      break
                    }
                  }
                } catch (_) { /* ignore encoding fix errors */ }
              }
            }

            // --- Merge info: auto-apply center alignment for horizontally merged cells ---
            const merge = mergeMap.get(`${r}:${c}`)
            if (merge && merge.colSpan > 1) {
              // Merged cells spanning multiple columns should be center-aligned by default
              if (!styleParts.some(p => p.startsWith('align-'))) {
                styleParts.push('align-center')
              }
              if (!styleParts.some(p => p.startsWith('valign-'))) {
                styleParts.push('valign-middle')
              }
            }
            const styleKey = styleParts.length > 0 ? styleParts.join(' ') : null
            const mergeInfo = merge ? JSON.stringify(merge) : null

            insertCell.run(
              uuidv4(),
              sheetId,
              r,
              c,
              isFormula ? 'formula' : 'text',
              isFormula ? null : cellStr,
              isFormula ? cellStr : null,
              styleKey,
              null, // col_width: stored at sheet level
              null, // row_height: stored at sheet level
              mergeInfo
            )

            // Extract @ function names
            if (isFormula && cellStr.startsWith('@')) {
              const matches = cellStr.matchAll(/(?:^|[^\w])@?([a-zA-Z_][\w]*)\s*\(/g)
              for (const m of matches) formulaFunctions.add(m[1].toLowerCase())
            }
          }
        }

        // Upsert formula functions
        for (const fn of formulaFunctions) {
          db.prepare(
            `INSERT INTO report_formula_functions (id, account_set_id, function_name, handler_key, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
             ON CONFLICT(account_set_id, function_name)
             DO UPDATE SET updated_at = datetime('now')`
          ).run(uuidv4(), resolvedAccountSetId, fn, `xls:${fn}`, 'Excel 报表公式函数（待实现执行器）')
        }
      })
    })

    applyImport()

    const definition = getDefinitionByCode(db, resolvedAccountSetId, reportCode)
    console.log('[import] 导入成功，definitionId:', definition?.id)
    res.json({ code: 0, message: '导入成功', data: { definitionId: definition?.id, name: effectiveName, code: reportCode } })
  } catch (error) {
    console.error('[import] 导入失败，详细错误:', error)
    console.error('[import] 错误堆栈:', error instanceof Error ? error.stack : '无堆栈信息')
    return res
      .status(500)
      .json({ code: 500, message: error instanceof Error ? error.message : '导入失败' })
  }
})

router.delete('/templates/:code/sheets/:sheetId', (req: AuthRequest, res) => {
  const reportCode = String(req.params.code || '').trim()
  const sheetId = String(req.params.sheetId || '').trim()
  const db = getDb()
  const resolvedAccountSetId = resolveAccountSetId(req.accountSetId || '', db)

  if (!reportCode) {
    return res.status(400).json({ code: 400, message: '报表编码不能为空' })
  }
  if (!sheetId) {
    return res.status(400).json({ code: 400, message: 'sheetId 不能为空' })
  }

  const definition = getDefinitionByCode(db, resolvedAccountSetId, reportCode)
  if (!definition) {
    return res.status(404).json({ code: 404, message: '未找到对应的报表模板' })
  }

  const sheets = getSheetsByDefinitionId(db, definition.id)
  if (sheets.length <= 1) {
    return res.status(400).json({ code: 400, message: '至少需要保留一个工作表' })
  }

  const targetSheet = sheets.find(s => s.id === sheetId)
  if (!targetSheet) {
    return res.status(404).json({ code: 404, message: '未找到对应工作表' })
  }

  db.prepare(`DELETE FROM report_cells WHERE report_sheet_id = ?`).run(sheetId)
  db.prepare(`DELETE FROM report_sheets WHERE id = ?`).run(sheetId)

  res.json({ code: 0, message: '删除成功' })
})

router.post('/templates/:code/execute', (req: AuthRequest, res) => {
  const reportCode = String(req.params.code || '').trim()
  const db = getDb()
  const resolvedAccountSetId = resolveAccountSetId(req.accountSetId || '', db)
  const year = Number(req.body?.year) || new Date().getFullYear()
  const period = Number(req.body?.period) || new Date().getMonth() + 1

  if (!reportCode) {
    return res.status(400).json({ code: 400, message: '报表编码不能为空' })
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ code: 400, message: 'year 必须为 2000-2100 的整数' })
  }
  if (!Number.isInteger(period) || period < 1 || period > 12) {
    return res.status(400).json({ code: 400, message: 'period 必须为 1-12 的整数' })
  }

  // 创建进度追踪任务
  const taskId = uuidv4()
  createReportTask(taskId)

  const accountScope = req.accountScope

  // 异步执行报表生成，立即返回任务ID
  setImmediate(async () => {
    try {
      updateReportTask(taskId, { status: 'running', progress: 10, message: '正在加载报表模板...' })

      const definition = getDefinitionByCode(db, resolvedAccountSetId, reportCode)
      if (!definition) {
        updateReportTask(taskId, {
          status: 'failed',
          progress: 20,
          message: '未找到对应报表模板',
          error: '未找到对应报表模板',
        })
        return
      }

      updateReportTask(taskId, { progress: 30, message: '正在加载报表配置...' })

      const sheets = getSheetsByDefinitionId(db, definition.id)
      const cells = getCellsBySheetIds(
        db,
        sheets.map(sheet => sheet.id)
      )
      const cellsBySheetId = new Map<string, ReportCellRow[]>()
      for (const cell of cells) {
        const bucket = cellsBySheetId.get(cell.report_sheet_id)
        if (bucket) {
          bucket.push(cell)
        } else {
          cellsBySheetId.set(cell.report_sheet_id, [cell])
        }
      }

      updateReportTask(taskId, { progress: 50, message: '正在计算报表数据...' })

      const executedSheets = executeTemplateSheets(
        sheets.map(sheet => ({
          ...sheet,
          cells: cellsBySheetId.get(sheet.id) || [],
        })),
        {
          db,
          accountSetId: resolvedAccountSetId,
          year,
          period,
          unitName: (db.prepare('SELECT name FROM account_sets WHERE id = ?').get(resolvedAccountSetId) as any)?.name || '',
          accountScope,
        }
      )

      updateReportTask(taskId, {
        status: 'completed',
        progress: 100,
        message: '报表生成完成',
        result: {
          definition: {
            ...definition,
            is_enabled: Boolean(definition.is_enabled),
          },
          filters: { year, period },
          sheets: executedSheets.map(sheet => ({
            ...sheet,
            metrics: {
              cellCount: sheet.cells.length,
              rowCount:
                sheet.cells.reduce((max: number, cell: any) => Math.max(max, cell.row_index), -1) +
                1,
              colCount:
                sheet.cells.reduce((max: number, cell: any) => Math.max(max, cell.col_index), -1) +
                1,
              errorCount: sheet.cells.filter((cell: any) => cell.status === 'error').length,
            },
          })),
        },
      })
    } catch (error: any) {
      updateReportTask(taskId, {
        status: 'failed',
        progress: 80,
        message: '报表生成失败',
        error: error.message || '未知错误',
      })
    }
  })

  // 立即返回任务ID，前端可轮询进度
  res.json({
    code: 0,
    message: '报表生成任务已创建',
    data: {
      taskId,
      pollUrl: `/api/report/tasks/${taskId}`,
    },
  })
})

// 导出 Excel：基于原始模板回填取数结果（保留格式）
router.get('/templates/:code/export', async (req: AuthRequest, res) => {
  const reportCode = String(req.params.code || '').trim()
  const db = getDb()
  const resolvedAccountSetId = resolveAccountSetId(req.accountSetId || '', db)
  const year = Number(req.query.year) || new Date().getFullYear()
  const period = Number(req.query.period) || new Date().getMonth() + 1

  if (!reportCode) {
    return res.status(400).json({ code: 400, message: '报表编码不能为空' })
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ code: 400, message: 'year 必须为 2000-2100 的整数' })
  }
  if (!Number.isInteger(period) || period < 1 || period > 12) {
    return res.status(400).json({ code: 400, message: 'period 必须为 1-12 的整数' })
  }

  try {
    const { buffer, fileName } = await exportReportTemplateToBuffer({
      db,
      accountSetId: resolvedAccountSetId,
      reportCode,
      year,
      period,
      accountScope: req.accountScope,
    })

    const encodedName = encodeURIComponent(fileName)
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
    res.send(buffer)
  } catch (error: any) {
    const message = error?.message || '导出失败'
    const status = message.includes('未找到') ? 404 : 500
    res.status(status).json({ code: status, message })
  }
})

/**
 * 更新报表模板的元数据（code / name / is_enabled）。
 * - 导航栏按 sort_order ASC 排序，顺序可在「导航顺序」中调整。
 * - 若新 code 已被同账套的另一个报表占用，则**互换**两个报表的 code（用临时值中转，避免 UNIQUE 冲突）。
 * - is_enabled = 0 的报表不会出现在导航栏。
 */
router.patch('/templates/:code/meta', (req: AuthRequest, res) => {
  const currentCode = String(req.params.code || '').trim()
  const db = getDb()
  const accountSetId = resolveAccountSetId(req.accountSetId || '', db)

  if (!currentCode) {
    return res.status(400).json({ code: 400, message: '报表编码不能为空' })
  }

  const current = db
    .prepare(
      'SELECT id, code, name, is_enabled FROM report_definitions WHERE account_set_id = ? AND code = ?'
    )
    .get(accountSetId, currentCode) as
    | { id: string; code: string; name: string; is_enabled: number }
    | undefined

  if (!current) {
    return res.status(404).json({ code: 404, message: '未找到对应的报表模板' })
  }

  const body = (req.body || {}) as {
    code?: unknown
    name?: unknown
    is_enabled?: unknown
  }

  let nextCode: string | null = null
  if (typeof body.code === 'string') {
    const trimmed = body.code.trim()
    if (!trimmed) {
      return res.status(400).json({ code: 400, message: '新编码不能为空' })
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      return res
        .status(400)
        .json({ code: 400, message: '编码只能包含字母、数字、下划线' })
    }
    if (trimmed !== current.code) nextCode = trimmed
  }

  let nextName: string | null = null
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim()
    if (trimmed && trimmed !== current.name) nextName = trimmed
  }

  let nextIsEnabled: number | null = null
  if (body.is_enabled !== undefined) {
    const flag = body.is_enabled === true || body.is_enabled === 1 ? 1 : 0
    if (flag !== current.is_enabled) nextIsEnabled = flag
  }

  if (!nextCode && !nextName && nextIsEnabled === null) {
    return res.json({
      code: 0,
      message: '无变化',
      data: {
        code: current.code,
        name: current.name,
        is_enabled: Boolean(current.is_enabled),
        swapped: false,
      },
    })
  }

  // 检测 code 冲突 → 互换
  let swapTarget: { id: string; code: string; name: string } | null = null
  if (nextCode) {
    const conflict = db
      .prepare(
        'SELECT id, code, name FROM report_definitions WHERE account_set_id = ? AND code = ? AND id != ?'
      )
      .get(accountSetId, nextCode, current.id) as
      | { id: string; code: string; name: string }
      | undefined
    if (conflict) swapTarget = conflict
  }

  try {
    db.transaction(() => {
      if (nextCode && swapTarget) {
        // 互换：current 拿 nextCode，swapTarget 拿 current 原 code（用临时值中转）
        const tempCode = `__SWAP_${current.id}`
        db.prepare(
          `UPDATE report_definitions SET code = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(tempCode, current.id)
        db.prepare(
          `UPDATE report_definitions SET code = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(current.code, swapTarget.id)
        db.prepare(
          `UPDATE report_definitions SET code = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(nextCode, current.id)
      } else if (nextCode) {
        db.prepare(
          `UPDATE report_definitions SET code = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(nextCode, current.id)
      }

      if (nextName) {
        db.prepare(
          `UPDATE report_definitions SET name = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(nextName, current.id)
      }

      if (nextIsEnabled !== null) {
        db.prepare(
          `UPDATE report_definitions SET is_enabled = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(nextIsEnabled, current.id)
      }
    })()
  } catch (error: any) {
    return res.status(500).json({
      code: 500,
      message: error?.message || '更新报表模板失败',
    })
  }

  res.json({
    code: 0,
    message: swapTarget ? `编码已与「${swapTarget.name}」互换` : '更新成功',
    data: {
      code: nextCode || current.code,
      name: nextName || current.name,
      is_enabled: Boolean(nextIsEnabled !== null ? nextIsEnabled : current.is_enabled),
      swapped: Boolean(swapTarget),
      swapWith: swapTarget
        ? {
            code: current.code, // swapTarget 拿到的新 code
            name: swapTarget.name,
            originalCode: swapTarget.code,
          }
        : null,
    },
  })
})

// 删除报表模板（需「报表定义」权限，与报表维护页 /report/dynamic 的访问权限一致；系统管理员 '*' 亦可）
router.delete('/templates/:code', requirePermission('report:define'), (req: AuthRequest, res) => {
  const reportCode = String(req.params.code || '').trim()
  const db = getDb()
  const resolvedAccountSetId = resolveAccountSetId(req.accountSetId || '', db)

  if (!reportCode) {
    return res.status(400).json({ code: 400, message: '报表编码不能为空' })
  }

  const definition = getDefinitionByCode(db, resolvedAccountSetId, reportCode)
  if (!definition) {
    return res.status(404).json({ code: 404, message: '未找到对应的报表模板' })
  }

  db.transaction(() => {
    db.prepare(
      `DELETE FROM report_cells WHERE report_sheet_id IN (SELECT id FROM report_sheets WHERE report_definition_id = ?)`
    ).run(definition.id)
    db.prepare(`DELETE FROM report_sheets WHERE report_definition_id = ?`).run(definition.id)
    db.prepare(`DELETE FROM report_template_sources WHERE report_definition_id = ?`).run(definition.id)
    db.prepare(`DELETE FROM report_definitions WHERE id = ?`).run(definition.id)
  })()

  res.json({ code: 0, message: '报表模板已删除' })
})

export default router
