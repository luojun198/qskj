/**
 * 供应链单据「列方案」可控列元数据。
 * 由列方案管理界面（ColSchemeManager）、明细表（DocForm）、单据列表（DocList）共用，
 * 保证三处对「可隐藏列」的 key 与名称完全一致。
 *
 * 仅列出「可被用户/方案隐藏的列」；核心列（物料/数量/金额/操作等）不在此，始终显示。
 */
import { isPushProgressDoc } from '@/utils/scmDoc'

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

/**
 * 单据列表（target='list'）全量列定义：DocList 的列设置面板与 ColSchemeManager 的「可隐藏列」共用这一份。
 * 列表接口取 scm_doc 的 d.* 全部列，所以 scm_doc 上有的数据列都应能在此设置。
 *
 * 可用性规则见 listColsForType：
 * - header / line 声明该列依赖单据类型 header_fields / line_fields 里的哪一项；
 *   **类型未配置**（字段为 NULL，库里绝大多数类型如此）→ 全部可用；类型已配置 → 命中才可用。
 * - always：与类型配置无关，始终可用。
 * - allViewOnly：仅「全部类型」混合视图有意义（如「类型」列）。
 * - onlyTypes：仅这些单据类型有意义（「全部」视图仍可用）。
 * - pushOnly：仅有下推链路的类型（isPushProgressDoc）。
 */
export interface ListColDef extends ColMeta {
  visible: boolean
  required?: boolean
  header?: string
  line?: string[]
  always?: boolean
  allViewOnly?: boolean
  onlyTypes?: string[]
  pushOnly?: boolean
  group?: string
}

const TAX_LINE = ['tax_amount', 'tax_rate']
export const LIST_ALL_COLS: ListColDef[] = [
  { key: 'doc_no',           label: '单据号',   visible: true,  required: true, always: true },
  { key: 'doc_date',         label: '日期',     visible: true,  always: true },
  { key: 'doc_type',         label: '类型',     visible: true,  allViewOnly: true },
  { key: 'partner',          label: '往来单位', visible: true,  header: 'partner' },
  { key: 'warehouse',        label: '仓库',     visible: true,  header: 'warehouse' },
  { key: 'dest_warehouse',   label: '调入仓库', visible: false, onlyTypes: ['TR'] },
  { key: 'biz_person',       label: '业务员',   visible: false, header: 'biz_person' },
  { key: 'dept_code',        label: '部门',     visible: false, header: 'dept' },
  { key: 'contract_no',      label: '合同号',   visible: false, header: 'contract' },
  { key: 'payment_type',     label: '付款方式', visible: false, header: 'payment' },
  { key: 'settle_account',   label: '结算方式', visible: false, header: 'settle_account' },
  { key: 'io_category',      label: '收发类别', visible: false, header: 'io_category' },
  { key: 'transport_method', label: '运输方式', visible: false, header: 'transport' },
  { key: 'expect_date',      label: '预计交期', visible: false, header: 'expect_date' },
  { key: 'credit_days',      label: '账期',     visible: false, header: 'credit' },
  { key: 'due_date',         label: '到期日',   visible: false, header: 'credit' },
  { key: 'invoice_type',     label: '发票类型', visible: false, header: 'invoice' },
  { key: 'invoice_no',       label: '发票号',   visible: false, header: 'invoice' },
  { key: 'invoice_date',     label: '开票日期', visible: false, header: 'invoice' },
  { key: 'currency',         label: '币别',     visible: false, header: 'currency' },
  { key: 'exchange_rate',    label: '汇率',     visible: false, header: 'currency' },
  { key: 'discount_rate',    label: '整单折扣', visible: false, header: 'discount' },
  { key: 'tax_rate',         label: '税率',     visible: false, always: true },
  { key: 'total_qty',        label: '数量',     visible: true,  always: true },
  { key: 'total_amount',     label: '金额',     visible: true,  always: true },
  { key: 'total_tax',        label: '税额',     visible: false, line: TAX_LINE },
  { key: 'total_with_tax',   label: '价税合计', visible: true,  line: TAX_LINE },
  { key: 'push',             label: '下推数量', visible: true,  pushOnly: true },
  // 下推金额 = 已下推数量 × 本单明细行单价（跟随订单计税：有税额按价税合计，无税额按金额）；未下推金额 = 剩余数量 × 单价。客户要求「下推进度后面带出金额」，已下推金额默认显示
  { key: 'pushed_amount',    label: '已下推金额', visible: true,  pushOnly: true },
  { key: 'unpushed_amount',  label: '未下推金额', visible: false, pushOnly: true },
  // 订单关联单号（参照金蝶序时簿）：采购订单 = 入库单 / 付款单，销售订单 = 出库单 / 收款单；列表按类型改显示名
  { key: 'linked_docs',      label: '关联下游单号', visible: true, onlyTypes: ['PO', 'SOa'] },
  { key: 'linked_payments',  label: '关联收付款单号', visible: true, onlyTypes: ['PO', 'SOa'] },
  // 收付款单核销信息（含预收 / 预付）：已核销 / 未核销（原币）、核销单号、与之核销的对方单据
  { key: 'verified_amount',   label: '已核销',   visible: true, onlyTypes: ['RCV', 'PAY'] },
  { key: 'unverified_amount', label: '未核销',   visible: true, onlyTypes: ['RCV', 'PAY'] },
  { key: 'verify_nos',        label: '核销单号', visible: true, onlyTypes: ['RCV', 'PAY'] },
  { key: 'pay_linked_docs',   label: '关联单据', visible: true, onlyTypes: ['RCV', 'PAY'] },
  { key: 'operator',         label: '经手人',   visible: false, always: true },
  { key: 'maker',            label: '制单人',   visible: false, always: true },
  { key: 'created_at',       label: '制单时间', visible: false, always: true },
  { key: 'auditor',          label: '审核人',   visible: false, always: true },
  { key: 'audited_at',       label: '审核时间', visible: false, always: true },
  { key: 'updated_at',       label: '修改时间', visible: false, always: true },
  { key: 'source_doc_no',    label: '源单号',   visible: false, always: true },
  { key: 'voucher_no',       label: '凭证号',   visible: false, always: true },
  { key: 'print_count',      label: '打印次数', visible: false, always: true },
  { key: 'status',           label: '状态',     visible: true,  always: true },
  { key: 'remark',           label: '备注',     visible: false, always: true },
  // 组装单「成品明细」视图专用列（成品行 + 产品档案字段）；仅 AS 可用，「全部」视图不出现
  { key: 'pl_item_code',     label: '成品编号', visible: true,  onlyTypes: ['AS'] },
  { key: 'pl_item_name',     label: '成品名称', visible: true,  onlyTypes: ['AS'] },
  { key: 'pl_spec',          label: '规格',     visible: true,  onlyTypes: ['AS'] },
  { key: 'pl_unit',          label: '单位',     visible: true,  onlyTypes: ['AS'] },
  { key: 'pl_qty',           label: '成品数量', visible: true,  onlyTypes: ['AS'] },
  { key: 'pl_fee',           label: '加工单价', visible: true,  onlyTypes: ['AS'] },
  { key: 'pl_amount',        label: '加工费',   visible: true,  onlyTypes: ['AS'] },
  { key: 'pl_barcode',       label: '条码',     visible: false, onlyTypes: ['AS'] },
  { key: 'pl_short_code',    label: '简码',     visible: false, onlyTypes: ['AS'] },
  { key: 'pl_category_code', label: '大类',     visible: false, onlyTypes: ['AS'] },
  { key: 'pl_subcategory_code', label: '小类',  visible: false, onlyTypes: ['AS'] },
  { key: 'pl_item_type',     label: '物料属性', visible: false, onlyTypes: ['AS'] },
  { key: 'pl_purchase_price', label: '进价',    visible: false, onlyTypes: ['AS'] },
  { key: 'pl_sale_price',    label: '售价',     visible: false, onlyTypes: ['AS'] },
  { key: 'pl_ref_cost',      label: '参考成本', visible: false, onlyTypes: ['AS'] },
  { key: 'pl_item_remark',   label: '档案备注', visible: false, onlyTypes: ['AS'] },
]

