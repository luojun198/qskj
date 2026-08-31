/**
 * 修正行政事业单位资产负债表标准模版公式：
 * - B19/C19 流动资产合计纳入 B5/C5（货币资金）
 * - E26/F26 非流动负债合计改为汇总 E21:E25，避免与 E27 受托代理负债重复取 2901
 */
const ExcelJS = require('exceljs')
const path = require('path')
const fs = require('fs')

const targets = [
  path.join(__dirname, '../标准模版/行政事业单位/资产负债表.xlsx'),
]

async function patchWorkbook(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log('skip missing', filePath)
    return
  }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error(`no sheet: ${filePath}`)

  const b19 = ws.getCell('B19')
  const c19 = ws.getCell('C19')
  const e26 = ws.getCell('E26')
  const f26 = ws.getCell('F26')

  const oldB19 = '=B6+B7+B8+B9+B10+B11+B12+B13+B14+B15+B16+B17+B18'
  const newB19 = '=B5+B6+B7+B8+B9+B10+B11+B12+B13+B14+B15+B16+B17+B18'
  const oldC19 = '=C6+C7+C8+C9+C10+C11+C12+C13+C14+C15+C16+C17+C18'
  const newC19 = '=C5+C6+C7+C8+C9+C10+C11+C12+C13+C14+C15+C16+C17+C18'

  if (String(b19.formula || b19.value || '') === oldB19) {
    b19.value = { formula: newB19 }
  }
  if (String(c19.formula || c19.value || '') === oldC19) {
    c19.value = { formula: newC19 }
  }

  const e26Text = String(e26.formula || e26.value || '')
  if (e26Text.includes('2901') || e26Text === oldB19.replace(/B/g, 'E').replace('19', '26')) {
    // only patch when still pointing at 2901
  }
  if (/2901/.test(e26Text)) {
    e26.value = { formula: '=E21+E22+E23+E24+E25' }
  }
  const f26Text = String(f26.formula || f26.value || '')
  if (/2901/.test(f26Text)) {
    f26.value = { formula: '=F21+F22+F23+F24+F25' }
  }

  await wb.xlsx.writeFile(filePath)
  console.log('patched', filePath)
}

;(async () => {
  for (const file of targets) {
    await patchWorkbook(file)
  }
})().catch(err => {
  console.error(err)
  process.exit(1)
})
