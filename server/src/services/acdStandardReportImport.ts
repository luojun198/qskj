import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

import { extractAcdReportTemplates } from './acdReportFormulaSync.js'

export interface AcdStandardReportCell {
  rowIndex: number
  colIndex: number
  cellType: 'text' | 'formula'
  textValue: string | null
  formulaText: string | null
}

export interface PreparedAcdStandardReport {
  code: string
  name: string
  sourceFile: string
  sortOrder: number
  cells: AcdStandardReportCell[]
}

export interface AcdStandardReportSummary {
  code: string
  name: string
  source_file: string
}

export interface ImportedAcdStandardReport {
  id: string
  code: string
  name: string
}

export interface AcdStandardReportPreview {
  reports: AcdStandardReportSummary[]
  warnings: string[]
  prepared: PreparedAcdStandardReport[]
}

export class AcdStandardReportImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcdStandardReportImportError'
  }
}

export function deduplicateStandardReportCells(cells: AcdStandardReportCell[]) {
  const cellMap = new Map<string, AcdStandardReportCell>()
  for (const cell of cells) {
    if (cell.rowIndex < 0 || cell.colIndex < 0) continue
    const key = `${cell.rowIndex}_${cell.colIndex}`
    const existing = cellMap.get(key)
    if (!existing || (cell.cellType === 'formula' && existing.cellType !== 'formula')) {
      cellMap.set(key, cell)
    }
  }
  return Array.from(cellMap.values())
}

export function previewAcdStandardReports(acdBuffer: Buffer): AcdStandardReportPreview {
  let extracted: ReturnType<typeof extractAcdReportTemplates>
  try {
    extracted = extractAcdReportTemplates(acdBuffer)
  } catch (error) {
    throw new AcdStandardReportImportError(
      `ACD 标准报表解析失败: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const { templates, warnings: parserWarnings } = extracted
  const warnings = [...parserWarnings]
  const prepared: PreparedAcdStandardReport[] = []
  const seenCodes = new Set<string>()

  templates.forEach((template, templateIndex) => {
    const code = String(template.reportCode || '').trim()
    if (!code || seenCodes.has(code)) {
      if (code) warnings.push(`跳过重复报表编码: ${code}`)
      return
    }

    const sheet = template.sheets.find(item => item.cells.length > 0)
    const cells = sheet ? deduplicateStandardReportCells(sheet.cells) : []
    if (cells.length === 0) {
      warnings.push(`跳过空报表模板: ${template.reportName} (${template.sourceFile})`)
      return
    }

    seenCodes.add(code)
    prepared.push({
      code,
      name: template.reportName,
      sourceFile: template.sourceFile,
      sortOrder: templateIndex,
      cells,
    })
  })

  return {
    reports: prepared.map(report => ({
      code: report.code,
      name: report.name,
      source_file: report.sourceFile,
    })),
    warnings,
    prepared,
  }
}

export function persistPreparedAcdStandardReports(
  db: Database,
  accountSetId: string,
  prepared: PreparedAcdStandardReport[],
  reportCodes?: string[]
): ImportedAcdStandardReport[] {
  const availableByCode = new Map(prepared.map(report => [report.code, report]))
  const selectedCodes = reportCodes?.map(code => String(code).trim()).filter(Boolean)
  const requestedCodes = selectedCodes?.length ? selectedCodes : prepared.map(report => report.code)

  if (selectedCodes) {
    const uniqueCodes = new Set(selectedCodes)
    if (uniqueCodes.size !== selectedCodes.length) {
      throw new AcdStandardReportImportError('选择的报表编码不能重复')
    }
    const invalidCodes = selectedCodes.filter(code => !availableByCode.has(code))
    if (invalidCodes.length > 0) {
      throw new AcdStandardReportImportError(`ACD 中不存在所选报表: ${invalidCodes.join('、')}`)
    }
  }

  const selectedReports = requestedCodes
    .map(code => availableByCode.get(code))
    .filter((report): report is PreparedAcdStandardReport => !!report)

  if (selectedReports.length === 0) {
    throw new AcdStandardReportImportError('没有可导入的标准报表')
  }

  const existingStmt = db.prepare(
    'SELECT id FROM rh_standard_reports WHERE account_set_id = ? AND code = ?'
  )
  const insertReport = db.prepare(
    `INSERT INTO rh_standard_reports
      (id, account_set_id, code, name, source_file, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  )
  const updateReport = db.prepare(
    `UPDATE rh_standard_reports
     SET name = ?, source_file = ?, sort_order = ?, updated_at = datetime('now')
     WHERE id = ? AND account_set_id = ?`
  )
  const deleteCells = db.prepare('DELETE FROM rh_standard_report_cells WHERE report_id = ?')
  const insertCell = db.prepare(
    `INSERT INTO rh_standard_report_cells
      (id, report_id, row_index, col_index, text_value, formula_text)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  return db.transaction(() => {
    const imported: ImportedAcdStandardReport[] = []
    for (const report of selectedReports) {
      const existing = existingStmt.get(accountSetId, report.code) as { id: string } | undefined
      const reportId = existing?.id || uuidv4()

      if (existing) {
        deleteCells.run(reportId)
        updateReport.run(report.name, report.sourceFile, report.sortOrder, reportId, accountSetId)
      } else {
        insertReport.run(
          reportId,
          accountSetId,
          report.code,
          report.name,
          report.sourceFile,
          report.sortOrder
        )
      }

      for (const cell of report.cells) {
        insertCell.run(
          uuidv4(),
          reportId,
          cell.rowIndex,
          cell.colIndex,
          cell.textValue,
          cell.formulaText
        )
      }

      imported.push({ id: reportId, code: report.code, name: report.name })
    }
    return imported
  })()
}

export function importAcdStandardReports(
  db: Database,
  accountSetId: string,
  acdBuffer: Buffer,
  reportCodes?: string[]
) {
  const preview = previewAcdStandardReports(acdBuffer)
  if (preview.prepared.length === 0) {
    if (reportCodes?.length) {
      throw new AcdStandardReportImportError(
        preview.warnings[0] || 'ACD 中没有可导入的标准报表'
      )
    }
    return { reports: [] as ImportedAcdStandardReport[], warnings: preview.warnings }
  }

  const reports = persistPreparedAcdStandardReports(
    db,
    accountSetId,
    preview.prepared,
    reportCodes
  )
  return { reports, warnings: preview.warnings }
}