/** 成品明细列 key 前缀（仅组装单成品明细视图渲染） */
export const LIST_PRODUCT_COL_PREFIX = 'pl_'

/** 兼容导出：列方案「可隐藏」的标准列（= 全量列去掉必选列与仅「全部」视图的列）。 */
export const LIST_OPT_COLS: ColMeta[] = LIST_ALL_COLS
  .filter(c => !c.required && !c.allViewOnly)
  .map(({ key, label }) => ({ key, label }))

/** 自定义字段在单据列表里的列 key 前缀（值取自 scm_doc.field_values；表体字段按行存储，不进列表） */
export const LIST_CUSTOM_COL_PREFIX = 'cf:'
export const isListCustomField = (position?: string) => position !== 'body'

export interface ListColTypeCfg { header_fields?: string | null; line_fields?: string | null }
export interface ListColCustomField { field_key: string; field_name: string; position?: string; is_visible?: number }

const parseCfg = (s?: string | null): string[] => { try { return s ? JSON.parse(s) : [] } catch { return [] } }
/** 类型是否声明过该配置：NULL/空串 = 未配置（按「全部可用」处理）；'[]' = 明确声明「没有」 */
const hasCfg = (s?: string | null) => s != null && String(s).trim() !== ''

/**
 * 某单据类型在列表上「可用」的全部列（列设置面板、列方案可隐藏项共用）。
 * docType 为空 = 「全部类型」混合视图：各类型字段并集，允许选任意标准列（自定义字段按类型而异，不出现）。
 * 返回顺序：标准列（LIST_ALL_COLS 顺序）+ 表头/表尾自定义字段列；custom 列默认勾选。
 */
export function listColsForType(
  docType: string,
  typeCfg: ListColTypeCfg | undefined,
  customFields: readonly ListColCustomField[] = [],
): ListColDef[] {
  const allView = !docType
  const headerCfg = typeCfg && hasCfg(typeCfg.header_fields) ? new Set(parseCfg(typeCfg.header_fields)) : null
  const lineCfg = typeCfg && hasCfg(typeCfg.line_fields) ? new Set(parseCfg(typeCfg.line_fields)) : null
  const standard = LIST_ALL_COLS.filter(c => {
    if (allView) return !c.key.startsWith(LIST_PRODUCT_COL_PREFIX)
    if (c.allViewOnly) return false
    if (c.onlyTypes && !c.onlyTypes.includes(docType)) return false
    if (c.pushOnly) return isPushProgressDoc(docType)
    if (c.always || c.required) return true
    if (c.header) return !headerCfg || headerCfg.has(c.header)
    if (c.line) return !lineCfg || c.line.some(k => lineCfg.has(k))
    return true
  })
  const custom: ListColDef[] = allView ? [] : customFields
    .filter(f => isListCustomField(f.position) && f.is_visible !== 0)
    .map(f => ({
      key: LIST_CUSTOM_COL_PREFIX + f.field_key,
      label: f.field_name,
      visible: true,
      group: f.position === 'footer' ? '表尾字段' : '表头字段',
    }))
  return [...standard, ...custom]
}

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
