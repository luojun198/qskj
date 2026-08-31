import type { Database as SqliteDatabase } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import iconv from 'iconv-lite'

import { parseAcdFileTables, splitTableRows } from '../scripts/importAcdToCurrentAccountSet.js'
import { fixCashFlowReportFormulas } from '../scripts/fixCashFlowReportFormulas.js'
import { fixBudgetSurplusReportFormulas } from '../scripts/fixBudgetSurplusReportFormulas.js'

type ParsedAcdCell = {
  rowIndex: number
  colIndex: number
  cellType: 'text' | 'formula'
  textValue: string | null
  formulaText: string | null
}

type ParsedAcdSheet = {
  name: string
  index: number
  cells: ParsedAcdCell[]
}

type ParsedAcdTemplate = {
  reportCode: string
  reportName: string
  sourceFile: string
  sheets: ParsedAcdSheet[]
}

type BinaryCellRecord = ParsedAcdCell & {
  offset: number
}

type SyncStats = {
  matchedReports: number
  matchedSheets: number
  updatedCells: number
  insertedCells: number
  skippedUnsupportedFormulas: number
  warnings: string[]
}

function getBaseFileName(value: string) {
  return value.replace(/^.*[\\/]/, '').toLowerCase()
}

function normalizeReportName(value: string) {
  return value
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .replace(/表$/u, '')
    .trim()
}

function normalizeAnchorText(value: string) {
  return value
    .replace(/\u3000/g, ' ')
    .replace(/[：﹕]/g, ':')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, '')
    .trim()
}

function isSheetTitleCell(cell: BinaryCellRecord) {
  if (cell.cellType !== 'text') return false
  if (cell.rowIndex !== 0 || cell.colIndex !== 0) return false
  const text = String(cell.textValue || '').trim()
  if (!text) return false
  return /表|差异/u.test(text)
}

function getCellAddress(rowIndex: number, colIndex: number) {
  let value = colIndex + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return `${result}${rowIndex + 1}`
}

function stripOuterParentheses(value: string) {
  let result = value.trim()
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let wrapped = true
    for (let index = 0; index < result.length; index += 1) {
      const char = result[index]
      if (char === '(') depth += 1
      if (char === ')') depth -= 1
      if (depth === 0 && index < result.length - 1) {
        wrapped = false
        break
      }
    }
    if (!wrapped) break
    result = result.slice(1, -1).trim()
  }
  return result
}

function formatNumericLiteral(value: number) {
  if (Number.isInteger(value)) {
    return String(value)
  }
  return String(Number(value.toFixed(12)))
}

function decodeCompiledFormula(tokens: Buffer) {
  const stack: string[] = []

  for (let index = 0; index < tokens.length; ) {
    const opcode = tokens[index]

    if (opcode === 0x44) {
      if (index + 3 >= tokens.length) return null
      const rowIndex = tokens.readUInt16LE(index + 1) & 0x3fff
      const colIndex = tokens[index + 3] & 0x3f
      stack.push(getCellAddress(rowIndex, colIndex))
      index += 4
      continue
    }

    if (opcode === 0x1e) {
      if (index + 2 >= tokens.length) return null
      stack.push(String(tokens.readInt16LE(index + 1)))
      index += 3
      continue
    }

    if (opcode === 0x1f) {
      if (index + 8 >= tokens.length) return null
      stack.push(formatNumericLiteral(tokens.readDoubleLE(index + 1)))
      index += 9
      continue
    }

    if (opcode === 0x03 || opcode === 0x04 || opcode === 0x05 || opcode === 0x06) {
      const right = stack.pop()
      const left = stack.pop()
      if (!left || !right) return null
      const operator = opcode === 0x03
        ? '+'
        : opcode === 0x04
          ? '-'
          : opcode === 0x05
            ? '*'
            : '/'
      stack.push(`(${left}${operator}${right})`)
      index += 1
      continue
    }

    return null
  }

  if (stack.length !== 1) {
    return null
  }

  return `=${stripOuterParentheses(stack[0])}`
}

