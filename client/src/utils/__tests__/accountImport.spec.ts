import { describe, it, expect } from 'vitest'
import {
  buildAccountImportSummary,
  collectAccountImportIssues,
  parseAccountImportRows,
} from '../accountImport'

describe('accountImport', () => {
  it('parseAccountImportRows 检测重复编码与缺必填', () => {
    const { rows } = parseAccountImportRows(
      [
        { 科目编码: '1001', 科目名称: '现金', 余额方向: '借方' },
        { 科目编码: '1001', 科目名称: '重复', 余额方向: '贷方' },
        { 科目名称: '无名', 余额方向: '借方' },
      ],
      {
        existingCodes: new Set(['2001']),
        existingCodeToId: new Map([['2001', 'id-old']]),
        auxCategories: [],
        auxItems: [],
        parseAuxCols: () => null,
        buildAuxDesc: () => '',
      }
    )
    expect(rows).toHaveLength(3)
    expect(rows[0].matched).toBe(true)
    expect(rows[1].matched).toBe(false)
    expect(rows[2].matched).toBe(false)
    expect(collectAccountImportIssues(rows)).toHaveLength(2)
  })

  it('buildAccountImportSummary 模板缺列', () => {
    const s = buildAccountImportSummary({
      contentRowCount: 0,
      validCount: 0,
      issueCount: 0,
      blankSkipped: 0,
      templateWarning: '模板缺少必填列',
    })
    expect(s.alertType).toBe('warning')
  })
})
