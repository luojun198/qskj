import { describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'
import Database from 'better-sqlite3'
import {
  buildExcelStyleKey,
  importExcelReportsFromTemplate,
} from '../services/standardTemplateImport.js'
import { exportReportTemplateToBuffer } from '../services/reportTemplateExport.js'

function createReportImportDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE report_definitions (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      code TEXT,
      name TEXT,
      source TEXT,
      source_file TEXT,
      sort_order INTEGER,
      is_enabled INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE report_sheets (
      id TEXT PRIMARY KEY,
      report_definition_id TEXT,
      sheet_key TEXT,
      sheet_name TEXT,
      sheet_index INTEGER,
      default_col_width INTEGER,
      default_row_height INTEGER,
      col_widths TEXT,
      row_heights TEXT,
      created_at TEXT
    );
    CREATE TABLE report_cells (
      id TEXT PRIMARY KEY,
      report_sheet_id TEXT,
      row_index INTEGER,
      col_index INTEGER,
      cell_type TEXT,
      text_value TEXT,
      formula_text TEXT,
      format_text TEXT,
      style_key TEXT,
      side TEXT,
      col_width INTEGER,
      row_height INTEGER,
      merge_info TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE report_formula_functions (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      function_name TEXT,
      handler_key TEXT,
      description TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE report_template_sources (
      id TEXT PRIMARY KEY,
      report_definition_id TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_type TEXT NOT NULL,
      raw_content TEXT,
      content_encoding TEXT,
      parse_version TEXT,
      created_at TEXT
    );
    CREATE TABLE account_sets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `)
  return db
}

describe('standardTemplateImport', () => {
  it('应把 Excel 字体、对齐、边框和合并信息转换为前端可渲染样式', () => {
    const styleKey = buildExcelStyleKey({
      excelStyle: {
        font: { name: '宋体', size: 24, bold: true },
        alignment: { horizontal: 'centerContinuous', vertical: 'middle' },
        border: {
          top: { style: 'medium' },
          right: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'medium' },
        },
      },
      merge: { rowSpan: 1, colSpan: 8 },
    })

    expect(styleKey).toContain('align-center')
    expect(styleKey).toContain('valign-middle')
    expect(styleKey).toContain('font-bold')
    expect(styleKey).toContain('font-size-24')
    expect(styleKey).toContain('font-family-SimSun')
    expect(styleKey).toContain('border-all')
    expect(styleKey).toContain('border-width-2')
  })

  it('应跳过合并覆盖格并识别表头日期横向合并', async () => {
    const templatePath = resolve(
      process.cwd(),
      '..',
      '标准模版',
      '新企业会计准则',
      '资产负债表已执行新金融.xlsx'
    )
    expect(existsSync(templatePath)).toBe(true)

    const db = createReportImportDb()
    try {
      await importExcelReportsFromTemplate(db, 'account-set-1', [
        { name: '资产负债表', path: templatePath },
      ])
      const headerCells = db
        .prepare(
          `
          SELECT row_index, col_index, merge_info, text_value
          FROM report_cells rc
          JOIN report_sheets rs ON rs.id = rc.report_sheet_id
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ? AND rc.row_index = 1
          ORDER BY rc.col_index
          `
        )
        .all('account-set-1') as Array<{
        row_index: number
        col_index: number
        merge_info: string | null
        text_value: string | null
      }>

      expect(headerCells).toHaveLength(1)
      expect(headerCells[0].col_index).toBe(0)
      expect(JSON.parse(headerCells[0].merge_info || '{}').colSpan).toBeGreaterThanOrEqual(8)

      const dateCell = db
        .prepare(
          `
          SELECT merge_info, text_value
          FROM report_cells rc
          JOIN report_sheets rs ON rs.id = rc.report_sheet_id
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ? AND rc.row_index = 2 AND rc.col_index = 3
          `
        )
        .get('account-set-1') as { merge_info: string | null; text_value: string | null }

      expect(dateCell.text_value).toContain('%y')
      expect(JSON.parse(dateCell.merge_info || '{}').colSpan).toBeGreaterThan(1)

      const taxpayerCell = db
        .prepare(
          `
          SELECT merge_info, style_key, text_value
          FROM report_cells rc
          JOIN report_sheets rs ON rs.id = rc.report_sheet_id
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ? AND rc.row_index = 2 AND rc.col_index = 0
          `
        )
        .get('account-set-1') as {
        merge_info: string | null
        style_key: string | null
        text_value: string | null
      }

      expect(taxpayerCell.text_value).toContain('纳税人')
      expect(JSON.parse(taxpayerCell.merge_info || '{}').colSpan).toBe(3)
      expect(taxpayerCell.style_key).toContain('align-left')

      const formCodeCell = db
        .prepare(
          `
          SELECT text_value, style_key
          FROM report_cells rc
          JOIN report_sheets rs ON rs.id = rc.report_sheet_id
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ? AND rc.row_index = 2 AND rc.col_index = 7
          `
        )
        .get('account-set-1') as { text_value: string | null; style_key: string | null }

      expect(formCodeCell.text_value).toContain('会企01表')
      expect(formCodeCell.style_key).toContain('align-right')

      const unitRowCell = db
        .prepare(
          `
          SELECT merge_info, text_value, style_key
          FROM report_cells rc
          JOIN report_sheets rs ON rs.id = rc.report_sheet_id
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ? AND rc.row_index = 3 AND rc.col_index = 0
          `
        )
        .get('account-set-1') as {
        merge_info: string | null
        text_value: string | null
        style_key: string | null
      }

      expect(JSON.parse(unitRowCell.merge_info || '{}').colSpan).toBe(7)

      const unitCell = db
        .prepare(
          `
          SELECT text_value, style_key
          FROM report_cells rc
          JOIN report_sheets rs ON rs.id = rc.report_sheet_id
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ? AND rc.row_index = 3 AND rc.col_index = 7
          `
        )
        .get('account-set-1') as { text_value: string | null; style_key: string | null }

      expect(unitCell.text_value).toContain('单位')
      expect(unitCell.style_key).toContain('align-right')
    } finally {
      db.close()
    }
  })

  it('不应导入 Excel 尾部仅带格式的空白行', async () => {
    const templatePath = resolve(process.cwd(), '..', '标准模版', '新企业会计准则', '利润表.xlsx')
    expect(existsSync(templatePath)).toBe(true)

    const db = createReportImportDb()
    try {
      const stats = await importExcelReportsFromTemplate(db, 'account-set-1', [
        { name: '利润表', path: templatePath },
      ])
      const maxRow = db
        .prepare(
          `
          SELECT MAX(rc.row_index) as max_row
          FROM report_cells rc
          JOIN report_sheets rs ON rs.id = rc.report_sheet_id
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ?
          `
        )
        .get('account-set-1') as { max_row: number | null }
      const sheetCount = db
        .prepare(
          `
          SELECT COUNT(*) as count
          FROM report_sheets rs
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ?
          `
        )
        .get('account-set-1') as { count: number }

      expect(stats.success).toBe(1)
      expect(sheetCount.count).toBe(1)
      expect(maxRow.max_row).not.toBeNull()
      expect(maxRow.max_row || 0).toBeLessThan(100)
    } finally {
      db.close()
    }
  })

  it('小企业现金流量表应把跨列居中读取为前端合并格式', async () => {
    const templatePath = resolve(process.cwd(), '..', '标准模版', '小企业会计准则', '现金流量表.xlsx')
    expect(existsSync(templatePath)).toBe(true)

    const db = createReportImportDb()
    try {
      const stats = await importExcelReportsFromTemplate(db, 'account-set-1', [
        { name: '现金流量表', path: templatePath },
      ])
      expect(stats.success).toBe(1)

      const titleCells = db
        .prepare(
          `
          SELECT row_index, col_index, merge_info, text_value
          FROM report_cells rc
          JOIN report_sheets rs ON rs.id = rc.report_sheet_id
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ? AND rc.row_index = 1
          ORDER BY rc.col_index
          `
        )
        .all('account-set-1') as Array<{
        row_index: number
        col_index: number
        merge_info: string | null
        text_value: string | null
      }>

      expect(titleCells).toHaveLength(1)
      expect(titleCells[0].col_index).toBe(0)
      expect(titleCells[0].text_value?.replace(/\s+/g, '')).toContain('现金流量表')
      expect(JSON.parse(titleCells[0].merge_info || '{}').colSpan).toBe(4)

      const formCodeCell = db
        .prepare(
          `
          SELECT col_index, merge_info, text_value
          FROM report_cells rc
          JOIN report_sheets rs ON rs.id = rc.report_sheet_id
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ? AND rc.row_index = 2 AND rc.col_index = 3
          `
        )
        .get('account-set-1') as { col_index: number; merge_info: string | null; text_value: string | null }

      expect(formCodeCell.text_value).toContain('会小企03表')
      expect(formCodeCell.merge_info).toBeNull()

      const mergedCells = db
        .prepare(
          `
          SELECT merge_info
          FROM report_cells rc
          JOIN report_sheets rs ON rs.id = rc.report_sheet_id
          JOIN report_definitions rd ON rd.id = rs.report_definition_id
          WHERE rd.account_set_id = ? AND rc.merge_info IS NOT NULL
          `
        )
        .all('account-set-1') as Array<{ merge_info: string }>

      expect(
        mergedCells.some(cell => {
          const merge = JSON.parse(cell.merge_info)
          return merge.colSpan === 1 && merge.rowSpan === 1
        })
      ).toBe(false)
    } finally {
      db.close()
    }
  })

  it('标准模版导入应保存 Excel 副本，磁盘路径失效后仍可导出', async () => {
    const templatePath = resolve(
      process.cwd(),
      '..',
      '标准模版',
      '新企业会计准则',
      '资产负债表已执行新金融.xlsx'
    )
    if (!existsSync(templatePath)) return

    const db = createReportImportDb()
    try {
      db.prepare('INSERT INTO account_sets (id, name) VALUES (?, ?)').run('account-set-1', '测试账套')

      const stats = await importExcelReportsFromTemplate(db, 'account-set-1', [
        { name: '资产负债表', path: templatePath },
      ])
      expect(stats.success).toBe(1)

      const sourceCount = db
        .prepare('SELECT COUNT(*) as count FROM report_template_sources')
        .get() as { count: number }
      expect(sourceCount.count).toBeGreaterThan(0)

      const definition = db
        .prepare('SELECT id, code FROM report_definitions WHERE account_set_id = ? LIMIT 1')
        .get('account-set-1') as { id: string; code: string }

      db.prepare('UPDATE report_definitions SET source_file = ? WHERE id = ?').run(
        'Z:\\not-exists\\missing-template.xlsx',
        definition.id
      )

      const result = await exportReportTemplateToBuffer({
        db,
        accountSetId: 'account-set-1',
        reportCode: definition.code,
        year: 2026,
        period: 5,
      })

      expect(result.buffer.length).toBeGreaterThan(1000)
    } finally {
      db.close()
    }
  })
})
