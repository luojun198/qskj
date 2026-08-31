import type Database from 'better-sqlite3'

interface DownstreamLineSource {
  id?: string
  source_line_id?: string | null
  field_values?: string | Record<string, any> | null
}

function sourceAllocationIds(fieldValues: DownstreamLineSource['field_values']): string[] {
  if (!fieldValues) return []
  try {
    const values = typeof fieldValues === 'string' ? JSON.parse(fieldValues) : fieldValues
    const allocations = values?.source_line_allocations
    if (!Array.isArray(allocations)) return []
    return allocations
      .map(allocation => String(allocation?.source_line_id || '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function getSourceOrderNosByLine(
  db: Database.Database,
  accountSetId: string,
  lines: DownstreamLineSource[],
  sourceDocType: 'SOa' | 'PO',
): Map<string, string> {
  const sourceIdsByLine = new Map<string, Set<string>>()
  for (const line of lines) {
    const lineId = String(line.id || '').trim()
    if (!lineId) continue
    const sourceIds = new Set(sourceAllocationIds(line.field_values))
    const directSourceId = String(line.source_line_id || '').trim()
    if (directSourceId) sourceIds.add(directSourceId)
    if (sourceIds.size) sourceIdsByLine.set(lineId, sourceIds)
  }

  const sourceLineIds = [...new Set([...sourceIdsByLine.values()].flatMap(ids => [...ids]))]
  if (!sourceLineIds.length) return new Map()

  const placeholders = sourceLineIds.map(() => '?').join(',')
  const sourceRows = db.prepare(`
    SELECT line.id AS source_line_id, doc.doc_no
    FROM scm_doc_line line
    JOIN scm_doc doc ON doc.id=line.doc_id
      AND doc.account_set_id=line.account_set_id
      AND doc.doc_type=?
    WHERE line.account_set_id=? AND line.id IN (${placeholders})
  `).all(sourceDocType, accountSetId, ...sourceLineIds) as Array<{ source_line_id: string; doc_no: string }>
  const orderNoBySourceLine = new Map(sourceRows.map(row => [row.source_line_id, row.doc_no]))

  const result = new Map<string, string>()
  for (const [lineId, sourceIds] of sourceIdsByLine) {
    const orderNos = [...new Set([...sourceIds]
      .map(sourceId => orderNoBySourceLine.get(sourceId))
      .filter((orderNo): orderNo is string => !!orderNo))]
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    if (orderNos.length) result.set(lineId, orderNos.join('、'))
  }
  return result
}

export function getSalesDispatchOrderNosByLine(
  db: Database.Database,
  accountSetId: string,
  lines: DownstreamLineSource[],
): Map<string, string> {
  return getSourceOrderNosByLine(db, accountSetId, lines, 'SOa')
}

export function getPurchaseReceiptOrderNosByLine(
  db: Database.Database,
  accountSetId: string,
  lines: DownstreamLineSource[],
): Map<string, string> {
  return getSourceOrderNosByLine(db, accountSetId, lines, 'PO')
}
