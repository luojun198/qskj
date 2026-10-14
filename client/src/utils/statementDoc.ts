/** 对账单（单据化）共用：单据类别名称、对账状态名称 */
const CAT_LABELS: Record<string, string> = {
  SO: '销售出库', SR: '销售退货', RS: '销售发票', RCV: '客户收款',
  PI: '采购入库', PR: '采购退货', RP: '采购发票', PAY: '供应商付款', WI: '委外入库', OP: '委外加工费',
}

export function statementCatLabel(docType: string): string {
  return CAT_LABELS[docType] || docType
}

export const RECON_STATUS_LABEL: Record<string, string> = {
  reconciled: '已对账',
  pending: '对账中',
  unreconciled: '未对账',
}

export function statementDirectionLabel(direction: string): string {
  return direction === 'ar' ? '应收（客户）' : '应付（供应商）'
}

export const fmtAmount = (v: any) =>
  (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtQty = (v: any) => {
  if (v == null || v === '') return ''
  const n = Number(v) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '')
}
