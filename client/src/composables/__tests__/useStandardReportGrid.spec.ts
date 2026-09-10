import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveCellsMock = vi.fn()
const saveLayoutMock = vi.fn()

vi.mock('@/api/ledgerStandardReport', () => ({
  saveStandardReportCells: (...args: unknown[]) => saveCellsMock(...args),
  saveStandardReportLayout: (...args: unknown[]) => saveLayoutMock(...args),
}))

const { useStandardReportGrid } = await import('../useStandardReportGrid')

function makeDetail(cells: Array<Partial<Record<string, unknown>>> = []) {
  return {
    id: 'r1',
    name: '测试报表',
    account_set_id: 'as-1',
    created_at: '',
    cells: cells.map((cell, index) => ({
      id: `c${index}`,
      report_id: 'r1',
      row_index: 0,
      col_index: 0,
      text_value: null,
      formula_text: null,
      ...cell,
    })),
  } as never
}

/** 让防抖计时器与挂起的 promise 都跑完 */
async function settle(ms = 600) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('useStandardReportGrid 自动保存', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveCellsMock.mockReset().mockResolvedValue({ code: 0 })
    saveLayoutMock.mockReset().mockResolvedValue({ code: 0 })
  })

  it('编辑后经防抖自动保存，并把多次改动合并成一次请求', async () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())

    grid.setCellValue(0, 0, '现金')
    grid.setCellValue(1, 0, '银行存款')
    grid.setCellValue(1, 1, '=A1+1')

    // 防抖期内不应发请求
    expect(saveCellsMock).not.toHaveBeenCalled()

    await settle()

    expect(saveCellsMock).toHaveBeenCalledTimes(1)
    const [reportId, cells] = saveCellsMock.mock.calls[0]
    expect(reportId).toBe('r1')
    expect(cells).toHaveLength(3)
    expect(grid.saveState.value).toBe('saved')
    expect(grid.isDirty.value).toBe(false)
  })

  it('以 = 开头存为公式，普通文字存为文本', async () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())

    grid.setCellValue(0, 0, '=B5+B6')
    grid.setCellValue(0, 1, '合计')
    await settle()

    const cells = saveCellsMock.mock.calls[0][1] as Array<Record<string, unknown>>
    const formulaCell = cells.find(c => c.col_index === 0)!
    const textCell = cells.find(c => c.col_index === 1)!

    expect(formulaCell.formula_text).toBe('=B5+B6')
    expect(formulaCell.text_value).toBeNull()
    expect(formulaCell.cell_type).toBe('formula')
    expect(textCell.text_value).toBe('合计')
    expect(textCell.formula_text).toBeNull()
    expect(textCell.cell_type).toBe('text')
  })

  it('取数公式（@ 开头）同样识别为公式', async () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())

    grid.setCellValue(0, 0, '@ye(1001,99)')
    await settle()

    const cells = saveCellsMock.mock.calls[0][1] as Array<Record<string, unknown>>
    expect(cells[0].formula_text).toBe('@ye(1001,99)')
    expect(cells[0].cell_type).toBe('formula')
  })

  it('保存进行中不并发发请求，期间的新改动留到下一批', async () => {
    let releaseFirst: (value: unknown) => void = () => {}
    saveCellsMock.mockImplementationOnce(
      () => new Promise(resolve => { releaseFirst = resolve })
    )

    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())

    grid.setCellValue(0, 0, 'A')
    await settle()
    expect(saveCellsMock).toHaveBeenCalledTimes(1)
    expect(grid.saveState.value).toBe('saving')

    // 第一次请求尚未返回时又改了一格
    grid.setCellValue(1, 0, 'B')
    await settle()
    expect(saveCellsMock).toHaveBeenCalledTimes(1) // 没有并发

    releaseFirst({ code: 0 })
    await settle()

    expect(saveCellsMock).toHaveBeenCalledTimes(2)
    const secondBatch = saveCellsMock.mock.calls[1][1] as Array<Record<string, unknown>>
    expect(secondBatch).toHaveLength(1)
    expect(secondBatch[0].text_value).toBe('B')
  })

  it('保存失败保留脏标记，可重试', async () => {
    saveCellsMock.mockRejectedValueOnce(new Error('网络错误'))

    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())
    grid.setCellValue(0, 0, 'X')
    await settle()

    expect(grid.saveState.value).toBe('error')
    expect(grid.saveError.value).toBe('网络错误')
    expect(grid.isDirty.value).toBe(true) // 改动没丢

    grid.retrySave()
    await settle()

    expect(saveCellsMock).toHaveBeenCalledTimes(2)
    expect(grid.saveState.value).toBe('saved')
    expect(grid.isDirty.value).toBe(false)
  })

  it('切换报表会取消未决保存，不把上一张的改动写到新报表', async () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())
    grid.setCellValue(0, 0, '旧报表内容')

    // 防抖还没触发就切走
    const another = makeDetail() as unknown as Record<string, unknown>
    grid.loadDetail({ ...another, id: 'r2' } as never)
    await settle()

    expect(saveCellsMock).not.toHaveBeenCalled()
    expect(grid.isDirty.value).toBe(false)
  })

  it('公式视图展示公式原文，取数视图展示计算结果', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(
      makeDetail([{ row_index: 0, col_index: 0, formula_text: '@ye(1001,99)', cell_type: 'formula' }])
    )

    const templateCell = grid.context.buildSheetVisibleCells({} as never)[0]
    expect(templateCell.displayValue).toBe('@ye(1001,99)')

    grid.computedMap.value = new Map([['0:0', { display_value: '1,234.00', status: 'ok' as const }]])
    grid.showComputed.value = true

    const computedCell = grid.context.buildSheetVisibleCells({} as never)[0]
    expect(computedCell.displayValue).toBe('1,234.00')
  })
})

