import { computed, ref } from 'vue'
import type { Ref } from 'vue'

type TemplateCell = {
  id: string
  report_sheet_id: string
  row_index: number
  col_index: number
  cell_type: string
  text_value: string | null
  formula_text: string | null
  format_text: string | null
  style_key: string | null
  side: string | null
  merge_info: string | null
}

type TemplateSheet = {
  id: string
  sheet_name: string
  sheet_index: number
  cells: TemplateCell[]
}

type ExecutionCell = {
  id: string
  display_value: string
  error: string | null
  status: 'ok' | 'error'
}

type DraftCellInput = Partial<TemplateCell> & {
  id?: string
  row_index: number
  col_index: number
}

type DraftCellRecord = Partial<TemplateCell> & {
  id?: string
  row_index: number
  col_index: number
}

type PastedCellValue = {
  cell_type: string
  text_value: string | null
  formula_text: string | null
}

function buildDraftKey(sheetId: string, rowIndex: number, colIndex: number) {
  return `${sheetId}:${rowIndex}:${colIndex}`
}

function parsePastedCellValue(rawValue: string): PastedCellValue {
  const normalizedValue = rawValue.replace(/\r/g, '')
  const trimmedValue = normalizedValue.trim()

  if (!trimmedValue) {
    return {
      cell_type: 'empty',
      text_value: null,
      formula_text: null,
    }
  }

  if (trimmedValue.startsWith('=') || trimmedValue.startsWith('@')) {
    return {
      cell_type: 'formula',
      text_value: null,
      formula_text: trimmedValue,
    }
  }

  return {
    cell_type: 'text',
    text_value: normalizedValue || null,
    formula_text: null,
  }
}

