import { describe, expect, it } from 'vitest'

import {
  appendBorderAll,
  buildPrintWorkbook,
  buildReportExportModel,
  buildReportPrintHtml,
  buildReportWorkbook,
  ensureExportTableBorders,
  styleKeyHasBorder,
  type BuildModelOptions,
} from '../standardReportExport'

function makeOptions(overrides: Partial<BuildModelOptions> = {}): BuildModelOptions {
  return {
    name: '资产负债表',
    rowCount: 2,
    colCount: 3,
    getColWidth: index => [120, 80, 200][index] ?? 100,
    getRowHeight: index => [40, 24][index] ?? 24,
    source: [
      { row_index: 0, col_index: 0, merge_info: JSON.stringify({ rowSpan: 1, colSpan: 3 }) },
      { row_index: 1, col_index: 0, style_key: 'align-left font-bold' },
      { row_index: 1, col_index: 1 },
      { row_index: 1, col_index: 2, format_text: '2decimal' },
    ],
    getText: (row, col) => (row === 0 && col === 0 ? '资产负债表' : `r${row}c${col}`),
    ...overrides,
  }
}

describe('buildReportExportModel', () => {
  it('排除被合并覆盖的坐标，只保留左上角', () => {
    const model = buildReportExportModel(makeOptions())
    const firstRow = model.cells.filter(cell => cell.rowIndex === 0)

    expect(firstRow).toHaveLength(1)
    expect(firstRow[0].colSpan).toBe(3)
    expect(firstRow[0].text).toBe('资产负债表')
  })

  it('列宽行高按 colCount / rowCount 逐项取出', () => {
    const model = buildReportExportModel(makeOptions())

    expect(model.colWidths).toEqual([120, 80, 200])
    expect(model.rowHeights).toEqual([40, 24])
  })

  it('数值与错误状态由回调决定', () => {
    const model = buildReportExportModel(
      makeOptions({
        getNumeric: (row, col) => (row === 1 && col === 2 ? 1234.5 : null),
        isError: (row, col) => row === 1 && col === 1,
      })
    )
    const byKey = new Map(model.cells.map(cell => [`${cell.rowIndex}_${cell.colIndex}`, cell]))

    expect(byKey.get('1_2')!.numericValue).toBe(1234.5)
    expect(byKey.get('1_1')!.isError).toBe(true)
    expect(byKey.get('1_0')!.numericValue).toBeNull()
  })
})

