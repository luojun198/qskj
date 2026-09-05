import { computed, nextTick, ref } from 'vue'

import {
  saveStandardReportCells,
  saveStandardReportLayout,
  type RhStandardReportCell,
  type RhStandardReportCellInput,
  type RhStandardReportDetail,
} from '@/api/ledgerStandardReport'
import type { ReportGridContext } from '@/components/report/reportGridContext'
import {
  borderCss,
  fontFamilyCss,
  formatNumberByType,
  mergeStyleKey,
  parseStyleKey,
  type CellStyle,
} from '@/composables/useReportCellStyle'

/**
 * 把标准报表的数据接到动态报表那套现成网格组件（ReportSheetGrid）上。
 *
 * 组件只依赖 reportGridContext.ts 里的 37 个成员，对数据源零假设，
 * 因此这里只需组装出它要的形状即可复用整套网格 UI（行列头、拖选、内联编辑、
 * 列宽行高拖拽、Excel 粘贴）。
 *
 * 一期只做结构与公式，样式相关的取值先给默认值；二期接 style_key 时再补。
 */

const DEFAULT_COL_WIDTH = 120
const DEFAULT_ROW_HEIGHT = 28
const HEADER_COL_WIDTH = 48
const HEADER_ROW_HEIGHT = 28
/**
 * 网格尺寸贴合报表实际数据，不再大面积补空白。
 * 公式视图只多留一点余量（够点进去在末尾追加），取数视图则严格等于数据范围，
 * 这样两个视图看着几乎一样，也不会在报表下方/右侧拖出大片空格。
 */
const EDIT_ROW_PADDING = 2
const EDIT_COL_PADDING = 1
/** 新建的空白报表数据极少，编辑时给个下限免得无从下手 */
const MIN_EDIT_ROW_COUNT = 15
const MIN_EDIT_COL_COUNT = 5

export type GridCellView = {
  key: string
  rowIndex: number
  colIndex: number
  rowSpan: number
  colSpan: number
  cell_type: string
  displayValue: string
  editorValue: string
  tooltip: string
  isSelected: boolean
  isEditing: boolean
  executionStatus: 'ok' | 'error' | null
  textAlign: string
  verticalAlign: string
  fontSize: number
  bold: boolean
  underline: boolean
  fontFamily: string
  borderColor: string
  borderWidth: number
  borderStyle: string
  textColor: string
  bgColor: string
  borderStyleCss: Record<string, string>
}

type CellRange = { startRow: number; endRow: number; startCol: number; endCol: number }