function parseTextRecords(buffer: Buffer): BinaryCellRecord[] {
  const records: BinaryCellRecord[] = []

  for (let offset = 0; offset <= buffer.length - 10; offset += 1) {
    if (buffer[offset] !== 0x04) continue
    const recordLength = buffer[offset + 1]
    if (recordLength < 8 || offset + 2 + recordLength > buffer.length) continue

    const rowIndex = buffer.readUInt16LE(offset + 2)
    const colIndex = buffer.readUInt16LE(offset + 4)
    const style = buffer.readUInt16LE(offset + 6)
    const textLength = buffer.readUInt16LE(offset + 8)

    if (rowIndex === 0 || colIndex > 64 || style > 0x2000) continue
    if (textLength <= 0 || textLength !== recordLength - 8 || textLength > 240) continue

    const rawText = iconv
      .decode(buffer.subarray(offset + 10, offset + 10 + textLength), 'gb18030')
      .replace(/\0/g, '')
      .trim()

    if (!rawText || /[\ue000-\uf8ff]/u.test(rawText)) continue

    const isFormula = rawText.startsWith('@') || rawText.startsWith('=')
    records.push({
      offset,
      rowIndex: rowIndex - 1,
      colIndex,
      cellType: isFormula ? 'formula' : 'text',
      textValue: isFormula ? null : rawText,
      formulaText: isFormula ? rawText : null,
    })
  }

  return records
}

function parseCompiledFormulaRecords(buffer: Buffer, warnings: string[]): BinaryCellRecord[] {
  const records: BinaryCellRecord[] = []

  for (let offset = 0; offset <= buffer.length - 26; offset += 1) {
    if (buffer[offset] !== 0x06) continue
    const recordLength = buffer[offset + 1]
    if (recordLength < 24 || offset + 2 + recordLength > buffer.length) continue

    const rowIndex = buffer.readUInt16LE(offset + 2)
    const colIndex = buffer.readUInt16LE(offset + 4)
    const style = buffer.readUInt16LE(offset + 6)
    const tokenLength = buffer.readUInt16LE(offset + 24)

    if (rowIndex === 0 || colIndex > 64 || style > 0x2000) continue
    if (tokenLength <= 0 || tokenLength > recordLength - 24) continue

    const tokenBuffer = buffer.subarray(offset + 26, offset + 26 + tokenLength)
    const formulaText = decodeCompiledFormula(tokenBuffer)

    if (!formulaText) {
      warnings.push(`未解析公式记录: row=${rowIndex} col=${colIndex} len=${tokenLength}`)
      continue
    }

    records.push({
      offset,
      rowIndex: rowIndex - 1,
      colIndex,
      cellType: 'formula',
      textValue: null,
      formulaText,
    })
  }

  return records
}

function parseVtsSheets(buffer: Buffer, fallbackName: string, warnings: string[]) {
  const records = [
    ...parseTextRecords(buffer),
    ...parseCompiledFormulaRecords(buffer, warnings),
  ].sort((left, right) => left.offset - right.offset)

  if (records.length === 0) {
    return [] as ParsedAcdSheet[]
  }

  const sheets: ParsedAcdSheet[] = []
  let currentSheet: ParsedAcdSheet | null = null

  for (const record of records) {
    if (isSheetTitleCell(record)) {
      if (currentSheet && currentSheet.cells.length > 0) {
        sheets.push(currentSheet)
      }
      currentSheet = {
        name: String(record.textValue || fallbackName),
        index: sheets.length,
        cells: [],
      }
    }

    if (!currentSheet) {
      currentSheet = {
        name: fallbackName,
        index: sheets.length,
        cells: [],
      }
    }

    currentSheet.cells.push({
      rowIndex: record.rowIndex,
      colIndex: record.colIndex,
      cellType: record.cellType,
      textValue: record.textValue,
      formulaText: record.formulaText,
    })
  }

  if (currentSheet && currentSheet.cells.length > 0) {
    sheets.push(currentSheet)
  }

  return sheets
}

