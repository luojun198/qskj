export interface NavItem {
  path: string
  title: string
  /** 任一权限满足即显示；省略表示登录即可见 */
  permission?: string | string[]
  requiresCashFlow?: boolean
}

export interface NavSubGroup {
  label: string
  items: NavItem[]
}

export interface NavGroup {
  title: string
  icon: string
  children: NavItem[]
  /** 可选：内部子分组；children 继续作为直接菜单项显示 */
  subGroups?: NavSubGroup[]
}

/** 路由白名单：登录即可访问，不做权限校验 */
export const ROUTE_PERMISSION_WHITELIST = ['/login', '/forbidden', '/activate'] as const

/** 主页查看权限码 */
export const DASHBOARD_PERMISSION = 'system:dashboard'

/** 精确路径 → 权限码（任一满足即可） */
const ROUTE_PERMISSION_MAP: Record<string, string | string[]> = {
  '/dashboard': DASHBOARD_PERMISSION,
  '/base/account': 'base:account',
  '/base/init-balance': 'period:init',
  '/base/init-balance/aux': 'period:init',
  '/base/voucher-type': 'base:vtype',
  '/voucher/template': 'base:template',
  '/base/transfer-type': 'base:transfer',
  '/report/dynamic': 'report:define',
  '/base/print-template': 'system:print',
  '/base/cash-flow-items': 'base:cashitem',
  '/base/fund-source': 'base:project',
  '/voucher/entry': 'voucher:entry',
  '/voucher/audit': ['voucher:audit', 'voucher:post', 'voucher:unpost'],
  '/voucher/auto-transfer': 'period:carry',
  '/voucher/query': 'voucher:query',
  '/voucher/period-close': ['period:close', 'period:unclose'],
  '/ledger/general': 'ledger:balance',
  '/ledger/detail': 'ledger:detail',
  '/ledger/balance': 'ledger:general',
  '/ledger/cash-journal': ['ledger:cash', 'ledger:bank'],
  '/ledger/cash-flow-trial-balance': 'ledger:cashflow',
  '/ledger/chronological': 'ledger:detail',
  '/base/project': 'base:project',
  '/base/project/category/new': 'base:project',
  '/ledger/aux-balance': 'ledger:aux',
  '/ledger/aux-detail': 'ledger:aux',
  '/system/account-set': 'system:account',
  '/system/user': 'system:user',
  '/system/role': 'system:role',
  '/system/param': 'system:init',
  '/system/log': 'period:log',
  '/security/backup': ['system:backup', 'system:restore'],
  '/cashier/journal': 'cashier:journal',
  '/cashier/init-balance': 'cashier:initbal',
  '/cashier/reconciliation': 'cashier:reconcile',
  '/cashier/flow-query': 'cashier:journal',
  '/cashier/daily-report': 'cashier:journal',
  '/cashier/bank-import': 'cashier:reconcile',
  '/cashier/reset': 'cashier:initbal',
  '/cashier/settle-type': 'cashier:dict',
  '/asset/list': 'asset:view',
  '/asset/depreciation': 'asset:edit',
  '/asset/report': 'asset:view',
  '/asset/inventory': 'asset:edit',
  '/asset/dict': 'asset:dict',
  '/scm/items': 'scm:item',
  '/scm/categories': 'scm:category',
  '/scm/item-types': 'scm:item',
  '/scm/units': 'scm:item',
  '/scm/partners': 'scm:partner',
  '/scm/suppliers': 'scm:partner',
  '/scm/customers': 'scm:partner',
  '/scm/warehouses': 'scm:warehouse',
  '/scm/bins': 'scm:warehouse',
  '/scm/stock': 'scm:stock',
  // 单据页一条路径承载多业务域（doc_type 由查询参数区分），路由守卫放行任一业务域，后端按域细化校验
  '/scm/docs': ['scm:purchase', 'scm:sale', 'scm:inventory', 'scm:production', 'scm:outsource', 'scm:arap'],
  '/scm/sales-order-relations': 'scm:sale',
  '/scm/report': 'scm:report',
  '/scm/report/sales/summary': 'scm:report',
  '/scm/report/sales/detail': 'scm:report',
  '/scm/report/sales/ranking': 'scm:report',
  '/scm/report/sales/profit': 'scm:report',
  '/scm/report/sales/trend': 'scm:report',
  '/scm/report/purchase/summary': 'scm:report',
  '/scm/report/purchase/detail': 'scm:report',
  '/scm/report/purchase/order-tracking': 'scm:report',
  '/scm/report/purchase/ranking': 'scm:report',
  '/scm/report/purchase/cost': 'scm:report',
  '/scm/report/purchase/trend': 'scm:report',
  '/scm/report/stock-ledger': 'scm:report',
  '/scm/report/outsource/execution': 'scm:report',
  '/scm/boms': ['scm:production', 'scm:outsource'],
  '/scm/production-plans': ['scm:production', 'scm:outsource'],
  '/scm/work-centers': ['scm:production', 'scm:outsource'],
  '/scm/routings': ['scm:production', 'scm:outsource'],
  '/scm/work-reports': ['scm:production', 'scm:outsource'],
  '/scm/kitting': ['scm:production', 'scm:outsource'],
  '/scm/mrp': ['scm:production', 'scm:outsource'],
  '/scm/cost-variance': ['scm:production', 'scm:outsource'],
  '/scm/qc-docs': ['scm:production', 'scm:outsource'],
  '/scm/arap': 'scm:arap',
  '/scm/arap-detail': 'scm:arap',
  '/scm/arap-verify': 'scm:arap',
  '/scm/arap-due': 'scm:arap',
  '/scm/arap-statement': 'scm:arap',
  '/scm/arap-statement/print': 'scm:arap',
  '/scm/arap-aging': 'scm:arap',
  '/scm/report/stock-alert': 'scm:report',
  '/scm/report/buysell': 'scm:report',
  '/scm/report/purchase-advice': 'scm:report',
  '/scm/batch-stock': 'scm:stock',
  '/scm/serials': 'scm:stock',
  '/scm/report/batch-alert': 'scm:report',
  '/report/cash-flow': 'ledger:cashflow',
  '/aux/dept': 'base:dept',
  '/aux/project': 'base:project',
  '/aux/supplier': 'base:customer',
  '/aux/person': 'base:person',
  '/aux/func-class': 'base:aux',
}

