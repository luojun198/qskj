import request, { type RequestConfig } from './request'

export interface ScmItemFieldDef {
  id?: string
  field_key: string
  field_name: string
  field_type: 'text' | 'number' | 'date' | 'select'
  options_json?: string
  sort_order?: number
  is_enabled?: number
}

/** 单据自定义字段定义（表头/表尾），按账套+单据类型隔离 */
export interface ScmDocFieldDef {
  id?: string
  doc_type?: string
  position: 'header' | 'body' | 'footer'
  field_key: string
  field_name: string
  field_type: 'text' | 'number' | 'date' | 'select' | 'textarea'
  options_json?: string
  sort_order?: number
  is_visible?: number
  is_enabled?: number
}

export interface ScmItem {
  id: string
  code: string
  name: string
  spec?: string
  barcode?: string
  short_code?: string
  unit?: string               // 向后兼容：主单位名称文本
  primary_unit_code?: string  // 主单位编号
  unit_name?: string          // 主单位名称
  secondary_units?: ScmItemUnit[] // 副单位列表
  category_code?: string
  subcategory_code?: string
  item_type?: string
  purchase_price?: number
  sale_price?: number
  ref_cost?: number
  fixed_cost?: number
  inv_account?: string
  sale_account?: string
  batch_flag?: number
  is_asset?: number
  is_leaf?: number
  parent_id?: string | null
  field_values?: Record<string, any>
  supplier_code?: string
  default_warehouse_code?: string
  remark?: string
  enabled?: number
  // 扩展字段（Phase 5）
  volume?: number
  min_order_qty?: number
  lead_time_days?: number
  shelf_life_days?: number
  batch_out_mode?: 'fifo' | 'manual'
  serial_flag?: number
  buyer?: string
  work_station?: string
  transfer_price?: number
  sale_price2?: number
  sale_price3?: number
  safety_stock?: number
  source_type?: 'purchase' | 'outsource' | 'self' | 'assembly'  // 物料来源：采购/委外/自制/组装
}

export interface ScmUnit {
  id: string
  code: string
  name: string
  enabled: number
  remark?: string
  created_at?: string
  updated_at?: string
}

export interface ScmItemUnit {
  unit_code: string
  unit_name?: string
  is_primary: number
  conversion_rate: number
}

export interface ScmPartner {
  id: string
  code: string
  name: string
  short_name?: string
  partner_type?: string
  ar_account?: string
  ap_account?: string
  credit_limit?: number
  tax_rate?: number
  region_code?: string
  contact?: string
  phone?: string
  address?: string
  bank_name?: string
  bank_account?: string
  tax_no?: string
  salesman?: string
  price_level?: number
  remark?: string
  enabled?: number
  // 扩展字段（Phase 5）
  ship_address?: string
  ship_phone?: string
  ship_contact?: string
  province?: string
  city?: string
  county?: string
  country?: string
  payment_type?: string
  credit_days?: number
  qq?: string
  email?: string
  wechat?: string
  is_outsource?: number  // 委外厂标识
}

export interface ScmWarehouse {
  id: string
  code: string
  name: string
  attr?: string
  keeper?: string
  remark?: string
  enabled?: number
  // 扩展字段（Phase 5）
  address?: string
  phone?: string
  partner_code?: string
}

export const ITEM_TYPES: Record<string, string> = { '0': '原辅材料', '6': '半成品', '9': '成品' }
export const SOURCE_TYPES: Record<string, string> = { purchase: '采购', outsource: '委外', self: '自制', assembly: '组装' }
export const COSTING_METHODS: Record<string, string> = {
  moving_avg: '移动加权平均',
  month_avg: '全月平均',
  fifo: '先进先出',
  lifo: '后进先出',
  specified: '指定成本',
}

export interface ScmDocRef { id: string; doc_no: string; doc_type: string; status: string }
export interface ScmDoc { id?: string; doc_type: string; doc_no?: string; doc_date?: string; partner_code?: string; partner_name?: string; warehouse_code?: string; warehouse_name?: string; operator?: string; status?: string; source_doc_id?: string; total_qty?: number; total_amount?: number; remark?: string; lines?: ScmDocLine[];
  // 扩展表头字段（Phase 2）
  biz_person?: string; payment_type?: string; settle_account?: string; invoice_type?: string; invoice_no?: string; invoice_date?: string;
  contract_no?: string; currency?: string; exchange_rate?: number; discount_rate?: number; expect_date?: string; dest_warehouse_code?: string;
  credit_days?: number; due_date?: string; maker?: string; auditor?: string; audited_at?: string; total_tax?: number; field_values?: Record<string, any> | string;
  voucher_id?: string; pushed_qty?: number;
  // 上下游链路
  push_progress?: 'none' | 'part' | 'full'; total_lines?: number; pushed_lines?: number; fully_pushed_lines?: number;
  source_doc?: ScmDocRef | null; source_docs?: ScmDocRef[]; target_docs?: ScmDocRef[];
  // 销售订单已生成缺料单标记（SOa 列表用，防重复下推）
  shortage_doc_count?: number; shortage_doc_id?: string; mrp_source_count?: number; mrp_doc_id?: string; mrp_status?: string; mrp_doc_no?: string;
  // 上下游计数（列表用，控制「览」追溯按钮显隐）
  downstream_doc_count?: number; downstream_plan_count?: number; upstream_doc_count?: number; downstream_line_count?: number
  // 挂靠的生产/委外计划（领料/完工/委外发货入库等）——本单的上游来源之一，见 hasTrace
  plan_id?: string | null }
export interface ScmDocLine { id?: string; seq?: number; item_code?: string | null; item_name?: string; spec?: string; unit?: string; warehouse_code?: string; qty?: number; pushed_qty?: number; price?: number; amount?: number; tax_rate?: number | null; tax_amount?: number | null; unit_cost?: number; batch_no?: string; source_line_id?: string; remark?: string;
  sales_order_no?: string;
  purchase_order_no?: string;
  // 扩展明细字段（Phase 2）
  price_with_tax?: number; discount_rate?: number; discount_amount?: number; expire_date?: string; produce_date?: string; gift_flag?: number; ref_no?: string; scrap_rate?: number; process_fee?: number; field_values?: Record<string, any> | string;
  supplier_code?: string; source_type?: string; serial_nos?: string[] | string;
  // 物料档案默认供应商/来源（getDoc 返回，用于行供应商为空时的展示兜底）
  item_supplier?: string; item_source_type?: string;
  arap_source_log_id?: string | null; arap_source_doc_id?: string; arap_source_doc_type?: string; arap_source_doc_no?: string; arap_source_doc_date?: string;
  arap_source_amount?: number; arap_source_settled_amount?: number; arap_source_open_amount?: number }
