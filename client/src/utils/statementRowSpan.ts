const HEADER_COLUMN_KEYS = new Set([
  'partner', 'cat', 'docNo', 'docDate', 'invoiceType', 'taxRate', 'orderNo', 'extOrderNo',
])

export interface StatementSpanRow {
  docKey: string
}

export function getStatementRowSpan(
  rows: StatementSpanRow[],
  rowIndex: number,
  columnKey?: string,
): [number, number] {
  if (!columnKey || !HEADER_COLUMN_KEYS.has(columnKey)) return [1, 1]

  const current = rows[rowIndex]
  if (!current || rows[rowIndex - 1]?.docKey === current.docKey) return [0, 0]

  let rowSpan = 1
  while (rows[rowIndex + rowSpan]?.docKey === current.docKey) rowSpan += 1
  return [rowSpan, 1]
}