describe('buildReportPrintHtml', () => {
  /**
   * 这三条正是 PDF 错位的根因回归：原实现 width:100%、没有 colgroup、内容溢出不裁剪，
   * 渲染器自行分配列宽后文字互相压在一起。
   */
  it('输出 colgroup 且列宽与模型一致', () => {
    const html = buildReportPrintHtml(buildReportExportModel(makeOptions()))

    expect(html).toContain('<colgroup>')
    expect(html).toContain('width:120px;')
    expect(html).toContain('width:80px;')
    expect(html).toContain('width:200px;')
  })

  it('表格用 table-layout:fixed 与固定总宽，而不是百分比宽度', () => {
    const html = buildReportPrintHtml(buildReportExportModel(makeOptions()))

    expect(html).toContain('table-layout:fixed')
    expect(html).toContain('width:400px;') // 120 + 80 + 200
    expect(html).not.toContain('width:100%')
  })

  it('超宽内容在格子内部裁剪，td 本身不写 overflow（否则 Chrome 拆掉 collapse）', () => {
    const html = buildReportPrintHtml(buildReportExportModel(makeOptions()))

    expect(html).toContain('overflow:hidden')
    expect(html).toMatch(/<td[^>]*style="[^"]*box-sizing:border-box/)
    expect(html).not.toMatch(/<td[^>]*style="[^"]*overflow:hidden/)
  })

  it('表格声明 collapse / empty-cells，空的带框格也会画出框线', () => {
    const html = buildReportPrintHtml(buildReportExportModel(makeOptions()))

    expect(html).toContain('border-collapse:collapse')
    expect(html).toContain('empty-cells:show')
    expect(html).toContain('border-spacing:0')
  })

  it('行高写在 tr 上', () => {
    const html = buildReportPrintHtml(buildReportExportModel(makeOptions()))

    expect(html).toContain('height:40px;')
    expect(html).toContain('height:24px;')
  })

  it('合并输出为 colspan / rowspan', () => {
    const html = buildReportPrintHtml(buildReportExportModel(makeOptions()))

    expect(html).toContain('colspan="3"')
  })

  it('缩放用 transform 而不是 zoom（html2canvas 对 zoom 支持不稳）', () => {
    const html = buildReportPrintHtml(buildReportExportModel(makeOptions()), { scale: 0.8 })

    expect(html).toContain('transform:scale(0.8)')
    expect(html).toContain('transform-origin:top left')
    expect(html).not.toContain('zoom:')
  })

  it('scale 为 1 时不包缩放容器', () => {
    const html = buildReportPrintHtml(buildReportExportModel(makeOptions()), { scale: 1 })

    expect(html).not.toContain('transform:scale')
    expect(html.startsWith('<div class="cw-report-print">')).toBe(true)
    expect(html).toContain('<table')
  })

  it('转义 HTML 特殊字符', () => {
    const model = buildReportExportModel(
      makeOptions({ getText: () => '<b>&amp;</b>' })
    )
    const html = buildReportPrintHtml(model)

    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  describe('长标签铺开（Excel 行为）', () => {
    function spillOptions(overrides: Partial<BuildModelOptions> = {}) {
      return makeOptions({
        rowCount: 1,
        colCount: 3,
        getColWidth: () => 100,
        source: [{ row_index: 0, col_index: 0 }],
        getText: (_row, col) => (col === 0 ? '负债和所有者权益(或股东权益)总计' : ''),
        ...overrides,
      })
    }

    it('右侧全空时铺到表尾，宽度扣掉左右内边距', () => {
      const html = buildReportPrintHtml(buildReportExportModel(spillOptions()))

      // 3 列 × 100 - 8×2 = 284
      expect(html).toContain('display:inline-block;width:284px;overflow:hidden;')
    })

    it('遇到第一个有内容的格子就止步，不会压到别人身上', () => {
      const html = buildReportPrintHtml(
        buildReportExportModel(
          spillOptions({
            source: [{ row_index: 0, col_index: 0 }, { row_index: 0, col_index: 2 }],
            getText: (_row, col) => (col === 0 ? '很长很长的标签文字' : col === 2 ? '123' : ''),
          })
        )
      )

      // 只能铺过空的第 1 列：2 × 100 - 16 = 184
      expect(html).toContain('width:184px;')
    })

    it('数字格不铺开 —— 铺开后看不出归属哪一列', () => {
      const html = buildReportPrintHtml(
        buildReportExportModel(
          spillOptions({
            getText: (_row, col) => (col === 0 ? '123.45' : ''),
            getNumeric: (_row, col) => (col === 0 ? 123.45 : null),
          })
        )
      )

      expect(html).not.toContain('inline-block')
    })

    it('居中/右对齐的格子不铺开', () => {
      const html = buildReportPrintHtml(
        buildReportExportModel(
          spillOptions({ source: [{ row_index: 0, col_index: 0, style_key: 'align-center' }] })
        )
      )

      expect(html).not.toContain('inline-block')
    })

    it('右边紧挨着就有内容时不铺开', () => {
      // 三列都有内容，谁都没有可铺开的空间
      const html = buildReportPrintHtml(
        buildReportExportModel(
          spillOptions({ getText: (_row, col) => ['很长的标签', 'x', 'y'][col] })
        )
      )

      expect(html).not.toContain('inline-block')
    })

    it('右侧空格若已有边框也不铺开——行次列不能被项目名盖住', () => {
      const html = buildReportPrintHtml(
        buildReportExportModel(
          spillOptions({
            source: [
              { row_index: 0, col_index: 0, style_key: 'border-all' },
              { row_index: 0, col_index: 1, style_key: 'border-all' },
              { row_index: 0, col_index: 2, style_key: 'border-all' },
            ],
          })
        )
      )

      expect(html).not.toContain('inline-block')
      expect(html).toContain('cw-grid')
      expect(html).toContain('border-right:1px solid #000')
    })

    it('表格主体画连续网格，标题行不加框', () => {
      const html = buildReportPrintHtml(
        buildReportExportModel(
          makeOptions({
            rowCount: 3,
            colCount: 2,
            getColWidth: () => 80,
            getRowHeight: () => 24,
            source: [
              { row_index: 0, col_index: 0, style_key: 'align-center font-bold' },
              { row_index: 1, col_index: 0, style_key: 'border-all' },
              { row_index: 1, col_index: 1, style_key: 'border-all' },
              { row_index: 2, col_index: 0, style_key: 'border-all' },
              { row_index: 2, col_index: 1, style_key: 'align-right' },
            ],
            getText: (row, col) => `r${row}c${col}`,
          })
        )
      )

      expect(html).toContain('class="cw-grid cw-grid-left cw-grid-top"')
      expect(html).toContain('cw-grid-left')
      expect(html.match(/cw-grid/g)?.length).toBeGreaterThan(3)
      expect(html).not.toMatch(/<td[^>]*class="cw-grid[^"]*"[^>]*>[\s\S]*?r0c0/)
    })
  })

  describe('打印前补齐表格主体边框', () => {
    it('识别带框区域，给区域内没框的格子补 border-all，标题行不动', () => {
      const model = ensureExportTableBorders(
        buildReportExportModel(
          makeOptions({
            rowCount: 3,
            colCount: 2,
            getColWidth: () => 80,
            getRowHeight: () => 24,
            source: [
              { row_index: 0, col_index: 0, style_key: 'align-center font-bold' },
              { row_index: 1, col_index: 0, style_key: 'border-all' },
              { row_index: 1, col_index: 1, style_key: 'border-all' },
              { row_index: 2, col_index: 0, style_key: 'border-all' },
              { row_index: 2, col_index: 1, style_key: 'align-right' },
            ],
            getText: (row, col) => `r${row}c${col}`,
          })
        )
      )
      const byKey = new Map(model.cells.map(cell => [`${cell.rowIndex}_${cell.colIndex}`, cell]))

      expect(byKey.get('0_0')!.styleKey).toBe('align-center font-bold')
      expect(byKey.get('2_1')!.styleKey).toBe('align-right border-all')
      expect(byKey.get('1_1')!.styleKey).toBe('border-all')
    })

    it('styleKeyHasBorder 只认真正的边，不认颜色/粗细 token', () => {
      expect(styleKeyHasBorder('border-all')).toBe(true)
      expect(styleKeyHasBorder('align-right border-bottom')).toBe(true)
      expect(styleKeyHasBorder('border-color-FF0000')).toBe(false)
      expect(styleKeyHasBorder(appendBorderAll('align-right'))).toBe(true)
    })
  })

  it('空报表返回空串', () => {
    const model = buildReportExportModel(makeOptions({ rowCount: 0, colCount: 0, source: [] }))

    expect(buildReportPrintHtml(model)).toBe('')
  })
})

