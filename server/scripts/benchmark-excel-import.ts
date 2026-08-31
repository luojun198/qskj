import { readFileSync } from 'fs'
import { resolve } from 'path'
import xlsx from 'xlsx'
import { getSheetContentBounds, readExcelStyleBundle } from '../src/services/standardTemplateImport.js'

const file = resolve('../标准模版/行政事业单位/资产负债表.xlsx')
const buf = readFileSync(file)
console.log('size KB:', Math.round(buf.length / 1024))

let t0 = Date.now()
const workbook = xlsx.read(buf, { type: 'buffer', cellStyles: true, codepage: 936 })
console.log('xlsx.read ms:', Date.now() - t0)

const sheetName = workbook.SheetNames[0]
const sheet = workbook.Sheets[sheetName]
const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1')
console.log('sheet ref rows/cols:', range.e.r + 1, range.e.c + 1)
console.log('merges:', (sheet['!merges'] || []).length)

let nonEmpty = 0
for (const key of Object.keys(sheet)) {
  if (key.startsWith('!')) continue
  const cell = (sheet as any)[key]
  if (cell?.v != null && String(cell.v).trim() !== '') nonEmpty++
}
console.log('non-empty cells:', nonEmpty)

const bounds = getSheetContentBounds(sheet)
console.log('content bounds:', bounds)

t0 = Date.now()
const styleBundle = await readExcelStyleBundle(buf, [bounds])
console.log('readExcelStyleBundle ms:', Date.now() - t0)
console.log(
  'styles:',
  styleBundle.stylesBySheet.get(0)?.size ?? 0,
  'merges:',
  styleBundle.mergesBySheet.get(0)?.size ?? 0
)