describe('useStandardReportGrid 格式与选择', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveCellsMock.mockReset().mockResolvedValue({ code: 0 })
    saveLayoutMock.mockReset().mockResolvedValue({ code: 0 })
  })

  /** 组件模板不传 event，选行选列靠捕获阶段记下的 mousedown 修饰键 */
  function pressWith(modifiers: { shift?: boolean; ctrl?: boolean }) {
    window.dispatchEvent(
      new MouseEvent('mousedown', {
        shiftKey: !!modifiers.shift,
        ctrlKey: !!modifiers.ctrl,
        bubbles: true,
      })
    )
  }

  it('解析 style_key，让标题行居中放大（两个视图共用同一份呈现）', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(
      makeDetail([
        {
          row_index: 0,
          col_index: 0,
          text_value: '资产负债表',
          style_key: 'align-center font-size-18 font-bold',
          merge_info: JSON.stringify({ rowSpan: 1, colSpan: 8 }),
        },
      ])
    )

    const cell = grid.context.buildSheetVisibleCells({} as never)[0]
    expect(cell.textAlign).toBe('center')
    expect(cell.fontSize).toBe(18)
    expect(cell.bold).toBe(true)
    expect(cell.colSpan).toBe(8)
  })

  it('取数视图只读、不显示行列头；公式视图相反', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())

    expect(grid.context.showGridHeaders.value).toBe(true)
    expect(grid.context.isDirectReportMode.value).toBe(false)

    grid.viewMode.value = 'compute'
    expect(grid.context.showGridHeaders.value).toBe(false)
    expect(grid.context.isDirectReportMode.value).toBe(true)

    // 只读态不进入编辑
    grid.context.selectGridCell({ rowIndex: 1, colIndex: 1 })
    expect(grid.selectedRow.value).toBeNull()
  })

  it('取数视图下数值右对齐', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail([{ row_index: 0, col_index: 0, formula_text: '@ye(1001,99)' }]))
    grid.computedMap.value = new Map([
      ['0:0', { display_value: '1,234.00', status: 'ok' as const, numeric_value: 1234 }],
    ])
    grid.viewMode.value = 'compute'
    grid.showComputed.value = true

    expect(grid.context.buildSheetVisibleCells({} as never)[0].textAlign).toBe('right')
  })

  it('Shift 连选多行，Ctrl 追加单行', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())

    pressWith({})
    grid.context.selectRow(2)
    expect(Array.from(grid.selectedRowIndexes.value)).toEqual([2])

    pressWith({ shift: true })
    grid.context.selectRow(5)
    expect(Array.from(grid.selectedRowIndexes.value).sort((a, b) => a - b)).toEqual([2, 3, 4, 5])

    pressWith({ ctrl: true })
    grid.context.selectRow(8)
    expect(grid.selectedRowIndexes.value.has(8)).toBe(true)
    expect(grid.selectedRowIndexes.value.size).toBe(5)
  })

  it('选中多列后拖动其中一列，整组按同一增量变宽', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())

    pressWith({})
    grid.context.selectColumn(1)
    pressWith({ shift: true })
    grid.context.selectColumn(3)
    expect(grid.selectedColIndexes.value.size).toBe(3)

    grid.context.startColumnResize('sheet1', 2, new MouseEvent('mousedown', { clientX: 100 }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    // 默认宽 120，三列都 +40
    expect(grid.colWidths.value[1]).toBe(160)
    expect(grid.colWidths.value[2]).toBe(160)
    expect(grid.colWidths.value[3]).toBe(160)
    // 未选中的列不动
    expect(grid.colWidths.value[4] ?? 120).toBe(120)
  })

  it('未选中多列时，只调整被拖的那一列', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())

    grid.context.startColumnResize('sheet1', 0, new MouseEvent('mousedown', { clientX: 0 }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 30 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(grid.colWidths.value[0]).toBe(150)
    expect(grid.colWidths.value[1] ?? 120).toBe(120)
  })

  it('合并选区后写出 merge_info，取消合并后清除', async () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail([{ row_index: 0, col_index: 0, text_value: '标题' }]))

    grid.selectedRanges.value = [{ startRow: 0, endRow: 0, startCol: 0, endCol: 3 }]
    expect(grid.canMergeSelection.value).toBe(true)

    grid.mergeSelection()
    const anchor = grid.cellMap.value.get('0:0')!
    expect(JSON.parse(anchor.merge_info!)).toEqual({ rowSpan: 1, colSpan: 4 })
    expect(anchor.text_value).toBe('标题')
    expect(grid.cellMap.value.get('0:1')!.cell_type).toBe('merged')

    await vi.advanceTimersByTimeAsync(600)
    expect(saveCellsMock).toHaveBeenCalled()

    expect(grid.canUnmergeSelection.value).toBe(true)
    grid.unmergeSelection()
    expect(grid.cellMap.value.get('0:0')!.merge_info).toBeNull()
    expect(grid.cellMap.value.get('0:1')!.cell_type).toBe('empty')
  })

  it('被合并覆盖的格子不单独渲染', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(
      makeDetail([
        {
          row_index: 0,
          col_index: 0,
          text_value: '标题',
          merge_info: JSON.stringify({ rowSpan: 1, colSpan: 3 }),
        },
      ])
    )

    const firstRow = grid.context
      .buildSheetVisibleCells({} as never)
      .filter((cell: { rowIndex: number }) => cell.rowIndex === 0)
    // 0 号格跨 3 列，1、2 号格被覆盖不渲染
    expect(firstRow[0].colSpan).toBe(3)
    expect(firstRow[1].colIndex).toBe(3)
  })
})