export function normalizePath(path: string): string {
  const raw = path.split('?')[0] || path
  return raw.startsWith('/') ? raw : `/${raw}`
}

function toPermissionList(permission?: string | string[]): string[] {
  if (!permission) return []
  return Array.isArray(permission) ? permission : [permission]
}

function hasAnyPermissionInList(permissions: string[], required: string[]): boolean {
  if (permissions.includes('*')) return true
  if (required.length === 0) return true
  return required.some(p => permissions.includes(p))
}

/** 判断用户是否拥有指定权限集合中的任一权限 */
export function matchPermissions(permissions: string[], required: string | string[]): boolean {
  return hasAnyPermissionInList(permissions, toPermissionList(required))
}

/** 判断单个 NavItem 是否可见 */
export function isNavItemVisible(item: NavItem, permissions: string[], enableCashFlow: boolean): boolean {
  if (item.requiresCashFlow && !enableCashFlow) return false
  if (!item.permission) return true
  return matchPermissions(permissions, item.permission)
}

function filterNavItems(items: NavItem[], permissions: string[], enableCashFlow: boolean): NavItem[] {
  return items.filter(item => isNavItemVisible(item, permissions, enableCashFlow))
}

/** 静态菜单分组定义（不含动态报表子项） */
function getStaticMenuGroups(enableCashFlow: boolean): NavGroup[] {
  // 基础设置 → 总账
  const baseGlChildren: NavItem[] = [
    { path: '/base/account', title: '会计科目', permission: 'base:account' },
    { path: '/base/init-balance', title: '期初余额', permission: 'period:init' },
    { path: '/base/voucher-type', title: '凭证类型', permission: 'base:vtype' },
    { path: '/voucher/template', title: '凭证模版', permission: 'base:template' },
    { path: '/base/transfer-type', title: '结转维护', permission: 'base:transfer' },
    { path: '/report/dynamic', title: '报表维护', permission: 'report:define' },
    { path: '/base/print-template', title: '打印模版', permission: 'system:print' },
  ]

  // 基础设置 → 出纳
  const baseCashierChildren: NavItem[] = [
    { path: '/cashier/init-balance', title: '出纳期初', permission: 'cashier:initbal' },
    { path: '/cashier/settle-type', title: '结算方式', permission: 'cashier:dict' },
    { path: '/cashier/reset', title: '出纳初始化', permission: 'cashier:initbal' },
  ]
  if (enableCashFlow) {
    baseCashierChildren.push(
      { path: '/base/cash-flow-items', title: '现金流量项目', permission: 'base:cashitem', requiresCashFlow: true },
      { path: '/base/fund-source', title: '资金来源', permission: 'base:project', requiresCashFlow: true }
    )
  }

  // 基础设置 → 资产
  const baseAssetChildren: NavItem[] = [
    { path: '/asset/dict', title: '资产档案', permission: 'asset:dict' },
  ]

  const ledgerChildren: NavItem[] = [
    { path: '/ledger/general', title: '科目余额表', permission: 'ledger:balance' },
    { path: '/ledger/detail', title: '明细账', permission: 'ledger:detail' },
    { path: '/ledger/balance', title: '总分类账', permission: 'ledger:general' },
    { path: '/ledger/cash-journal', title: '日记账', permission: ['ledger:cash', 'ledger:bank'] },
  ]
  if (enableCashFlow) {
    ledgerChildren.push({
      path: '/ledger/cash-flow-trial-balance',
      title: '现金流量试算平衡表',
      permission: 'ledger:cashflow',
      requiresCashFlow: true,
    })
  }
  ledgerChildren.push({ path: '/ledger/chronological', title: '序时账', permission: 'ledger:detail' })
  ledgerChildren.push({ path: '/ledger/standard-report', title: '标准报表', permission: 'ledger:detail' })

  const groups: NavGroup[] = [
    {
      title: '凭证管理',
      icon: 'EditPen',
      children: [
        { path: '/voucher/entry', title: '凭证录入', permission: 'voucher:entry' },
        { path: '/voucher/audit', title: '审核记账', permission: ['voucher:audit', 'voucher:post', 'voucher:unpost'] },
        { path: '/voucher/auto-transfer', title: '凭证结转', permission: 'period:carry' },
        { path: '/voucher/query', title: '凭证查询', permission: 'voucher:query' },
        { path: '/voucher/period-close', title: '期间结账', permission: ['period:close', 'period:unclose'] },
      ],
    },
    { title: '账簿管理', icon: 'List', children: ledgerChildren },
    {
      title: '辅助核算',
      icon: 'FolderOpened',
      children: [
        { path: '/base/project', title: '核算项目', permission: 'base:project' },
        { path: '/ledger/aux-balance', title: '辅助项目余额表', permission: 'ledger:aux' },
        { path: '/ledger/aux-detail', title: '辅助项目明细账', permission: 'ledger:aux' },
      ],
    },
    { title: '报表管理', icon: 'TrendCharts', children: [] },
    {
      title: '出纳管理',
      icon: 'CreditCard',
      children: [
        { path: '/cashier/journal', title: '出纳录单', permission: 'cashier:journal' },
        { path: '/cashier/daily-report', title: '账户余额表', permission: 'cashier:journal' },
        { path: '/cashier/flow-query', title: '出纳流水账', permission: 'cashier:journal' },
        { path: '/cashier/summary-report', title: '资金收支汇总表', permission: 'cashier:journal' },
        { path: '/cashier/document-query', title: '单据综合查询', permission: 'cashier:journal' },
      ],
    },
    {
      title: '固定资产',
      icon: 'OfficeBuilding',
      children: [
        { path: '/asset/list', title: '资产卡片', permission: 'asset:view' },
        { path: '/asset/depreciation', title: '折旧计提', permission: 'asset:edit' },
        { path: '/asset/report', title: '资产报表', permission: 'asset:view' },
        { path: '/asset/inventory', title: '资产盘点', permission: 'asset:edit' },
      ],
    },
    {
      title: '销售管理',
      icon: 'Sell',
      children: [
        { path: '/scm/docs?doc_type=SQ', title: '报价单', permission: 'scm:sale' },
        { path: '/scm/docs?doc_type=SOa', title: '销售订单', permission: 'scm:sale' },
        { path: '/scm/sales-order-relations', title: '销售订单关联表', permission: 'scm:sale' },
        { path: '/scm/docs?doc_type=SO', title: '销售发货', permission: 'scm:sale' },
        { path: '/scm/docs?doc_type=SR', title: '销售退货', permission: 'scm:sale' },
        { path: '/scm/docs?doc_type=RCV', title: '收款单', permission: 'scm:arap' },
        { path: '/scm/docs?doc_type=RS', title: '销售发票', permission: 'scm:sale' },
      ],
      subGroups: [
        {
          label: '销售报表',
          items: [
            { path: '/scm/report/sales/summary', title: '销售汇总表', permission: 'scm:report' },
            { path: '/scm/report/sales/detail', title: '销售明细表', permission: 'scm:report' },
            { path: '/scm/report/sales/ranking', title: '销售排行榜', permission: 'scm:report' },
            { path: '/scm/report/sales/profit', title: '销售毛利分析', permission: 'scm:report' },
            { path: '/scm/report/sales/trend', title: '销售趋势分析', permission: 'scm:report' },
            { path: '/scm/report/buysell?kind=sales', title: '自定义查询', permission: 'scm:report' },
          ],
        },
      ],
    },
    {
      title: '采购管理',
      icon: 'ShoppingCart',
      children: [
        { path: '/scm/docs?doc_type=MR', title: '缺料单', permission: 'scm:purchase' },
        { path: '/scm/docs?doc_type=PQ', title: '采购询价', permission: 'scm:purchase' },
        { path: '/scm/docs?doc_type=PO', title: '采购订单', permission: 'scm:purchase' },
        { path: '/scm/docs?doc_type=PI', title: '采购入库', permission: 'scm:purchase' },
        { path: '/scm/docs?doc_type=PR', title: '采购退货', permission: 'scm:purchase' },
        { path: '/scm/docs?doc_type=PAY', title: '付款单', permission: 'scm:arap' },
        { path: '/scm/docs?doc_type=RP', title: '采购发票', permission: 'scm:purchase' },
      ],
      subGroups: [
        {
          label: '采购报表',
          items: [
            { path: '/scm/report/purchase/summary', title: '采购汇总表', permission: 'scm:report' },
            { path: '/scm/report/purchase/detail', title: '采购明细表', permission: 'scm:report' },
            { path: '/scm/report/purchase/order-tracking', title: '采购订单执行表', permission: 'scm:report' },
            { path: '/scm/report/purchase/ranking', title: '采购排行榜', permission: 'scm:report' },
            { path: '/scm/report/purchase/cost', title: '采购成本分析', permission: 'scm:report' },
            { path: '/scm/report/purchase/trend', title: '采购趋势分析', permission: 'scm:report' },
            { path: '/scm/report/buysell?kind=purchase', title: '自定义查询', permission: 'scm:report' },
            { path: '/scm/report/purchase-advice', title: '采购建议', permission: 'scm:report' },
          ],
        },
      ],
    },
    {
      title: '往来管理',
      icon: 'Money',
      children: [
        { path: '/scm/arap', title: '往来余额表', permission: 'scm:arap' },
        { path: '/scm/arap-detail', title: '往来明细账', permission: 'scm:arap' },
        { path: '/scm/arap-verify', title: '往来核销', permission: 'scm:arap' },
        { path: '/scm/arap-due', title: '到期提醒/信用', permission: 'scm:arap' },
        { path: '/scm/arap-statement', title: '对账单', permission: 'scm:arap' },
        { path: '/scm/arap-aging', title: '应收应付账龄', permission: 'scm:arap' },
        { path: '/scm/docs?doc_type=RCV&payment_mode=advance', title: '预收款单', permission: 'scm:arap' },
        { path: '/scm/docs?doc_type=PAY&payment_mode=advance', title: '预付款单', permission: 'scm:arap' },
        { path: '/scm/docs?doc_type=RCV', title: '收款单', permission: 'scm:arap' },
        { path: '/scm/docs?doc_type=PAY', title: '付款单', permission: 'scm:arap' },
      ],
    },
    {
      title: '生产管理',
      icon: 'SetUp',
      children: [
        { path: '/scm/boms', title: '物料清单(BOM)', permission: 'scm:production' },
        { path: '/scm/mrp', title: 'MRP运算', permission: 'scm:production' },
        { path: '/scm/production-plans?plan_type=self', title: '生产计划', permission: 'scm:production' },
        { path: '/scm/work-centers', title: '工作中心', permission: 'scm:production' },
        { path: '/scm/routings', title: '工艺路线', permission: 'scm:production' },
        { path: '/scm/work-reports', title: '生产报工', permission: 'scm:production' },
        { path: '/scm/kitting', title: '齐套分析', permission: 'scm:production' },
        { path: '/scm/cost-variance', title: '标准成本差异', permission: 'scm:production' },
        { path: '/scm/qc-docs', title: '质检管理', permission: 'scm:production' },
        { path: '/scm/docs?doc_type=PL', title: '领料单', permission: 'scm:production' },
        { path: '/scm/docs?doc_type=PF', title: '成品入库', permission: 'scm:production' },
        { path: '/scm/docs?doc_type=PS', title: '不良品入库', permission: 'scm:production' },
        { path: '/scm/docs?doc_type=PJ', title: '退料单', permission: 'scm:production' },
        { path: '/scm/docs?doc_type=AS', title: '组装单', permission: 'scm:production' },
        { path: '/scm/docs?doc_type=DS', title: '拆卸单', permission: 'scm:production' },
      ],
    },
    {
      title: '委外管理',
      icon: 'Connection',
      children: [
        { path: '/scm/production-plans?plan_type=outsource', title: '委外计划', permission: 'scm:outsource' },
        { path: '/scm/docs?doc_type=WO', title: '委外发货', permission: 'scm:outsource' },
        { path: '/scm/docs?doc_type=WI', title: '委外入库', permission: 'scm:outsource' },
        { path: '/scm/report/outsource/execution', title: '委外执行及结存表', permission: 'scm:report' },
      ],
    },
    {
      title: '库存',
      icon: 'Box',
      children: [
        { path: '/scm/stock', title: '库存查询', permission: 'scm:stock' },
        { path: '/scm/batch-stock', title: '批次库存', permission: 'scm:stock' },
        { path: '/scm/serials', title: '序列号查询', permission: 'scm:stock' },
        { path: '/scm/report', title: '收发存汇总', permission: 'scm:report' },
        { path: '/scm/report/stock-ledger', title: '物料收发明细账', permission: 'scm:report' },
        { path: '/scm/report/stock-alert', title: '库存预警', permission: 'scm:report' },
        { path: '/scm/report/batch-alert', title: '批次临期预警', permission: 'scm:report' },
        { path: '/scm/docs?doc_type=OI', title: '其他入库', permission: 'scm:inventory' },
        { path: '/scm/docs?doc_type=OO', title: '其他出库', permission: 'scm:inventory' },
        { path: '/scm/docs?doc_type=TR', title: '调拨单', permission: 'scm:inventory' },
        { path: '/scm/docs?doc_type=CK', title: '盘点单', permission: 'scm:inventory' },
      ],
    },
    // 基础设置（含4个内部子分组）
    {
      title: '基础设置',
      icon: 'Coin',
      children: [],
      subGroups: [
        { label: '总账', items: baseGlChildren },
        { label: '出纳', items: baseCashierChildren },
        { label: '资产', items: baseAssetChildren },
        { label: '供应链', items: [
          { path: '/scm/items', title: '物料档案', permission: 'scm:item' },
          { path: '/scm/categories', title: '物料分类', permission: 'scm:category' },
          { path: '/scm/item-types', title: '物料属性', permission: 'scm:item' },
          { path: '/scm/units', title: '计量单位', permission: 'scm:item' },
          { path: '/scm/suppliers?partner_type=supplier', title: '供应商', permission: 'scm:partner' },
          { path: '/scm/customers?partner_type=customer', title: '客户', permission: 'scm:partner' },
          { path: '/scm/warehouses', title: '仓库档案', permission: 'scm:warehouse' },
          { path: '/scm/bins', title: '库位档案', permission: 'scm:warehouse' },
          { path: '/scm/col-schemes', title: '列方案设置', permission: 'scm:colscheme' },
          { path: '/scm/doc-field-defs', title: '单据自定义字段', permission: 'scm:param' },
        ]},
      ],
    },
    {
      title: '系统管理',
      icon: 'Setting',
      children: [
        { path: '/system/account-set', title: '账套管理', permission: 'system:account' },
        { path: '/system/user', title: '用户管理', permission: 'system:user' },
        { path: '/system/role', title: '角色管理', permission: 'system:role' },
        { path: '/system/param', title: '系统参数', permission: 'system:init' },
        { path: '/system/log', title: '操作日志', permission: 'period:log' },
      ],
    },
    {
      title: '数据安全',
      icon: 'Box',
      children: [{ path: '/security/backup', title: '备份恢复', permission: ['system:backup', 'system:restore'] }],
    },
  ]

  return groups
}

