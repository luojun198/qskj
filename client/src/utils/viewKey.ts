/** 标签类别：固定页、普通页、可复用只读页、编辑工作页。 */
export type TabKind = 'fixed' | 'normal' | 'transient' | 'editor'

export interface TabPolicy {
  kind: TabKind
  evictable: boolean
}

/**
 * 同一功能只保留一个标签的只读动态页面。
 * 切换不同记录时由 tabs store 更新地址并更换缓存 key，确保页面重新取数。
 */
const TRANSIENT_ROUTE_NAMES = new Set([
  'GroupNav',
  'ScmProductionOrder',
  'ScmBomTree',
  'ScmDocDispatch',
  'ScmMrPushPreview',
  'ScmDocDownstream',
  'ScmProductionPlanDownstream',
  'ScmDocCost',
  'ScmDocPrint',
  'ScmDocView',
  'AssetDetail',
])

/** 新增、编辑页面不得被标签上限自动回收。 */
function isEditorRoute(routeName: string): boolean {
  return /(?:New|Edit)$/.test(routeName) || routeName === 'ProjectCategoryForm' || routeName === 'PrintTemplateDesigner'
}

/** 打印模板设计器：新建与保存后带 id 的地址共用一个标签，避免保存时拆掉画布。 */
export function isPrintTemplateDesignerPath(fullPath: string): boolean {
  const path = fullPath.split('?')[0] || ''
  return path === '/base/print-template/design' || path.startsWith('/base/print-template/design/')
}

/** 同一购销报表工作台内切换固定报表或自定义查询时复用当前标签。 */
export function getScmReportTabFamily(fullPath: string): 'sales' | 'purchase' | undefined {
  const [path, query = ''] = fullPath.split('?')
  if (path.startsWith('/scm/report/sales/')) return 'sales'
  if (path.startsWith('/scm/report/purchase/')) return 'purchase'
  if (path === '/scm/report/buysell') {
    const kind = new URLSearchParams(query).get('kind')
    if (kind === 'sales' || kind === 'purchase') return kind
  }
  return undefined
}

/**
 * 同一单据类型的列表、新增、查看和编辑共用一个工作标签。
 * 查看/编辑页从列表进入时通过 nav_list_doc_type 携带类型；直接访问且尚未知类型时保留原规则。
 */
export function getScmDocTabFamily(fullPath: string): string | undefined {
  const [path, query = ''] = fullPath.split('?')
  const isListOrNew = path === '/scm/docs' || path === '/scm/docs/new'
  const isDetailOrEdit = /^\/scm\/docs\/[^/]+(?:\/edit)?$/.test(path)
  if (!isListOrNew && !isDetailOrEdit) return undefined

  const params = new URLSearchParams(query)
  const docType = params.get('doc_type') || params.get('nav_list_doc_type') || ''
  if (!docType) return undefined
  const paymentMode = params.get('payment_mode') === 'advance' ? 'advance' : 'normal'
  return `${docType}:${paymentMode}`
}

export function getTabPolicy(routeName?: string | symbol | null): TabPolicy {
  const name = String(routeName || '')
  if (name === 'Dashboard') return { kind: 'fixed', evictable: false }
  if (isEditorRoute(name)) return { kind: 'editor', evictable: false }
  if (TRANSIENT_ROUTE_NAMES.has(name)) return { kind: 'transient', evictable: true }
  return { kind: 'normal', evictable: true }
}

/**
 * 标签身份用于判断“这页是否已经打开”。
 * - 可复用只读页按 route name 去重；
 * - 普通页默认按 path 去重并忽略普通筛选 query；
 * - 供应链单据列表、新增页保留原有 doc_type/source_doc_id 区分规则；
 * - 编辑页路径包含记录 id，因此天然保持独立。
 */
export function getViewKey(fullPath: string, accountKey: string, routeName?: string | symbol | null): string {
  const name = String(routeName || '')

  const scmDocFamily = getScmDocTabFamily(fullPath)
  if (scmDocFamily) return `${accountKey}:scm-doc:${scmDocFamily}`

  if (name === 'PrintTemplateDesigner' || isPrintTemplateDesignerPath(fullPath)) {
    return `${accountKey}:print-template-design`
  }

  if (TRANSIENT_ROUTE_NAMES.has(name)) return `${accountKey}:route:${name}`

  // 应收 / 应付对账单列表、新增页按方向各占一个标签（路径相同、query 不同）
  const [stmtPath, stmtQuery = ''] = fullPath.split('?')
  if (stmtPath === '/scm/statements' || stmtPath === '/scm/statements/new') {
    const direction = new URLSearchParams(stmtQuery).get('direction')
    if (direction === 'ar' || direction === 'ap') return `${accountKey}:${stmtPath}:${direction}`
  }

  const reportFamily = getScmReportTabFamily(fullPath)
  if (reportFamily) return `${accountKey}:scm-report:${reportFamily}`

  const path = fullPath.split('?')[0] || fullPath
  return `${accountKey}:${path}`
}
