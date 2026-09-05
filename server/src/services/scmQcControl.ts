/**
 * 质检单与生产链路的联动
 *
 * 质检单（IQC/IPQC/FQC）此前是一座孤岛：建了、审了，对入库和成本没有任何影响，
 * 不良数量也只能靠人工再开一张不良品入库单。这里补上两条联动：
 *   1. 参数 `scm:qc_required_for_finish` 打开后，完工入库前必须有一张判定合格的已审核 FQC；
 *   2. 质检单的不良明细可以一键下推成不良品入库单(PS)，走 PS 的工单成本上卷口径。
 */
import type Database from 'better-sqlite3'

export const QC_REQUIRED_FOR_FINISH_PARAM = 'scm:qc_required_for_finish'

export interface QcDefectLine {
  item_code: string
  qty: number
  batch_no: string | null
  remark: string | null
}

/** 完工入库是否要求先过 FQC 检验（系统参数 → 供应链，默认关） */
export function isQcRequiredForFinish(db: Database.Database, accountSetId: string): boolean {
  const row = db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(accountSetId, QC_REQUIRED_FOR_FINISH_PARAM) as { param_value?: string } | undefined
  return row?.param_value === '1'
}

/**
 * 完工入库前的质检校验。
 *
 * 合格的判定：存在一张 `status='audited'`、`result='pass'` 的 FQC 质检单，
 * 其来源指向本张完工单**或**本工单（两种挂法都允许：先检后入库时通常挂工单，
 * 补检时才挂到具体的完工单上）。
 *
 * @returns 错误信息；无需校验或已通过时返回 null
 */
export function validateFinishQc(
  db: Database.Database,
  accountSetId: string,
  doc: { id: string; doc_no: string; doc_type: string; plan_id?: string | null },
): string | null {
  if (doc.doc_type !== 'PF' && doc.doc_type !== 'WI') return null
  if (!isQcRequiredForFinish(db, accountSetId)) return null

  const sources = [doc.id, doc.plan_id].filter(Boolean) as string[]
  const placeholders = sources.map(() => '?').join(',')
  const hit = db.prepare(
    `SELECT qc_no FROM scm_qc_doc
     WHERE account_set_id=? AND qc_type='FQC' AND status='audited' AND result='pass'
       AND source_doc_id IN (${placeholders}) LIMIT 1`,
  ).get(accountSetId, ...sources) as { qc_no?: string } | undefined
  if (hit) return null

  return `系统参数已开启「完工入库须先质检」，单据 ${doc.doc_no} 没有判定合格的已审核完工检验单(FQC)。`
    + '请先在「质检管理」新建 FQC 质检单（来源选本工单或本完工单）、判定合格并审核。'
}

/**
 * 取质检单的不良明细，作为不良品入库单(PS)的行。
 * 只取 `defect_qty > 0` 的行；批次号一并带过去便于追溯。
 */
export function getQcDefectLines(
  db: Database.Database,
  accountSetId: string,
  qcDocId: string,
): QcDefectLine[] {
  const rows = db.prepare(
    'SELECT item_code, COALESCE(defect_qty,0) AS defect_qty, batch_no, defect_reason'
    + ' FROM scm_qc_line WHERE account_set_id=? AND qc_doc_id=? ORDER BY seq',
  ).all(accountSetId, qcDocId) as any[]
  return rows
    .filter(r => r.item_code && Number(r.defect_qty) > 0)
    .map(r => ({
      item_code: r.item_code,
      qty: Math.round((Number(r.defect_qty) || 0) * 1e6) / 1e6,
      batch_no: r.batch_no ?? null,
      remark: r.defect_reason ?? null,
    }))
}

/**
 * 校验质检单是否可以下推不良品入库单。
 * @returns 错误信息；可以下推时返回 null
 */
export function validateQcDefectPush(
  qc: { status?: string } | undefined,
  planId: string | null | undefined,
  defectLines: QcDefectLine[],
): string | null {
  if (!qc) return '质检单不存在'
  if (qc.status !== 'audited') return '请先审核质检单再下推不良品入库'
  if (!planId) return '质检单未关联工单，无法下推不良品入库；请在质检单上选择来源工单，或在下推时指定工单'
  if (!defectLines.length) return '该质检单没有不良数量，无需下推不良品入库'
  return null
}