export interface ScmDocType { code: string; name: string; direction: string; affects_stock: number; affects_ar_ap: number; category: string;
  header_fields?: string; line_fields?: string; required_fields?: string }

export type SalesOrderRelationNodeKind = 'doc' | 'production_plan' | 'work_report' | 'qc'
export interface SalesOrderRelationNode {
  node_id: string
  node_kind: SalesOrderRelationNodeKind
  entity_id: string
  parent_node_id: string | null
  relation_type: string
  doc_type: string
  type_name: string
  doc_no: string
  doc_date?: string | null
  partner_code?: string | null
  partner_name?: string | null
  item_summary: string
  total_qty: number
  total_amount: number
  status: string
  progress_text: string
  shared_order_count: number
  shared: boolean
  descendant_count: number
  children: SalesOrderRelationNode[]
}
export interface SalesOrderRelationResult {
  page: number
  page_size: number
  total: number
  roots: SalesOrderRelationNode[]
  available_types: Array<{ value: string; label: string }>
  // BFS 节点总量超过上限时为 true，前端应提示用户关联范围过大、已截断显示
  truncated?: boolean
}

export interface ScmPaymentSource {
  arap_source_log_id: string
  source_doc_id: string
  source_doc_type: 'SO' | 'PI' | 'WI'
  source_doc_no: string
  source_doc_date: string
  due_date?: string
  source_amount: number
  settled_amount: number
  open_amount: number
  remark?: string
}

export type SalesReportFieldType = 'text' | 'number' | 'amount' | 'date' | 'enum' | 'percent' | 'integer'
export interface SalesReportFieldMeta {
  key: string; label: string; type: SalesReportFieldType; category: string; operators: string[]
  detail?: boolean; dimension?: boolean; option_source?: string; options?: Array<{ label: string; value: string }>
}
export interface SalesReportFilterCondition { field: string; operator: string; value?: any; value2?: any }
export interface SalesReportFilterGroup { logic: 'and' | 'or'; children: Array<SalesReportFilterGroup | SalesReportFilterCondition> }
export interface SalesReportQueryConfig {
  mode: 'detail' | 'summary'; filters: SalesReportFilterGroup; result_filters?: SalesReportFilterGroup
  fields: string[]; dimensions: string[]; metrics: string[]
  sort: Array<{ key: string; direction: 'asc' | 'desc' }>; page: number; page_size: number
}
export interface SalesReportMeta {
  fields: SalesReportFieldMeta[]; dimensions: SalesReportFieldMeta[]
  metrics: Array<{ key: string; label: string; type: SalesReportFieldType; operators: string[] }>
  operators: Record<string, string>
  defaults: { detail_fields: string[]; dimensions: string[]; metrics: string[] }
  limits: { filters: number; filter_depth: number; dimensions: number; page_size: number }
}
export interface SalesReportResult {
  mode: 'detail' | 'summary'
  columns: Array<{ key: string; label: string; type: SalesReportFieldType; role: 'field' | 'dimension' | 'metric' }>
  rows: Record<string, any>[]; summary: Record<string, number | null>
  total: number; page: number; page_size: number; ignored_fields: string[]
}
export type SalesFixedReportCode = 'summary' | 'detail' | 'ranking' | 'profit' | 'trend'
export type SalesTrendPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year'
export interface SalesFixedFilters {
  start_date?: string; end_date?: string; partner_codes?: string[]; item_codes?: string[]; category_codes?: string[]
  warehouse_codes?: string[]; batch_nos?: string[]; biz_persons?: string[]; dept_codes?: string[]
  source_types?: Array<'SO' | 'SR'>; currency?: string; profit_min?: number; profit_max?: number
  profit_rate_min?: number; profit_rate_max?: number
  empty_fields?: Array<'partner_code' | 'item_code' | 'category_code' | 'warehouse_code' | 'batch_no' | 'biz_person' | 'dept_code'>
}
export interface SalesFixedReportRequest {
  report_code: SalesFixedReportCode; filters: SalesFixedFilters; grouping?: string
  rank_metric?: 'sales_amount' | 'qty' | 'cost_amount' | 'profit' | 'profit_rate'; top_n?: 10 | 20 | 50 | 100
  period?: SalesTrendPeriod; chart_metric?: 'sales_amount' | 'qty' | 'cost_amount' | 'profit' | 'profit_rate'
  sort?: Array<{ key: string; direction: 'asc' | 'desc' }>; page?: number; page_size?: number
}
export interface SalesFixedReportMeta {
  reports: Array<{ code: SalesFixedReportCode; title: string; path: string }>
  groupings: Record<string, Array<{ value: string; label: string }>>
  rank_metrics: Array<{ value: string; label: string }>; periods: Array<{ value: SalesTrendPeriod; label: string }>
  options: Record<string, Array<{ label: string; value: string }>>
  defaults: { start_date: string; end_date: string; currency: string; summary_grouping: string; profit_grouping: string
    ranking_grouping: string; rank_metric: string; top_n: number; trend_period: SalesTrendPeriod; chart_metric: string
    trend_dates: { start_date: string; end_date: string } }
  limits: { page_size: number; export_rows: number; trend_day_range: number }
}
export interface SalesFixedReportResult extends SalesReportResult {
  report_code: SalesFixedReportCode; chart_metric?: string; displayed?: number
}
export type PurchaseFixedReportCode = 'summary' | 'detail' | 'order_tracking' | 'ranking' | 'cost' | 'trend'
export type PurchaseOrderExecutionStatus = 'not_received' | 'pending' | 'partial' | 'completed' | 'over_received' | 'overdue'
export interface PurchaseFixedFilters {
  start_date?: string; end_date?: string; expect_start_date?: string; expect_end_date?: string
  partner_codes?: string[]; item_codes?: string[]; category_codes?: string[]
  warehouse_codes?: string[]; batch_nos?: string[]; biz_persons?: string[]; dept_codes?: string[]
  source_types?: Array<'PI' | 'PR'>; order_statuses?: PurchaseOrderExecutionStatus[]
  currency?: string; variance_min?: number; variance_max?: number
  variance_rate_min?: number; variance_rate_max?: number
  empty_fields?: Array<'partner_code' | 'item_code' | 'category_code' | 'warehouse_code' | 'batch_no' | 'biz_person' | 'dept_code'>
}
export interface PurchaseFixedReportRequest {
  report_code: PurchaseFixedReportCode; filters: PurchaseFixedFilters; grouping?: string
  rank_metric?: 'purchase_amount' | 'qty' | 'purchase_cost' | 'cost_variance' | 'variance_rate'; top_n?: 10 | 20 | 50 | 100
  period?: SalesTrendPeriod; chart_metric?: 'purchase_amount' | 'qty' | 'purchase_cost' | 'cost_variance' | 'variance_rate'
  sort?: Array<{ key: string; direction: 'asc' | 'desc' }>; page?: number; page_size?: number
}
export interface PurchaseFixedReportMeta {
  reports: Array<{ code: PurchaseFixedReportCode; title: string; path: string }>
  groupings: Record<string, Array<{ value: string; label: string }>>
  rank_metrics: Array<{ value: string; label: string }>; periods: Array<{ value: SalesTrendPeriod; label: string }>
  options: Record<string, Array<{ label: string; value: string }>>
  defaults: { start_date: string; end_date: string; currency: string; summary_grouping: string; cost_grouping: string
    ranking_grouping: string; rank_metric: string; top_n: number; trend_period: SalesTrendPeriod; chart_metric: string
    trend_dates: { start_date: string; end_date: string }; order_tracking_dates: { start_date: string; end_date: string }
    order_tracking_statuses: PurchaseOrderExecutionStatus[] }
  limits: { page_size: number; export_rows: number; trend_day_range: number }
}
export interface PurchaseFixedReportResult extends SalesReportResult {
  report_code: PurchaseFixedReportCode; chart_metric?: string; displayed?: number
}
export interface SalesReportScheme {
  id: string; report_key: 'sales' | 'purchase'; name: string; config: SalesReportQueryConfig
  is_default: boolean; created_at?: string; updated_at?: string
}

