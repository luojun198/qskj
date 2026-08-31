import { existsSync, readdirSync } from 'fs'
import { basename, join } from 'path'

/** Excel 打开文件时生成的临时锁文件（~$xxx.xlsx），不可作为报表模板导入 */
export function isImportableExcelFileName(fileName: string): boolean {
  const base = basename(fileName)
  if (!base || base.startsWith('~$') || base.startsWith('.')) {
    return false
  }
  return /\.(xls|xlsx)$/i.test(base)
}

export interface ExcelTemplateFile {
  name: string
  path: string
}

/** 从目录扫描可导入的 Excel 报表模板（排除 ~$ 临时文件） */
export function listImportableExcelFiles(dir: string): ExcelTemplateFile[] {
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter(isImportableExcelFileName)
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' }))
    .map(fileName => ({
      name: fileName.replace(/\.(xls|xlsx)$/i, ''),
      path: join(dir, fileName),
    }))
}
