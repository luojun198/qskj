import {
  ALL_MODULE_KEYS,
  docTypeToModules,
  hasLicensedModule,
  permissionToModules,
  planTypeToModules,
  PRODUCTION_OR_OUTSOURCE_MODULES,
  SHARED_SCM_MODULES,
  type LicenseModuleKey,
} from './licenseModules'
import { resolveNavAppTitle } from '@/utils/groupNavigation'

export interface NavItem {
  path: string
  title: string
  /** 任一权限满足即显示；省略表示登录即可见 */
  permission?: string | string[]
  requiresCashFlow?: boolean
  requiresForeignCurrency?: boolean
  /** 所属注册模块（任一授权即可）；省略时继承子分组/分组，再按路径推导 */
  module?: LicenseModuleKey | LicenseModuleKey[]
  /** Lucide 图标键，见 navIcons.ts；省略时按路径回退 */
  icon?: string
}

/** 二级分组：一级应用下按业务环节切分的菜单段 */
export interface NavSection {
  key: string
  label: string
  items: NavItem[]
  module?: LicenseModuleKey | LicenseModuleKey[]
}

/** 一级应用：左侧应用栏中的一个入口 */
export interface NavApp {
  key: string
  title: string
  /** Lucide 图标键 */
  icon: string
  /** 一句话说明，模块首页与搜索结果使用 */
  description?: string
  sections: NavSection[]
  /** 应用所属注册模块，作为分组/子项默认值；省略表示不受模块授权限制 */
  module?: LicenseModuleKey | LicenseModuleKey[]
}

/** 兼容旧调用方的子分组结构（等价于 NavSection） */
export interface NavSubGroup {
  label: string
  items: NavItem[]
  module?: LicenseModuleKey | LicenseModuleKey[]
}

/**
 * 兼容结构：一个 NavApp 摊平成一个 NavGroup。
 * children 为应用下全部可见页面（顺序与分组一致），subGroups 与 sections 一一对应。
 */
export interface NavGroup {
  key?: string
  title: string
  icon: string
  children: NavItem[]
  subGroups?: NavSubGroup[]
  module?: LicenseModuleKey | LicenseModuleKey[]
}

/** 工作台应用键，左侧应用栏首项 */
export const WORKBENCH_APP_KEY = 'workbench'
/** 动态报表挂载的应用/分组键 */
export const DYNAMIC_REPORT_APP_KEY = 'finance'
export const DYNAMIC_REPORT_SECTION_KEY = 'finance-reports'

/** 路由白名单：登录即可访问，不做权限校验 */
export const ROUTE_PERMISSION_WHITELIST = ['/login', '/forbidden', '/activate'] as const

/** 主页查看权限码 */
export const DASHBOARD_PERMISSION = 'system:dashboard'

