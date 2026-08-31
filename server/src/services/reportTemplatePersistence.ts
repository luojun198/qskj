import { v4 as uuidv4 } from 'uuid'
import type { Database } from 'better-sqlite3'

const EXCEL_SOURCE_PARSE_VERSION = 'uploaded-excel-v1'

/** 将 Excel 原始二进制保存到 report_template_sources，供导出时回填版式 */
export function saveReportTemplateExcelSource(
  db: Database,
  definitionId: string,
  sourceFileLabel: string,
  buffer: Buffer
) {
  db.prepare(`DELETE FROM report_template_sources WHERE report_definition_id = ?`).run(definitionId)
  db.prepare(
    `INSERT INTO report_template_sources
     (id, report_definition_id, source_file, source_type, raw_content, content_encoding, parse_version, created_at)
     VALUES (?, ?, ?, 'xls', ?, 'base64', ?, datetime('now'))`
  ).run(uuidv4(), definitionId, sourceFileLabel, buffer.toString('base64'), EXCEL_SOURCE_PARSE_VERSION)
}

/** 读取已保存的 Excel 模板二进制（优先最新一条 xls 来源） */
export function loadReportTemplateExcelSource(
  db: Database,
  definitionId: string
): { buffer: Buffer; sourceFile: string } | null {
  const row = db
    .prepare(
      `
      SELECT source_file, raw_content, content_encoding
      FROM report_template_sources
      WHERE report_definition_id = ?
        AND source_type = 'xls'
        AND raw_content IS NOT NULL
        AND length(trim(raw_content)) > 0
      ORDER BY created_at DESC
      LIMIT 1
      `
    )
    .get(definitionId) as
    | { source_file: string; raw_content: string; content_encoding: string | null }
    | undefined

  if (!row?.raw_content) return null

  const buffer =
    row.content_encoding === 'base64'
      ? Buffer.from(row.raw_content, 'base64')
      : Buffer.from(row.raw_content, 'utf8')

  if (buffer.length === 0) return null

  return { buffer, sourceFile: row.source_file }
}
