import { describe, expect, it } from 'vitest'
import { isImportableExcelFileName } from '../utils/reportTemplateFiles.js'

describe('reportTemplateFiles', () => {
  it('应拒绝 Excel 临时锁文件 ~$', () => {
    expect(isImportableExcelFileName('~$资产负债表已执行新金融.xlsx')).toBe(false)
    expect(isImportableExcelFileName('~$1利润表.xls')).toBe(false)
  })

  it('应接受正常报表 Excel 文件', () => {
    expect(isImportableExcelFileName('1资产负债表已执行新金融.xlsx')).toBe(true)
    expect(isImportableExcelFileName('利润表.XLS')).toBe(true)
  })

  it('应拒绝隐藏文件', () => {
    expect(isImportableExcelFileName('.hidden.xlsx')).toBe(false)
  })
})
