import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  AcdStandardReportImportError,
  deduplicateStandardReportCells,
  persistPreparedAcdStandardReports,
  previewAcdStandardReports,
  type PreparedAcdStandardReport,
} from '../services/acdStandardReportImport.js'

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE rh_standard_reports (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      source_file TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_set_id, code)
    );
    CREATE TABLE rh_standard_report_cells (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      col_index INTEGER NOT NULL,
      text_value TEXT,
      formula_text TEXT,
      UNIQUE(report_id, row_index, col_index)
    );
  `)
}

function report(
  code: string,
  name: string,
  value: string,
  sortOrder: number
): PreparedAcdStandardReport {
  return {
    code,
    name,
    sourceFile: `bb${code.padStart(5, '0')}.vts`,
    sortOrder,
    cells: [
      {
        rowIndex: 0,
        colIndex: 0,
        cellType: 'text',
        textValue: value,
        formulaText: null,
      },
    ],
  }
}

describe('ACD 标准报表选择性导入', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    createSchema(db)
    db.prepare('INSERT INTO account_sets (id, name) VALUES (?, ?)').run('as-1', '测试账套')
  })

  it('同位置公式优先于文本并过滤无效坐标', () => {
    const cells = deduplicateStandardReportCells([
      { rowIndex: 1, colIndex: 1, cellType: 'text', textValue: '旧文本', formulaText: null },
      { rowIndex: 1, colIndex: 1, cellType: 'formula', textValue: null, formulaText: '@ye(1001,99)' },
      { rowIndex: -1, colIndex: 0, cellType: 'text', textValue: '无效', formulaText: null },
    ])

    expect(cells).toHaveLength(1)
    expect(cells[0]?.cellType).toBe('formula')
  })

  it('只更新所选报表并保留原报表 ID，未选报表不变', () => {
    const initial = persistPreparedAcdStandardReports(db, 'as-1', [
      report('1', '资产负债表', '旧资产', 0),
      report('2', '利润表', '旧利润', 1),
    ])
    const oldAssetId = initial.find(item => item.code === '1')?.id
    const oldProfitId = initial.find(item => item.code === '2')?.id

    const updated = persistPreparedAcdStandardReports(
      db,
      'as-1',
      [report('1', '资产负债表（新）', '新资产', 0), report('2', '利润表（新）', '新利润', 1)],
      ['1']
    )

    expect(updated).toEqual([{ id: oldAssetId, code: '1', name: '资产负债表（新）' }])
    const reports = db
      .prepare('SELECT id, code, name FROM rh_standard_reports ORDER BY code')
      .all() as Array<{ id: string; code: string; name: string }>
    expect(reports).toEqual([
      { id: oldAssetId, code: '1', name: '资产负债表（新）' },
      { id: oldProfitId, code: '2', name: '利润表' },
    ])
    const profitCell = db
      .prepare('SELECT text_value FROM rh_standard_report_cells WHERE report_id = ?')
      .get(oldProfitId) as { text_value: string }
    expect(profitCell.text_value).toBe('旧利润')
  })

  it('伪造或重复报表编码被拒绝且不修改原数据', () => {
    persistPreparedAcdStandardReports(db, 'as-1', [report('1', '资产负债表', '原值', 0)])

    expect(() =>
      persistPreparedAcdStandardReports(db, 'as-1', [report('1', '新报表', '新值', 0)], ['9'])
    ).toThrow(AcdStandardReportImportError)
    expect(() =>
      persistPreparedAcdStandardReports(db, 'as-1', [report('1', '新报表', '新值', 0)], ['1', '1'])
    ).toThrow('选择的报表编码不能重复')

    const row = db
      .prepare(
        `SELECT r.name, c.text_value
         FROM rh_standard_reports r
         JOIN rh_standard_report_cells c ON c.report_id = r.id
         WHERE r.account_set_id = ? AND r.code = ?`
      )
      .get('as-1', '1') as { name: string; text_value: string }
    expect(row).toEqual({ name: '资产负债表', text_value: '原值' })
  })

  it('缺少报表目录时返回空预览和明确警告', () => {
    const preview = previewAcdStandardReports(Buffer.from('invalid-acd'))
    expect(preview.reports).toEqual([])
    expect(preview.warnings).toContain('ACD 中缺少 bbml.txt')
  })
})
