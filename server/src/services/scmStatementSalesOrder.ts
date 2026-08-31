import type Database from 'better-sqlite3'

interface SourceOrderLink {
  doc_id: string
  order_no: string
  source_field_values: string | null
}

function statementSourceOrderLinks(
  db: Database.Database,
  accountSetId: string,
  docs: Array<{ id?: string }>,
): SourceOrderLink[] {
  const ids = [...new Set(docs.map(doc => doc.id).filter(Boolean) as string[])]
  if (!ids.length) return []

  const placeholders = ids.map(() => '?').join(',')
  const links = db.prepare(`
    SELECT child.id AS doc_id, source.doc_no AS order_no, source.field_values AS source_field_values
    FROM scm_doc child
    JOIN scm_doc source ON source.id=child.source_doc_id
      AND source.account_set_id=child.account_set_id AND source.doc_type IN ('SOa','PO')
    WHERE child.account_set_id=? AND child.id IN (${placeholders})
    UNION
    SELECT line.doc_id AS doc_id, source.doc_no AS order_no, source.field_values AS source_field_values
    FROM scm_doc_line line
    JOIN scm_doc_line source_line ON source_line.id=line.source_line_id
    JOIN scm_doc source ON source.id=source_line.doc_id
      AND source.account_set_id=line.account_set_id AND source.doc_type IN ('SOa','PO')
    WHERE line.account_set_id=? AND line.doc_id IN (${placeholders})
    ORDER BY doc_id, order_no
  `).all(accountSetId, ...ids, accountSetId, ...ids) as SourceOrderLink[]

  const allocationRows = db.prepare(`
    SELECT doc_id, field_values FROM scm_doc_line
    WHERE account_set_id=? AND doc_id IN (${placeholders}) AND field_values IS NOT NULL AND field_values<>''
  `).all(accountSetId, ...ids) as Array<{ doc_id: string; field_values: string | null }>
  const allocations: Array<{ doc_id: string; source_line_id: string }> = []
  for (const row of allocationRows) {
    try {
      const values = JSON.parse(row.field_values || '{}')?.source_line_allocations
      if (!Array.isArray(values)) continue
      for (const value of values) {
        if (value?.source_line_id) allocations.push({ doc_id: row.doc_id, source_line_id: String(value.source_line_id) })
      }
    } catch { /* 合并来源快照损坏时忽略，保留其它可追溯来源 */ }
  }
  const sourceLineIds = [...new Set(allocations.map(row => row.source_line_id))]
  if (!sourceLineIds.length) return links

  const sourceRows = db.prepare(`
    SELECT line.id AS source_line_id, source.doc_no AS order_no, source.field_values AS source_field_values
    FROM scm_doc_line line
    JOIN scm_doc source ON source.id=line.doc_id
      AND source.account_set_id=line.account_set_id AND source.doc_type IN ('SOa','PO')
    WHERE line.account_set_id=? AND line.id IN (${sourceLineIds.map(() => '?').join(',')})
  `).all(accountSetId, ...sourceLineIds) as Array<{ source_line_id: string; order_no: string; source_field_values: string | null }>
  const sourceByLine = new Map(sourceRows.map(row => [row.source_line_id, row]))
  for (const allocation of allocations) {
    const source = sourceByLine.get(allocation.source_line_id)
    if (source) links.push({ doc_id: allocation.doc_id, ...source })
  }
  return links.sort((a, b) => a.doc_id.localeCompare(b.doc_id) || a.order_no.localeCompare(b.order_no))
}

export function getStatementSalesOrderNos(
  db: Database.Database,
  accountSetId: string,
  docs: Array<{ id?: string }>,
): Map<string, string> {
  const values = new Map<string, string[]>()
  for (const row of statementSourceOrderLinks(db, accountSetId, docs)) {
    const nos = values.get(row.doc_id) || []
    if (!nos.includes(row.order_no)) nos.push(row.order_no)
    values.set(row.doc_id, nos)
  }
  return new Map([...values].map(([id, nos]) => [id, nos.join('、')]))
}

export function getStatementExternalOrderNos(
  db: Database.Database,
  accountSetId: string,
  docs: Array<{ id?: string }>,
): Map<string, string> {
  const values = new Map<string, string[]>()
  for (const row of statementSourceOrderLinks(db, accountSetId, docs)) {
    try {
      const value = JSON.parse(row.source_field_values || '{}')?.external_order_no
      if (value) {
        const nos = values.get(row.doc_id) || []
        if (!nos.includes(String(value))) nos.push(String(value))
        values.set(row.doc_id, nos)
      }
    } catch { /* 源单自定义字段损坏时忽略，避免阻断对账单 */ }
  }
  return new Map([...values].map(([id, nos]) => [id, nos.join('、')]))
}
