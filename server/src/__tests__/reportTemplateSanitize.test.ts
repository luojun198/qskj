import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { sanitizeTemplateWorkbook } from '../services/reportTemplateSanitize.js'

async function buildFixtureBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const main = wb.addWorksheet('主表')
  main.getCell('A1').value = '科目'
  main.getCell('B1').value = '金额'
  main.getCell('A2').value = '资产'
  main.getCell('B2').value = 100
  main.mergeCells('A1:B1')

  // 内容数据区：A1:B2。下面是"仅有样式无内容"的脏单元格，模拟用户在 Excel
  // 中误操作产生的右下方残留区域
  main.getCell('D10').style = { border: { top: { style: 'thin' } } }
  main.getCell('B50').style = { border: { top: { style: 'thin' } } }

  const note = wb.addWorksheet('备注')
  note.getCell('A1').value = '这个 sheet 应该被删除'

  const extra = wb.addWorksheet('数据2')
  extra.getCell('A1').value = '冗余'

  const ab = await wb.xlsx.writeBuffer()
  return Buffer.from(ab)
}

describe('sanitizeTemplateWorkbook', () => {
  it('应仅保留首个 sheet 并删除其余 sheet', async () => {
    const buffer = await buildFixtureBuffer()
    const sanitized = await sanitizeTemplateWorkbook(buffer)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(sanitized as unknown as ArrayBuffer)

    expect(wb.worksheets).toHaveLength(1)
    expect(wb.worksheets[0].name).toBe('主表')
  })

  it('应清除内容边界外的脏数据', async () => {
    const buffer = await buildFixtureBuffer()
    const sanitized = await sanitizeTemplateWorkbook(buffer)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(sanitized as unknown as ArrayBuffer)
    const ws = wb.worksheets[0]

    // 内容区保留
    expect(ws.getCell('A2').value).toBe('资产')
    expect(ws.getCell('B2').value).toBe(100)

    // 边界外仅有样式的"脏"单元格被清除（样式被重置）
    const d10 = ws.getCell('D10')
    const b50 = ws.getCell('B50')
    expect(d10.value == null || d10.value === '').toBe(true)
    expect(b50.value == null || b50.value === '').toBe(true)
    expect(d10.border?.top).toBeUndefined()
    expect(b50.border?.top).toBeUndefined()
  })

  it('保留 sheet 的 dimension 应被裁剪到内容边界，且关闭网格线', async () => {
    const buffer = await buildFixtureBuffer()
    const sanitized = await sanitizeTemplateWorkbook(buffer)

    const zip = await JSZip.loadAsync(sanitized)
    const sheetFiles = Object.keys(zip.files).filter(n =>
      /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)
    )
    expect(sheetFiles).toHaveLength(1)
    const xml = await zip.files[sheetFiles[0]].async('string')

    // 内容为 A1:B2，dimension 必须被压缩到 B2 而不是延伸到 D10/B50
    expect(xml).toMatch(/<dimension[^>]*\sref="A1:B2"/i)
    // 不应该再有 D10 / B50 这些边界外的 cell ref
    expect(xml).not.toMatch(/r="D10"/)
    expect(xml).not.toMatch(/r="B50"/)
    // sheetView 关闭网格线
    expect(xml).toMatch(/<sheetView[^>]*showGridLines="0"/i)
    // 内容区右侧追加 hidden 列直到 XFD（16384），避免 Excel/WPS 显示右侧空列
    expect(xml).toMatch(/<col[^/]*min="\d+"[^/]*max="16384"[^/]*hidden="1"/)
  })

  it('单 sheet + 无脏数据的模板应保持稳定（幂等）', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('表')
    ws.getCell('A1').value = 'x'
    ws.getCell('B2').value = 1
    const buffer = Buffer.from(await wb.xlsx.writeBuffer())

    const once = await sanitizeTemplateWorkbook(buffer)
    const twice = await sanitizeTemplateWorkbook(once)

    const wb2 = new ExcelJS.Workbook()
    await wb2.xlsx.load(twice as unknown as ArrayBuffer)
    expect(wb2.worksheets).toHaveLength(1)
    expect(wb2.worksheets[0].getCell('A1').value).toBe('x')
    expect(wb2.worksheets[0].getCell('B2').value).toBe(1)
  })
})