export function extractAcdReportTemplates(acdBuffer: Buffer) {
  const { texts, buffers } = parseAcdFileTables(acdBuffer)
  const warnings: string[] = []

  const reportCatalogEntry = Array.from(texts.entries()).find(([fileName]) => /bbml\.txt$/i.test(fileName))
  if (!reportCatalogEntry) {
    return {
      templates: [] as ParsedAcdTemplate[],
      warnings: ['ACD 中缺少 bbml.txt'],
    }
  }

  const reportRows = splitTableRows(reportCatalogEntry[1])
  const templateBuffers = new Map<string, Buffer>()
  for (const [fileName, buffer] of buffers.entries()) {
    const baseFileName = getBaseFileName(fileName)
    if (/^bb[\w]+\.vts$/i.test(baseFileName)) {
      templateBuffers.set(baseFileName, buffer)
    }
  }

  const templates: ParsedAcdTemplate[] = []
  for (const row of reportRows) {
    const reportCode = String(row[0] || '').trim()
    const reportName = String(row[1] || '').trim()
    if (!reportCode || !reportName) continue

    const sourceFile = `bb${reportCode.padStart(5, '0')}.vts`.toLowerCase()
    const buffer = templateBuffers.get(sourceFile)
    if (!buffer) continue

    let sheets: ParsedAcdSheet[]
    try {
      sheets = parseVtsSheets(buffer, reportName, warnings)
    } catch (error) {
      warnings.push(
        `跳过解析失败的报表模板: ${reportName} (${sourceFile}) - ${error instanceof Error ? error.message : String(error)}`
      )
      continue
    }
    const cellCount = sheets.reduce((sum, sheet) => sum + sheet.cells.length, 0)
    if (cellCount === 0) {
      warnings.push(`跳过空报表模板: ${reportName} (${sourceFile})`)
      continue
    }

    templates.push({
      reportCode,
      reportName,
      sourceFile,
      sheets,
    })
  }

  return { templates, warnings }
}

function getMatchedDefinitionIds(
  db: SqliteDatabase,
  accountSetId: string,
  reportName: string
) {
  const normalizedTarget = normalizeReportName(reportName)
  const definitions = db
    .prepare(
      `
      SELECT id, code, name
      FROM report_definitions
      WHERE account_set_id = ?
      ORDER BY sort_order ASC, created_at ASC, code ASC
      `
    )
    .all(accountSetId) as Array<{ id: string; code: string; name: string }>

  return definitions.filter(definition => normalizeReportName(definition.name) === normalizedTarget)
}

function getSheetIdsByDefinition(db: SqliteDatabase, definitionId: string) {
  return db
    .prepare(
      `
      SELECT id, sheet_index
      FROM report_sheets
      WHERE report_definition_id = ?
      ORDER BY sheet_index ASC
      `
    )
    .all(definitionId) as Array<{ id: string; sheet_index: number }>
}

/**
 * 把锚点位置按 (行,列) 去重后加入桶。
 * ACD（.vts 二进制）解析时同一文本单元格常被重复记录多次（同一行列出现 2~3 次），
 * 若不去重，下面「锚点必须在源/目标各恰好出现 1 次」的唯一性判断会把所有锚点判为多重并跳过，
 * 导致行偏移检测恒为 0；据此放置 ACD 公式会整体错位一行（典型：资产负债表货币资金上移到「流动资产：」表头行）。
 */
function addAnchorPosition(
  anchors: Map<string, Array<{ rowIndex: number; colIndex: number }>>,
  key: string,
  rowIndex: number,
  colIndex: number
) {
  const bucket = anchors.get(key)
  if (!bucket) {
    anchors.set(key, [{ rowIndex, colIndex }])
    return
  }
  if (bucket.some(pos => pos.rowIndex === rowIndex && pos.colIndex === colIndex)) {
    return
  }
  bucket.push({ rowIndex, colIndex })
}

