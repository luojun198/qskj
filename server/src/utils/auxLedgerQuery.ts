/**
 * 辅助账簿查询：兼容 aux_data JSON 与凭证分录固定列两种存储方式
 */

/** 辅助类别 code -> voucher_entries 固定列 */
export const AUX_LEGACY_COLUMNS: Record<string, { id: string; name: string }> = {
  dept: { id: 'dept_id', name: 'dept_name' },
  project: { id: 'project_id', name: 'project_name' },
  supplier: { id: 'supplier_id', name: 'supplier_name' },
  customer: { id: 'supplier_id', name: 'supplier_name' },
  person: { id: 'person_id', name: 'person_name' },
  func_class: { id: 'func_class_id', name: 'func_class_name' },
}

/** SQLite JSON 路径：键含 UUID/连字符时用引号包裹 */
export function jsonAuxPathForStorageKey(storageKey: string, field: 'id' | 'name' | 'field_values') {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(storageKey)) {
    return `json_extract(ve.aux_data, '$.${storageKey}.${field}')`
  }
  const escaped = storageKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `json_extract(ve.aux_data, '$."${escaped}".${field}')`
}

export function jsonAuxPath(categoryCode: string, field: 'id' | 'name' | 'field_values') {
  return jsonAuxPathForStorageKey(categoryCode, field)
}

/** json_extract 已返回去引号的文本，无需 json_unquote（部分环境未编译该函数） */
export function jsonAuxPathUnquoted(categoryCode: string, field: 'id' | 'name') {
  return jsonAuxPathForStorageKey(categoryCode, field)
}

export type AuxMatchOptions = {
  itemCodes?: string[]
  /** 凭证 aux_data 可能以类别 UUID 为键（与 code 并存） */
  categoryId?: string
  /** json.id 也可能存项目编码（历史/导入数据） */
  matchItemCodesInJsonId?: boolean
}

function auxDataStorageKeys(categoryCode: string, categoryId?: string): string[] {
  const keys = [categoryCode]
  if (categoryId && categoryId !== categoryCode) {
    keys.push(categoryId)
  }
  return keys
}

/**
 * 追加与 buildAuxItemMatchCondition 对应的绑定参数（json 列 + 固定列 IN 需各传一遍 itemIds）
 */
export function appendAuxItemMatchParams(
  target: unknown[],
  categoryCode: string,
  itemIds: string[],
  options?: AuxMatchOptions
) {
  const keys = auxDataStorageKeys(categoryCode, options?.categoryId)
  for (let i = 0; i < keys.length; i++) {
    target.push(...itemIds)
  }

  const codes = options?.itemCodes?.filter(Boolean) || []
  if (options?.matchItemCodesInJsonId && codes.length > 0) {
    for (let i = 0; i < keys.length; i++) {
      target.push(...codes)
    }
  }

  if (AUX_LEGACY_COLUMNS[categoryCode]) {
    target.push(...itemIds)
  }
  if (categoryCode === 'cash_flow' && codes.length > 0) {
    target.push(...codes)
  }
}

/** WHERE：匹配 aux_data 或固定列中的辅助项目 id */
export function buildAuxItemMatchCondition(
  categoryCode: string,
  itemIdsPlaceholder: string,
  options?: AuxMatchOptions
): string {
  const parts: string[] = []
  const keys = auxDataStorageKeys(categoryCode, options?.categoryId)
  for (const key of keys) {
    parts.push(`${jsonAuxPathForStorageKey(key, 'id')} IN (${itemIdsPlaceholder})`)
  }

  const codes = options?.itemCodes?.filter(Boolean) || []
  if (options?.matchItemCodesInJsonId && codes.length > 0) {
    const codePh = codes.map(() => '?').join(',')
    for (const key of keys) {
      parts.push(`${jsonAuxPathForStorageKey(key, 'id')} IN (${codePh})`)
    }
  }

  const legacy = AUX_LEGACY_COLUMNS[categoryCode]
  if (legacy) {
    parts.push(`ve.${legacy.id} IN (${itemIdsPlaceholder})`)
  }

  if (categoryCode === 'cash_flow' && codes.length > 0) {
    const codePh = codes.map(() => '?').join(',')
    parts.push(`ve.cash_flow_code IN (${codePh})`)
  }

  return `(${parts.join(' OR ')})`
}

/** SELECT：优先 aux_data，回退固定列 */
export function buildAuxIdSelect(categoryCode: string, categoryId?: string) {
  const parts: string[] = []
  for (const key of auxDataStorageKeys(categoryCode, categoryId)) {
    parts.push(jsonAuxPathForStorageKey(key, 'id'))
  }
  const legacy = AUX_LEGACY_COLUMNS[categoryCode]
  if (legacy) {
    parts.push(`ve.${legacy.id}`)
  }
  if (categoryCode === 'cash_flow') {
    parts.push('ve.cash_flow_code')
  }
  return parts.length === 1 ? parts[0] : `COALESCE(${parts.join(', ')})`
}

