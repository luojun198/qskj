type TableColumn = {
  field: string
  label: string
  width: string
  align?: string
  visible?: boolean
}

type FieldElement = {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  fontWeight: string
  align: string
  columns?: TableColumn[]
  printRows?: number
  [key: string]: unknown
}

type PrintTemplateElements = {
  title?: { text?: string; fontSize?: number; fontWeight?: string; align?: string }
  info?: { fontSize?: number }
  table?: { columns?: TableColumn[]; fontSize?: number; borderWidth?: number }
}

function createElementId(type: string): string {
  return `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function createFieldElement(
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Record<string, unknown> = {}
): FieldElement {
  return {
    id: createElementId(type),
    type,
    x,
    y,
    width,
    height,
    fontSize: 12,
    fontWeight: 'normal',
    align: 'left',
    ...options,
  }
}

function defaultTableColumns(): TableColumn[] {
  return [
    { field: 'summary', label: '摘要', width: '30%', align: 'left', visible: true },
    { field: 'account_code', label: '科目代码', width: '12%', align: 'center', visible: true },
    { field: 'account_name', label: '科目名称', width: '23%', align: 'left', visible: true },
    { field: 'debit', label: '借方金额', width: '17.5%', align: 'right', visible: true },
    { field: 'credit', label: '贷方金额', width: '17.5%', align: 'right', visible: true },
  ]
}

function normalizeTableColumns(columns: TableColumn[] | undefined): TableColumn[] {
  if (!columns?.length) return defaultTableColumns()
  return columns.map(col => ({
    ...col,
    field: col.field === 'account' ? 'account_name' : col.field,
    visible: col.visible !== false,
    align: col.align || 'left',
  }))
}

function getDefaultFieldElements(legacy?: PrintTemplateElements, contentWidth = 200): FieldElement[] {
  const titleText = legacy?.title?.text || '记账凭证'
  const tableColumns = normalizeTableColumns(legacy?.table?.columns)

  return [
    createFieldElement('title', 50, 2, 100, 10, {
      text: titleText,
      fontSize: legacy?.title?.fontSize || 16,
      fontWeight: legacy?.title?.fontWeight || 'bold',
      align: legacy?.title?.align || 'center',
    }),
    createFieldElement('account_set_name', 60, 12, 80, 6, { fontSize: 9, align: 'center' }),
    createFieldElement('voucher_no', 0, 20, 50, 6, { fontSize: legacy?.info?.fontSize || 9, align: 'left' }),
    createFieldElement('date', contentWidth - 50, 20, 50, 6, {
      fontSize: legacy?.info?.fontSize || 9,
      align: 'right',
      dateFormat: 'YYYY-MM-DD',
    }),
    createFieldElement('table', 0, 28, contentWidth, 50, {
      fontSize: legacy?.table?.fontSize || 9,
      borderWidth: legacy?.table?.borderWidth || 1,
      showHeader: true,
      rowHeight: 6,
      printRows: 6,
      numberFormat: 'thousand',
      columns: tableColumns,
    }),
    createFieldElement('signature_maker', 0, 82, 45, 6, { fontSize: 9, align: 'center' }),
    createFieldElement('signature_auditor', 50, 82, 45, 6, { fontSize: 9, align: 'center' }),
    createFieldElement('signature_poster', 100, 82, 45, 6, { fontSize: 9, align: 'center' }),
    createFieldElement('signature_supervisor', 150, 82, 45, 6, { fontSize: 9, align: 'center' }),
  ]
}

export function normalizePrintTemplateElements(
  elements: unknown,
  paperWidth = 220,
  _paperHeight = 140
): FieldElement[] {
  if (Array.isArray(elements) && elements.length > 0) {
    return elements.map(el => ({
      ...el,
      columns: el.type === 'table' ? normalizeTableColumns(el.columns) : el.columns,
      printRows: el.type === 'table' ? Math.max(2, el.printRows || 6) : el.printRows,
    }))
  }

  if (elements && typeof elements === 'object' && !Array.isArray(elements)) {
    const contentWidth = Math.max(100, paperWidth - 20)
    return getDefaultFieldElements(elements as PrintTemplateElements, contentWidth)
  }

  return getDefaultFieldElements()
}