export function resolveSheetOffset(
  sourceSheet: ParsedAcdSheet,
  targetCells: Array<{
    row_index: number
    col_index: number
    cell_type: string
    text_value: string | null
  }>
) {
  const sourceAnchors = new Map<string, Array<{ rowIndex: number; colIndex: number }>>()
  const targetAnchors = new Map<string, Array<{ rowIndex: number; colIndex: number }>>()

  for (const cell of sourceSheet.cells) {
    if (cell.cellType !== 'text' || !cell.textValue) continue
    const key = normalizeAnchorText(cell.textValue)
    if (!key || key.length < 2) continue
    addAnchorPosition(sourceAnchors, key, cell.rowIndex, cell.colIndex)
  }

  for (const cell of targetCells) {
    if (cell.cell_type === 'formula' || !cell.text_value) continue
    const key = normalizeAnchorText(cell.text_value)
    if (!key || key.length < 2) continue
    addAnchorPosition(targetAnchors, key, cell.row_index, cell.col_index)
  }

  const deltaCounts = new Map<string, number>()
  for (const [key, sourcePositions] of sourceAnchors.entries()) {
    const targetPositions = targetAnchors.get(key)
    if (!targetPositions) continue
    if (sourcePositions.length !== 1 || targetPositions.length !== 1) continue

    const deltaRow = targetPositions[0].rowIndex - sourcePositions[0].rowIndex
    const deltaCol = targetPositions[0].colIndex - sourcePositions[0].colIndex
    const deltaKey = `${deltaRow}:${deltaCol}`
    deltaCounts.set(deltaKey, (deltaCounts.get(deltaKey) || 0) + 1)
  }

  let bestRowDelta = 0
  let bestColDelta = 0
  let bestCount = 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (const [deltaKey, count] of deltaCounts.entries()) {
    const [rowPart, colPart] = deltaKey.split(':')
    const rowDelta = Number(rowPart)
    const colDelta = Number(colPart)
    const distance = Math.abs(rowDelta) + Math.abs(colDelta)
    if (
      count > bestCount ||
      (count === bestCount && distance < bestDistance)
    ) {
      bestRowDelta = rowDelta
      bestColDelta = colDelta
      bestCount = count
      bestDistance = distance
    }
  }

  return {
    rowDelta: bestRowDelta,
    colDelta: bestColDelta,
    matchCount: bestCount,
  }
}