describe('useStandardReportGrid 样式应用', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveCellsMock.mockReset().mockResolvedValue({ code: 0 })
    saveLayoutMock.mockReset().mockResolvedValue({ code: 0 })
  })

  it('样式套用到整个选区并自动保存', async () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())
    grid.selectedRanges.value = [{ startRow: 0, endRow: 1, startCol: 0, endCol: 1 }]

    grid.applyStyleToSelection({ bold: true, textColor: '#C00000' })

    expect(grid.cellMap.value.get('0:0')!.style_key).toContain('font-bold')
    expect(grid.cellMap.value.get('1:1')!.style_key).toContain('text-color-C00000')

    await vi.advanceTimersByTimeAsync(600)
    const cells = saveCellsMock.mock.calls[0][1] as Array<Record<string, unknown>>
    expect(cells).toHaveLength(4)
  })

  it('套用样式不影响已有内容与公式', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail([{ row_index: 0, col_index: 0, formula_text: '@ye(1001,99)' }]))
    grid.selectedRanges.value = [{ startRow: 0, endRow: 0, startCol: 0, endCol: 0 }]

    grid.applyStyleToSelection({ textAlign: 'right' })

    const cell = grid.cellMap.value.get('0:0')!
    expect(cell.formula_text).toBe('@ye(1001,99)')
    expect(cell.cell_type).toBe('formula')
    expect(cell.style_key).toContain('align-right')
  })

  it('字号增减以 13 起算并有上下限', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())
    grid.selectedRanges.value = [{ startRow: 0, endRow: 0, startCol: 0, endCol: 0 }]

    grid.adjustFontSize(1)
    expect(grid.cellMap.value.get('0:0')!.style_key).toContain('font-size-14')

    grid.adjustFontSize(-6)
    expect(grid.cellMap.value.get('0:0')!.style_key).toContain('font-size-8')
  })

  it('数字格式写入 format_text 而不是 style_key', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail())
    grid.selectedRanges.value = [{ startRow: 0, endRow: 0, startCol: 0, endCol: 0 }]

    grid.applyNumberFormatToSelection('thousands')

    const cell = grid.cellMap.value.get('0:0')!
    expect(cell.format_text).toBe('thousands')
    expect(cell.style_key ?? '').not.toContain('thousands')
  })

  it('样式经 buildCellView 呈现为可渲染的值', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(
      makeDetail([
        {
          row_index: 0,
          col_index: 0,
          text_value: '合计',
          style_key: 'align-right font-family-SimHei text-color-C00000 bg-color-FFFF00 border-bottom border-width-2',
        },
      ])
    )

    const cell = grid.context.buildSheetVisibleCells({} as never)[0]
    expect(cell.textAlign).toBe('right')
    expect(cell.fontFamily).toContain('SimHei')
    expect(cell.textColor).toBe('C00000')
    expect(cell.bgColor).toBe('FFFF00')
    expect(cell.borderStyleCss).toEqual({ borderBottom: '2px solid #000' })
  })
})