export const DOC_CATEGORIES: Record<string, string> = { purchase: '采购', sale: '销售', inventory: '库存', production: '生产', outsource: '委外', finance: '财务' }

/** 销售订单可用库存对比行 */
export interface ScmStockAvailLine {
  source_doc_id?: string; source_doc_no?: string; source_doc_date?: string
  line_id: string; seq?: number; item_code: string; item_name?: string; spec?: string; unit?: string
  warehouse_code?: string; warehouse_name?: string
  order_qty: number; pushed_qty: number; remain: number
  base_remaining?: number; max_allowed_qty?: number; overrun_remaining?: number
  on_hand: number; other_reserved: number; available: number
  ship_qty: number; max_ship_qty?: number; short_qty: number
  price?: number; price_with_tax?: number; tax_rate?: number | null; unit_cost?: number; bom_id?: string
  supplier_code?: string; purchase_price?: number; source_type?: 'purchase' | 'outsource' | 'self' | 'assembly'
}

export type ProductionActionStatus = 'available' | 'blocked_draft' | 'completed' | 'not_required' | 'unavailable'
export interface ProductionActionStateItem {
  status: ProductionActionStatus
  remaining_qty: number
  remaining_lines: number
  base_remaining: number
  max_allowed_qty: number
  overrun_remaining: number
  draft_doc?: { id: string; doc_no: string; doc_type: string }
  reason?: string
}
export interface ProductionPlanActionState {
  issue: ProductionActionStateItem
  finish: ProductionActionStateItem
}

export type MrpSourceKind = 'sales_order' | 'production_plan' | 'outsource_plan' | 'assembly'
export interface MrpSourceRef { kind: MrpSourceKind; id: string }
export type ScmPushOptionStatus = 'available' | 'partial' | 'blocked_draft' | 'completed' | 'unavailable'
export type ScmPushAction = 'sales_dispatch' | 'mrp' | 'issue' | 'finish'
export interface ScmPushOption {
  action: ScmPushAction
  target_doc_type: string
  label: string
  status: ScmPushOptionStatus
  remaining_qty: number
  remaining_lines: number
  base_remaining?: number
  max_allowed_qty?: number
  overrun_remaining?: number
  existing_doc?: { id: string; doc_no: string; doc_type: string; status: string } | null
  reason?: string
}
export interface MrpSourceOption {
  id: string; kind: MrpSourceKind; source_no: string; doc_date?: string; status: string
  total_qty?: number; partner_code?: string; supplier_code?: string
  eligible: boolean; reason?: string; occupied_mrp_id?: string | null
}
export interface MrpSourceSummary {
  kind: MrpSourceKind; id: string; source_no: string; doc_date?: string | null; status: string
  partner_code?: string; partner_name?: string; demand_line_count: number; demand_qty: number
  earliest_need_date?: string | null
}
export interface MrpSourceDetail {
  id: string; source_kind: MrpSourceKind; source_id: string; source_no: string
  source_line_id?: string | null; source_line_seq?: number | null
  item_code: string; item_name?: string; spec?: string; unit?: string
  demand_qty: number; allocated_net_qty: number; multiplied_qty?: number; extra_qty?: number
  target_allocated_qty?: number; final_demand_qty?: number; need_date?: string | null; priority: number
  snapshot?: Record<string, any>
}
export interface MrpResultLine extends ScmDocLine {
  field_values: {
    level: number; parent_item_codes: string[]; gross_req: number; direct_gross_qty: number; dependent_gross_qty: number
    on_hand: number; other_reserved: number; effective_stock: number; in_transit: number; other_mrp_supply: number
    safety_stock: number; net_req: number; suggest_qty: number; min_order_qty: number; lead_time_days: number
    bom_id?: string | null; bom_code?: string; missing_bom?: boolean; source_refs?: string[]
    demand_multiplier?: number; fixed_extra_qty?: number; item_target_qty?: number | null; target_overridden?: boolean
  }
}