/** 过滤菜单分组（保留 enableCashFlow 逻辑 + 权限过滤） */
export function buildMenuGroups(
  permissions: string[],
  enableCashFlow: boolean,
  dynamicReportItems: NavItem[]
): NavGroup[] {
  const groups = getStaticMenuGroups(enableCashFlow).map(group => {
    if (group.title === '报表管理') {
      return {
        ...group,
        children: filterNavItems(dynamicReportItems, permissions, enableCashFlow),
      }
    }
    if (group.subGroups) {
      const filteredSubGroups = group.subGroups
        .map(sg => ({ ...sg, items: filterNavItems(sg.items, permissions, enableCashFlow) }))
        .filter(sg => sg.items.length > 0)
      return {
        ...group,
        subGroups: filteredSubGroups,
        children: filterNavItems(group.children, permissions, enableCashFlow),
      }
    }
    return {
      ...group,
      children: filterNavItems(group.children, permissions, enableCashFlow),
    }
  })

  return groups.filter(group => group.children.length > 0 || (group.subGroups?.length ?? 0) > 0)
}

/** 路由守卫用：根据 path 查权限，支持动态路由段 */
export function getRoutePermissions(path: string): string[] | undefined {
  const normalized = normalizePath(path)

  if ((ROUTE_PERMISSION_WHITELIST as readonly string[]).includes(normalized)) {
    return undefined
  }

  const exact = ROUTE_PERMISSION_MAP[normalized]
  if (exact) {
    return toPermissionList(exact)
  }

  // 动态报表查看：/report/dynamic/:code
  const dynamicReportMatch = normalized.match(/^\/report\/dynamic\/[^/]+$/)
  if (dynamicReportMatch) {
    return ['report:view']
  }

  // 兼容 Dashboard 等使用的 /report/run/:code
  const reportRunMatch = normalized.match(/^\/report\/run\/[^/]+$/)
  if (reportRunMatch) {
    return ['report:view']
  }

  // 资产明细账：/asset/detail/:id
  const assetDetailMatch = normalized.match(/^\/asset\/detail\/[^/]+$/)
  if (assetDetailMatch) {
    return ['asset:view']
  }

  if (/^\/base\/project\/category\/[^/]+\/edit$/.test(normalized)) {
    return ['base:project']
  }

  return undefined
}