describe('useStandardReportGrid 网格尺寸', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveCellsMock.mockReset().mockResolvedValue({ code: 0 })
  })

  it('取数视图严格贴合数据范围，不铺多余空白', () => {
    const grid = useStandardReportGrid()
    // 造一张 25 行 4 列的报表
    grid.loadDetail(makeDetail([{ row_index: 24, col_index: 3, text_value: 'x' }]))
    grid.viewMode.value = 'compute'

    expect(grid.rowCount.value).toBe(25)
    expect(grid.colCount.value).toBe(4)
  })

  it('公式视图只多留一点余量，便于在末尾追加', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail([{ row_index: 24, col_index: 3, text_value: 'x' }]))

    // 25+2 行、4+1 列——与取数视图只差一点，切换时不会突然变样
    expect(grid.rowCount.value).toBe(27)
    expect(grid.colCount.value).toBe(5)
  })

  it('新建的空白报表在编辑时仍有可用的最小网格', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail([{ row_index: 0, col_index: 0, text_value: '新报表' }]))

    expect(grid.rowCount.value).toBe(15)
    expect(grid.colCount.value).toBe(5)
  })
})

describe('useStandardReportGrid 单元格多选', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveCellsMock.mockReset().mockResolvedValue({ code: 0 })
  })

  const at = (rowIndex: number, colIndex: number) => ({ rowIndex, colIndex })
  const press = (mods: { shift?: boolean; ctrl?: boolean } = {}) =>
    new MouseEvent('mousedown', { shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl })

  function makeGrid() {
    const grid = useStandardReportGrid()
    grid.loadDetail(makeDetail([{ row_index: 9, col_index: 9, text_value: 'x' }]))
    return grid
  }

  it('普通点击是单选', () => {
    const grid = makeGrid()
    grid.context.startDragSelection(at(2, 2), press())

    expect(grid.selectedRanges.value).toEqual([
      { startRow: 2, endRow: 2, startCol: 2, endCol: 2 },
    ])
    expect(grid.selectedRow.value).toBe(2)
  })

  it('Shift 点击从基准格框成一片', () => {
    const grid = makeGrid()
    grid.context.startDragSelection(at(1, 1), press())
    grid.context.startDragSelection(at(3, 4), press({ shift: true }))

    expect(grid.selectedRanges.value).toEqual([
      { startRow: 1, endRow: 3, startCol: 1, endCol: 4 },
    ])
  })

  it('Shift 反向点击也能正确框选', () => {
    const grid = makeGrid()
    grid.context.startDragSelection(at(4, 4), press())
    grid.context.startDragSelection(at(2, 1), press({ shift: true }))

    expect(grid.selectedRanges.value).toEqual([
      { startRow: 2, endRow: 4, startCol: 1, endCol: 4 },
    ])
  })

  it('Ctrl 点击把格子并入选区，可选多块不相邻的', () => {
    const grid = makeGrid()
    grid.context.startDragSelection(at(0, 0), press())
    grid.context.startDragSelection(at(2, 3), press({ ctrl: true }))
    grid.context.startDragSelection(at(5, 1), press({ ctrl: true }))

    expect(grid.selectedRanges.value).toHaveLength(3)
    expect(grid.context.isCellStructureSelected(0, 0)).toBe(true)
    expect(grid.context.isCellStructureSelected(2, 3)).toBe(true)
    expect(grid.context.isCellStructureSelected(5, 1)).toBe(true)
    expect(grid.context.isCellStructureSelected(1, 1)).toBe(false)
  })

  it('再次 Ctrl 点同一格会取消它', () => {
    const grid = makeGrid()
    grid.context.startDragSelection(at(0, 0), press())
    grid.context.startDragSelection(at(2, 3), press({ ctrl: true }))
    expect(grid.selectedRanges.value).toHaveLength(2)

    grid.context.startDragSelection(at(2, 3), press({ ctrl: true }))
    expect(grid.selectedRanges.value).toHaveLength(1)
    expect(grid.context.isCellStructureSelected(2, 3)).toBe(false)
  })

  it('多选后套用样式会作用于所有选中的格子', async () => {
    const grid = makeGrid()
    grid.context.startDragSelection(at(0, 0), press())
    grid.context.startDragSelection(at(2, 2), press({ ctrl: true }))

    grid.applyStyleToSelection({ bold: true })

    expect(grid.cellMap.value.get('0:0')!.style_key).toContain('font-bold')
    expect(grid.cellMap.value.get('2:2')!.style_key).toContain('font-bold')
    expect(grid.cellMap.value.get('1:1')).toBeUndefined() // 没选中的不动

    await vi.advanceTimersByTimeAsync(600)
    expect((saveCellsMock.mock.calls[0][1] as unknown[]).length).toBe(2)
  })

  it('点击本身不再重置 mousedown 选好的区域', () => {
    // 早先 mousedown 设好多选后，随后的 click 会把它重置成单格
    const grid = makeGrid()
    grid.context.startDragSelection(at(1, 1), press())
    grid.context.startDragSelection(at(3, 3), press({ shift: true }))

    grid.context.selectGridCell(at(3, 3))

    expect(grid.selectedRanges.value).toEqual([
      { startRow: 1, endRow: 3, startCol: 1, endCol: 3 },
    ])
  })

  it('选区摘要能反映当前选了多大一片', () => {
    const grid = makeGrid()
    grid.context.startDragSelection(at(1, 1), press())
    expect(grid.selectionSummary.value).toBe('')

    grid.context.startDragSelection(at(3, 2), press({ shift: true }))
    expect(grid.selectionSummary.value).toBe('3 行 x 2 列')

    grid.context.startDragSelection(at(8, 8), press({ ctrl: true }))
    expect(grid.selectionSummary.value).toBe('7 格')
  })
})

