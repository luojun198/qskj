import type { ScmDoc } from '@/api/scm'
import { hasTrace, isLocked, pushTarget } from '@/utils/scmDoc'

export const MAX_SCM_BATCH_SELECTION = 30

export interface ScmActionAvailability {
  enabled: boolean
  reason?: string
  targetType?: string
}

export interface ScmDocBatchActionState {
  count: number
  single: boolean
  view: ScmActionAvailability
  edit: ScmActionAvailability
  audit: ScmActionAvailability
  unaudit: ScmActionAvailability
  delete: ScmActionAvailability
  print: ScmActionAvailability
  genVoucher: ScmActionAvailability
  trace: ScmActionAvailability
  push: ScmActionAvailability
  mrp: ScmActionAvailability
}

const disabled = (reason: string): ScmActionAvailability => ({ enabled: false, reason })
const enabled = (extra: Partial<ScmActionAvailability> = {}): ScmActionAvailability => ({ enabled: true, ...extra })

export function isSelectableScmDoc(row: ScmDoc & { __summary?: boolean }): boolean {
  return !row.__summary && !!row.id
}

function all(rows: ScmDoc[], predicate: (row: ScmDoc) => boolean): boolean {
  return rows.length > 0 && rows.every(predicate)
}

function batchPushState(rows: ScmDoc[]): ScmActionAvailability {
  if (!rows.length) return disabled('请先选择单据')
  const types = new Set(rows.map(row => row.doc_type))
  if (types.size !== 1) return disabled('批量下推要求单据类型一致')
  const sourceType = rows[0].doc_type
  if (sourceType === 'MR' || sourceType === 'MRP') return disabled('MR/MRP 仅支持单张专用下推')
  const targetType = pushTarget(sourceType)
  if (!targetType) return disabled('当前单据类型不支持下推')
  // 状态：可下推类型（PO/PQ/SOa/SQ）一律允许 draft 与 audited 及其混合。
  // 这些类型都是承诺性/报价性单据，未审核也常需要预下推生成下游草稿做参考；
  // 下游单据一律以 draft 落库，不影响库存/账务。
  if (!all(rows, row => row.status === 'draft' || row.status === 'audited')) {
    return disabled('批量下推要求全部为草稿或已审核单据')
  }
  if (rows.some(row => row.push_progress === 'full')) return disabled('存在已全部下推单据')
  // MRP 关联锁定订单的编辑/反审核，不能阻止销售订单继续合并出库；
  // 已完全下推的订单已在上方单独拦截，部分下推订单则允许继续下推。
  // PO → PI 在服务端按供应商与币别拆草稿，不要求同一表头。
  if (sourceType !== 'PO' && new Set(rows.map(row => row.partner_code || '')).size !== 1) return disabled('批量下推要求往来单位一致')
  if (sourceType !== 'PO' && new Set(rows.map(row => row.currency || 'CNY')).size !== 1) return disabled('批量下推要求币别一致')
  return enabled({ targetType })
}

function batchMrpState(rows: ScmDoc[]): ScmActionAvailability {
  if (!all(rows, row => row.doc_type === 'SOa' && row.status === 'audited' && row.push_progress !== 'full')) {
    return disabled('合并MRP要求全部为可下推的已审核销售订单')
  }
  if (new Set(rows.map(row => row.currency || 'CNY')).size !== 1) {
    return disabled('合并MRP要求币别一致')
  }
  return enabled()
}

export function getDocBatchActionState(rows: ScmDoc[]): ScmDocBatchActionState {
  const count = rows.length
  const single = count === 1
  const one = rows[0]
  const nonMrp = all(rows, row => row.doc_type !== 'MRP')
  const draft = all(rows, row => row.status === 'draft')
  const audited = all(rows, row => row.status === 'audited')
  const unlocked = all(rows, row => !isLocked(row))
  const mrpUnlocked = all(rows, row => !['draft', 'audited'].includes(String(row.mrp_status || '')))

  return {
    count,
    single,
    view: single ? enabled() : disabled('查看仅支持单选'),
    edit: single && one.status === 'draft' && !isLocked(one) ? enabled() : disabled('编辑仅支持未锁定的单张草稿'),
    audit: nonMrp && draft && mrpUnlocked ? enabled() : disabled('审核要求全部为可审核草稿'),
    unaudit: nonMrp && audited && mrpUnlocked ? enabled() : disabled('反审核要求全部为未被MRP锁定的已审核单据'),
    delete: nonMrp && draft && unlocked ? enabled() : disabled('删除要求全部为未锁定草稿'),
    print: nonMrp && count > 0 ? enabled() : disabled('请先选择可打印单据'),
    genVoucher: nonMrp && audited && all(rows, row => !row.voucher_id) ? enabled() : disabled('生成凭证要求全部已审核且尚未生成凭证'),
    trace: single && hasTrace(one) ? enabled() : disabled('上下游仅支持存在关联的单张单据'),
    push: batchPushState(rows),
    mrp: batchMrpState(rows),
  }
}

export interface ProductionPlanBatchRow {
  id: string
  code?: string
  status?: string
  doc_count?: number
  mrp_status?: string | null
  source_doc_id?: string | null
  mrp_doc_id?: string | null
}

/** 是否存在上下游关联（数据驱动控制「上下游」按钮，与单据侧 hasTrace 同一口径） */
export function hasProductionPlanTrace(row: ProductionPlanBatchRow): boolean {
  return !!row.source_doc_id || !!row.mrp_doc_id || (Number(row.doc_count) || 0) > 0
}

export function getProductionPlanBatchActionState(rows: ProductionPlanBatchRow[]) {
  const count = rows.length
  const single = count === 1
  const allStatus = (status: string) => count > 0 && rows.every(row => (row.status || 'draft') === status)
  const blockedByDownstream = rows.some(row => Number(row.doc_count) > 0)
  const blockedByMrp = rows.some(row => !!row.mrp_status)
  return {
    count,
    single,
    edit: single && allStatus('draft') ? enabled() : disabled('编辑仅支持单张草稿'),
    order: single ? enabled() : disabled('工单仅支持单选'),
    delete: allStatus('draft') ? enabled() : disabled('批量删除要求全部为草稿'),
    unrelease: allStatus('released') && !blockedByDownstream && !blockedByMrp
      ? enabled()
      : disabled(blockedByMrp ? '存在已进入MRP的计划' : blockedByDownstream ? '存在下游单据' : '批量反审核要求全部为已审核计划'),
    reopen: allStatus('closed') ? enabled() : disabled('批量重开要求全部为已关闭计划'),
    push: single && allStatus('released') ? enabled() : disabled('领料/完工下推保持单张操作'),
    trace: single && hasProductionPlanTrace(rows[0]) ? enabled() : disabled('上下游仅支持存在关联的单张计划'),
  }
}