/** 判断用户是否有权访问指定路由 */
export function canAccessRoute(path: string, permissions: string[]): boolean {
  const normalized = normalizePath(path)

  if ((ROUTE_PERMISSION_WHITELIST as readonly string[]).includes(normalized)) {
    return true
  }

  const required = getRoutePermissions(normalized)
  if (!required || required.length === 0) {
    return true
  }

  return matchPermissions(permissions, required)
}

/** 登录后默认落地页：有主页权限则 /dashboard，否则取第一个可访问菜单 */
export function getDefaultLandingPath(permissions: string[], enableCashFlow = false): string {
  if (canAccessRoute('/dashboard', permissions)) {
    return '/dashboard'
  }
  const groups = buildMenuGroups(permissions, enableCashFlow, [])
  const first = groups.flatMap(g => [
    ...g.children,
    ...(g.subGroups?.flatMap(sg => sg.items) ?? []),
  ])[0]
  return first?.path.split('?')[0] || '/forbidden'
}

/** 无路由权限时落到可访问首页，避免停留在无权限页并触发 403 提示 */
export function resolveAccessiblePath(
  targetPath: string,
  permissions: string[],
  enableCashFlow = false
): string {
  const normalized = normalizePath(targetPath)
  if (canAccessRoute(normalized, permissions)) {
    return normalized
  }
  return getDefaultLandingPath(permissions, enableCashFlow)
}

/** 后端 requirePermission 返回的 403 文案（与 accountScope 等业务 403 区分） */
export const API_ROUTE_PERMISSION_DENIED_MESSAGE = '无此操作权限'

export function isApiRoutePermissionDenied(message?: string): boolean {
  return message === API_ROUTE_PERMISSION_DENIED_MESSAGE
}