describe('buildReportWorkbook', () => {
  it('列宽按 px→字符宽换算，行高按 px→磅换算', () => {
    const sheet = buildReportWorkbook(buildReportExportModel(makeOptions())).worksheets[0]

    // 120px ≈ 17.14 字符宽；40px = 30 磅
    expect(sheet.getColumn(1).width).toBeCloseTo(120 / 7, 1)
    expect(sheet.getColumn(3).width).toBeCloseTo(200 / 7, 1)
    expect(sheet.getRow(1).height).toBeCloseTo(30, 1)
    expect(sheet.getRow(2).height).toBeCloseTo(18, 1)
  })

  it('合并区域被还原', () => {
    const sheet = buildReportWorkbook(buildReportExportModel(makeOptions())).worksheets[0]

    expect((sheet as unknown as { model: { merges: string[] } }).model.merges).toContain('A1:C1')
  })

  it('数值写成数字并带上数字格式，文本写成字符串', () => {
    const model = buildReportExportModel(
      makeOptions({ getNumeric: (row, col) => (row === 1 && col === 2 ? 1234.5 : null) })
    )
    const sheet = buildReportWorkbook(model).worksheets[0]

    // 数字格保持数值类型，Excel 里还能继续参与计算
    expect(sheet.getCell('C2').value).toBe(1234.5)
    expect(sheet.getCell('C2').numFmt).toBe('0.00')
    expect(sheet.getCell('A2').value).toBe('r1c0')
  })

  it('样式落到字体与对齐上', () => {
    const sheet = buildReportWorkbook(buildReportExportModel(makeOptions())).worksheets[0]

    expect(sheet.getCell('A2').font?.bold).toBe(true)
    expect(sheet.getCell('A2').alignment?.horizontal).toBe('left')
  })

  it('没有显式对齐的数字格右对齐', () => {
    const model = buildReportExportModel(
      makeOptions({ getNumeric: (row, col) => (row === 1 && col === 1 ? 9 : null) })
    )
    const sheet = buildReportWorkbook(model).worksheets[0]

    expect(sheet.getCell('B2').alignment?.horizontal).toBe('right')
  })

  it('边框 token 展开成对应的边', () => {
    const model = buildReportExportModel(
      makeOptions({
        source: [
          { row_index: 0, col_index: 0, style_key: 'border-all' },
          { row_index: 1, col_index: 0, style_key: 'border-bottom' },
        ],
      })
    )
    const sheet = buildReportWorkbook(model).worksheets[0]

    expect(sheet.getCell('A1').border?.top).toBeTruthy()
    expect(sheet.getCell('A1').border?.right).toBeTruthy()
    expect(sheet.getCell('A2').border?.bottom).toBeTruthy()
    expect(sheet.getCell('A2').border?.top).toBeUndefined()
  })

  it('工作表名去掉 Excel 不允许的字符并截断到 31 字', () => {
    const model = buildReportExportModel(makeOptions({ name: '资产/负债*表[2026]' }))

    expect(buildReportWorkbook(model).worksheets[0].name).toBe('资产 负债 表 2026')
  })
})