/** 精确路径 → 权限码（任一满足即可） */
const ROUTE_PERMISSION_MAP: Record<string, string | string[]> = {
  '/dashboard': DASHBOARD_PERMISSION,
  '/base/account': 'base:account',
  '/base/account-set-info': 'system:init',
  '/base/init-balance': 'period:init',
  '/base/init-balance/aux': 'period:init',
  '/base/voucher-type': 'base:vtype',
  '/voucher/template': 'base:template',
  '/base/transfer-type': 'base:transfer',
  '/report/dynamic': 'report:define',
  '/base/print-template': 'system:print',
  '/base/cash-flow-items': 'base:cashitem',
  '/base/currency': 'base:currency',
  '/base/fund-source': 'base:project',
  '/voucher/entry': 'voucher:entry',
  '/voucher/audit': ['voucher:audit', 'voucher:post', 'voucher:unpost'],
  '/voucher/auto-transfer': 'period:carry',
  '/voucher/fx-reval': 'period:carry',
  '/voucher/query': 'voucher:query',
  '/voucher/period-close': ['period:close', 'period:unclose'],
  // ⚠️ 历史命名错位，勿"顺手对齐"：
  //   /ledger/general  页面是「科目余额表」，权限 key 为 ledger:balance
  //   /ledger/balance  页面是「总分类账」，  权限 key 为 ledger:general
  // 即路由名与功能名互换、权限 key 又与两者互换一遍。本表是权限的唯一真源，
  // 新增菜单请以「页面实际功能」挑权限 key，不要按路由名推断。
  // 若要彻底统一，需同步改路由、菜单、角色权限表存量数据与用户标签页缓存，属大版本改动。
  '/ledger/general': 'ledger:balance',
  '/ledger/detail': 'ledger:detail',
  '/ledger/vat-detail': 'ledger:detail',
  '/ledger/multi-column': 'ledger:multirow',
  '/ledger/balance': 'ledger:general',
  '/ledger/cash-journal': ['ledger:cash', 'ledger:bank'],
  '/ledger/cash-flow-trial-balance': 'ledger:cashflow',
  '/ledger/foreign-balance': 'ledger:foreign',
  '/ledger/foreign-detail': 'ledger:foreign',
  '/ledger/quantity-balance': 'ledger:qty',
  '/ledger/voucher-summary': 'ledger:vsummary',
  '/ledger/subject-analysis': 'ledger:balance',
  '/ledger/chronological': 'ledger:detail',
  '/base/project': 'base:project',
  '/base/project/category/new': 'base:project',
  '/ledger/aux-balance': 'ledger:aux',
  '/ledger/aux-foreign-balance': 'ledger:aux',
  '/ledger/aux-quantity-balance': 'ledger:aux',
  '/ledger/aux-detail': 'ledger:aux',
  '/ledger/aux-multi-column': 'ledger:aux',
  '/system/account-set': 'system:account',
  '/system/user': 'system:user',
  '/system/role': 'system:role',
  '/system/param': 'system:init',
  '/system/log': 'period:log',
  '/security/backup': ['system:backup', 'system:restore'],
  '/cashier/journal': 'cashier:journal',
  '/cashier/init-balance': 'cashier:initbal',
  '/cashier/reconciliation': 'cashier:reconcile',
  '/cashier/reconcile': 'cashier:reconcile',
  '/base/keyboard-shortcuts': 'system:init',
  '/cashier/flow-query': 'cashier:journal',
  '/cashier/daily-report': 'cashier:journal',
  '/cashier/summary-report': 'cashier:journal',
  '/cashier/document-query': 'cashier:journal',
  '/cashier/bank-import': 'cashier:reconcile',
  '/cashier/reset': 'cashier:initbal',
  '/cashier/settle-type': 'cashier:dict',
  // 与 server/src/routes/fixedAsset.ts 的 ASSET_PERMISSION_RULES 保持一致，
  // 否则会出现「菜单可见但操作 403」
  '/asset/list': 'asset:view',
  '/asset/change': 'asset:change',
  '/asset/change/list': 'asset:view',
  '/asset/requisition': 'asset:requisition',
  '/asset/import': 'asset:edit',
  '/asset/depreciation': 'asset:depr',
  '/asset/report': 'asset:report',
  '/asset/inventory': 'asset:inventory',
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
  '/scm/docs': ['scm:purchase', 'scm:sale', 'scm:inventory', 'scm:opening', 'scm:production', 'scm:outsource', 'scm:arap'],
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
  '/scm/report/production/execution': 'scm:report',
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
  // 首页取数规则：系统参数维护者与工作台使用者都可进入（与历史行为一致，工作台内有直达链接）
  '/system/dashboard-rules': ['system:init', DASHBOARD_PERMISSION],
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

function readQueryParam(fullPath: string, key: string): string | undefined {
  const queryIndex = fullPath.indexOf('?')
  if (queryIndex < 0) return undefined
  const value = new URLSearchParams(fullPath.slice(queryIndex + 1)).get(key)
  return value || undefined
}

function toPermissionList(permission?: string | string[]): string[] {
  if (!permission) return []
  return Array.isArray(permission) ? permission : [permission]
}

function toModuleList(module?: LicenseModuleKey | LicenseModuleKey[]): LicenseModuleKey[] {
  if (!module) return []
  return Array.isArray(module) ? module : [module]
}

function uniqueModules(list: Array<LicenseModuleKey | null | undefined>): LicenseModuleKey[] {
  const result: LicenseModuleKey[] = []
  for (const item of list) {
    if (item && !result.includes(item)) result.push(item)
  }
  return result
}

/**
 * 路由所需注册模块（任一授权即可），空数组表示不受模块限制。
 * 供应链单据页按 doc_type / plan_type 查询参数细分到生产、委外；
 * 不带参数的子路由（如 /scm/docs/:id）只能放宽到进销存/生产/委外任一，由后端按单据精确校验。
 */
export function getRouteModules(fullPath: string): LicenseModuleKey[] {
  const normalized = normalizePath(fullPath)

  if ((ROUTE_PERMISSION_WHITELIST as readonly string[]).includes(normalized)) {
    return []
  }

  if (normalized === '/scm/docs' || normalized.startsWith('/scm/docs/')) {
    const byDocType = docTypeToModules(readQueryParam(fullPath, 'doc_type'))
    return byDocType.length > 0 ? byDocType : [...SHARED_SCM_MODULES]
  }
  if (normalized === '/scm/production-plans' || normalized.startsWith('/scm/production-plans/')) {
    return planTypeToModules(readQueryParam(fullPath, 'plan_type'))
  }
  if (normalized.startsWith('/scm/report/outsource')) {
    return ['outsource']
  }
  if (normalized.startsWith('/scm/report/production')) {
    return [...PRODUCTION_OR_OUTSOURCE_MODULES]
  }

  const permissions = getRoutePermissions(normalized)
  if (permissions && permissions.length > 0) {
    const derived = uniqueModules(permissions.flatMap(permissionToModules))
    if (derived.length > 0) return derived
    return []
  }

  // 未登记权限的页面按路径前缀兜底，避免模块页面绕过授权
  if (normalized.startsWith('/cashier/')) return ['cashier']
  if (normalized.startsWith('/asset/')) return ['asset']
  if (normalized.startsWith('/scm/')) return ['scm']
  return []
}

/** 判断授权模块是否满足路由要求 */
export function canAccessModules(fullPath: string, licensedModules: readonly string[]): boolean {
  const required = getRouteModules(fullPath)
  return hasLicensedModule(licensedModules, required)
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
export function isNavItemVisible(
  item: NavItem,
  permissions: string[],
  enableCashFlow: boolean,
  licensedModules: readonly string[] = ALL_MODULE_KEYS,
  inheritedModule?: LicenseModuleKey | LicenseModuleKey[],
  enableForeignCurrency = false
): boolean {
  if (item.requiresCashFlow && !enableCashFlow) return false
  if (item.requiresForeignCurrency && !enableForeignCurrency) return false
  const requiredModules = toModuleList(item.module ?? inheritedModule)
  const moduleOk = requiredModules.length > 0
    ? hasLicensedModule(licensedModules, requiredModules)
    : canAccessModules(item.path, licensedModules)
  if (!moduleOk) return false
  if (!item.permission) return true
  return matchPermissions(permissions, item.permission)
}

function filterNavItems(
  items: NavItem[],
  permissions: string[],
  enableCashFlow: boolean,
  licensedModules: readonly string[],
  inheritedModule?: LicenseModuleKey | LicenseModuleKey[],
  enableForeignCurrency = false
): NavItem[] {
  return items.filter(item =>
    isNavItemVisible(
      item,
      permissions,
      enableCashFlow,
      licensedModules,
      inheritedModule,
      enableForeignCurrency
    )
  )
}

/** 静态应用定义（不含动态报表子项） */
function getStaticNavApps(enableCashFlow: boolean, enableForeignCurrency = false): NavApp[] {
  const ledgerItems: NavItem[] = [
    // 注意：路由名与功能名历史错位，权限 key 见本文件顶部 routePermissionMap 处说明
    { path: '/ledger/general', title: '科目余额表', permission: 'ledger:balance', icon: 'Table2' },
    { path: '/ledger/balance', title: '总分类账', permission: 'ledger:general', icon: 'BookOpen' },
    { path: '/ledger/detail', title: '明细账', permission: 'ledger:detail', icon: 'ListOrdered' },
    { path: '/ledger/vat-detail', title: '增值税明细账', permission: 'ledger:detail', icon: 'Receipt' },
    { path: '/ledger/multi-column', title: '多栏账', permission: 'ledger:multirow', icon: 'Table2' },
    { path: '/ledger/chronological', title: '序时账', permission: 'ledger:detail', icon: 'Clock' },
    { path: '/ledger/cash-journal', title: '日记账', permission: ['ledger:cash', 'ledger:bank'], icon: 'Wallet' },
    { path: '/ledger/voucher-summary', title: '凭证汇总表', permission: 'ledger:vsummary', icon: 'Table2' },
    { path: '/ledger/quantity-balance', title: '库存数量金额表', permission: 'ledger:qty', icon: 'Boxes' },
  ]
  if (enableCashFlow) {
    ledgerItems.push({
      path: '/ledger/cash-flow-trial-balance',
      title: '现金流量试算平衡表',
      permission: 'ledger:cashflow',
      requiresCashFlow: true,
      icon: 'Waves',
    })
  }
  if (enableForeignCurrency) {
    ledgerItems.push({
      path: '/ledger/foreign-balance',
      title: '外币余额表',
      permission: 'ledger:foreign',
      requiresForeignCurrency: true,
      icon: 'Coins',
    })
    ledgerItems.push({
      path: '/ledger/foreign-detail',
      title: '外币明细账',
      permission: 'ledger:foreign',
      requiresForeignCurrency: true,
      icon: 'Coins',
    })
  }

  const auxItems: NavItem[] = [
    { path: '/base/project', title: '核算项目', permission: 'base:project', icon: 'Tags' },
    { path: '/ledger/aux-balance', title: '辅助项目余额表', permission: 'ledger:aux', icon: 'Layers' },
  ]
  if (enableForeignCurrency) {
    auxItems.push({
      path: '/ledger/aux-foreign-balance',
      title: '辅助项目外币余额表',
      permission: 'ledger:aux',
      requiresForeignCurrency: true,
      icon: 'Coins',
    })
  }
  auxItems.push({
    path: '/ledger/aux-quantity-balance',
    title: '辅助项目库存数量金额表',
    permission: 'ledger:aux',
    icon: 'Boxes',
  })
  auxItems.push({ path: '/ledger/aux-detail', title: '辅助项目明细账', permission: 'ledger:aux', icon: 'Sheet' })
  auxItems.push({ path: '/ledger/aux-multi-column', title: '辅助项目多栏明细账', permission: 'ledger:aux', icon: 'Table2' })

  const financeReportItems: NavItem[] = [
    { path: '/ledger/standard-report', title: '标准报表', permission: 'ledger:detail', icon: 'FileBarChart2' },
    { path: '/ledger/subject-analysis', title: '财务分析', permission: 'ledger:balance', icon: 'PieChart' },
  ]
  if (enableCashFlow) {
    financeReportItems.push({
      path: '/report/cash-flow',
      title: '现金流量表(估算)',
      permission: 'ledger:cashflow',
      requiresCashFlow: true,
      icon: 'Waves',
    })
  }

  return [
    {
      key: 'finance',
      title: '财务总账',
      icon: 'BookOpenCheck',
      description: '凭证、账簿、辅助核算与财务报表',
      module: 'gl',
      sections: [
        {
          key: 'finance-voucher',
          label: '凭证处理',
          items: [
            { path: '/voucher/entry', title: '凭证录入', permission: 'voucher:entry', icon: 'FilePen' },
            { path: '/voucher/audit', title: '审核记账', permission: ['voucher:audit', 'voucher:post', 'voucher:unpost'], icon: 'FileCheck2' },
            { path: '/voucher/query', title: '凭证查询', permission: 'voucher:query', icon: 'FileSearch' },
            { path: '/voucher/fx-reval', title: '期末调汇', permission: 'period:carry', icon: 'Coins', requiresForeignCurrency: true },
            { path: '/voucher/auto-transfer', title: '凭证结转', permission: 'period:carry', icon: 'ArrowRightLeft' },
            { path: '/voucher/period-close', title: '期间结账', permission: ['period:close', 'period:unclose'], icon: 'CalendarCheck' },
          ],
        },
        { key: 'finance-ledger', label: '账簿查询', items: ledgerItems },
        { key: 'finance-aux', label: '辅助核算', items: auxItems },
        { key: DYNAMIC_REPORT_SECTION_KEY, label: '财务报表', items: financeReportItems },
      ],
    },
    {
      key: 'cashier',
      title: '出纳管理',
      icon: 'Landmark',
      description: '出纳录单、资金报表与出纳设置',
      module: 'cashier',
      sections: [
        {
          key: 'cashier-daily',
          label: '出纳业务',
          items: [
            { path: '/cashier/journal', title: '出纳录单', permission: 'cashier:journal', icon: 'Banknote' },
          ],
        },
        {
          key: 'cashier-bank',
          label: '银行对账',
          items: [
            { path: '/cashier/reconcile', title: '银行勾对', permission: 'cashier:reconcile', icon: 'ListChecks' },
            { path: '/cashier/reconciliation', title: '余额调节表', permission: 'cashier:reconcile', icon: 'Sheet' },
            { path: '/cashier/bank-import', title: '银行对账单导入', permission: 'cashier:reconcile', icon: 'FileInput' },
          ],
        },
        {
          key: 'cashier-report',
          label: '资金报表',
          items: [
            { path: '/cashier/daily-report', title: '账户余额表', permission: 'cashier:journal', icon: 'Table2' },
            { path: '/cashier/flow-query', title: '出纳流水账', permission: 'cashier:journal', icon: 'ListOrdered' },
            { path: '/cashier/summary-report', title: '资金收支汇总表', permission: 'cashier:journal', icon: 'PieChart' },
            { path: '/cashier/document-query', title: '单据综合查询', permission: 'cashier:journal', icon: 'FileSearch' },
          ],
        },
        {
          key: 'cashier-setup',
          label: '出纳设置',
          items: [
            { path: '/cashier/settle-type', title: '结算方式', permission: 'cashier:dict', icon: 'CreditCard' },
            { path: '/cashier/init-balance', title: '出纳期初', permission: 'cashier:initbal', icon: 'Coins' },
            { path: '/cashier/reset', title: '出纳初始化', permission: 'cashier:initbal', icon: 'RotateCcw' },
          ],
        },
      ],
    },
    {
      key: 'asset',
      title: '固定资产',
      icon: 'Building2',
      description: '资产卡片、折旧、盘点与资产报表',
      module: 'asset',
      sections: [
        {
          key: 'asset-ops',
          label: '资产业务',
          items: [
            { path: '/asset/list', title: '资产卡片', permission: 'asset:view', icon: 'IdCard' },
            { path: '/asset/change', title: '资产变动', permission: 'asset:change', icon: 'ArrowLeftRight' },
            { path: '/asset/requisition', title: '领用归还', permission: 'asset:requisition', icon: 'UserCheck' },
            { path: '/asset/depreciation', title: '折旧计提', permission: 'asset:depr', icon: 'TrendingDown' },
            { path: '/asset/inventory', title: '资产盘点', permission: 'asset:inventory', icon: 'ClipboardCheck' },
          ],
        },
        {
          key: 'asset-report',
          label: '资产报表',
          items: [{ path: '/asset/report', title: '资产报表', permission: 'asset:report', icon: 'FileBarChart2' }],
        },
        {
          key: 'asset-setup',
          label: '资产设置',
          items: [{ path: '/asset/dict', title: '资产档案', permission: 'asset:dict', icon: 'FolderCog' }],
        },
      ],
    },
    {
      key: 'purchase',
      title: '采购管理',
      icon: 'ShoppingCart',
      description: '询价、订单、入库、退货、发票与采购分析',
      module: 'scm',
      sections: [
        {
          key: 'purchase-docs',
          label: '采购业务',
          items: [
            { path: '/scm/docs?doc_type=PQ', title: '采购询价', permission: 'scm:purchase', icon: 'MessageSquareQuote' },
            { path: '/scm/docs?doc_type=PO', title: '采购订单', permission: 'scm:purchase', icon: 'ClipboardList' },
            { path: '/scm/docs?doc_type=PI', title: '采购入库', permission: 'scm:purchase', icon: 'PackagePlus' },
            { path: '/scm/docs?doc_type=PR', title: '采购退货', permission: 'scm:purchase', icon: 'Undo2' },
            { path: '/scm/docs?doc_type=RP', title: '采购发票', permission: 'scm:purchase', icon: 'Receipt' },
          ],
        },
        {
          key: 'purchase-demand',
          label: '缺料与建议',
          items: [
            { path: '/scm/docs?doc_type=MR', title: '缺料单', permission: 'scm:purchase', icon: 'AlertTriangle' },
            { path: '/scm/report/purchase-advice', title: '采购建议', permission: 'scm:report', icon: 'Lightbulb' },
          ],
        },
        {
          key: 'purchase-report',
          label: '采购报表',
          items: [
            { path: '/scm/report/purchase/summary', title: '采购汇总表', permission: 'scm:report', icon: 'Table2' },
            { path: '/scm/report/purchase/detail', title: '采购明细表', permission: 'scm:report', icon: 'ListOrdered' },
            { path: '/scm/report/purchase/order-tracking', title: '采购订单执行表', permission: 'scm:report', icon: 'ListChecks' },
            { path: '/scm/report/purchase/ranking', title: '采购排行榜', permission: 'scm:report', icon: 'Trophy' },
            { path: '/scm/report/purchase/cost', title: '采购成本分析', permission: 'scm:report', icon: 'Calculator' },
            { path: '/scm/report/purchase/trend', title: '采购趋势分析', permission: 'scm:report', icon: 'LineChart' },
            { path: '/scm/report/buysell?kind=purchase', title: '自定义查询', permission: 'scm:report', icon: 'Search' },
          ],
        },
      ],
    },
    {
      key: 'sales',
      title: '销售管理',
      icon: 'Store',
      description: '报价、订单、发货、退货、发票与销售分析',
      module: 'scm',
      sections: [
        {
          key: 'sales-docs',
          label: '销售业务',
          items: [
            { path: '/scm/docs?doc_type=SQ', title: '销售报价', permission: 'scm:sale', icon: 'MessageSquareQuote' },
            { path: '/scm/docs?doc_type=SOa', title: '销售订单', permission: 'scm:sale', icon: 'ClipboardList' },
            { path: '/scm/docs?doc_type=SO', title: '销售发货', permission: 'scm:sale', icon: 'Truck' },
            { path: '/scm/docs?doc_type=SR', title: '销售退货', permission: 'scm:sale', icon: 'Undo2' },
            { path: '/scm/docs?doc_type=RS', title: '销售发票', permission: 'scm:sale', icon: 'Receipt' },
            { path: '/scm/sales-order-relations', title: '销售订单关联表', permission: 'scm:sale', icon: 'Network' },
          ],
        },
        {
          key: 'sales-report',
          label: '销售报表',
          items: [
            { path: '/scm/report/sales/summary', title: '销售汇总表', permission: 'scm:report', icon: 'Table2' },
            { path: '/scm/report/sales/detail', title: '销售明细表', permission: 'scm:report', icon: 'ListOrdered' },
            { path: '/scm/report/sales/ranking', title: '销售排行榜', permission: 'scm:report', icon: 'Trophy' },
            { path: '/scm/report/sales/profit', title: '销售毛利分析', permission: 'scm:report', icon: 'Percent' },
            { path: '/scm/report/sales/trend', title: '销售趋势分析', permission: 'scm:report', icon: 'LineChart' },
            { path: '/scm/report/buysell?kind=sales', title: '自定义查询', permission: 'scm:report', icon: 'Search' },
          ],
        },
      ],
    },
    {
      key: 'inventory',
      title: '库存管理',
      icon: 'Warehouse',
      description: '出入库、调拨、盘点与库存查询预警',
      // app 级不挂 module：库存查询/报表/期初入库对生产、委外开放，
      // 只有「其他出入库/调拨/盘点」是进销存专属（在 section 上标注）。
      sections: [
        {
          key: 'inventory-docs',
          label: '库存单据',
          module: 'scm',
          items: [
            { path: '/scm/docs?doc_type=OI', title: '其他入库', permission: 'scm:inventory', icon: 'PackagePlus' },
            { path: '/scm/docs?doc_type=OO', title: '其他出库', permission: 'scm:inventory', icon: 'PackageMinus' },
            { path: '/scm/docs?doc_type=TR', title: '调拨单', permission: 'scm:inventory', icon: 'ArrowLeftRight' },
            { path: '/scm/docs?doc_type=CK', title: '盘点单', permission: 'scm:inventory', icon: 'ClipboardCheck' },
            // 期初入库是建立库存的唯一入口，生产/委外单独授权时也必须可见
            { path: '/scm/docs?doc_type=IS', title: '期初入库', permission: ['scm:inventory', 'scm:opening'], module: SHARED_SCM_MODULES, icon: 'PackageOpen' },
          ],
        },
        {
          key: 'inventory-query',
          label: '库存查询',
          module: SHARED_SCM_MODULES,
          items: [
            { path: '/scm/stock', title: '库存查询', permission: 'scm:stock', icon: 'Boxes' },
            { path: '/scm/batch-stock', title: '批次库存', permission: 'scm:stock', icon: 'Barcode' },
            { path: '/scm/serials', title: '序列号查询', permission: 'scm:stock', icon: 'ScanLine' },
          ],
        },
        {
          key: 'inventory-report',
          label: '库存报表',
          module: SHARED_SCM_MODULES,
          items: [
            { path: '/scm/report', title: '收发存汇总', permission: 'scm:report', icon: 'Table2' },
            { path: '/scm/report/stock-ledger', title: '物料收发明细账', permission: 'scm:report', icon: 'ListOrdered' },
            { path: '/scm/report/stock-alert', title: '库存预警', permission: 'scm:report', icon: 'AlertTriangle' },
            { path: '/scm/report/batch-alert', title: '批次临期预警', permission: 'scm:report', icon: 'Hourglass' },
          ],
        },
      ],
    },
    {
      key: 'arap',
      title: '应收应付',
      icon: 'HandCoins',
      description: '收付款、核销对账与往来查询',
      module: 'scm',
      sections: [
        {
          key: 'arap-payment',
          label: '收付款',
          items: [
            { path: '/scm/docs?doc_type=RCV', title: '收款单', permission: 'scm:arap', icon: 'ArrowDownToLine' },
            { path: '/scm/docs?doc_type=PAY', title: '付款单', permission: 'scm:arap', icon: 'ArrowUpFromLine' },
            { path: '/scm/docs?doc_type=RCV&payment_mode=advance', title: '预收款单', permission: 'scm:arap', icon: 'FileInput' },
            { path: '/scm/docs?doc_type=PAY&payment_mode=advance', title: '预付款单', permission: 'scm:arap', icon: 'FileOutput' },
          ],
        },
        {
          key: 'arap-verify',
          label: '核销对账',
          items: [
            { path: '/scm/arap-verify', title: '往来核销', permission: 'scm:arap', icon: 'BadgeCheck' },
            { path: '/scm/arap-statement', title: '对账单', permission: 'scm:arap', icon: 'ScrollText' },
          ],
        },
        {
          key: 'arap-query',
          label: '往来查询',
          items: [
            { path: '/scm/arap', title: '往来余额表', permission: 'scm:arap', icon: 'Table2' },
            { path: '/scm/arap-detail', title: '往来明细账', permission: 'scm:arap', icon: 'ListOrdered' },
            { path: '/scm/arap-aging', title: '应收应付账龄', permission: 'scm:arap', icon: 'Hourglass' },
            { path: '/scm/arap-due', title: '到期提醒/信用', permission: 'scm:arap', icon: 'Bell' },
          ],
        },
      ],
    },
    {
      key: 'production',
      title: '生产制造',
      icon: 'Factory',
      description: 'MRP、生产计划、工单、报工与生产单据',
      module: 'production',
      sections: [
        {
          key: 'production-plan',
          label: '计划与执行',
          items: [
            { path: '/scm/mrp', title: 'MRP运算', permission: 'scm:production', icon: 'Cpu' },
            { path: '/scm/production-plans?plan_type=self', title: '生产计划', permission: 'scm:production', icon: 'CalendarRange' },
            { path: '/scm/work-reports', title: '生产报工', permission: 'scm:production', icon: 'Hammer' },
            { path: '/scm/kitting', title: '齐套分析', permission: 'scm:production', icon: 'ListChecks' },
          ],
        },
        {
          key: 'production-docs',
          label: '生产单据',
          items: [
            { path: '/scm/docs?doc_type=PL', title: '领料单', permission: 'scm:production', icon: 'PackageMinus' },
            { path: '/scm/docs?doc_type=PF', title: '完工入库', permission: 'scm:production', icon: 'PackageCheck' },
            { path: '/scm/docs?doc_type=PS', title: '不良品入库', permission: 'scm:production', icon: 'PackageX' },
            { path: '/scm/docs?doc_type=PJ', title: '退料单', permission: 'scm:production', icon: 'Undo2' },
            { path: '/scm/docs?doc_type=PB', title: '补料单', permission: 'scm:production', icon: 'PackagePlus' },
            { path: '/scm/docs?doc_type=AS', title: '组装单', permission: 'scm:production', icon: 'Combine' },
            { path: '/scm/docs?doc_type=DS', title: '拆卸单', permission: 'scm:production', icon: 'Split' },
          ],
        },
        {
          key: 'production-engineering',
          label: '工程数据',
          items: [
            { path: '/scm/boms', title: '物料清单(BOM)', permission: 'scm:production', icon: 'FolderTree' },
            { path: '/scm/work-centers', title: '工作中心', permission: 'scm:production', icon: 'Wrench' },
            { path: '/scm/routings', title: '工艺路线', permission: 'scm:production', icon: 'Route' },
          ],
        },
        {
          key: 'production-quality',
          label: '质量·成本·报表',
          items: [
            { path: '/scm/qc-docs', title: '质检管理', permission: 'scm:production', icon: 'FlaskConical' },
            { path: '/scm/cost-variance', title: '标准成本差异', permission: 'scm:production', icon: 'Calculator' },
            { path: '/scm/report/production/execution', title: '生产执行及在制结存表', permission: 'scm:report', module: PRODUCTION_OR_OUTSOURCE_MODULES, icon: 'Table2' },
          ],
        },
      ],
    },
    {
      key: 'outsource',
      title: '委外管理',
      icon: 'Handshake',
      description: '委外计划、发货、入库与执行结存',
      module: 'outsource',
      sections: [
        {
          key: 'outsource-ops',
          label: '委外业务',
          items: [
            { path: '/scm/production-plans?plan_type=outsource', title: '委外计划', permission: 'scm:outsource', icon: 'CalendarRange' },
            { path: '/scm/docs?doc_type=WO', title: '委外发货', permission: 'scm:outsource', icon: 'Truck' },
            { path: '/scm/docs?doc_type=WI', title: '委外入库', permission: 'scm:outsource', icon: 'PackageCheck' },
          ],
        },
        {
          key: 'outsource-report',
          label: '委外报表',
          items: [
            { path: '/scm/report/outsource/execution', title: '委外执行及结存表', permission: 'scm:report', icon: 'Table2' },
          ],
        },
      ],
    },
    {
      key: 'basedata',
      title: '基础资料',
      icon: 'Database',
      description: '财务、出纳、资产与供应链档案',
      sections: [
        {
          key: 'basedata-finance',
          label: '财务档案',
          module: 'gl',
          items: [
            { path: '/base/account', title: '会计科目', permission: 'base:account', icon: 'BookMarked' },
            { path: '/base/account-set-info', title: '套账信息', permission: 'system:init', icon: 'IdCard' },
            { path: '/base/init-balance', title: '期初余额', permission: 'period:init', icon: 'Coins' },
            { path: '/base/voucher-type', title: '凭证类型', permission: 'base:vtype', icon: 'Tags' },
            { path: '/voucher/template', title: '凭证模版', permission: 'base:template', icon: 'LayoutTemplate' },
            { path: '/base/transfer-type', title: '结转维护', permission: 'base:transfer', icon: 'ArrowRightLeft' },
            ...(enableForeignCurrency
              ? [
                  {
                    path: '/base/currency',
                    title: '外币类型',
                    permission: 'base:currency',
                    requiresForeignCurrency: true,
                    icon: 'Coins',
                  } as NavItem,
                ]
              : []),
          ],
        },
        {
          key: 'basedata-cashier',
          label: '出纳档案',
          module: 'cashier',
          items: [
            { path: '/cashier/settle-type', title: '结算方式', permission: 'cashier:dict', icon: 'CreditCard' },
            { path: '/cashier/init-balance', title: '出纳期初', permission: 'cashier:initbal', icon: 'Coins' },
          ],
        },
        {
          key: 'basedata-asset',
          label: '资产档案',
          module: 'asset',
          items: [{ path: '/asset/dict', title: '资产档案字典', permission: 'asset:dict', icon: 'FolderCog' }],
        },
        {
          // 物料/分类/单位/仓库/货位是进销存、生产、委外共用的基础档案，
          // 不能只挂进销存——否则单买「生产管理」的客户连物料都建不了。
          key: 'basedata-scm',
          label: '供应链档案',
          module: SHARED_SCM_MODULES,
          items: [
            { path: '/scm/items', title: '物料档案', permission: 'scm:item', icon: 'Package' },
            { path: '/scm/categories', title: '物料分类', permission: 'scm:category', icon: 'FolderTree' },
            { path: '/scm/item-types', title: '物料类型', permission: 'scm:item', icon: 'Tags' },
            { path: '/scm/units', title: '计量单位', permission: 'scm:item', icon: 'Ruler' },
            { path: '/scm/partners', title: '往来单位', permission: 'scm:partner', module: ['scm', 'outsource'], icon: 'UsersRound' },
            { path: '/scm/warehouses', title: '仓库档案', permission: 'scm:warehouse', icon: 'Warehouse' },
            { path: '/scm/bins', title: '货位档案', permission: 'scm:warehouse', icon: 'Grid3x3' },
          ],
        },
        {
          key: 'basedata-print',
          label: '报表与打印',
          items: [
            { path: '/report/dynamic', title: '报表维护', permission: 'report:define', module: 'gl', icon: 'FileSpreadsheet' },
            { path: '/base/print-template', title: '打印模版', permission: 'system:print', module: 'gl', icon: 'Printer' },
          ],
        },
      ],
    },
    {
      key: 'system',
      title: '系统管理',
      icon: 'Settings',
      description: '账套、用户权限、参数与运维',
      sections: [
        {
          key: 'system-org',
          label: '组织权限',
          items: [
            { path: '/system/account-set', title: '账套管理', permission: 'system:account', icon: 'Building' },
            { path: '/system/user', title: '用户管理', permission: 'system:user', icon: 'Users' },
            { path: '/system/role', title: '角色管理', permission: 'system:role', icon: 'Shield' },
          ],
        },
        {
          key: 'system-settings',
          label: '系统设置',
          items: [
            { path: '/system/param', title: '系统参数', permission: 'system:init', icon: 'SlidersHorizontal' },
            { path: '/system/dashboard-rules', title: '首页取数规则', permission: 'system:init', icon: 'Gauge' },
            { path: '/base/keyboard-shortcuts', title: '快捷键维护', permission: 'system:init', icon: 'Zap' },
          ],
        },
        {
          key: 'system-ops',
          label: '运维',
          items: [
            { path: '/system/log', title: '操作日志', permission: 'period:log', icon: 'History' },
            { path: '/security/backup', title: '备份恢复', permission: ['system:backup', 'system:restore'], icon: 'DatabaseBackup' },
          ],
        },
      ],
    },
  ]
}

/** 过滤应用树（enableCashFlow + 权限 + 注册模块），动态报表并入「财务总账 › 财务报表」 */
export function buildNavApps(
  permissions: string[],
  enableCashFlow: boolean,
  dynamicReportItems: NavItem[],
  licensedModules: readonly string[] = ALL_MODULE_KEYS,
  enableForeignCurrency = false
): NavApp[] {
  return getStaticNavApps(enableCashFlow, enableForeignCurrency)
    .map(app => {
      const sections = app.sections
        .map(section => {
          const inherited = section.module ?? app.module
          const baseItems =
            section.key === DYNAMIC_REPORT_SECTION_KEY
              ? [...section.items, ...dynamicReportItems.map(item => ({ ...item, icon: item.icon ?? 'FileBarChart2' }))]
              : section.items
          return {
            ...section,
            items: filterNavItems(
              baseItems,
              permissions,
              enableCashFlow,
              licensedModules,
              inherited,
              enableForeignCurrency
            ),
          }
        })
        .filter(section => section.items.length > 0)
      return { ...app, sections }
    })
    .filter(app => app.sections.length > 0)
}

/** 应用下全部页面（按分组顺序摊平） */
export function flattenNavApp(app: NavApp): NavItem[] {
  return app.sections.flatMap(section => section.items)
}

/** 全部应用下的页面（按应用、分组顺序摊平） */
export function flattenNavApps(apps: NavApp[]): NavItem[] {
  return apps.flatMap(flattenNavApp)
}

/** 应用 → 兼容 NavGroup（children 为全部页面，subGroups 与 sections 一一对应） */
export function navAppToGroup(app: NavApp): NavGroup {
  return {
    key: app.key,
    title: app.title,
    icon: app.icon,
    module: app.module,
    children: flattenNavApp(app),
    subGroups: app.sections.map(section => ({ label: section.label, items: section.items, module: section.module })),
  }
}

/** 兼容旧调用方：以 NavGroup 形式返回过滤后的应用树 */
export function buildMenuGroups(
  permissions: string[],
  enableCashFlow: boolean,
  dynamicReportItems: NavItem[],
  licensedModules: readonly string[] = ALL_MODULE_KEYS
): NavGroup[] {
  return buildNavApps(permissions, enableCashFlow, dynamicReportItems, licensedModules).map(navAppToGroup)
}

/** 根据路径（可带查询串）定位所属应用与分组；先精确匹配再退回按 path 前缀匹配 */
export function locateNavItem(
  apps: NavApp[],
  fullPath: string
): { app: NavApp; section: NavSection; item: NavItem } | null {
  const target = fullPath.startsWith('/') ? fullPath : `/${fullPath}`
  const targetBase = normalizePath(target)
  const targetQuery = readAllQueryParams(target)

  let fallback: { app: NavApp; section: NavSection; item: NavItem } | null = null
  for (const app of apps) {
    for (const section of app.sections) {
      for (const item of section.items) {
        if (item.path === target) return { app, section, item }
        const itemBase = normalizePath(item.path)
        if (itemBase !== targetBase) continue
        const itemQuery = readAllQueryParams(item.path)
        // 带查询串的菜单项（doc_type / plan_type / kind / payment_mode）要求这些键完全一致
        const keys = new Set([...Object.keys(itemQuery), ...Object.keys(targetQuery)].filter(k => k !== 'view'))
        let matched = true
        for (const key of keys) {
          if ((itemQuery[key] ?? '') !== (targetQuery[key] ?? '')) {
            matched = false
            break
          }
        }
        if (matched) return { app, section, item }
        if (!fallback && Object.keys(itemQuery).length === 0) fallback = { app, section, item }
      }
    }
  }
  if (fallback) return fallback

  // 子路由（如 /scm/docs/:id、/asset/detail/:id）按最长菜单前缀归属
  let best: { app: NavApp; section: NavSection; item: NavItem } | null = null
  let bestLength = 0
  for (const app of apps) {
    for (const section of app.sections) {
      for (const item of section.items) {
        const itemBase = normalizePath(item.path)
        if (targetBase.startsWith(`${itemBase}/`) && itemBase.length > bestLength) {
          best = { app, section, item }
          bestLength = itemBase.length
        }
      }
    }
  }
  return best
}

function readAllQueryParams(fullPath: string): Record<string, string> {
  const queryIndex = fullPath.indexOf('?')
  if (queryIndex < 0) return {}
  const result: Record<string, string> = {}
  new URLSearchParams(fullPath.slice(queryIndex + 1)).forEach((value, key) => {
    result[key] = value
  })
  return result
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

  if (normalized === '/base/print-template' || normalized.startsWith('/base/print-template/')) {
    return ['system:print']
  }

  return undefined
}

/**
 * 判断用户是否有权访问指定路由（权限 + 注册模块）。
 * path 可带查询串（如 /scm/docs?doc_type=PL），用于细分生产/委外模块。
 */
export function canAccessRoute(
  path: string,
  permissions: string[],
  licensedModules: readonly string[] = ALL_MODULE_KEYS
): boolean {
  const normalized = normalizePath(path)

  if ((ROUTE_PERMISSION_WHITELIST as readonly string[]).includes(normalized)) {
    return true
  }

  if (!canAccessModules(path, licensedModules)) {
    return false
  }

  const required = getRoutePermissions(normalized)
  if (!required || required.length === 0) {
    return true
  }

  return matchPermissions(permissions, required)
}

/**
 * 校验「默认主页」偏好在当前权限下是否可用。
 * /group/{模块名} 形式的模块主页需在可见导航树里有同名应用且分组非空（与 GroupNav 空态判定一致）；
 * 其余按普通路由的权限 + 注册模块校验。
 */
export function isValidHomePath(
  path: string,
  permissions: string[],
  enableCashFlow = false,
  licensedModules: readonly string[] = ALL_MODULE_KEYS,
  enableForeignCurrency = false
): boolean {
  if (!path) return false

  if (path.startsWith('/group/')) {
    let title = path.slice('/group/'.length).split('?')[0]
    try {
      title = decodeURIComponent(title)
    } catch {
      /* 非法编码时按原文匹配 */
    }
    title = resolveNavAppTitle(title)
    const app = buildNavApps(permissions, enableCashFlow, [], licensedModules, enableForeignCurrency).find(
      a => a.title === title
    )
    return !!app && app.sections.length > 0
  }

  return canAccessRoute(path, permissions, licensedModules)
}

/** 登录后默认落地页：用户自定义主页 → /dashboard → 第一个可访问菜单 */
export function getDefaultLandingPath(
  permissions: string[],
  enableCashFlow = false,
  licensedModules: readonly string[] = ALL_MODULE_KEYS,
  preferredPath?: string
): string {
  if (preferredPath && isValidHomePath(preferredPath, permissions, enableCashFlow, licensedModules)) {
    return preferredPath
  }
  if (canAccessRoute('/dashboard', permissions, licensedModules)) {
    return '/dashboard'
  }
  const first = flattenNavApps(buildNavApps(permissions, enableCashFlow, [], licensedModules))[0]
  return first?.path.split('?')[0] || '/forbidden'
}

/** 无路由权限时落到可访问首页，避免停留在无权限页并触发 403 提示 */
export function resolveAccessiblePath(
  targetPath: string,
  permissions: string[],
  enableCashFlow = false,
  licensedModules: readonly string[] = ALL_MODULE_KEYS
): string {
  if (canAccessRoute(targetPath, permissions, licensedModules)) {
    return normalizePath(targetPath)
  }
  return getDefaultLandingPath(permissions, enableCashFlow, licensedModules)
}

/** 后端 requirePermission 返回的 403 文案（与 accountScope 等业务 403 区分） */
export const API_ROUTE_PERMISSION_DENIED_MESSAGE = '无此操作权限'

export function isApiRoutePermissionDenied(message?: string): boolean {
  return message === API_ROUTE_PERMISSION_DENIED_MESSAGE
}