export function useDynamicReportEditor(templateSheets: Ref<TemplateSheet[]>, selectedSheetId: Ref<string>) {
  const selectedCellId = ref('')
  const selectedPosition = ref<{ rowIndex: number; colIndex: number } | null>(null)
  const draftCells = ref<Record<string, DraftCellRecord>>({})
  const executionCells = ref<Record<string, ExecutionCell>>({})

  const selectedSheet = computed(() => templateSheets.value.find(sheet => sheet.id === selectedSheetId.value) || null)
  const selectedCell = computed(() => {
    const sheet = selectedSheet.value
    const position = selectedPosition.value
    if (!sheet || !position) return null

    const cell = sheet.cells.find(item => item.row_index === position.rowIndex && item.col_index === position.colIndex)
    const draft = draftCells.value[buildDraftKey(sheet.id, position.rowIndex, position.colIndex)]
    if (!cell && !draft) return null

    return {
      id: cell?.id || draft?.id || '',
      report_sheet_id: cell?.report_sheet_id || sheet.id,
      row_index: position.rowIndex,
      col_index: position.colIndex,
      cell_type: draft?.cell_type || cell?.cell_type || 'text',
      text_value: draft?.text_value === undefined ? (cell?.text_value ?? null) : draft.text_value,
      formula_text: draft?.formula_text === undefined ? (cell?.formula_text ?? null) : draft.formula_text,
      format_text: draft?.format_text === undefined ? (cell?.format_text ?? null) : draft.format_text,
      style_key: draft?.style_key === undefined ? (cell?.style_key ?? null) : draft.style_key,
      side: draft?.side === undefined ? (cell?.side ?? null) : draft.side,
    }
  })

  function selectCell(cellId: string, rowIndex?: number, colIndex?: number) {
    selectedCellId.value = cellId
    if (Number.isInteger(rowIndex) && Number.isInteger(colIndex)) {
      selectedPosition.value = { rowIndex: Number(rowIndex), colIndex: Number(colIndex) }
      return
    }

    const sheet = selectedSheet.value
    const cell = sheet?.cells.find(item => item.id === cellId)
    selectedPosition.value = cell ? { rowIndex: cell.row_index, colIndex: cell.col_index } : null
  }

  function selectPosition(rowIndex: number, colIndex: number) {
    selectedPosition.value = { rowIndex, colIndex }
    const sheet = selectedSheet.value
    const cell = sheet?.cells.find(item => item.row_index === rowIndex && item.col_index === colIndex)
    selectedCellId.value = cell?.id || ''
  }

  function updateDraftCell(payload: DraftCellInput) {
    const sheet = selectedSheet.value
    if (!sheet) return

    const key = buildDraftKey(sheet.id, payload.row_index, payload.col_index)
    draftCells.value = {
      ...draftCells.value,
      [key]: {
        ...(draftCells.value[key] || {}),
        ...payload,
        id: payload.id || draftCells.value[key]?.id || undefined,
        row_index: payload.row_index,
        col_index: payload.col_index,
      },
    }
  }

  function applyGridPaste(startRowIndex: number, startColIndex: number, rows: string[][]) {
    const sheet = selectedSheet.value
    if (!sheet) return 0

    const existingByPosition = new Map(sheet.cells.map(cell => [`${cell.row_index}:${cell.col_index}`, cell]))
    const nextDrafts = { ...draftCells.value }
    let updatedCount = 0

    rows.forEach((row, rowOffset) => {
      row.forEach((value, colOffset) => {
        const rowIndex = startRowIndex + rowOffset
        const colIndex = startColIndex + colOffset
        if (rowIndex < 0 || colIndex < 0) return

        const existingCell = existingByPosition.get(`${rowIndex}:${colIndex}`)
        const parsedValue = parsePastedCellValue(value)
        const key = buildDraftKey(sheet.id, rowIndex, colIndex)
        nextDrafts[key] = {
          ...(nextDrafts[key] || {}),
          id: existingCell?.id,
          row_index: rowIndex,
          col_index: colIndex,
          cell_type: parsedValue.cell_type,
          text_value: parsedValue.text_value,
          formula_text: parsedValue.formula_text,
          format_text: existingCell?.format_text || null,
        }
        updatedCount += 1
      })
    })

    draftCells.value = nextDrafts
    return updatedCount
  }

  function copyCellToPosition(sourceCell: TemplateCell | DraftCellRecord, targetRowIndex: number, targetColIndex: number) {
    updateDraftCell({
      row_index: targetRowIndex,
      col_index: targetColIndex,
      cell_type: sourceCell.cell_type || 'text',
      text_value: sourceCell.text_value ?? null,
      formula_text: sourceCell.formula_text ?? null,
      format_text: sourceCell.format_text ?? null,
      style_key: sourceCell.style_key ?? null,
    })
  }

  function moveCellToPosition(sourceCell: TemplateCell | DraftCellRecord, targetRowIndex: number, targetColIndex: number) {
    copyCellToPosition(sourceCell, targetRowIndex, targetColIndex)
    updateDraftCell({
      id: sourceCell.id,
      row_index: sourceCell.row_index,
      col_index: sourceCell.col_index,
      cell_type: 'empty',
      text_value: null,
      formula_text: null,
      format_text: sourceCell.format_text ?? null,
    })
  }

  function clearDrafts() {
    draftCells.value = {}
  }

  function buildSavePayload() {
    const sheet = selectedSheet.value
    if (!sheet) return { sheetId: '', cells: [] as Array<Partial<TemplateCell> & { id?: string; row_index: number; col_index: number }> }

    return {
      sheetId: sheet.id,
      cells: Object.values(draftCells.value)
        .filter(cell => cell.row_index !== undefined && cell.col_index !== undefined)
        .map(cell => {
          const entry: Record<string, unknown> = {
            id: cell.id,
            row_index: cell.row_index,
            col_index: cell.col_index,
            cell_type: cell.cell_type,
            text_value: cell.text_value === undefined ? null : cell.text_value,
            formula_text: cell.formula_text === undefined ? null : cell.formula_text,
            format_text: cell.format_text === undefined ? null : cell.format_text,
            style_key: cell.style_key === undefined ? null : cell.style_key,
          }
          if (cell.merge_info !== undefined) {
            entry.merge_info = cell.merge_info
          }
          return entry
        }),
    }
  }

  function applyExecutionResult(cells: ExecutionCell[]) {
    executionCells.value = cells.reduce<Record<string, ExecutionCell>>((acc, cell) => {
      acc[cell.id] = cell
      return acc
    }, {})
  }

  function resetExecutionResult() {
    executionCells.value = {}
  }

  return {
    selectedCellId,
    selectedPosition,
    selectedCell,
    draftCells,
    executionCells,
    selectCell,
    selectPosition,
    updateDraftCell,
    applyGridPaste,
    copyCellToPosition,
    moveCellToPosition,
    clearDrafts,
    buildSavePayload,
    applyExecutionResult,
    resetExecutionResult,
  }
}