describe('buildPrintWorkbook 页面设置', () => {
  it('把纸张、方向、边距和打印区域写入工作表', () => {
    const sheet = buildPrintWorkbook(buildReportExportModel(makeOptions()), {
      paperSize: 'A4',
      orientation: 'landscape',
      marginTop: 10,
      marginBottom: 10,
      marginLeft: 12,
      marginRight: 12,
      fitToPage: true,
    }).worksheets[0]

    expect(sheet.pageSetup.paperSize).toBe(9)
    expect(sheet.pageSetup.orientation).toBe('landscape')
    expect(sheet.pageSetup.fitToPage).toBe(true)
    expect(sheet.pageSetup.fitToWidth).toBe(1)
    expect(sheet.pageSetup.horizontalCentered).toBe(true)
    expect(sheet.pageSetup.margins?.left).toBeCloseTo(12 / 25.4, 3)
    expect(sheet.pageSetup.printArea).toBe('A1:C2')
  })

  it('手动缩放时写入百分比，不再 fitToPage', () => {
    const sheet = buildPrintWorkbook(buildReportExportModel(makeOptions()), {
      scale: 0.8,
      fitToPage: false,
    }).worksheets[0]

    expect(sheet.pageSetup.fitToPage).toBe(false)
    expect(sheet.pageSetup.scale).toBe(80)
  })
})