export function buildAuxNameSelect(categoryCode: string, categoryId?: string) {
  const parts: string[] = []
  for (const key of auxDataStorageKeys(categoryCode, categoryId)) {
    parts.push(jsonAuxPathForStorageKey(key, 'name'))
  }
  const legacy = AUX_LEGACY_COLUMNS[categoryCode]
  if (legacy) {
    parts.push(`ve.${legacy.name}`)
  }
  if (categoryCode === 'cash_flow') {
    parts.push('ve.cash_flow_name')
  }
  return parts.length === 1 ? parts[0] : `COALESCE(${parts.join(', ')})`
}

export function buildAuxFieldValuesSelect(categoryCode: string, categoryId?: string) {
  const parts = auxDataStorageKeys(categoryCode, categoryId).map(key =>
    jsonAuxPathForStorageKey(key, 'field_values')
  )
  return parts.length === 1 ? parts[0] : `COALESCE(${parts.join(', ')})`
}

/** 构建辅助账簿查询用的 match 选项 */
export function buildAuxMatchOptions(
  categoryCode: string,
  categoryIdByCode: Map<string, string>,
  batch: Array<{ code?: string }>
): AuxMatchOptions {
  const itemCodes = batch.map(item => item.code).filter(Boolean) as string[]
  return {
    categoryId: categoryIdByCode.get(categoryCode),
    itemCodes,
    matchItemCodesInJsonId: itemCodes.length > 0,
  }
}

/** 查询辅助项目编码（现金流量等按 code 存于分录固定列） */
export function lookupAuxItemCode(
  db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } },
  accountSetId: string,
  itemId: string
): string | null {
  const row = db
    .prepare('SELECT code FROM aux_items WHERE id=? AND account_set_id=?')
    .get(itemId, accountSetId) as { code: string } | undefined
  return row?.code ? String(row.code) : null
}

/**
 * 凭证明细汇总：匹配条件 + 等值过滤 的 SQL 片段与参数（避免占位符与参数个数不一致）
 */
export function buildAuxVoucherEntryFilter(
  categoryCode: string,
  itemId: string,
  itemCode: string | null
): { sql: string; params: string[] } {
  const itemCodes = categoryCode === 'cash_flow' && itemCode ? [itemCode] : undefined
  const matchCondition = buildAuxItemMatchCondition(categoryCode, '?', { itemCodes })
  const params: string[] = [itemId]
  if (AUX_LEGACY_COLUMNS[categoryCode]) {
    params.push(itemId)
  }
  if (categoryCode === 'cash_flow' && itemCode) {
    params.push(itemCode)
  }

  if (categoryCode === 'cash_flow') {
    const jsonId = jsonAuxPathUnquoted(categoryCode, 'id')
    const eqParams = itemCode ? [itemId, itemCode] : [itemId]
    const eqSql = itemCode
      ? `(${jsonId} = ? OR ve.cash_flow_code = ?)`
      : `(${jsonId} = ?)`
    return {
      sql: `(${matchCondition}) AND ${eqSql}`,
      params: [...params, ...eqParams],
    }
  }

  return {
    sql: `(${matchCondition}) AND ((${buildAuxIdSelect(categoryCode)}) = ?)`,
    params: [...params, itemId],
  }
}

export type AuxItemMeta = {
  id: string
  code?: string
  name: string
  category_code: string
  category_name?: string
}

export function buildAuxItemLookup(items: AuxItemMeta[]) {
  const byId = new Map<string, AuxItemMeta>()
  const byCode = new Map<string, AuxItemMeta>()
  for (const item of items) {
    byId.set(String(item.id), item)
    if (item.code) {
      byCode.set(`${item.category_code}:${item.code}`, item)
    }
  }
  return { byId, byCode }
}

export function enrichAuxLedgerEntry(
  entry: Record<string, any>,
  categoryCode: string,
  categoryNameByCode: Map<string, string>,
  lookup: ReturnType<typeof buildAuxItemLookup>
) {
  entry.category_code = entry.category_code || categoryCode
  entry.category_name =
    entry.category_name || categoryNameByCode.get(categoryCode) || categoryCode

  let auxId = entry.aux_id != null ? String(entry.aux_id) : ''
  if (auxId.startsWith('"') && auxId.endsWith('"')) {
    auxId = auxId.slice(1, -1)
    entry.aux_id = auxId
  }

  if (!entry.aux_name || entry.aux_name === 'null') {
    const byId = lookup.byId.get(auxId)
    if (byId?.name) {
      entry.aux_name = byId.name
    } else if (auxId) {
      const byCode = lookup.byCode.get(`${categoryCode}:${auxId}`)
      if (byCode?.name) {
        entry.aux_name = byCode.name
        if (!entry.aux_id || entry.aux_id === auxId) {
          entry.aux_id = byCode.id
        }
      }
    }
  }

  if (typeof entry.aux_name === 'string' && entry.aux_name.startsWith('"') && entry.aux_name.endsWith('"')) {
    entry.aux_name = entry.aux_name.slice(1, -1)
  }
}
