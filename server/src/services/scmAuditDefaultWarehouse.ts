interface AuditDocLike {
  id: string
  warehouse_code?: string | null
}

interface AuditLineLike {
  id: string
  seq?: number | null
  item_code: string
  warehouse_code?: string | null
  qty?: number | null
}

interface AuditWarehouseDb {
  prepare(sql: string): { all(...params: any[]): any[]; run(...params: any[]): unknown }
}

export interface DefaultWarehouseCandidate {
  line_id: string
  seq: number | null
  item_code: string
  item_name: string
  warehouse_code: string
  warehouse_name: string
}

export interface MissingDefaultWarehouseItem {
  line_id: string
  seq: number | null
  item_code: string
  item_name: string
}

export function inspectAuditDefaultWarehouses(
  db: AuditWarehouseDb,
  accountSetId: string,
  doc: AuditDocLike,
  lines: AuditLineLike[],
): { candidates: DefaultWarehouseCandidate[]; missing: MissingDefaultWarehouseItem[] } {
  if (String(doc.warehouse_code || '').trim()) return { candidates: [], missing: [] }

  const itemByCode = new Map<string, { name?: string | null; default_warehouse_code?: string | null }>()
  const warehouseNameByCode = new Map<string, string>()
  const candidates: DefaultWarehouseCandidate[] = []
  const missing: MissingDefaultWarehouseItem[] = []

  for (const line of lines) {
    if (Number(line.qty) <= 0 || String(line.warehouse_code || '').trim()) continue
    let item = itemByCode.get(line.item_code)
    if (!item) {
      item = db.prepare('SELECT name, default_warehouse_code FROM scm_item WHERE account_set_id=? AND code=?')
        .all(accountSetId, line.item_code)[0] as typeof item
      itemByCode.set(line.item_code, item || {})
    }
    const itemName = String(item?.name || line.item_code)
    const warehouseCode = String(item?.default_warehouse_code || '').trim()
    const payload = { line_id: line.id, seq: line.seq ?? null, item_code: line.item_code, item_name: itemName }
    if (warehouseCode) {
      if (!warehouseNameByCode.has(warehouseCode)) {
        const warehouse = db.prepare('SELECT name FROM scm_warehouse WHERE account_set_id=? AND code=?')
          .all(accountSetId, warehouseCode)[0] as { name?: string | null } | undefined
        warehouseNameByCode.set(warehouseCode, String(warehouse?.name || warehouseCode))
      }
      candidates.push({ ...payload, warehouse_code: warehouseCode, warehouse_name: warehouseNameByCode.get(warehouseCode)! })
    }
    else missing.push(payload)
  }
  return { candidates, missing }
}

/** 只填补空明细；表头仅在所有有效明细仓库一致时补齐。调用方必须在审核事务内执行。 */
export function applyAuditDefaultWarehouses(
  db: AuditWarehouseDb,
  accountSetId: string,
  doc: AuditDocLike,
  lines: AuditLineLike[],
  candidates: DefaultWarehouseCandidate[],
): string | null {
  const updateLine = db.prepare("UPDATE scm_doc_line SET warehouse_code=? WHERE id=? AND doc_id=? AND account_set_id=? AND (warehouse_code IS NULL OR TRIM(warehouse_code)='')")
  for (const candidate of candidates) updateLine.run(candidate.warehouse_code, candidate.line_id, doc.id, accountSetId)

  if (String(doc.warehouse_code || '').trim()) return null
  const candidateByLineId = new Map(candidates.map(candidate => [candidate.line_id, candidate.warehouse_code]))
  const warehouses = new Set(
    lines
      .filter(line => Number(line.qty) > 0)
      .map(line => String(line.warehouse_code || candidateByLineId.get(line.id) || '').trim())
      .filter(Boolean),
  )
  if (warehouses.size !== 1) return null
  const warehouseCode = [...warehouses][0]
  db.prepare("UPDATE scm_doc SET warehouse_code=? WHERE id=? AND account_set_id=? AND (warehouse_code IS NULL OR TRIM(warehouse_code)='')")
    .run(warehouseCode, doc.id, accountSetId)
  return warehouseCode
}
