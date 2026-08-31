import { describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'
import Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import xlsx from 'xlsx'
import { exportReportTemplateToBuffer, resolveTemplateFilePath } from '../services/reportTemplateExport.js'

describe('resolveTemplateFilePath', () => {
  it('应能按文件名在标准模版目录中找到资产负债表模板', () => {
    const path = resolveTemplateFilePath('资产负债表已执行新金融.xlsx')
    expect(path).toBeTruthy()
    expect(existsSync(path!)).toBe(true)
    expect(path).toContain('资产负债表')
  })

  it('应能解析绝对路径', () => {
    const absolute = resolve(
      process.cwd(),
      '..',
      '标准模版',
      '新企业会计准则',
      '资产负债表已执行新金融.xlsx'
    )
    if (!existsSync(absolute)) return
    expect(resolveTemplateFilePath(absolute)).toBe(absolute)
  })

  it('source_file 文件丢失时应能从数据库保存的上传 Excel 内容导出', async () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE account_sets (
          id TEXT PRIMARY KEY,
          name TEXT
        );
        CREATE TABLE report_definitions (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          source_file TEXT
        );
        CREATE TABLE report_sheets (
          id TEXT PRIMARY KEY,
          report_definition_id TEXT NOT NULL,
          sheet_name TEXT NOT NULL,
          sheet_index INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE report_cells (
          id TEXT PRIMARY KEY,
          report_sheet_id TEXT NOT NULL,
          row_index INTEGER NOT NULL,
          col_index INTEGER NOT NULL,
          cell_type TEXT NOT NULL,
          text_value TEXT,
          formula_text TEXT,
          format_text TEXT,
          style_key TEXT,
          side TEXT
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
      `)

      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Sheet1')
      sheet.getCell('A1').value = '原模板标题'
      sheet.getCell('B2').value = '旧值'
      const originalBuffer = Buffer.from(await workbook.xlsx.writeBuffer())

      db.prepare('INSERT INTO account_sets (id, name) VALUES (?, ?)').run('as1', '测试账套')
      db.prepare(
        'INSERT INTO report_definitions (id, account_set_id, code, name, source_file) VALUES (?, ?, ?, ?, ?)'
      ).run('def1', 'as1', 'R1', '测试报表', 'missing-uploaded-template.xlsx')
      db.prepare(
        'INSERT INTO report_sheets (id, report_definition_id, sheet_name, sheet_index) VALUES (?, ?, ?, ?)'
      ).run('sheet1', 'def1', 'Sheet1', 0)
      db.prepare(
        `INSERT INTO report_cells
         (id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, format_text, style_key, side)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('cell1', 'sheet1', 1, 1, 'text', '新导出值', null, null, null, null)
      db.prepare(
        `INSERT INTO report_template_sources
         (id, report_definition_id, source_file, source_type, raw_content, content_encoding, parse_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        'src1',
        'def1',
        'missing-uploaded-template.xlsx',
        'xls',
        originalBuffer.toString('base64'),
        'base64',
        'uploaded-excel-v1'
      )

      const result = await exportReportTemplateToBuffer({
        db,
        accountSetId: 'as1',
        reportCode: 'R1',
        year: 2026,
        period: 5,
      })

      const exported = new ExcelJS.Workbook()
      await exported.xlsx.load(result.buffer)
      const exportedSheet = exported.getWorksheet('Sheet1')
      expect(exportedSheet?.getCell('A1').value).toBe('原模板标题')
      expect(exportedSheet?.getCell('B2').value).toBe('新导出值')
    } finally {
      db.close()
    }
  })

  it('导出时应忽略数据库中超出模板列范围的单元格', async () => {
    const templatePath = resolve(process.cwd(), '..', '标准模版', '行政事业单位', '收入费用表.xlsx')
    if (!existsSync(templatePath)) return

    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE account_sets (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE report_definitions (
          id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, code TEXT NOT NULL,
          name TEXT NOT NULL, source_file TEXT
        );
        CREATE TABLE report_sheets (
          id TEXT PRIMARY KEY, report_definition_id TEXT NOT NULL,
          sheet_name TEXT NOT NULL, sheet_index INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE report_cells (
          id TEXT PRIMARY KEY, report_sheet_id TEXT NOT NULL,
          row_index INTEGER NOT NULL, col_index INTEGER NOT NULL,
          cell_type TEXT NOT NULL, text_value TEXT, formula_text TEXT,
          format_text TEXT, style_key TEXT, side TEXT
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
      `)

      db.prepare('INSERT INTO account_sets (id, name) VALUES (?, ?)').run('as1', '测试账套')
      db.prepare(
        'INSERT INTO report_definitions (id, account_set_id, code, name, source_file) VALUES (?, ?, ?, ?, ?)'
      ).run('def1', 'as1', 'R_INCOME', '收入费用表', templatePath)
      db.prepare(
        'INSERT INTO report_sheets (id, report_definition_id, sheet_name, sheet_index) VALUES (?, ?, ?, ?)'
      ).run('sheet1', 'def1', 'Sheet1', 0)

      const insertCell = db.prepare(
        `INSERT INTO report_cells
         (id, report_sheet_id, row_index, col_index, cell_type, text_value, formula_text, format_text, style_key, side)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      insertCell.run('c1', 'sheet1', 5, 1, 'formula', null, '@jqy(4001,99,99)', null, null, null)
      insertCell.run('c2', 'sheet1', 5, 2, 'formula', null, '@jqy(4001,01,99)', null, null, null)
      insertCell.run('c3', 'sheet1', 5, 3, 'formula', null, '@jqy(4101,01,99)', null, null, null)
      insertCell.run('c4', 'sheet1', 5, 6, 'formula', null, '@JQY(516,99,99)', null, null, null)

      const result = await exportReportTemplateToBuffer({
        db,
        accountSetId: 'as1',
        reportCode: 'R_INCOME',
        year: 2026,
        period: 5,
      })

      const exported = xlsx.read(result.buffer, { type: 'buffer' })
      const sheet = exported.Sheets[exported.SheetNames[0]]
      // 数据库中 D6 / G6 不在模板内容区域，不应被回填到导出文件。
      // 注：维度（!ref）的裁剪已移至导入端净化；此用例直接挂载未净化模板，
      // 故不再断言 !ref；模板维度的整体净化由 sanitize-templates 脚本承担。
      expect(sheet['D6']).toBeUndefined()
      expect(sheet['G6']).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