export function syncAcdReportFormulasToAccountSet(
  db: SqliteDatabase,
  accountSetId: string,
  acdBuffer: Buffer
) {
  const { templates, warnings } = extractAcdReportTemplates(acdBuffer)
  const stats: SyncStats = {
    matchedReports: 0,
    matchedSheets: 0,
    updatedCells: 0,
    insertedCells: 0,
    skippedUnsupportedFormulas: warnings.filter(item => item.startsWith('未解析公式记录')).length,
    warnings: [...warnings],
  }

  const updateCell = db.prepare(
    `
    UPDATE report_cells
    SET cell_type = 'formula',
        text_value = NULL,
        formula_text = ?,
        updated_at = datetime('now')
    WHERE id = ?
    `
  )

  const insertCell = db.prepare(
    `
    INSERT INTO report_cells (
      id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text,
      format_text, style_key, side, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'formula', NULL, ?, NULL, NULL, NULL, datetime('now'), datetime('now'))
    `
  )

  const clearFormulaCell = db.prepare(
    `
    UPDATE report_cells
    SET cell_type = CASE
          WHEN text_value IS NULL OR trim(text_value) = '' THEN 'empty'
          ELSE 'text'
        END,
        formula_text = NULL,
        updated_at = datetime('now')
    WHERE report_sheet_id = ?
      AND row_index = ?
      AND col_index = ?
      AND cell_type = 'formula'
    `
  )

  const transaction = db.transaction(() => {
    for (const template of templates) {
      const definitionIds = getMatchedDefinitionIds(db, accountSetId, template.reportName)
      if (definitionIds.length === 0) {
        continue
      }

      for (const definition of definitionIds) {
        stats.matchedReports += 1
        const sheets = getSheetIdsByDefinition(db, definition.id)
        const sheetCount = Math.min(sheets.length, template.sheets.length)
        stats.matchedSheets += sheetCount

        for (let index = 0; index < sheetCount; index += 1) {
          const targetSheet = sheets[index]
          const sourceSheet = template.sheets[index]
          const existingCells = db
            .prepare(
              `
              SELECT id, row_index, col_index, formula_text, cell_type, text_value
              FROM report_cells
              WHERE report_sheet_id = ?
              `
            )
            .all(targetSheet.id) as Array<{
            id: string
            row_index: number
            col_index: number
            formula_text: string | null
            cell_type: string
            text_value: string | null
          }>

          const { rowDelta, colDelta, matchCount } = resolveSheetOffset(sourceSheet, existingCells)
          if ((rowDelta !== 0 || colDelta !== 0) && matchCount > 0) {
            stats.warnings.push(
              `报表 ${template.reportName} 第 ${index + 1} 个工作表应用坐标偏移 row=${rowDelta}, col=${colDelta}`
            )
          }

          const existingCellMap = new Map(
            existingCells.map(cell => [`${cell.row_index}:${cell.col_index}`, cell])
          )
          const processedKeys = new Set<string>()
          const offsetApplied = rowDelta !== 0 || colDelta !== 0

          if (offsetApplied) {
            // 仅清理「上一次同步因偏移错位而残留的同一条 ACD 公式」，避免误删 Excel 模板
            // 在 ACD 公式原始行位上合法存在的小计公式（如「非流动负债合计」=E22+E23+E24+E25，
            // 该公式不在 ACD 中，但其行号恰好与某条 ACD 数据公式的原始行重合）。
            for (const cell of sourceSheet.cells) {
              if (!cell.formulaText) continue
              const rawKey = `${cell.rowIndex}:${cell.colIndex}`
              const existing = existingCellMap.get(rawKey)
              if (!existing || existing.cell_type !== 'formula') continue
              if (existing.formula_text !== cell.formulaText) continue
              clearFormulaCell.run(targetSheet.id, cell.rowIndex, cell.colIndex)
            }
          }

          for (const cell of sourceSheet.cells) {
            if (!cell.formulaText) continue

            const targetRowIndex = cell.rowIndex + rowDelta
            const targetColIndex = cell.colIndex + colDelta
            if (targetRowIndex < 0 || targetColIndex < 0) {
              continue
            }

            const key = `${targetRowIndex}:${targetColIndex}`
            if (processedKeys.has(key)) {
              continue
            }
            processedKeys.add(key)
            const existing = existingCellMap.get(key)

            if (existing) {
              if (
                !offsetApplied &&
                existing.cell_type === 'formula' &&
                existing.formula_text === cell.formulaText
              ) {
                continue
              }
              const result = updateCell.run(cell.formulaText, existing.id)
              stats.updatedCells += result.changes
              continue
            }

            insertCell.run(
              uuidv4(),
              targetSheet.id,
              targetRowIndex,
              targetColIndex,
              cell.formulaText
            )
            stats.insertedCells += 1
          }
        }
      }
    }
  })

  transaction()
  fixCashFlowReportFormulas(accountSetId, db)
  fixBudgetSurplusReportFormulas(accountSetId, db)

  // 按 ACD 目录顺序重排报表 sort_order，使导入结果与模板原始顺序一致
  const updateSortOrder = db.prepare(
    `UPDATE report_definitions SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND account_set_id = ?`
  )
  const reassignOrder = db.transaction(() => {
    const matchedIds = new Set<string>()
    let idx = 1
    for (const template of templates) {
      const defs = getMatchedDefinitionIds(db, accountSetId, template.reportName)
      for (const def of defs) {
        updateSortOrder.run(idx, def.id, accountSetId)
        matchedIds.add(def.id)
        idx++
      }
    }
    // 未匹配到 ACD 目录的报表排在末尾，保持其相对顺序
    const unmatched = db
      .prepare(
        `SELECT id FROM report_definitions WHERE account_set_id = ? ORDER BY sort_order ASC, created_at ASC`
      )
      .all(accountSetId) as Array<{ id: string }>
    for (const row of unmatched) {
      if (!matchedIds.has(row.id)) {
        updateSortOrder.run(idx, row.id, accountSetId)
        idx++
      }
    }
  })
  reassignOrder()

  return stats
}