describe('useStandardReportGrid 取数视图呈现', () => {
  function makeComputedGrid() {
    const grid = useStandardReportGrid()
    grid.loadDetail(
      makeDetail([
        // 表头：未合并的长文本，右侧两格空白
        { row_index: 0, col_index: 0, text_value: '纳税人名称 ：广州东汇食品有限公司', cell_type: 'text', style_key: 'font-size-15' },
        { row_index: 0, col_index: 3, text_value: '会企01表', cell_type: 'text', style_key: 'align-right' },
        // 数据行：项目名 / 居中的行次公式 / 右对齐金额公式
        { row_index: 1, col_index: 0, text_value: '货币资金', cell_type: 'text', style_key: 'border-all' },
        { row_index: 1, col_index: 1, formula_text: '=B1+1', cell_type: 'formula', style_key: 'align-center border-all' },
        { row_index: 1, col_index: 2, formula_text: '@YE(1001,99)', cell_type: 'formula', style_key: 'border-all' },
        { row_index: 1, col_index: 3, formula_text: '@NC(1001)', cell_type: 'formula', style_key: 'border-all' },
      ])
    )
    grid.colWidths.value = [100, 60, 90, 90]
    grid.viewMode.value = 'compute'
    grid.computedMap.value = new Map([
      [grid.cellKey(1, 1), { display_value: '1', status: 'ok', numeric_value: 1 }],
      [grid.cellKey(1, 2), { display_value: '0', status: 'ok', numeric_value: 0 }],
      [grid.cellKey(1, 3), { display_value: '1234.5', status: 'ok', numeric_value: 1234.5 }],
    ])
    grid.showComputed.value = true
    return grid
  }

  const findCell = (grid: ReturnType<typeof useStandardReportGrid>, row: number, col: number) =>
    grid.context.buildSheetVisibleCells({} as never).find(c => c.rowIndex === row && c.colIndex === col)

  it('取数结果为 0 时留白', () => {
    const grid = makeComputedGrid()
    expect(findCell(grid, 1, 2)?.displayValue).toBe('')
    expect(findCell(grid, 1, 3)?.displayValue).toBe('1234.5')
  })

  it('格子自带对齐优先于数值默认右对齐', () => {
    const grid = makeComputedGrid()
    expect(findCell(grid, 1, 1)?.textAlign).toBe('center')
    expect(findCell(grid, 1, 3)?.textAlign).toBe('right')
  })

  it('只读视图下装不下的左对齐文本向右铺到空白邻格，被铺过的格子不再渲染', () => {
    const grid = makeComputedGrid()
    const header = findCell(grid, 0, 0)
    // 100px 装不下 15 号字 16 个汉字，铺过 B、C 两列后被 D 列的内容挡住
    expect(header?.colSpan).toBe(3)
    expect(findCell(grid, 0, 1)).toBeUndefined()
    expect(findCell(grid, 0, 2)).toBeUndefined()
    expect(findCell(grid, 0, 3)?.displayValue).toBe('会企01表')
    // 带边框的数据行不受影响
    expect(findCell(grid, 1, 0)?.colSpan).toBe(1)
  })

  it('右邻是整行居中的日期格时，名称越过格线铺到日期文字之前，日期格仍然渲染', () => {
    const grid = useStandardReportGrid()
    grid.loadDetail(
      makeDetail([
        { row_index: 0, col_index: 0, text_value: '纳税人名称 ：广州东汇食品有限公司', cell_type: 'text', style_key: 'font-size-15' },
        {
          row_index: 0,
          col_index: 1,
          text_value: '2025年12月31日',
          cell_type: 'text',
          style_key: 'align-row-center font-size-15',
          merge_info: JSON.stringify({ rowSpan: 1, colSpan: 6 }),
        },
        { row_index: 0, col_index: 7, text_value: '会企01表', cell_type: 'text', style_key: 'align-right' },
        { row_index: 1, col_index: 0, text_value: '货币资金', cell_type: 'text', style_key: 'border-all' },
      ])
    )
    grid.colWidths.value = [193, 36, 121, 121, 193, 35, 121, 121]
    grid.viewMode.value = 'compute'
    grid.showComputed.value = true

    const header = findCell(grid, 0, 0)
    const date = findCell(grid, 0, 1)
    expect(header?.colSpan).toBe(1)
    expect(header?.softSpillWidth).toBeGreaterThan(193)
    // 不能碰到日期文字：总宽 941，中线 470.5，日期 9 字符约 100px 宽
    expect(header?.softSpillWidth).toBeLessThan(470.5 - 40)
    expect(date?.displayValue).toBe('2025年12月31日')
    expect(date?.rowCenterOffset).toBeCloseTo(470.5 - 193, 5)
  })

  it('公式视图不做溢出铺开', () => {
    const grid = makeComputedGrid()
    grid.viewMode.value = 'template'
    grid.showComputed.value = false
    expect(findCell(grid, 0, 0)?.colSpan).toBe(1)
    expect(findCell(grid, 0, 1)).toBeDefined()
  })
})
