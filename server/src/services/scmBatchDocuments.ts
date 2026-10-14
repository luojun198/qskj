export const MAX_SCM_BATCH_SELECTION = 30

export interface BatchPushDocument {
  id: string
  doc_no: string
  doc_type: string
  status: string
  partner_code?: string | null
  currency?: string | null
  push_progress?: string | null
}

const TARGET_TYPE: Record<string, string> = {
  PQ: 'PO',
  SQ: 'SOa',
  PO: 'PI',
  SOa: 'SO',
}

export function normalizeBatchIds(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error('ids 必须为数组')
  const ids = input.map(value => String(value || '').trim()).filter(Boolean)
  if (!ids.length) throw new Error('至少选择一张单据')
  if (ids.length > MAX_SCM_BATCH_SELECTION) throw new Error(`一次最多处理 ${MAX_SCM_BATCH_SELECTION} 张单据`)
  if (new Set(ids).size !== ids.length) throw new Error('单据ID存在重复')
  return ids
}

export function validateBatchPushDocuments(docs: BatchPushDocument[]): { sourceType: string; targetType: string } {
  if (!docs.length) throw new Error('至少选择一张单据')
  const sourceTypes = new Set(docs.map(doc => doc.doc_type))
  if (sourceTypes.size !== 1) throw new Error('批量下推要求来源类型一致')
  const sourceType = docs[0].doc_type
  if (sourceType === 'MR' || sourceType === 'MRP') throw new Error('MR/MRP 仅支持单张专用下推')
  const targetType = TARGET_TYPE[sourceType]
  if (!targetType) throw new Error(`单据类型 ${sourceType} 不支持批量下推`)
  // 状态：可下推类型（PO/PQ/SOa/SQ）一律允许 draft 与 audited 及其混合。
  // 这些类型都是承诺性/报价性单据，未审核也允许预下推生成下游草稿；下游统一以 draft 落库，不影响库存/账务。
  if (docs.some(doc => doc.status !== 'draft' && doc.status !== 'audited')) {
    throw new Error('批量下推要求全部单据为草稿或已审核')
  }
  if (docs.some(doc => doc.push_progress === 'full')) throw new Error('存在已全部下推单据')
  // PO → PI 会按供应商和币别拆分草稿；其余批量下推仍要求单一表头口径。
  if (sourceType !== 'PO' && new Set(docs.map(doc => doc.partner_code || '')).size !== 1) throw new Error('批量下推要求往来单位一致')
  if (sourceType !== 'PO' && new Set(docs.map(doc => doc.currency || 'CNY')).size !== 1) throw new Error('批量下推要求币别一致')
  return { sourceType, targetType }
}

interface TransactionDatabase {
  transaction<T>(fn: () => T): () => T
}

export function executeBatchAtomically<T>(
  db: TransactionDatabase,
  ids: string[],
  execute: (id: string) => T,
): T[] {
  return db.transaction(() => ids.map(execute))()
}

export interface ProductionPlanBatchDocument {
  id: string
  code: string
  status: string
  doc_count?: number
  mrp_status?: string | null
}

export function validateProductionPlanBatchAction(
  action: 'delete' | 'release' | 'unrelease' | 'reopen',
  plans: ProductionPlanBatchDocument[],
): void {
  if (!plans.length) throw new Error('至少选择一张计划')
  if (action === 'release' && plans.some(plan => (plan.status || 'draft') !== 'draft')) throw new Error('批量审核要求全部为草稿计划')
  if (action === 'delete' && plans.some(plan => plan.status !== 'draft')) throw new Error('批量删除要求全部为草稿计划')
  if (action === 'reopen' && plans.some(plan => plan.status !== 'closed')) throw new Error('批量重开要求全部为已关闭计划')
  if (action === 'unrelease') {
    if (plans.some(plan => plan.status !== 'released')) throw new Error('批量反审核要求全部为已审核计划')
    if (plans.some(plan => Number(plan.doc_count) > 0)) throw new Error('存在已有下游单据的计划')
    if (plans.some(plan => !!plan.mrp_status)) throw new Error('存在已进入MRP计算单的计划')
  }
}
