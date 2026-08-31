import { describe, it, expect } from 'vitest'
import { buildImportSummary } from '../spreadsheetImportReport'

describe('spreadsheetImportReport', () => {
  it('全部失败时提示查看异常说明', () => {
    const s = buildImportSummary({
      contentRowCount: 3,
      validCount: 0,
      issueCount: 3,
      blankSkipped: 0,
      templateWarning: null,
    })
    expect(s.alertType).toBe('error')
    expect(s.hint).toContain('查看异常说明')
  })
})
