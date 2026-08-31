import type { LocationQuery, LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import { useUserStore } from '@/stores/user'

const SCM_DOC_EDIT_PERMISSIONS: Record<string, string> = {
  IS: 'scm:inventory', OI: 'scm:inventory', OO: 'scm:inventory', TR: 'scm:inventory', CK: 'scm:inventory',
  PI: 'scm:purchase', PR: 'scm:purchase', PQ: 'scm:purchase', PO: 'scm:purchase', RP: 'scm:purchase',
  SO: 'scm:sale', SR: 'scm:sale', SQ: 'scm:sale', SOa: 'scm:sale', RS: 'scm:sale',
  PL: 'scm:production', PF: 'scm:production', PS: 'scm:production', PB: 'scm:production', PJ: 'scm:production', AS: 'scm:production', DS: 'scm:production',
  WO: 'scm:outsource', WI: 'scm:outsource', PAY: 'scm:arap', RCV: 'scm:arap',
}

function currentPermissions(): string[] {
  try { return useUserStore().permissions || [] } catch { return ['*'] }
}

const SCM_DOCUMENT_FORM_ROUTES = new Set(['ScmDocNew', 'ScmDocEdit', 'ScmDocView'])
const SCM_MRP_FORM_ROUTES = new Set(['ScmMrpNew', 'ScmMrpEdit', 'ScmMrpView'])

export function isScmDocumentFormRoute(routeName: unknown): boolean {
  return SCM_DOCUMENT_FORM_ROUTES.has(String(routeName || ''))
}

export function isScmMrpFormRoute(routeName: unknown): boolean {
  return SCM_MRP_FORM_ROUTES.has(String(routeName || ''))
}

/** 草稿且具备对应业务域权限时，单据可进入编辑状态。 */
export function canEditScmDocument(docType: string, status?: string, permissions = currentPermissions()): boolean {
  if (status !== 'draft') return false
  if (!docType) return true
  if (permissions.includes('*')) return true
  if (docType === 'MRP') return permissions.includes('scm:production') || permissions.includes('scm:outsource')
  const permission = SCM_DOC_EDIT_PERMISSIONS[docType]
  return !!permission && permissions.includes(permission)
}

export interface ScmDocNavContext {
  warehouse_code?: string
  partner_code?: string
  status?: string
  start_date?: string
  end_date?: string
  payment_mode?: 'advance'
  page?: number
  /** 是否由单据列表进入；直接打开详情地址时为 false。 */
  from_list?: boolean
  /** 返回列表时恢复的类型过滤；空字符串表示原列表显示全部类型。 */
  list_doc_type?: string
  /** 原列表是否为菜单固定类型入口，决定返回时使用 doc_type 还是 filter_doc_type。 */
  fixed_doc_type?: boolean
}

export interface ScmDocPagerState {
  index: number
  total: number
  canPrevious: boolean
  canNext: boolean
}

/** 下推生成或关联出的草稿直接进入编辑页，非草稿保持只读查看。 */
export function scmDownstreamDocRoute(id: string, status?: string, query?: LocationQueryRaw, docType = ''): RouteLocationRaw {
  return {
    name: canEditScmDocument(docType, status) ? 'ScmDocEdit' : 'ScmDocView',
    params: { id },
    ...(query && Object.keys(query).length ? { query } : {}),
  }
}

/** 销售订单按实时可发量下推时，直接进入可编辑的新建销售出库单。 */
export function scmSalesDispatchDraftRoute(sourceId: string): RouteLocationRaw {
  return {
    name: 'ScmDocNew',
    query: { doc_type: 'SO', source_doc_id: sourceId },
  }
}

/** MRP 计算单与普通进销存单据使用不同路由，草稿同样直接进入编辑页。 */
export function scmDownstreamMrpRoute(id: string, status?: string, query?: LocationQueryRaw): RouteLocationRaw {
  return {
    name: canEditScmDocument('MRP', status) ? 'ScmMrpEdit' : 'ScmMrpView',
    params: { id },
    ...(query && Object.keys(query).length ? { query } : {}),
  }
}

/** 通用单据入口按单据类型分流；MRP 必须进入专用页面。 */
export function scmDocumentRoute(
  id: string,
  docType: string,
  status?: string,
  query?: LocationQueryRaw,
  permissions?: string[],
): RouteLocationRaw {
  return docType === 'MRP'
    ? { name: canEditScmDocument(docType, status, permissions) ? 'ScmMrpEdit' : 'ScmMrpView', params: { id }, ...(query && Object.keys(query).length ? { query } : {}) }
    : { name: canEditScmDocument(docType, status, permissions) ? 'ScmDocEdit' : 'ScmDocView', params: { id }, ...(query && Object.keys(query).length ? { query } : {}) }
}

/** 生产/委外工单保留计划类型，保证返回入口和面包屑回到对应列表。 */
export function scmProductionPlanOrderRoute(id: string, planType?: 'self' | 'outsource'): RouteLocationRaw {
  return {
    name: 'ScmProductionOrder',
    params: { id },
    ...(planType ? { query: { plan_type: planType } } : {}),
  }
}

/** 生产/委外计划草稿进入计划编辑页，已审核或已关闭后进入工单执行页。 */
export function scmDownstreamProductionPlanRoute(id: string, status?: string): RouteLocationRaw {
  return {
    name: !status || status === 'draft' ? 'ScmProductionPlanEdit' : 'ScmProductionOrder',
    params: { id },
  }
}

function queryText(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function positivePage(value: unknown): number | undefined {
  const page = Number(queryText(value))
  return Number.isInteger(page) && page > 0 ? page : undefined
}

export function readScmDocNavContext(query: LocationQuery): ScmDocNavContext {
  const paymentMode = queryText(query.nav_payment_mode)
  return {
    warehouse_code: queryText(query.nav_warehouse_code) || undefined,
    partner_code: queryText(query.nav_partner_code) || undefined,
    status: queryText(query.nav_status) || undefined,
    start_date: queryText(query.nav_start_date) || undefined,
    end_date: queryText(query.nav_end_date) || undefined,
    payment_mode: paymentMode === 'advance' ? 'advance' : undefined,
    page: positivePage(query.nav_page),
    from_list: queryText(query.nav_from_list) === '1',
    list_doc_type: queryText(query.nav_list_doc_type),
    fixed_doc_type: queryText(query.nav_fixed_doc_type) === '1',
  }
}

export function scmDocNavContextToDetailQuery(context?: ScmDocNavContext): LocationQueryRaw {
  if (!context?.from_list) return {}
  const query: LocationQueryRaw = { nav_from_list: '1' }
  if (context.warehouse_code) query.nav_warehouse_code = context.warehouse_code
  if (context.partner_code) query.nav_partner_code = context.partner_code
  if (context.status) query.nav_status = context.status
  if (context.start_date) query.nav_start_date = context.start_date
  if (context.end_date) query.nav_end_date = context.end_date
  if (context.payment_mode) query.nav_payment_mode = context.payment_mode
  if (context.page && context.page > 1) query.nav_page = String(context.page)
  if (context.list_doc_type) query.nav_list_doc_type = context.list_doc_type
  if (context.fixed_doc_type) query.nav_fixed_doc_type = '1'
  return query
}

export function scmDocNavContextToIdsParams(docType: string, context?: ScmDocNavContext) {
  return {
    doc_type: docType,
    warehouse_code: context?.warehouse_code || undefined,
    partner_code: context?.partner_code || undefined,
    status: context?.status || undefined,
    start_date: context?.start_date || undefined,
    end_date: context?.end_date || undefined,
    payment_mode: context?.payment_mode,
  }
}

export function scmDocNavContextToListQuery(context: ScmDocNavContext | undefined, fallbackDocType: string): LocationQueryRaw {
  if (!context?.from_list) return fallbackDocType ? { doc_type: fallbackDocType } : {}
  const query: LocationQueryRaw = {}
  const listDocType = context.list_doc_type || ''
  if (context.fixed_doc_type && listDocType) query.doc_type = listDocType
  else if (listDocType) query.filter_doc_type = listDocType
  if (context.warehouse_code) query.warehouse_code = context.warehouse_code
  if (context.partner_code) query.partner_code = context.partner_code
  if (context.status) query.status = context.status
  if (context.start_date) query.start_date = context.start_date
  if (context.end_date) query.end_date = context.end_date
  if (context.payment_mode) query.payment_mode = context.payment_mode
  if (context.page && context.page > 1) query.page = String(context.page)
  return query
}

export function getScmDocPagerState(ids: string[], currentId: string): ScmDocPagerState {
  const index = ids.indexOf(currentId)
  return {
    index,
    total: ids.length,
    canPrevious: index > 0,
    canNext: index >= 0 && index < ids.length - 1,
  }
}

function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce<Record<string, any>>((result, key) => {
    result[key] = stableValue(value[key])
    return result
  }, {})
}

const SAVED_LINE_FIELDS = [
  'id', 'item_code', 'warehouse_code', 'qty', 'price', 'amount', 'unit_cost', 'tax_rate', 'tax_amount',
  'remark', 'price_with_tax', 'discount_rate', 'batch_no', 'produce_date', 'expire_date', 'serial_nos',
  'bin_no', 'scrap_rate', 'process_fee', 'source_line_id', 'arap_source_log_id', 'supplier_code', 'source_type',
  'line_role', 'product_group', 'field_values',
] as const

export function createScmDocEditSnapshot(source: {
  form: Record<string, any>
  lines: Array<Record<string, any>>
  selectedBom?: string
  paymentSources?: Array<Record<string, any>>
  advanceAmount?: number | null
  advanceRemark?: string
}): string {
  const lines = source.lines
    .filter(line => line.item_code || line.arap_source_log_id)
    .map(line => SAVED_LINE_FIELDS.reduce<Record<string, any>>((result, key) => {
      result[key] = line[key] ?? null
      return result
    }, {}))
  const paymentSources = (source.paymentSources || []).map(line => ({
    arap_source_log_id: line.arap_source_log_id || null,
    selected: !!line.selected,
    current_amount: Number(line.current_amount) || 0,
    payment_remark: line.payment_remark || '',
  }))
  return JSON.stringify(stableValue({
    form: source.form,
    lines,
    selectedBom: source.selectedBom || '',
    paymentSources,
    advanceAmount: Number(source.advanceAmount) || 0,
    advanceRemark: source.advanceRemark || '',
  }))
}
