/** 采购、销售类单据：录入页一律提供币别 / 记账汇率（后端对所有单据都存币别、汇率） */
export const SCM_FX_DOC_TYPES = ['PQ', 'PO', 'PI', 'PR', 'RP', 'SQ', 'SOa', 'SO', 'SR', 'RS']

/**
 * 表头是否显示「币别 / 记账汇率」：
 * - 字段配置里含 currency（如收付款单、工序委外单）→ 显示；
 * - 采购 / 销售类单据即使配置里没有也显示；
 * - 用户在「隐藏字段」里隐藏了 currency 则一律不显示。
 */
export function shouldShowCurrencyHeader(docType: string, headerCols: Set<string>, hidden: Set<string>): boolean {
  if (hidden.has('currency')) return false
  return headerCols.has('currency') || SCM_FX_DOC_TYPES.includes(docType)
}
