import type { InjectionKey, Ref, ComputedRef } from 'vue'

export type ReportGridContext = {
  templateData: Ref<any>
  activeSheetName: Ref<string>
  isBalanceTemplate: ComputedRef<boolean>
  isDirectReportMode: ComputedRef<boolean>
  showGridHeaders: ComputedRef<boolean>
  bulkSelectionMode: Ref<string>
  selectedColIndex: Ref<number | null>
  selectedRowIndex: Ref<number | null>
  toColumnName: (colIndex: number) => string
  buildSheetRows: (sheet: any) => any[]
  buildSheetVisibleCells: (sheet: any) => any[]
  getGridTemplateColumns: (sheetId: string, colCount: number) => string
  getGridTemplateRows: (sheetId: string, rowCount: number) => string
  getSheetGridWidth: (sheetId: string, colCount: number) => number
  toggleSelectAll: () => void
  selectColumn: (colIndex: number) => void
  selectRow: (rowIndex: number) => void
  autoFitColumn: (sheetId: string, colIndex: number) => void
  autoFitRow: (sheetId: string, rowIndex: number) => void
  startColumnResize: (sheetId: string, colIndex: number, event: MouseEvent) => void
  startRowResize: (sheetId: string, rowIndex: number, event: MouseEvent) => void
  isCellStructureSelected: (rowIndex: number, colIndex: number) => boolean
  selectGridCell: (cell: any, event?: MouseEvent) => void
  startDragSelection: (cell: any, event: MouseEvent) => void
  setActiveEditorRef: (el: Element | null) => void
  handleInlineInput: (cell: any, event: Event) => void
  applyInlineEdit: (cell: any) => void
  cancelInlineEdit: () => void
  handleGridPaste: (event: ClipboardEvent) => void
  handleSheetChange: (name: string | number) => void
  handleSheetEdit: (paneName: string | number | undefined, action: 'remove' | 'add') => void
  getCellGridColumn: (cell: { colIndex: number; colSpan: number }) => string
  getCellGridRow: (rowIndex: number, rowSpan: number) => string
}

export const REPORT_GRID_KEY: InjectionKey<ReportGridContext> = Symbol('reportGrid')