export const scmApi = {
  // 物料
  getItemNextNo: () => request.get<{ next_no: string }>('/scm/items/next-no'),
  getItems: (params?: { keyword?: string; category_code?: string; item_type?: string; is_leaf?: number; page?: number; page_size?: number; all?: string | number }) =>
    request.get<{ list: ScmItem[]; total: number; page: number; page_size: number }>('/scm/items', { params }),
  createItem: (data: Partial<ScmItem>) => request.post<{ id: string }>('/scm/items', data),
  // 物料自定义字段定义
  getItemFieldDefs: () => request.get<ScmItemFieldDef[]>('/scm/item-fields'),
  saveItemFieldDefs: (fields: ScmItemFieldDef[]) => request.post('/scm/item-fields', { fields }),
  updateItem: (id: string, data: Partial<ScmItem>) => request.put(`/scm/items/${id}`, data),
  deleteItem: (id: string) => request.delete(`/scm/items/${id}`),

  // 往来单位
  getPartnerNextNo: (partner_type?: string) => request.get<{ next_no: string }>('/scm/partners/next-no', { params: { partner_type } }),
  getPartners: (params?: { keyword?: string; partner_type?: string }) =>
    request.get<ScmPartner[]>('/scm/partners', { params }),
  createPartner: (data: Partial<ScmPartner>) => request.post<{ id: string }>('/scm/partners', data),
  updatePartner: (id: string, data: Partial<ScmPartner>) => request.put(`/scm/partners/${id}`, data),
  deletePartner: (id: string) => request.delete(`/scm/partners/${id}`),

  // 仓库
  getWarehouseNextNo: () => request.get<{ next_no: string }>('/scm/warehouses/next-no'),
  getWarehouses: () => request.get<ScmWarehouse[]>('/scm/warehouses'),
  createWarehouse: (data: Partial<ScmWarehouse>) => request.post<{ id: string }>('/scm/warehouses', data),
  updateWarehouse: (id: string, data: Partial<ScmWarehouse>) => request.put(`/scm/warehouses/${id}`, data),
  deleteWarehouse: (id: string) => request.delete(`/scm/warehouses/${id}`),

  // 计量单位
  getUnitNextNo: () => request.get<{ next_no: string }>('/scm/units/next-no'),
  getUnits: () => request.get<ScmUnit[]>('/scm/units'),
  createUnit: (data: Partial<ScmUnit>) => request.post<{ id: string }>('/scm/units', data),
  updateUnit: (id: string, data: Partial<ScmUnit>) => request.put(`/scm/units/${id}`, data),
  deleteUnit: (id: string) => request.delete(`/scm/units/${id}`),

  // 库存
  getStock: (params?: { keyword?: string; warehouse_code?: string }) =>
    request.get<any[]>('/scm/stock', { params }),
  getStockLedger: (params: Record<string, any>) =>
    request.get<{ rows: any[]; total: number; page: number; page_size: number; summary: Record<string, number> }>('/scm/stock/ledger', { params }),
  exportStockLedger: (data: Record<string, any>) => request.downloadPost('/scm/stock/ledger/export', data, { timeout: 600_000 }),
  getOutsourceExecution: (params: Record<string, any>) =>
    request.get<{ rows: any[]; total: number; page: number; page_size: number; summary: Record<string, number> }>('/scm/report/outsource/execution', { params }),
  exportOutsourceExecution: (data: Record<string, any>) => request.downloadPost('/scm/report/outsource/execution/export', data, { timeout: 600_000 }),
  getProductionExecution: (params: Record<string, any>) =>
    request.get<{ rows: any[]; total: number; page: number; page_size: number; summary: Record<string, number> }>('/scm/report/production/execution', { params }),
  exportProductionExecution: (data: Record<string, any>) => request.downloadPost('/scm/report/production/execution/export', data, { timeout: 600_000 }),

  // 分类
  getCategories: () => request.get<any[]>('/scm/categories'),
  createCategory: (data: { code: string; name: string; parent_code?: string | null }) => request.post('/scm/categories', data),
  updateCategory: (id: string, data: { name: string; parent_code?: string | null }) => request.put(`/scm/categories/${id}`, data),
  deleteCategory: (id: string) => request.delete(`/scm/categories/${id}`),
  // 库位档案
  getBins: (warehouse_code?: string) => request.get<any[]>('/scm/bins', { params: warehouse_code ? { warehouse_code } : {} }),
  createBin: (data: { warehouse_code: string; code: string; name: string; remark?: string }) => request.post('/scm/bins', data),
  updateBin: (id: string, data: { name: string; remark?: string; enabled?: number }) => request.put(`/scm/bins/${id}`, data),
  deleteBin: (id: string) => request.delete(`/scm/bins/${id}`),

  // 参数
  getParams: () => request.get<{ param_key: string; param_value: string }[]>('/scm/params'),
  saveParams: (params: { param_key: string; param_value: string }[]) => request.put('/scm/params', { params }),
  // 供应链初始化（清空业务数据 business / 连同档案 all）
  resetData: (mode: 'business' | 'all') => request.post<{ ok: boolean; cleared: string[] }>('/scm/reset', { mode }),

  // 单据
  getDocTypes: () => request.get<ScmDocType[]>('/scm/docs/types'),
  seedDocTypes: () => request.post<{ seeded: number }>('/scm/docs/seed', {}),
  // 单据自定义字段定义（表头/表尾）
  getDocFieldDefs: (doc_type: string) => request.get<ScmDocFieldDef[]>('/scm/doc-fields', { params: { doc_type } }),
  getAllDocFieldDefs: () => request.get<ScmDocFieldDef[]>('/scm/doc-fields/all'),
  saveDocFieldDefs: (doc_type: string, fields: ScmDocFieldDef[]) => request.post('/scm/doc-fields', { doc_type, fields }),
  getDocNextNo: (doc_type: string, doc_date?: string) => request.get<{ next_no: string }>('/scm/docs/next-no', { params: { doc_type, doc_date } }),
  getDocs: (params: { doc_type?: string; partner_code?: string; warehouse_code?: string; status?: string; start_date?: string; end_date?: string; payment_mode?: 'advance'; keyword?: string; biz_person?: string; page?: number; page_size?: number }) =>
    request.get<{ list: ScmDoc[]; total: number; page: number; page_size: number }>('/scm/docs', { params }),
  getSalesOrderRelations: (params?: { keyword?: string; status?: string; start_date?: string; end_date?: string; page?: number; page_size?: number }) =>
    request.get<SalesOrderRelationResult>('/scm/sales-order-relations', { params }),
  // 单据翻页：按过滤条件取有序 id 数组（与列表同序），用于查看/编辑页首/上/下/尾翻阅
  getDocIds: (params: { doc_type?: string; partner_code?: string; warehouse_code?: string; status?: string; start_date?: string; end_date?: string; payment_mode?: 'advance'; keyword?: string; biz_person?: string }) =>
    request.get<string[]>('/scm/docs/ids', { params }),
  // 列表筛选用：按单据实际发生过的往来单位（DISTINCT partner_code + partner_name）
  getDocPartnerOptions: (params?: { doc_type?: string }) =>
    request.get<Array<{ partner_code: string; partner_name: string | null }>>('/scm/docs/partner-options', { params }),
  // 列表筛选用：按单据实际发生过的业务员（DISTINCT biz_person）
  getDocBizPersonOptions: (params?: { doc_type?: string }) =>
    request.get<Array<{ biz_person: string }>>('/scm/docs/biz-person-options', { params }),
  getDoc: (id: string) => request.get<ScmDoc & { lines: ScmDocLine[] }>(`/scm/docs/${id}`),
  // 完工/委外入库单成本明细（按成品拆料/人工/制费/加工费，料再逐物料）
  getDocCostDetail: (id: string) => request.get<any>(`/scm/docs/${id}/cost-detail`),
  createDoc: (data: Partial<ScmDoc> & { lines?: Partial<ScmDocLine>[] }) => request.post<{ id: string; doc_no: string }>('/scm/docs', data),
  updateDoc: (id: string, data: Partial<ScmDoc> & { lines?: Partial<ScmDocLine>[] }) => request.put(`/scm/docs/${id}`, data),
  deleteDoc: (id: string, config?: RequestConfig) => request.delete(`/scm/docs/${id}`, config),
  auditDoc: (id: string, data: { apply_item_default_warehouses?: boolean } = {}, config?: RequestConfig) => request.post<{ id: string; status: string; total_amount: number; auditor?: string; audited_at?: string; already_audited?: boolean; credit_warning?: string; serial_warning?: string; invoice_notice?: string }>(`/scm/docs/${id}/audit`, data, config),
  unauditDoc: (id: string, config?: RequestConfig) => request.post<{ ok: boolean }>(`/scm/docs/${id}/unaudit`, {}, config),
  genAssets: (id: string) => request.post<{ created: number }>(`/scm/docs/${id}/gen-assets`, {}),
  genVoucher: (id: string) => request.post<{ voucher_id: string; voucher_no: string; entry_count: number }>(`/scm/docs/${id}/gen-voucher`, {}),
  batchDocActions: (data: { action: 'audit' | 'unaudit' | 'delete' | 'gen_voucher'; ids: string[]; apply_item_default_warehouses?: boolean }) =>
    request.post<{ processed: number; action: string; results: any[] }>('/scm/docs/batch-actions', data, { skipErrorToast: true }),
  batchPushPurchase: (ids: string[]) =>
    request.post<{ created: number; docs: Array<{ id: string; doc_no: string; partner_code: string | null; currency: string }> }>('/scm/docs/batch-push-purchase', { ids }),

  // BOM
  getBomNextNo: () => request.get<{ next_no: string }>('/scm/boms/next-no'),
  getBoms: () => request.get<any[]>('/scm/boms'),
  getBom: (id: string) => request.get<any>(`/scm/boms/${id}`),
  getBomTree: (id: string, qty?: number) =>
    request.get<{ bom_id: string; bom_code: string; bom_name: string; qty: number; root: any; summary: { unit_cost: number; total_cost: number; leaf_kinds: number; max_level: number } }>(`/scm/boms/${id}/tree`, { params: { qty } }),
  createBom: (data: any) => request.post<{ id: string }>('/scm/boms', data),
  updateBom: (id: string, data: any) => request.put(`/scm/boms/${id}`, data),
  deleteBom: (id: string) => request.delete(`/scm/boms/${id}`),
  getBomWhereUsed: (item_code: string) => request.get<any[]>('/scm/boms/where-used', { params: { item_code } }),

  // 工作中心
  getWorkCenters: () => request.get<any[]>('/scm/work-centers'),
  createWorkCenter: (data: any) => request.post<{ id: string }>('/scm/work-centers', data),
  updateWorkCenter: (id: string, data: any) => request.put(`/scm/work-centers/${id}`, data),
  deleteWorkCenter: (id: string) => request.delete(`/scm/work-centers/${id}`),
  // 工艺路线
  getRoutingNextNo: () => request.get<{ next_no: string }>('/scm/routings/next-no'),
  getRoutings: (params?: { item_code?: string }) => request.get<any[]>('/scm/routings', { params }),
  getRouting: (id: string) => request.get<any>(`/scm/routings/${id}`),
  createRouting: (data: any) => request.post<{ id: string }>('/scm/routings', data),
  updateRouting: (id: string, data: any) => request.put(`/scm/routings/${id}`, data),
  deleteRouting: (id: string) => request.delete(`/scm/routings/${id}`),
  // 齐套分析
  getKitting: (params?: { plan_type?: string }) => request.get<any[]>('/scm/production-plans/kitting', { params }),
  // MRP 计算单
  getMrpDocs: (params?: { status?: string; keyword?: string; start_date?: string; end_date?: string }) => request.get<any[]>('/scm/mrp-docs', { params }),
  getPushOptions: (params: { source_kind: MrpSourceKind; source_id: string }) =>
    request.get<{ source_kind: MrpSourceKind; source_id: string; actions: ScmPushOption[] }>('/scm/push-options', { params }),
  getMrpSourceOptions: (params: { kind: MrpSourceKind; keyword?: string; exclude_occupied?: boolean; current_mrp_id?: string }) => request.get<MrpSourceOption[]>('/scm/mrp-docs/source-options', { params }),
  createMrpDoc: (data: { doc_date?: string; remark?: string; include_safety_stock?: boolean; demand_multiplier?: number; item_target_qty?: Record<string, number>; sources: MrpSourceRef[] }) => request.post<{ id: string; doc_no: string; status?: string; reused?: boolean }>('/scm/mrp-docs', data),
  getMrpDoc: (id: string) => request.get<{ doc: ScmDoc; source_refs: MrpSourceRef[]; source_summaries: MrpSourceSummary[]; sources: MrpSourceDetail[]; lines: MrpResultLine[]; shortage_doc: { id: string; doc_no: string; status: string } | null }>(`/scm/mrp-docs/${id}`),
  updateMrpDoc: (id: string, data: { doc_date?: string; remark?: string; include_safety_stock?: boolean; demand_multiplier?: number; item_target_qty?: Record<string, number>; source_adjustments?: Array<{ id: string; extra_qty: number }>; sources?: MrpSourceRef[] }) => request.put(`/scm/mrp-docs/${id}`, data),
  calculateMrpDoc: (id: string) => request.post<{ rows: number; total_qty: number; has_cycle: boolean; cycles: string[][]; warnings: string[] }>(`/scm/mrp-docs/${id}/calculate`, {}),
  auditMrpDoc: (id: string) => request.post(`/scm/mrp-docs/${id}/audit`, {}),
  unauditMrpDoc: (id: string) => request.post(`/scm/mrp-docs/${id}/unaudit`, {}),
  deleteMrpDoc: (id: string) => request.delete(`/scm/mrp-docs/${id}`),
  // 标准成本差异分析
  getCostVariance: (params?: { start_date?: string; end_date?: string }) => request.get<any[]>('/scm/report/cost-variance', { params }),
  // 质检单
  getQcDocs: (params?: { qc_type?: string; source_doc_id?: string }) => request.get<any[]>('/scm/qc-docs', { params }),
  getQcNextNo: (qc_type?: string) => request.get<{ next_no: string }>('/scm/qc-docs/next-no', { params: { qc_type } }),
  getQcDoc: (id: string) => request.get<any>(`/scm/qc-docs/${id}`),
  createQcDoc: (data: any) => request.post<{ id: string; qc_no: string }>('/scm/qc-docs', data),
  updateQcDoc: (id: string, data: any) => request.put(`/scm/qc-docs/${id}`, data),
  auditQcDoc: (id: string) => request.post(`/scm/qc-docs/${id}/audit`, {}),
  unauditQcDoc: (id: string) => request.post(`/scm/qc-docs/${id}/unaudit`, {}),
  deleteQcDoc: (id: string) => request.delete(`/scm/qc-docs/${id}`),
  genQcDefectDoc: (id: string, data: { plan_id?: string; warehouse_code?: string }) =>
    request.post<{ id: string; doc_no: string }>(`/scm/qc-docs/${id}/gen-defect`, data),
  // 生产报工
  getWorkReports: (params?: { plan_id?: string }) => request.get<any[]>('/scm/work-reports', { params }),
  createWorkReport: (data: any) => request.post<{ id: string; report_no: string }>('/scm/work-reports', data),
  updateWorkReport: (id: string, data: any) => request.put(`/scm/work-reports/${id}`, data),
  auditWorkReport: (id: string) => request.post(`/scm/work-reports/${id}/audit`, {}),
  unauditWorkReport: (id: string) => request.post(`/scm/work-reports/${id}/unaudit`, {}),
  deleteWorkReport: (id: string) => request.delete(`/scm/work-reports/${id}`),

  // 生产计划
  getProductionPlans: () => request.get<any[]>('/scm/production-plans'),
  getProductionPlanNextNo: (plan_type?: 'self' | 'outsource') =>
    request.get<{ next_no: string }>('/scm/production-plans/next-no', { params: { plan_type } }),
  createProductionPlan: (data: any) => request.post<{ id: string }>('/scm/production-plans', data),
  updateProductionPlan: (id: string, data: any) => request.put(`/scm/production-plans/${id}`, data),
  deleteProductionPlan: (id: string) => request.delete(`/scm/production-plans/${id}`),
  batchProductionPlanActions: (data: { action: 'delete' | 'unrelease' | 'reopen'; ids: string[] }) =>
    request.post<{ processed: number; action: string; results: any[] }>('/scm/production-plans/batch-actions', data, { skipErrorToast: true }),
  // 工单（生产闭环）
  getProductionPlan: (id: string) => request.get<{ plan: any; products: any[]; bom_lines: any[]; docs: any[]; action_state: ProductionPlanActionState; cost: { issuedCost: number; finishedCost: number; finishedQty: number; wip: number; unitCost: number; totalPlanQty?: number; products?: any[] } }>(`/scm/production-plans/${id}`),
  releaseProductionPlan: (id: string) => request.post(`/scm/production-plans/${id}/release`, {}),
  closeProductionPlan: (id: string, force = false) => request.post(`/scm/production-plans/${id}/close`, { force }, { skipErrorToast: true }),
  reopenProductionPlan: (id: string) => request.post<{ ok: boolean; status: string }>(`/scm/production-plans/${id}/reopen`, {}),
  unreleaseProductionPlan: (id: string) => request.post(`/scm/production-plans/${id}/unrelease`, {}, { skipErrorToast: true }),
  getIssueSuggestion: (id: string) => request.get<{ plan_id: string; yl_warehouse: string; lines: any[] }>(`/scm/production-plans/${id}/issue-suggestion`),
  genPlanIssue: (id: string) => request.post<{ id: string; doc_no: string }>(`/scm/production-plans/${id}/gen-issue`, {}),
  // 完工入库：多成品传 { products:[{product_id,qty,process_fee?}], fp_warehouse? }；兼容旧 { qty, process_fee, fp_warehouse }
  genPlanFinish: (id: string, data: { products?: Array<{ product_id: string; qty: number; process_fee?: number; process_tax_rate?: number }>; qty?: number; process_fee?: number; process_tax_rate?: number; fp_warehouse?: string }) =>
    request.post<{ id: string; doc_no: string }>(`/scm/production-plans/${id}/gen-finish`, data),
  // 批量下推生产/委外计划（销售订单缺口）
  createProductionPlansBatch: (data: { source_doc_id?: string; plan_type: 'self' | 'outsource'; supplier_code?: string; start_date?: string; end_date?: string; lines: Array<{ item_code: string; plan_qty: number; bom_id?: string; remark?: string }> }) =>
    request.post<{ created: number }>('/scm/production-plans/batch', data),
  // 生产/委外计划上下游关联追溯（上游下推来源单据 + 下游领料/完工/委外单），字段与 getDocDownstream 一致，供同一套页面渲染
  getProductionPlanDownstream: (id: string) =>
    request.get<{
      plan: any
      upstream_docs: Array<{ id: string; doc_no: string; doc_type: string; status: string; doc_date?: string; partner_code?: string; partner_name?: string; total_qty?: number; total_amount?: number }>
      downstream_docs: Array<{ id: string; doc_no: string; doc_type: string; status: string; doc_date?: string; partner_code?: string; partner_name?: string; total_qty?: number; total_amount?: number }>
    }>(`/scm/production-plans/${id}/downstream`),

  // 销售订单可用库存对比
  getDocAvailability: (id: string) =>
    request.get<{ doc: ScmDoc; lines: ScmStockAvailLine[]; shortage_docs: Array<{ id: string; doc_no: string; status: string }>; mrp_docs: Array<{ id: string; doc_no: string; status: string }> }>(`/scm/docs/${id}/availability`),
  getBatchDocAvailability: (ids: string[]) =>
    request.post<{ docs: ScmDoc[]; lines: ScmStockAvailLine[]; existing_doc?: { id: string; doc_no: string; status: string } }>('/scm/docs/batch-availability', { ids }, { skipErrorToast: true }),
  // 单据上下游关联追溯（上游父单/来源工单 + 下游子单 + 委外/生产计划）
  getDocDownstream: (id: string) =>
    request.get<{
      doc: ScmDoc
      upstream_docs: Array<{ id: string; doc_no: string; doc_type: string; status: string; doc_date?: string; partner_code?: string; partner_name?: string; total_qty?: number; total_amount?: number }>
      upstream_plans: Array<{ id: string; code: string; plan_type: string; item_code: string; item_name?: string; plan_qty: number; supplier_code?: string; status?: string; start_date?: string; end_date?: string; remark?: string }>
      downstream_docs: Array<{ id: string; doc_no: string; doc_type: string; status: string; doc_date?: string; partner_code?: string; partner_name?: string; total_qty?: number; total_amount?: number }>
      downstream_plans: Array<{ id: string; code: string; plan_type: string; item_code: string; item_name?: string; plan_qty: number; supplier_code?: string; status?: string; start_date?: string; end_date?: string; remark?: string }>
    }>(`/scm/docs/${id}/downstream`),
  // 缺料单 → 按供应商拆采购订单(PO)/询价单(PQ)
  genPurchaseDocs: (id: string, target_type: 'PO' | 'PQ' = 'PO') =>
    request.post<{ created: number; target_type: string; docs: Array<{ doc_no: string; supplier_code: string; lines: number }> }>(`/scm/docs/${id}/gen-purchase-docs`, { target_type }),
  // 缺料单 → 多层 BOM 分层下推预览（根缺料 + 各级半成品 + 采购件）
  getMrDownstreamPreview: (id: string) =>
    request.get<{
      doc: ScmDoc
      has_cycle: boolean
      cycles: string[][]
      nodes: Array<{
        key: string; level: number; parent_item_codes: string[]
        item_code: string; item_name: string; spec: string; unit: string
        source_type: 'purchase' | 'outsource' | 'self' | 'assembly'
        supplier_code: string; purchase_price: number; bom_id: string | null; bom_code: string
        root_qty: number; dependent_gross_qty: number; gross_qty: number
        stock_qty: number; external_supply_qty: number; required_qty: number
        generated_qty: number; suggest_qty: number; missing_bom: boolean
      }>
    }>(`/scm/docs/${id}/downstream-preview`),
  // 缺料单 → 按行物料来源自动路由（采购→PO、委外→委外计划、自制→生产计划）
  // force=true 跳过「已生成过下游」的确认闸门（needConfirm）
  genDownstream: (id: string, targets?: Array<'purchase' | 'outsource' | 'self' | 'assembly'>, quantities?: Record<string, number>, force?: boolean, selectedNodes?: Array<{ key: string; qty: number; supplier_code?: string }>) =>
    request.post<{
      needConfirm?: boolean
      existing?: { assembly: number; po: number; self_plans: number; outsource_plans: number }
      po: number; outsource_plans: number; self_plans: number; outsource_products: number; self_products: number; assembly_docs: number
    }>(`/scm/docs/${id}/gen-downstream`, {
      ...(targets ? { targets } : {}),
      ...(quantities ? { quantities } : {}),
      ...(force ? { force: true } : {}),
      ...(selectedNodes ? { selected_nodes: selectedNodes } : {}),
    }),

  // 往来台账
  getPartnerLedger: (partnerCode: string, params?: { start_date?: string; end_date?: string; arap_type?: 'ar' | 'ap'; with_lines?: 1 }) =>
    request.get<{ opening: number; detail: any[]; closing: number }>(`/scm/arap/${partnerCode}`, { params }),
  // 全部往来（不选往来单位时查询所有）
  getAllPartnerLedger: (params?: { start_date?: string; end_date?: string; arap_type?: 'ar' | 'ap'; with_lines?: 1 }) =>
    request.get<{ detail: any[]; total_in: number; total_out: number; closing: number }>('/scm/arap', { params }),
  // 往来余额表：按往来单位汇总（期初/本期增加/本期减少/期末）
  getPartnerBalanceSummary: (params?: { start_date?: string; end_date?: string; arap_type?: 'ar' | 'ap' }) =>
    request.get<{ summary: any[]; total_opening: number; total_in: number; total_out: number; total_closing: number;
      total_ar_opening: number; total_ap_opening: number; total_receivable: number; total_received: number;
      total_payable: number; total_paid: number; total_ar_closing: number; total_ap_closing: number }>('/scm/arap/balance-summary', { params }),
  getArApAging: (params?: { as_of_date?: string }) =>
    request.get<any[]>('/scm/arap-aging', { params }),
  // 往来核销 + 预收预付
  getArapOpenItems: (params: { partner_code: string; side?: 'ar' | 'ap' }) =>
    request.get<{ in_items: any[]; out_items: any[]; open_in: number; advance: number }>('/scm/arap/open-items', { params }),
  getPaymentSources: (params: { partner_code: string; payment_doc_type: 'RCV' | 'PAY' }) =>
    request.get<ScmPaymentSource[]>('/scm/arap/payment-sources', { params }),
  verifyArap: (data: { partner_code: string; verify_date?: string; matches: Array<{ in_log_id: string; out_log_id: string; amount: number }> }) =>
    request.post<{ verify_no: string; count: number }>('/scm/arap/verify', data),
  listArapVerifies: (params?: { partner_code?: string }) =>
    request.get<any[]>('/scm/arap/verify-list', { params }),
  cancelArapVerify: (verifyNo: string) =>
    request.post<{ count: number }>(`/scm/arap/verify/${verifyNo}/cancel`, {}),
  // 到期提醒 + 信用占用
  getArapDueReminder: (params?: { as_of_date?: string; upcoming_days?: number }) =>
    request.get<{ overdue: any[]; upcoming: any[]; overdue_total: number; upcoming_total: number }>('/scm/arap/due-reminder', { params }),
  getPartnerCredit: (code: string) =>
    request.get<{ partner_code: string; partner_name: string; credit_limit: number; used_ar: number; available: number }>(`/scm/partners/${code}/credit`),

  // 库存报表
  getStockSummary: (params?: { start_date?: string; end_date?: string; warehouse_code?: string }) =>
    request.get<{ summary: any[] }>('/scm/stock/summary', { params }),
  // 报表
  getStockAlert: () => request.get<any[]>('/scm/report/stock-alert'),
  getSalesReport: (params?: { start_date?: string; end_date?: string; item_code?: string; partner_code?: string }) =>
    request.get<any[]>('/scm/report/sales', { params }),
  getSalesCustomMeta: () => request.get<SalesReportMeta>('/scm/report/sales/custom-meta'),
  getSalesFixedMeta: () => request.get<SalesFixedReportMeta>('/scm/report/sales/fixed-meta'),
  querySalesFixed: (data: SalesFixedReportRequest) => request.post<SalesFixedReportResult>('/scm/report/sales/fixed-query', data),
  exportSalesFixed: (data: SalesFixedReportRequest) => request.downloadPost('/scm/report/sales/fixed-export', data, { timeout: 600_000 }),
  querySalesCustom: (data: SalesReportQueryConfig) => request.post<SalesReportResult>('/scm/report/sales/custom-query', data),
  exportSalesCustom: (data: SalesReportQueryConfig) => request.downloadPost('/scm/report/sales/custom-export', data, { timeout: 600_000 }),
  getSalesReportSchemes: () => request.get<SalesReportScheme[]>('/scm/report/query-schemes', { params: { report_key: 'sales' } }),
  createSalesReportScheme: (data: { name: string; config: SalesReportQueryConfig; is_default?: boolean }) =>
    request.post<{ id: string }>('/scm/report/query-schemes', { ...data, report_key: 'sales' }),
  updateSalesReportScheme: (id: string, data: { name: string; config: SalesReportQueryConfig; is_default?: boolean }) =>
    request.put(`/scm/report/query-schemes/${id}`, { ...data, report_key: 'sales' }),
  deleteSalesReportScheme: (id: string) => request.delete(`/scm/report/query-schemes/${id}`),
  getPurchaseReport: (params?: { start_date?: string; end_date?: string; item_code?: string; partner_code?: string }) =>
    request.get<any[]>('/scm/report/purchase', { params }),
  getPurchaseCustomMeta: () => request.get<SalesReportMeta>('/scm/report/purchase/custom-meta'),
  getPurchaseFixedMeta: () => request.get<PurchaseFixedReportMeta>('/scm/report/purchase/fixed-meta'),
  queryPurchaseFixed: (data: PurchaseFixedReportRequest) => request.post<PurchaseFixedReportResult>('/scm/report/purchase/fixed-query', data),
  exportPurchaseFixed: (data: PurchaseFixedReportRequest) => request.downloadPost('/scm/report/purchase/fixed-export', data, { timeout: 600_000 }),
  queryPurchaseCustom: (data: SalesReportQueryConfig) => request.post<SalesReportResult>('/scm/report/purchase/custom-query', data),
  exportPurchaseCustom: (data: SalesReportQueryConfig) => request.downloadPost('/scm/report/purchase/custom-export', data, { timeout: 600_000 }),
  getPurchaseReportSchemes: () => request.get<SalesReportScheme[]>('/scm/report/query-schemes', { params: { report_key: 'purchase' } }),
  createPurchaseReportScheme: (data: { name: string; config: SalesReportQueryConfig; is_default?: boolean }) =>
    request.post<{ id: string }>('/scm/report/query-schemes', { ...data, report_key: 'purchase' }),
  updatePurchaseReportScheme: (id: string, data: { name: string; config: SalesReportQueryConfig; is_default?: boolean }) =>
    request.put(`/scm/report/query-schemes/${id}`, { ...data, report_key: 'purchase' }),
  deletePurchaseReportScheme: (id: string) => request.delete(`/scm/report/query-schemes/${id}`),
  getPurchaseAdvice: () => request.get<any[]>('/scm/report/purchase-advice'),
  // 批次
  getBatchStock: (params?: { keyword?: string; warehouse_code?: string; batch_no?: string }) =>
    request.get<any[]>('/scm/batch-stock', { params }),
  getBatchAlert: (params?: { days?: number }) =>
    request.get<any[]>('/scm/report/batch-alert', { params }),
  // 序列号
  getSerials: (params?: { keyword?: string; serial_no?: string; status?: string; warehouse_code?: string }) =>
    request.get<any[]>('/scm/serials', { params }),
  // 复用财务辅助核算档案（业务员=人员, 部门）。注意 aux_items.type 存的是类别 id（UUID），需先取类别
  getAuxCategories: () => request.get<any[]>('/base/aux-categories'),
  getAuxItemsByCategory: (categoryId: string) =>
    request.get<any[]>('/base/aux-items', { params: { type: categoryId, all: 1 } }),
  createAuxItem: (data: { type: string; code: string; name: string }) =>
    request.post('/base/aux-items', data),
  // 复用出纳结算方式字典
  getSettleTypes: () => request.get<any[]>('/cashier/settle-types'),
  createSettleType: (data: { code: string; name: string }) => request.post('/cashier/settle-type', data),

  // BOM 展开
  explodeBom: (bomId: string, qty?: number) =>
    request.get<{ bom_id: string; qty: number; lines: any[] }>(`/scm/boms/${bomId}/explode`, { params: { qty } }),

  // 列方案（管理员建方案 + 分配用户；target: 'line'明细表 / 'list'单据列表）
  getColSchemes: (params: { target: string; doc_type?: string }) =>
    request.get<ColScheme[]>('/scm/col-schemes', { params }),
  createColScheme: (data: { target: string; doc_type: string; name: string; hidden_cols: string[] }) =>
    request.post<{ id: string }>('/scm/col-schemes', data),
  updateColScheme: (id: string, data: { name?: string; hidden_cols?: string[] }) =>
    request.put(`/scm/col-schemes/${id}`, data),
  deleteColScheme: (id: string) => request.delete(`/scm/col-schemes/${id}`),
  assignColScheme: (id: string, user_ids: string[]) =>
    request.post(`/scm/col-schemes/${id}/assign`, { user_ids }),
  getColSchemeUsers: () => request.get<ColSchemeUser[]>('/scm/col-schemes/users'),
  getMyColScheme: (params: { target: string; doc_type: string }) =>
    request.get<{ scheme_id: string | null; name: string | null; hidden_cols: string[] }>('/scm/col-schemes/my', { params }),
}

export interface ColScheme {
  id: string
  target: string
  doc_type: string
  name: string
  hidden_cols: string[]
  is_default: boolean
  user_ids: string[]
  created_at?: string
  updated_at?: string
}
export interface ColSchemeUser {
  id: string
  username: string
  nickname: string
}
