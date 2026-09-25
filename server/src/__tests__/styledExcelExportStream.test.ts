/**
 * FIX-254：服务端 xlsx 流式写入——标题 / 副标题合并、多级表头合并、数据行样式、小计与合计行、
 * 异步迭代器数据源；生成结果用 ExcelJS 读回逐格核对。
 */
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { buildStyledXlsxBuffer, writeStyledXlsxToStream } from '../services/styledExcelExport.js'
import { PassThrough } from 'node:stream'

const columns = [
  { label: '日期', width: 100 },
  { label: '金额', children: [{ label: '借方', type: 'amount' as const, align: 'right' as const }, { label: '贷方', type: 'amount' as const, align: 'right' as const }] },
]

async function readBack(buffer: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)
  return wb.worksheets[0]
}

describe('writeStyledXlsxToStream', () => {
  it('标题 / 多级表头 / 数据 / 小计 / 合计 逐行正确，合并区正确', async () => {
    const buffer = await buildStyledXlsxBuffer({
      sheetName: '测试',
      title: '标题',
      subtitle: '副标题',
      columns,
      rows: [
        ['2026-01-01', 100, null],
        ['2026-01-02', null, 30.5],
      ],
      subtotalRows: [['小计', 100, 30.5]],
      summaryValues: ['', 100, 30.5],
    })
    const ws = await readBack(buffer)
    expect(ws.name).toBe('测试')
    expect(ws.getCell('A1').value).toBe('标题')
    expect(ws.getCell('A2').value).toBe('副标题')
    expect(ws.getCell('A3').value).toBe('日期')
    expect(ws.getCell('B3').value).toBe('金额')
    expect(ws.getCell('B4').value).toBe('借方')
    expect(ws.getCell('C4').value).toBe('贷方')
    expect(ws.getCell('A5').value).toBe('2026-01-01')
    expect(ws.getCell('B5').value).toBe(100)
    expect(ws.getCell('B5').numFmt).toBe('#,##0.00')
    expect(ws.getCell('C6').value).toBe(30.5)
    expect(ws.getCell('A7').value).toBe('小计')
    expect(ws.getCell('A8').value).toBe('合计')
    expect(ws.getCell('B8').value).toBe(100)
    expect(ws.getCell('B8').font?.bold).toBe(true)
    // 合并：标题、副标题整行；「金额」跨两列；「日期」跨两行
    const merged = new Set<string>()
    for (const m of Object.keys((ws as any)._merges || {})) merged.add(m)
    expect(merged.has('A1')).toBe(true)
    expect(ws.getCell('B1').isMerged).toBe(true)
    expect(ws.getCell('C3').isMerged).toBe(true)
    expect(ws.getCell('A4').isMerged).toBe(true)
    expect(ws.getCell('A5').border?.left?.style).toBe('thin')
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 })
  })

  it('接受异步迭代器数据源并在写入过程中让出事件循环', async () => {
    async function* gen() {
      for (let i = 0; i < 4500; i++) yield [`r${i}`, i, null]
    }
    let ticks = 0
    const timer = setInterval(() => ticks++, 0)
    const sink = new PassThrough()
    const chunks: Buffer[] = []
    sink.on('data', c => chunks.push(c))
    const { rowCount } = await writeStyledXlsxToStream({ columns, rows: gen() }, sink)
    clearInterval(timer)
    expect(rowCount).toBe(4500)
    expect(ticks).toBeGreaterThan(0)
    const ws = await readBack(Buffer.concat(chunks))
    expect(ws.rowCount).toBe(2 + 4500)
    expect(ws.getCell('A4501').value).toBe('r4498')
  })
})
