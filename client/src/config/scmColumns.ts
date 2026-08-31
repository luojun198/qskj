/**
 * 供应链单据「列方案」可控列元数据。
 * 由列方案管理界面（ColSchemeManager）、明细表（DocForm）、单据列表（DocList）共用，
 * 保证三处对「可隐藏列」的 key 与名称完全一致。
 *
 * 仅列出「可被用户/方案隐藏的列」；核心列（物料/数量/金额/操作等）不在此，始终显示。
 */
export interface ColMeta { key: string; label: string }

/** 明细表（target='line'）可隐藏的可选业务列。key 与 DocForm 的 lineColShown(key) 对应。 */
export const LINE_OPT_COLS: ColMeta[] = [
  { key: 'realtime_stock', label: '实时库存' },
  { key: 'price_with_tax', label: '含税单价' },
  { key: 'discount_rate', label: '折扣(折)' },
  { key: 'tax_rate', label: '税率%' },
  { key: 'tax_amount', label: '税额' },
  { key: 'gross_amount', label: '价税合计' },
  { key: 'batch_no', label: '批号' },
  { key: 'produce_date', label: '生产日期' },
  { key: 'expire_date', label: '保质期' },
  { key: 'bin_no', label: '库位' },
  { key: 'scrap_rate', label: '损耗%' },
  { key: 'process_fee', label: '加工费' },
  { key: 'remark', label: '备注' },
]

/**
 * 单据表头（target='header'）可隐藏的标准表头字段。key 与 DocForm 的 hcol(key) / 字段 key 对齐。
 * 日期(doc_date)/单据号(doc_no) 为必备字段，不可隐藏，不列入。
 * 表头自定义字段（position='header'）不在此静态表，由调用处动态合并。
 */
export const HEADER_OPT_COLS: ColMeta[] = [
  { key: 'warehouse', label: '仓库' },
  { key: 'partner', label: '往来单位' },
  { key: 'biz_person', label: '业务员' },
  { key: 'dept', label: '部门' },
  { key: 'io_category', label: '收发类别' },
  { key: 'transport', label: '运输方式' },
  { key: 'contract', label: '合同号' },
  { key: 'payment', label: '付款方式' },
  { key: 'settle_account', label: '结算方式' },
  { key: 'currency', label: '币别' },
  { key: 'discount', label: '整单折扣' },
  { key: 'expect_date', label: '预计交期' },
  { key: 'credit', label: '账期' },
  { key: 'invoice', label: '发票' },
  { key: 'tax_rate', label: '税率' },
  { key: 'operator', label: '经手人' },
  { key: 'remark', label: '备注' },
]

/** 单据列表（target='list'）可隐藏的可选列。key 与 DocList allColumns 的 key 对应（不含 ALWAYS 必选列）。 */
export const LIST_OPT_COLS: ColMeta[] = [
  { key: 'doc_type', label: '类型' },
  { key: 'partner', label: '往来单位' },
  { key: 'warehouse', label: '仓库' },
  { key: 'biz_person', label: '业务员' },
  { key: 'dept_code', label: '部门' },
  { key: 'contract_no', label: '合同号' },
  { key: 'payment_type', label: '付款方式' },
  { key: 'invoice_no', label: '发票号' },
  { key: 'total_with_tax', label: '价税合计' },
  { key: 'currency', label: '币别' },
  { key: 'push', label: '下推数量' },
]

/**
 * 取某 target 的「标准可选列」静态元数据。
 * header 返回标准表头字段；footer 无标准字段（仅自定义，由调用处动态合并）。
 */
export function optColsFor(target: string): ColMeta[] {
  switch (target) {
    case 'list': return LIST_OPT_COLS
    case 'header': return HEADER_OPT_COLS
    case 'footer': return []
    default: return LINE_OPT_COLS
  }
}