export function useStandardReportGrid() {
  /** 单元格按 "row:col" 索引；这是编辑期间的唯一真源 */
  const cellMap = ref(new Map<string, RhStandardReportCell>())
  const reportName = ref('')
  const reportId = ref('')
  const colWidths = ref<number[]>([])
  const rowHeights = ref<number[]>([])
  const defaultColWidth = ref(DEFAULT_COL_WIDTH)
  const defaultRowHeight = ref(DEFAULT_ROW_HEIGHT)

  /** 待保存的单元格坐标集合 */
  const dirtyKeys = ref(new Set<string>())
  /** 自动保存状态；页面顶部据此显示「保存中… / 已保存 hh:mm:ss / 保存失败」 */
  const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveError = ref('')
  const lastSavedAt = ref<Date | null>(null)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  /** 保存进行中时不再并发发起；新变更累积到下一批 */
  let savingInFlight = false
  let layoutTimer: ReturnType<typeof setTimeout> | null = null
  /** 计算视图的结果，key 同为 "row:col" */
  const computedMap = ref(
    new Map<
      string,
      { display_value: string; status: 'ok' | 'error'; numeric_value?: number | null }
    >()
  )
  const showComputed = ref(false)
  /** 'template' = 公式（可编辑、显示行列头）；'compute' = 取数（只读、不显行列头） */
  const viewMode = ref<'template' | 'compute'>('template')
  const isReadonly = computed(() => viewMode.value === 'compute')

  const selectedRow = ref<number | null>(null)
  const selectedCol = ref<number | null>(null)
  const editingKey = ref<string | null>(null)
  const editorValue = ref('')
  const selectedRanges = ref<CellRange[]>([])
  const bulkSelectionMode = ref<'none' | 'row' | 'column' | 'all'>('none')
  const selectedRowIndex = ref<number | null>(null)
  const selectedColIndex = ref<number | null>(null)

  /** 多选中的行号 / 列号；批量调整宽高时对整组生效 */
  const selectedRowIndexes = ref<Set<number>>(new Set())
  const selectedColIndexes = ref<Set<number>>(new Set())

  const activeEditorRef = ref<Element | null>(null)
  let dragAnchor: { rowIndex: number; colIndex: number } | null = null
  /** Shift 连选的基准格：普通点击/Ctrl 点击会把它移到刚点的那一格 */
  const selectionAnchor = ref<{ rowIndex: number; colIndex: number } | null>(null)

  /**
   * 组件模板里是 `@click="grid.selectRow(rowIndex - 1)"`，没有把 event 传出来，
   * 拿不到 Shift / Ctrl。改组件签名要动 reportGridContext 契约和动态报表页，代价太大，
   * 所以在 window 捕获阶段记下最近一次 mousedown 的修饰键，选行选列时读它。
   */
  const lastModifiers = { shift: false, ctrl: false }
  const trackModifiers = (event: MouseEvent) => {
    lastModifiers.shift = event.shiftKey
    lastModifiers.ctrl = event.ctrlKey || event.metaKey
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('mousedown', trackModifiers, true)
  }
  /** 组件卸载时调用，避免监听器泄漏 */
  function dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('mousedown', trackModifiers, true)
    }
    cancelPendingSaves()
  }

  const cellKey = (rowIndex: number, colIndex: number) => `${rowIndex}:${colIndex}`

  // ---------- 载入 / 导出 ----------

  function loadDetail(detail: RhStandardReportDetail) {
    reportId.value = detail.id
    reportName.value = detail.name
    const map = new Map<string, RhStandardReportCell>()
    for (const cell of detail.cells || []) {
      map.set(cellKey(cell.row_index, cell.col_index), { ...cell })
    }
    cellMap.value = map
    cancelPendingSaves()
    dirtyKeys.value = new Set()
    saveState.value = 'idle'
    saveError.value = ''
    computedMap.value = new Map()
    showComputed.value = false
    defaultColWidth.value = detail.default_col_width || DEFAULT_COL_WIDTH
    defaultRowHeight.value = detail.default_row_height || DEFAULT_ROW_HEIGHT
    colWidths.value = parseSizeList(detail.col_widths)
    rowHeights.value = parseSizeList(detail.row_heights)
  }

  function parseSizeList(value: string | null | undefined): number[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(item => Number(item) || 0) : []
    } catch {
      return []
    }
  }

  /** 收集待保存的单元格；保存成功后调用 markSaved 清空脏标记 */
  function collectDirtyCells(): RhStandardReportCellInput[] {
    const result: RhStandardReportCellInput[] = []
    for (const key of dirtyKeys.value) {
      const cell = cellMap.value.get(key)
      const [rowIndex, colIndex] = key.split(':').map(Number)
      if (!cell) {
        // 被清空的格子：写回空值而不是删除，保持坐标存在
        result.push({ row_index: rowIndex, col_index: colIndex, text_value: null, formula_text: null, cell_type: 'empty' })
        continue
      }
      result.push({
        row_index: cell.row_index,
        col_index: cell.col_index,
        cell_type: (cell.cell_type as RhStandardReportCellInput['cell_type']) || 'text',
        text_value: cell.text_value,
        formula_text: cell.formula_text,
        format_text: cell.format_text ?? null,
        style_key: cell.style_key ?? null,
        side: cell.side ?? null,
        merge_info: cell.merge_info ?? null,
      })
    }
    return result
  }

  function markSaved() {
    dirtyKeys.value = new Set()
  }

  // ---------- 自动保存 ----------

  /** 立即把待存的单元格写库；保存期间产生的新改动会留到下一批 */
  async function flushSave(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (savingInFlight) return
    if (!reportId.value) return

    const pending = collectDirtyCells()
    if (!pending.length) return

    // 先记下这批的坐标，成功后只清除它们，避免误清保存期间的新改动
    const batchKeys = Array.from(dirtyKeys.value)
    savingInFlight = true
    saveState.value = 'saving'
    saveError.value = ''
    try {
      await saveStandardReportCells(reportId.value, pending)
      const remaining = new Set(dirtyKeys.value)
      for (const key of batchKeys) remaining.delete(key)
      dirtyKeys.value = remaining
      lastSavedAt.value = new Date()
      saveState.value = remaining.size > 0 ? 'idle' : 'saved'
    } catch (error) {
      // 失败不清脏标记，下次编辑或手动重试仍会带上
      saveState.value = 'error'
      saveError.value = error instanceof Error ? error.message : '保存失败'
    } finally {
      savingInFlight = false
    }

    // 保存期间又有新改动，接着存
    if (dirtyKeys.value.size > 0 && saveState.value !== 'error') {
      scheduleSave()
    }
  }

  /** 防抖调度：连续输入只在停下来后存一次 */
  function scheduleSave(delay = 500) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, delay)
  }

  /** 列宽行高变化后落库（拖拽过程中频繁触发，用更长的防抖） */
  function scheduleLayoutSave(delay = 800) {
    if (layoutTimer) clearTimeout(layoutTimer)
    layoutTimer = setTimeout(() => {
      layoutTimer = null
      if (!reportId.value) return
      void saveStandardReportLayout(reportId.value, {
        col_widths: colWidths.value,
        row_heights: rowHeights.value,
      }).catch(() => {
        // 列宽行高只是观感，失败不打断编辑
      })
    }, delay)
  }

  /** 重试上次失败的保存 */
  function retrySave() {
    saveState.value = 'idle'
    void flushSave()
  }

  function cancelPendingSaves() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (layoutTimer) {
      clearTimeout(layoutTimer)
      layoutTimer = null
    }
  }

  const isDirty = computed(() => dirtyKeys.value.size > 0)

  // ---------- 网格尺寸 ----------

  const dataRowCount = computed(() => {
    let max = 0
    for (const cell of cellMap.value.values()) {
      if (cell.row_index + 1 > max) max = cell.row_index + 1
    }
    return max
  })

  const dataColCount = computed(() => {
    let max = 0
    for (const cell of cellMap.value.values()) {
      if (cell.col_index + 1 > max) max = cell.col_index + 1
    }
    return max
  })

  const rowCount = computed(() =>
    isReadonly.value
      ? Math.max(dataRowCount.value, 1)
      : Math.max(dataRowCount.value + EDIT_ROW_PADDING, MIN_EDIT_ROW_COUNT)
  )
  const colCount = computed(() =>
    isReadonly.value
      ? Math.max(dataColCount.value, 1)
      : Math.max(dataColCount.value + EDIT_COL_PADDING, MIN_EDIT_COL_COUNT)
  )

  /** ReportSheetGrid 需要的 sheet 形状；标准报表是单表 */
  const templateData = computed(() => ({
    sheets: [
      {
        id: 'sheet1',
        sheet_name: reportName.value || '报表',
        metrics: { rowCount: rowCount.value, colCount: colCount.value },
      },
    ],
  }))

  const activeSheetName = ref('sheet1')

  // ---------- 单元格视图 ----------

  function parseMergeInfo(value: string | null | undefined) {
    if (!value) return { rowSpan: 1, colSpan: 1 }
    try {
      const parsed = JSON.parse(value)
      return {
        rowSpan: Math.max(1, Number(parsed?.rowSpan) || 1),
        colSpan: Math.max(1, Number(parsed?.colSpan) || 1),
      }
    } catch {
      return { rowSpan: 1, colSpan: 1 }
    }
  }

  /** 被合并覆盖、不应单独渲染的坐标 */
  const coveredKeys = computed(() => {
    const covered = new Set<string>()
    for (const cell of cellMap.value.values()) {
      const { rowSpan, colSpan } = parseMergeInfo(cell.merge_info)
      if (rowSpan === 1 && colSpan === 1) continue
      for (let r = 0; r < rowSpan; r += 1) {
        for (let c = 0; c < colSpan; c += 1) {
          if (r === 0 && c === 0) continue
          covered.add(cellKey(cell.row_index + r, cell.col_index + c))
        }
      }
    }
    return covered
  })

  /** 模板视图显示公式原文，计算视图显示取数结果 */
  function resolveDisplay(cell: RhStandardReportCell | undefined, key: string) {
    if (showComputed.value) {
      const computedCell = computedMap.value.get(key)
      // 服务端可能已输出千分位，formatNumberByType 会先去掉分隔符再按格式重排
      if (computedCell) return formatNumberByType(computedCell.display_value, cell?.format_text)
      if (cell?.formula_text) return ''
      return cell?.text_value || ''
    }
    if (!cell) return ''
    return cell.formula_text || cell.text_value || ''
  }

  function buildCellView(rowIndex: number, colIndex: number): GridCellView {
    const key = cellKey(rowIndex, colIndex)
    const cell = cellMap.value.get(key)
    const { rowSpan, colSpan } = parseMergeInfo(cell?.merge_info)
    const displayValue = resolveDisplay(cell, key)
    const computedCell = computedMap.value.get(key)
    const style = parseStyleKey(cell?.style_key)

    return {
      key,
      rowIndex,
      colIndex,
      rowSpan,
      colSpan,
      cell_type: cell?.cell_type || (cell?.formula_text ? 'formula' : 'text'),
      displayValue,
      editorValue: editingKey.value === key ? editorValue.value : displayValue,
      tooltip: cell?.formula_text || displayValue,
      isSelected: selectedRow.value === rowIndex && selectedCol.value === colIndex,
      isEditing: editingKey.value === key,
      executionStatus: showComputed.value ? (computedCell?.status ?? null) : null,
      // 取数视图下数值右对齐（与旧的只读表格 num-cell 行为一致），否则按 style_key
      textAlign:
        showComputed.value && computedCell && computedCell.numeric_value !== null
          ? 'right'
          : style.textAlign || 'left',
      verticalAlign: style.verticalAlign || 'middle',
      fontSize: style.fontSize || 13,
      bold: style.bold,
      underline: style.underline,
      fontFamily: fontFamilyCss(style.fontFamily),
      borderColor: style.borderColor,
      borderWidth: style.borderWidth,
      borderStyle: style.borderStyle || 'all',
      textColor: style.textColor,
      bgColor: style.bgColor,
      borderStyleCss: style.borderStyle ? (borderCss(style) as Record<string, string>) : {},
    }
  }

  function buildSheetVisibleCells() {
    const cells: GridCellView[] = []
    const covered = coveredKeys.value
    for (let rowIndex = 0; rowIndex < rowCount.value; rowIndex += 1) {
      for (let colIndex = 0; colIndex < colCount.value; colIndex += 1) {
        if (covered.has(cellKey(rowIndex, colIndex))) continue
        cells.push(buildCellView(rowIndex, colIndex))
      }
    }
    return cells
  }

  function buildSheetRows() {
    const rows: GridCellView[][] = []
    for (let rowIndex = 0; rowIndex < rowCount.value; rowIndex += 1) {
      const row: GridCellView[] = []
      for (let colIndex = 0; colIndex < colCount.value; colIndex += 1) {
        row.push(buildCellView(rowIndex, colIndex))
      }
      rows.push(row)
    }
    return rows
  }

  // ---------- 布局 ----------

  function toColumnName(colIndex: number) {
    let col = colIndex
    let name = ''
    do {
      name = String.fromCharCode(65 + (col % 26)) + name
      col = Math.floor(col / 26) - 1
    } while (col >= 0)
    return name
  }

  const getColWidth = (colIndex: number) => colWidths.value[colIndex] || defaultColWidth.value
  const getRowHeight = (rowIndex: number) => rowHeights.value[rowIndex] || defaultRowHeight.value

  function getGridTemplateColumns(_sheetId: string, count: number) {
    const widths: string[] = [`${HEADER_COL_WIDTH}px`]
    for (let i = 0; i < count; i += 1) widths.push(`${getColWidth(i)}px`)
    return widths.join(' ')
  }

  function getGridTemplateRows(_sheetId: string, count: number) {
    const heights: string[] = [`${HEADER_ROW_HEIGHT}px`]
    for (let i = 0; i < count; i += 1) heights.push(`${getRowHeight(i)}px`)
    return heights.join(' ')
  }

  function getSheetGridWidth(_sheetId: string, count: number) {
    let total = HEADER_COL_WIDTH
    for (let i = 0; i < count; i += 1) total += getColWidth(i)
    return total
  }

  // 行列头各占一格，故数据区从第 2 行 / 第 2 列起
  const getCellGridColumn = (cell: { colIndex: number; colSpan: number }) =>
    `${cell.colIndex + 2} / span ${Math.max(1, cell.colSpan)}`
  const getCellGridRow = (rowIndex: number, rowSpan: number) =>
    `${rowIndex + 2} / span ${Math.max(1, rowSpan)}`

  // ---------- 选择 ----------

  function clearBulkSelection() {
    bulkSelectionMode.value = 'none'
    selectedRowIndex.value = null
    selectedColIndex.value = null
    selectedRowIndexes.value = new Set()
    selectedColIndexes.value = new Set()
  }

  function toggleSelectAll() {
    if (bulkSelectionMode.value === 'all') {
      clearBulkSelection()
      return
    }
    bulkSelectionMode.value = 'all'
    selectedRowIndex.value = null
    selectedColIndex.value = null
    selectedRowIndexes.value = new Set(Array.from({ length: rowCount.value }, (_, i) => i))
    selectedColIndexes.value = new Set(Array.from({ length: colCount.value }, (_, i) => i))
    selectedRanges.value = [
      { startRow: 0, endRow: rowCount.value - 1, startCol: 0, endCol: colCount.value - 1 },
    ]
  }

  /** 依据修饰键把 index 并入既有选区：Shift 连选、Ctrl 追加、无修饰键单选 */
  function resolveIndexSelection(current: Set<number>, anchor: number | null, index: number) {
    if (lastModifiers.ctrl) {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    }
    if (lastModifiers.shift && anchor !== null) {
      const next = new Set<number>()
      const start = Math.min(anchor, index)
      const end = Math.max(anchor, index)
      for (let i = start; i <= end; i += 1) next.add(i)
      return next
    }
    return new Set([index])
  }

  function selectColumn(colIndex: number) {
    bulkSelectionMode.value = 'column'
    selectedColIndexes.value = resolveIndexSelection(
      selectedColIndexes.value,
      selectedColIndex.value,
      colIndex
    )
    selectedRowIndexes.value = new Set()
    // 锚点保持为首次点击处，便于随后 Shift 连选
    if (!lastModifiers.shift) selectedColIndex.value = colIndex
    selectedRowIndex.value = null
    selectedCol.value = colIndex
    selectedRow.value = null
    selectedRanges.value = Array.from(selectedColIndexes.value).map(index => ({
      startRow: 0,
      endRow: rowCount.value - 1,
      startCol: index,
      endCol: index,
    }))
  }

  function selectRow(rowIndex: number) {
    bulkSelectionMode.value = 'row'
    selectedRowIndexes.value = resolveIndexSelection(
      selectedRowIndexes.value,
      selectedRowIndex.value,
      rowIndex
    )
    selectedColIndexes.value = new Set()
    if (!lastModifiers.shift) selectedRowIndex.value = rowIndex
    selectedColIndex.value = null
    selectedRow.value = rowIndex
    selectedCol.value = null
    selectedRanges.value = Array.from(selectedRowIndexes.value).map(index => ({
      startRow: index,
      endRow: index,
      startCol: 0,
      endCol: colCount.value - 1,
    }))
  }

  function isCellStructureSelected(rowIndex: number, colIndex: number) {
    if (bulkSelectionMode.value === 'all') return true
    if (bulkSelectionMode.value === 'row') return selectedRowIndexes.value.has(rowIndex)
    if (bulkSelectionMode.value === 'column') return selectedColIndexes.value.has(colIndex)
    return selectedRanges.value.some(
      range =>
        rowIndex >= range.startRow &&
        rowIndex <= range.endRow &&
        colIndex >= range.startCol &&
        colIndex <= range.endCol
    )
  }

  /** 两个坐标围成的矩形 */
  function rangeBetween(
    from: { rowIndex: number; colIndex: number },
    to: { rowIndex: number; colIndex: number }
  ): CellRange {
    return {
      startRow: Math.min(from.rowIndex, to.rowIndex),
      endRow: Math.max(from.rowIndex, to.rowIndex),
      startCol: Math.min(from.colIndex, to.colIndex),
      endCol: Math.max(from.colIndex, to.colIndex),
    }
  }

  const isSingleCellRange = (range: CellRange, rowIndex: number, colIndex: number) =>
    range.startRow === rowIndex &&
    range.endRow === rowIndex &&
    range.startCol === colIndex &&
    range.endCol === colIndex

  /**
   * 点击单元格。
   *
   * 选区变更统一放在 mousedown（startDragSelection）里做，和 Excel 一致——按下即选中。
   * 这里只负责在点到别的格子时把正在编辑的内容提交掉，不再重复设置选区，
   * 否则 mousedown 刚设好的多选会被随后的 click 重置成单格。
   */
  function selectGridCell(cell: { rowIndex: number; colIndex: number }) {
    if (isReadonly.value) return
    if (editingKey.value && editingKey.value !== cellKey(cell.rowIndex, cell.colIndex)) {
      applyInlineEdit()
    }
  }

  /**
   * 按下单元格：处理单选、Shift 连选、Ctrl 加选，以及随后的拖选。
   *
   * - 普通点击：单选，并把连选基准移到这一格
   * - Shift 点击：从基准格到当前格框成一片
   * - Ctrl 点击：把这一格并入选区；已在选区里则移除
   * - 拖动：普通拖动替换当前这片；按住 Ctrl 拖动则追加一片（可选多块不相邻区域）
   */
  function startDragSelection(cell: { rowIndex: number; colIndex: number }, event: MouseEvent) {
    if (isReadonly.value) return
    if (editingKey.value) {
      // 正在编辑时点到别处，先把内容存下来
      if (editingKey.value !== cellKey(cell.rowIndex, cell.colIndex)) applyInlineEdit()
      else return
    }

    const additive = event.ctrlKey || event.metaKey
    const extend = event.shiftKey
    clearBulkSelection()

    /** Ctrl 拖动时保留已有选区，在其后追加新的一片 */
    let baseRanges: CellRange[] = []

    if (extend && selectionAnchor.value) {
      const kept = additive ? selectedRanges.value.slice(0, -1) : []
      baseRanges = kept
      selectedRanges.value = [...kept, rangeBetween(selectionAnchor.value, cell)]
    } else if (additive) {
      const hit = selectedRanges.value.findIndex(range =>
        isSingleCellRange(range, cell.rowIndex, cell.colIndex)
      )
      if (hit >= 0) {
        // 再次 Ctrl 点同一格 = 取消它
        selectedRanges.value = selectedRanges.value.filter((_, index) => index !== hit)
        selectionAnchor.value = { rowIndex: cell.rowIndex, colIndex: cell.colIndex }
        selectedRow.value = cell.rowIndex
        selectedCol.value = cell.colIndex
        return
      }
      baseRanges = selectedRanges.value.slice()
      selectedRanges.value = [...baseRanges, rangeBetween(cell, cell)]
      selectionAnchor.value = { rowIndex: cell.rowIndex, colIndex: cell.colIndex }
    } else {
      selectedRanges.value = [rangeBetween(cell, cell)]
      selectionAnchor.value = { rowIndex: cell.rowIndex, colIndex: cell.colIndex }
    }

    dragAnchor = extend && selectionAnchor.value ? selectionAnchor.value : { ...cell }
    selectedRow.value = cell.rowIndex
    selectedCol.value = cell.colIndex

    const onMove = (moveEvent: MouseEvent) => {
      if (!dragAnchor) return
      // 网格组件的模板里没有 data-* 坐标，这里从 CSS grid 定位反推行列
      // （单元格的 gridColumn/gridRow 形如 "3 / span 1"，数据区从第 2 行/列起）
      const target = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest('.cell') as HTMLElement | null
      if (!target) return
      const colIndex = Number.parseInt(target.style.gridColumn, 10) - 2
      const rowIndex = Number.parseInt(target.style.gridRow, 10) - 2
      if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex)) return
      if (rowIndex < 0 || colIndex < 0) return
      selectedRanges.value = [...baseRanges, rangeBetween(dragAnchor, { rowIndex, colIndex })]
    }
    const onUp = () => {
      dragAnchor = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)

    // 双击进入编辑
    if (event.detail >= 2) startEditing(cell.rowIndex, cell.colIndex)
  }

  // ---------- 编辑 ----------

  function setActiveEditorRef(el: Element | null) {
    activeEditorRef.value = el
    if (el instanceof HTMLTextAreaElement) {
      nextTick(() => {
        el.focus()
        el.select()
      })
    }
  }

  function startEditing(rowIndex: number, colIndex: number) {
    const key = cellKey(rowIndex, colIndex)
    const cell = cellMap.value.get(key)
    editingKey.value = key
    // 编辑时始终给公式原文，避免在计算视图里把取数结果写回模板
    editorValue.value = cell?.formula_text || cell?.text_value || ''
  }

  function handleInlineInput(_cell: unknown, event: Event) {
    editorValue.value = (event.target as HTMLTextAreaElement).value
  }

  function isFormulaLike(value: string) {
    const trimmed = value.trim()
    return trimmed.startsWith('=') || trimmed.startsWith('@') || trimmed.startsWith('＝')
  }

  function applyInlineEdit() {
    if (!editingKey.value) return
    const key = editingKey.value
    const [rowIndex, colIndex] = key.split(':').map(Number)
    setCellValue(rowIndex, colIndex, editorValue.value)
    editingKey.value = null
    editorValue.value = ''
  }

  function cancelInlineEdit() {
    editingKey.value = null
    editorValue.value = ''
  }

  /** 写入一格；输入以 = / @ 开头视为公式 */
  function setCellValue(rowIndex: number, colIndex: number, raw: string) {
    const key = cellKey(rowIndex, colIndex)
    const existing = cellMap.value.get(key)
    const value = raw ?? ''
    const asFormula = isFormulaLike(value)

    const next: RhStandardReportCell = {
      id: existing?.id || '',
      report_id: existing?.report_id || reportId.value,
      row_index: rowIndex,
      col_index: colIndex,
      text_value: asFormula ? null : value || null,
      formula_text: asFormula ? value : null,
      cell_type: value ? (asFormula ? 'formula' : 'text') : 'empty',
      format_text: existing?.format_text ?? null,
      style_key: existing?.style_key ?? null,
      side: existing?.side ?? null,
      merge_info: existing?.merge_info ?? null,
      col_width: existing?.col_width ?? null,
      row_height: existing?.row_height ?? null,
    }

    const map = new Map(cellMap.value)
    map.set(key, next)
    cellMap.value = map

    const dirty = new Set(dirtyKeys.value)
    dirty.add(key)
    dirtyKeys.value = dirty

    scheduleSave()
  }

  /** 从 Excel 粘贴：\t 分列、换行分行，落到当前选中格为左上角的区域 */
  function handleGridPaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text/plain')
    if (!text) return
    if (editingKey.value) return
    const baseRow = selectedRow.value ?? 0
    const baseCol = selectedCol.value ?? 0
    const rows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    if (rows.length && rows[rows.length - 1] === '') rows.pop()
    if (!rows.length) return

    event.preventDefault()
    rows.forEach((line, rowOffset) => {
      line.split('\t').forEach((value, colOffset) => {
        setCellValue(baseRow + rowOffset, baseCol + colOffset, value)
      })
    })
  }

  // ---------- 列宽 / 行高 ----------

  function ensureLength(list: number[], length: number, fallback: number) {
    const next = list.slice()
    while (next.length < length) next.push(fallback)
    return next
  }

  /** 本次拖动要一起调整的列：拖的列在选区内就整组联动，否则只动这一列 */
  function resolveResizeColumns(colIndex: number) {
    const selected = selectedColIndexes.value
    if (selected.size > 1 && selected.has(colIndex)) return Array.from(selected)
    // 框选了一片单元格时，取该区域覆盖的列
    if (selectedRanges.value.length && bulkSelectionMode.value === 'none') {
      const cols = new Set<number>()
      for (const range of selectedRanges.value) {
        for (let c = range.startCol; c <= range.endCol; c += 1) cols.add(c)
      }
      if (cols.size > 1 && cols.has(colIndex)) return Array.from(cols)
    }
    return [colIndex]
  }

  function resolveResizeRows(rowIndex: number) {
    const selected = selectedRowIndexes.value
    if (selected.size > 1 && selected.has(rowIndex)) return Array.from(selected)
    if (selectedRanges.value.length && bulkSelectionMode.value === 'none') {
      const rows = new Set<number>()
      for (const range of selectedRanges.value) {
        for (let r = range.startRow; r <= range.endRow; r += 1) rows.add(r)
      }
      if (rows.size > 1 && rows.has(rowIndex)) return Array.from(rows)
    }
    return [rowIndex]
  }

  function startColumnResize(_sheetId: string, colIndex: number, event: MouseEvent) {
    const startX = event.clientX
    const targets = resolveResizeColumns(colIndex)
    // 记下每列各自的起始宽度，按同一 delta 平移，避免不同宽度的列被拉成同一个值
    const startWidths = new Map(targets.map(index => [index, getColWidth(index)]))
    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      const next = ensureLength(colWidths.value, colCount.value, defaultColWidth.value)
      for (const index of targets) {
        next[index] = Math.max(40, (startWidths.get(index) || defaultColWidth.value) + delta)
      }
      colWidths.value = next
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      scheduleLayoutSave()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startRowResize(_sheetId: string, rowIndex: number, event: MouseEvent) {
    const startY = event.clientY
    const targets = resolveResizeRows(rowIndex)
    const startHeights = new Map(targets.map(index => [index, getRowHeight(index)]))
    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY
      const next = ensureLength(rowHeights.value, rowCount.value, defaultRowHeight.value)
      for (const index of targets) {
        next[index] = Math.max(18, (startHeights.get(index) || defaultRowHeight.value) + delta)
      }
      rowHeights.value = next
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      scheduleLayoutSave()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** 按该列最长内容估宽（中文按 2 字宽计） */
  function autoFitColumn(_sheetId: string, colIndex: number) {
    const targets = resolveResizeColumns(colIndex)
    const next = ensureLength(colWidths.value, colCount.value, defaultColWidth.value)
    for (const index of targets) {
      let maxLen = 4
      for (const cell of cellMap.value.values()) {
        if (cell.col_index !== index) continue
        const text = cell.formula_text || cell.text_value || ''
        let len = 0
        for (const char of text) len += /[一-龥＀-￯]/.test(char) ? 2 : 1
        if (len > maxLen) maxLen = len
      }
      next[index] = Math.min(360, Math.max(60, maxLen * 8 + 16))
    }
    colWidths.value = next
    scheduleLayoutSave()
  }

  function autoFitRow(_sheetId: string, rowIndex: number) {
    const targets = resolveResizeRows(rowIndex)
    const next = ensureLength(rowHeights.value, rowCount.value, defaultRowHeight.value)
    for (const index of targets) next[index] = defaultRowHeight.value
    rowHeights.value = next
    scheduleLayoutSave()
  }

  // ---------- 样式 ----------

  /** 当前选区涉及的所有坐标；没有选区时用当前选中格 */
  function selectionCellKeys(): Array<[number, number]> {
    const keys: Array<[number, number]> = []
    const seen = new Set<string>()
    const push = (rowIndex: number, colIndex: number) => {
      const key = cellKey(rowIndex, colIndex)
      if (seen.has(key)) return
      seen.add(key)
      keys.push([rowIndex, colIndex])
    }

    if (bulkSelectionMode.value === 'all') {
      // 只覆盖报表实际的数据范围：网格为了方便编辑会补足到 40x12，
      // 全选设样式时若连这些空白也写进去，会凭空产生几百条无意义的单元格记录
      const rows = Math.max(dataRowCount.value, 1)
      const cols = Math.max(dataColCount.value, 1)
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) push(r, c)
      }
      return keys
    }
    if (selectedRanges.value.length) {
      for (const range of selectedRanges.value) {
        for (let r = range.startRow; r <= range.endRow; r += 1) {
          for (let c = range.startCol; c <= range.endCol; c += 1) push(r, c)
        }
      }
      return keys
    }
    if (selectedRow.value !== null && selectedCol.value !== null) {
      push(selectedRow.value, selectedCol.value)
    }
    return keys
  }

  const hasStyleSelection = computed(() => selectionCellKeys().length > 0)

  /** 「3 行 x 2 列」这类提示；多块不相邻区域则给总格数 */
  const selectionSummary = computed(() => {
    if (bulkSelectionMode.value === 'all') return '整表'
    if (bulkSelectionMode.value === 'row') return `${selectedRowIndexes.value.size} 行`
    if (bulkSelectionMode.value === 'column') return `${selectedColIndexes.value.size} 列`
    const ranges = selectedRanges.value
    if (!ranges.length) return ''
    if (ranges.length === 1) {
      const [range] = ranges
      const rows = range.endRow - range.startRow + 1
      const cols = range.endCol - range.startCol + 1
      if (rows === 1 && cols === 1) return ''
      return `${rows} 行 x ${cols} 列`
    }
    return `${selectionCellKeys().length} 格`
  })

  /** 当前选区首格的样式，用于工具栏回显 */
  const currentStyle = computed<CellStyle>(() => {
    const keys = selectionCellKeys()
    const first = keys.length ? cellMap.value.get(cellKey(keys[0][0], keys[0][1])) : undefined
    return parseStyleKey(first?.style_key)
  })

  /** 给选区批量套用样式改动（patch 里只写要改的项） */
  function applyStyleToSelection(patch: Partial<CellStyle>) {
    const keys = selectionCellKeys()
    if (!keys.length) return

    const map = new Map(cellMap.value)
    const dirty = new Set(dirtyKeys.value)
    for (const [rowIndex, colIndex] of keys) {
      const key = cellKey(rowIndex, colIndex)
      const existing = map.get(key)
      map.set(key, {
        id: existing?.id || '',
        report_id: existing?.report_id || reportId.value,
        row_index: rowIndex,
        col_index: colIndex,
        text_value: existing?.text_value ?? null,
        formula_text: existing?.formula_text ?? null,
        cell_type: existing?.cell_type || (existing?.formula_text ? 'formula' : 'text'),
        format_text: existing?.format_text ?? null,
        style_key: mergeStyleKey(existing?.style_key, patch) || null,
        side: existing?.side ?? null,
        merge_info: existing?.merge_info ?? null,
        col_width: existing?.col_width ?? null,
        row_height: existing?.row_height ?? null,
      })
      dirty.add(key)
    }
    cellMap.value = map
    dirtyKeys.value = dirty
    scheduleSave()
  }

  /** 数字格式落在 format_text，不走 style_key */
  function applyNumberFormatToSelection(formatText: string) {
    const keys = selectionCellKeys()
    if (!keys.length) return

    const map = new Map(cellMap.value)
    const dirty = new Set(dirtyKeys.value)
    for (const [rowIndex, colIndex] of keys) {
      const key = cellKey(rowIndex, colIndex)
      const existing = map.get(key)
      map.set(key, {
        id: existing?.id || '',
        report_id: existing?.report_id || reportId.value,
        row_index: rowIndex,
        col_index: colIndex,
        text_value: existing?.text_value ?? null,
        formula_text: existing?.formula_text ?? null,
        cell_type: existing?.cell_type || (existing?.formula_text ? 'formula' : 'text'),
        format_text: formatText || null,
        style_key: existing?.style_key ?? null,
        side: existing?.side ?? null,
        merge_info: existing?.merge_info ?? null,
        col_width: existing?.col_width ?? null,
        row_height: existing?.row_height ?? null,
      })
      dirty.add(key)
    }
    cellMap.value = map
    dirtyKeys.value = dirty
    scheduleSave()
  }

  /** 字号增减：在当前值基础上加减，未设过则以 13 起算 */
  function adjustFontSize(delta: number) {
    const base = currentStyle.value.fontSize || 13
    applyStyleToSelection({ fontSize: Math.min(72, Math.max(8, base + delta)) })
  }

  // ---------- 合并单元格 ----------

  /** 当前选区的包围盒；无选区时退回当前选中格 */
  function currentSelectionBounds() {
    if (selectedRanges.value.length) {
      let startRow = Infinity
      let endRow = -1
      let startCol = Infinity
      let endCol = -1
      for (const range of selectedRanges.value) {
        startRow = Math.min(startRow, range.startRow)
        endRow = Math.max(endRow, range.endRow)
        startCol = Math.min(startCol, range.startCol)
        endCol = Math.max(endCol, range.endCol)
      }
      if (endRow >= 0 && endCol >= 0) return { startRow, endRow, startCol, endCol }
    }
    if (selectedRow.value === null || selectedCol.value === null) return null
    return {
      startRow: selectedRow.value,
      endRow: selectedRow.value,
      startCol: selectedCol.value,
      endCol: selectedCol.value,
    }
  }

  const canMergeSelection = computed(() => {
    const bounds = currentSelectionBounds()
    if (!bounds) return false
    return bounds.endRow > bounds.startRow || bounds.endCol > bounds.startCol
  })

  const canUnmergeSelection = computed(() => {
    const bounds = currentSelectionBounds()
    if (!bounds) return false
    const cell = cellMap.value.get(cellKey(bounds.startRow, bounds.startCol))
    const { rowSpan, colSpan } = parseMergeInfo(cell?.merge_info)
    return rowSpan > 1 || colSpan > 1
  })

  /** 合并选区：内容保留在左上角格，被覆盖的格清空 */
  function mergeSelection() {
    const bounds = currentSelectionBounds()
    if (!bounds) return
    const rowSpan = bounds.endRow - bounds.startRow + 1
    const colSpan = bounds.endCol - bounds.startCol + 1
    if (rowSpan <= 1 && colSpan <= 1) return

    const map = new Map(cellMap.value)
    const dirty = new Set(dirtyKeys.value)
    const anchorKey = cellKey(bounds.startRow, bounds.startCol)
    const anchor = map.get(anchorKey)

    map.set(anchorKey, {
      id: anchor?.id || '',
      report_id: anchor?.report_id || reportId.value,
      row_index: bounds.startRow,
      col_index: bounds.startCol,
      text_value: anchor?.text_value ?? null,
      formula_text: anchor?.formula_text ?? null,
      cell_type: anchor?.cell_type || (anchor?.formula_text ? 'formula' : 'text'),
      format_text: anchor?.format_text ?? null,
      style_key: anchor?.style_key ?? null,
      side: anchor?.side ?? null,
      merge_info: JSON.stringify({ rowSpan, colSpan }),
      col_width: anchor?.col_width ?? null,
      row_height: anchor?.row_height ?? null,
    })
    dirty.add(anchorKey)

    for (let r = bounds.startRow; r <= bounds.endRow; r += 1) {
      for (let c = bounds.startCol; c <= bounds.endCol; c += 1) {
        if (r === bounds.startRow && c === bounds.startCol) continue
        const key = cellKey(r, c)
        const existing = map.get(key)
        map.set(key, {
          id: existing?.id || '',
          report_id: existing?.report_id || reportId.value,
          row_index: r,
          col_index: c,
          text_value: null,
          formula_text: null,
          cell_type: 'merged',
          format_text: null,
          style_key: existing?.style_key ?? null,
          side: existing?.side ?? null,
          merge_info: null,
          col_width: null,
          row_height: null,
        })
        dirty.add(key)
      }
    }

    cellMap.value = map
    dirtyKeys.value = dirty
    scheduleSave()
  }

  /** 取消合并：清掉左上角格的 merge_info，被覆盖的格恢复为空文本格 */
  function unmergeSelection() {
    const bounds = currentSelectionBounds()
    if (!bounds) return
    const anchorKey = cellKey(bounds.startRow, bounds.startCol)
    const anchor = cellMap.value.get(anchorKey)
    if (!anchor) return
    const { rowSpan, colSpan } = parseMergeInfo(anchor.merge_info)
    if (rowSpan <= 1 && colSpan <= 1) return

    const map = new Map(cellMap.value)
    const dirty = new Set(dirtyKeys.value)

    map.set(anchorKey, { ...anchor, merge_info: null })
    dirty.add(anchorKey)

    for (let r = bounds.startRow; r < bounds.startRow + rowSpan; r += 1) {
      for (let c = bounds.startCol; c < bounds.startCol + colSpan; c += 1) {
        if (r === bounds.startRow && c === bounds.startCol) continue
        const key = cellKey(r, c)
        const existing = map.get(key)
        if (!existing || existing.cell_type !== 'merged') continue
        map.set(key, { ...existing, cell_type: 'empty' })
        dirty.add(key)
      }
    }

    cellMap.value = map
    dirtyKeys.value = dirty
    scheduleSave()
  }

  // 标准报表是单表，sheet 切换/增删无意义
  const handleSheetChange = () => {}
  const handleSheetEdit = () => {}

  const context: ReportGridContext = {
    templateData: templateData as unknown as ReportGridContext['templateData'],
    activeSheetName,
    isBalanceTemplate: computed(() => false),
    // 取数视图走只读通道：组件据此加 sheet-grid-readonly 并禁用页签关闭
    isDirectReportMode: isReadonly,
    // 行列头只在公式视图出现——它是选行选列、批量拖宽高的抓手，取数视图要的是报表原貌
    showGridHeaders: computed(() => !isReadonly.value),
    bulkSelectionMode: bulkSelectionMode as unknown as ReportGridContext['bulkSelectionMode'],
    selectedColIndex,
    selectedRowIndex,
    toColumnName,
    buildSheetRows,
    buildSheetVisibleCells,
    getGridTemplateColumns,
    getGridTemplateRows,
    getSheetGridWidth,
    toggleSelectAll,
    selectColumn,
    selectRow,
    autoFitColumn,
    autoFitRow,
    startColumnResize,
    startRowResize,
    isCellStructureSelected,
    selectGridCell,
    startDragSelection,
    setActiveEditorRef,
    handleInlineInput,
    applyInlineEdit,
    cancelInlineEdit,
    handleGridPaste,
    handleSheetChange,
    handleSheetEdit,
    getCellGridColumn,
    getCellGridRow,
  }

  return {
    context,
    // 状态
    reportId,
    reportName,
    cellMap,
    colWidths,
    rowHeights,
    isDirty,
    showComputed,
    viewMode,
    isReadonly,
    computedMap,
    selectedRow,
    selectedCol,
    selectedRowIndexes,
    selectedColIndexes,
    selectedRanges,
    canMergeSelection,
    canUnmergeSelection,
    selectionSummary,
    hasStyleSelection,
    currentStyle,
    editorValue,
    editingKey,
    rowCount,
    colCount,
    defaultColWidth,
    defaultRowHeight,
    saveState,
    saveError,
    lastSavedAt,
    // 方法
    loadDetail,
    collectDirtyCells,
    markSaved,
    flushSave,
    retrySave,
    cancelPendingSaves,
    dispose,
    setCellValue,
    mergeSelection,
    unmergeSelection,
    applyStyleToSelection,
    applyNumberFormatToSelection,
    adjustFontSize,
    startEditing,
    applyInlineEdit,
    toColumnName,
    cellKey,
    // 列宽/行高：打印与导出要和屏幕用同一套尺寸，否则排版对不上
    getColWidth,
    getRowHeight,
  }
}
