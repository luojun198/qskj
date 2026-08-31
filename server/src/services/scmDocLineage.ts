type ExistingDocLineSource = {
  id?: string | null
  source_line_id?: string | null
}

type IncomingDocLineSource = {
  id?: string | null
  source_line_id?: string | null
}

/**
 * 草稿单修改会重建明细行。旧客户端若未回传 source_line_id，按原明细 id 恢复来源行，
 * 避免采购入库等下游单据编辑后丢失订单下推关系。
 */
export function restoreMissingSourceLineIds<T extends IncomingDocLineSource>(
  incomingLines: T[],
  existingLines: ExistingDocLineSource[],
): T[] {
  const sourceByLineId = new Map<string, string>()
  for (const line of existingLines) {
    if (line.id && line.source_line_id) sourceByLineId.set(line.id, line.source_line_id)
  }

  for (const line of incomingLines) {
    if (!line.id) continue
    const sourceLineId = sourceByLineId.get(line.id)
    if (sourceLineId) line.source_line_id = sourceLineId
  }
  return incomingLines
}

type ExistingPlanProductSource = {
  id?: string | null
  item_code?: string | null
  source_line_id?: string | null
  source_doc_id?: string | null
}

type IncomingPlanProductSource = ExistingPlanProductSource

/**
 * 工单草稿编辑会重建成品行。优先按成品行 id 恢复来源；兼容旧客户端未回传 id 时，
 * 仅在同物料来源行和请求行都唯一的情况下匹配。无法唯一匹配时返回未匹配项，调用方应拒绝保存。
 */
export function restorePlanProductLineage<T extends IncomingPlanProductSource>(
  incomingProducts: T[],
  existingProducts: ExistingPlanProductSource[],
): { unmatchedSourceProductIds: string[] } {
  const incomingById = new Map(incomingProducts.filter(p => p.id).map(p => [p.id as string, p]))
  const sourcedExisting = existingProducts.filter(p => p.source_line_id || p.source_doc_id)
  const usedIncoming = new Set<T>()
  const unmatchedSourceProductIds: string[] = []

  for (const existing of sourcedExisting) {
    let incoming = existing.id ? incomingById.get(existing.id) : undefined
    if (incoming && existing.item_code && incoming.item_code !== existing.item_code) incoming = undefined
    if (!incoming && existing.item_code) {
      const sameExisting = sourcedExisting.filter(p => p.item_code === existing.item_code)
      const sameIncoming = incomingProducts.filter(p => p.item_code === existing.item_code && !usedIncoming.has(p))
      if (sameExisting.length === 1 && sameIncoming.length === 1) incoming = sameIncoming[0]
    }
    if (!incoming) {
      unmatchedSourceProductIds.push(existing.id || existing.item_code || 'unknown')
      continue
    }
    // 原来源是已落库业务关系，不允许客户端改写或清空。
    if (existing.source_line_id) incoming.source_line_id = existing.source_line_id
    if (existing.source_doc_id) incoming.source_doc_id = existing.source_doc_id
    usedIncoming.add(incoming)
  }

  return { unmatchedSourceProductIds }
}
