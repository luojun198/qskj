/**
 * 注册码模块授权目录（服务端为准，client/src/config/licenseModules.ts 为镜像，需同步修改）
 *
 * 注册码 v2 payload 的 `mods` 字段携带模块 key 列表；`'*'` 或 v1（无 mods）表示全部模块。
 * 系统管理 / 数据安全 / 登录 / 账套等基础功能不属于任何模块，始终可用。
 */

export const LICENSE_MODULES = [
  { key: 'gl', name: '总账' },
  { key: 'cashier', name: '出纳管理' },
  { key: 'asset', name: '固定资产' },
  { key: 'scm', name: '进销存' },
  { key: 'production', name: '生产管理' },
  { key: 'outsource', name: '委外管理' },
] as const

export type LicenseModuleKey = (typeof LICENSE_MODULES)[number]['key']

export const ALL_MODULE_KEYS: LicenseModuleKey[] = LICENSE_MODULES.map(m => m.key)

const MODULE_KEY_SET = new Set<string>(ALL_MODULE_KEYS)

export function isLicenseModuleKey(value: string): value is LicenseModuleKey {
  return MODULE_KEY_SET.has(value)
}

export function getLicenseModuleName(key: string): string {
  return LICENSE_MODULES.find(m => m.key === key)?.name || key
}

/**
 * 供应链的「共享基础层」：物料 / 分类 / 单位 / 仓库 / 货位 / 库存 / 供应链参数 / 期初入库 等，
 * 进销存、生产管理、委外管理三个模块都靠它才能开工，任一授权即可使用。
 * 只买「生产管理」的客户如果连物料和仓库都建不了，生产模块一步也走不动。
 */
export const SHARED_SCM_MODULES: LicenseModuleKey[] = ['scm', 'production', 'outsource']

/** 生产 / 委外共享（不含进销存） */
export const PRODUCTION_OR_OUTSOURCE_MODULES: LicenseModuleKey[] = ['production', 'outsource']

/** 供应链单据类型 → 模块（数组表示任一授权即可） */
export const DOC_TYPE_MODULE: Record<string, LicenseModuleKey | LicenseModuleKey[]> = {
  // 销售
  SQ: 'scm',
  SOa: 'scm',
  SO: 'scm',
  SR: 'scm',
  RS: 'scm',
  // 采购
  MR: 'scm',
  PQ: 'scm',
  PO: 'scm',
  PI: 'scm',
  PR: 'scm',
  RP: 'scm',
  // 往来收付
  RCV: 'scm',
  PAY: 'scm',
  // 库存：期初入库是建立库存的唯一入口，生产/委外也必须能用
  IS: SHARED_SCM_MODULES,
  OI: 'scm',
  OO: 'scm',
  TR: 'scm',
  CK: 'scm',
  // 生产
  PL: 'production',
  PB: 'production',
  PF: 'production',
  PS: 'production',
  PJ: 'production',
  AS: 'production',
  DS: 'production',
  // 委外
  WO: 'outsource',
  WI: 'outsource',
}

/** 单据类型 → 所需模块（任一即可）；未知单据类型返回空数组 = 不额外限制 */
export function docTypeToModules(docType: string | undefined | null): LicenseModuleKey[] {
  if (!docType) return []
  const hit = DOC_TYPE_MODULE[docType]
  if (!hit) return []
  return Array.isArray(hit) ? [...hit] : [hit]
}

/** 生产计划 plan_type → 模块；未指定时生产/委外任一授权即可 */
export function planTypeToModules(planType: string | undefined | null): LicenseModuleKey[] {
  if (planType === 'outsource') return ['outsource']
  if (planType === 'self') return ['production']
  return [...PRODUCTION_OR_OUTSOURCE_MODULES]
}

/**
 * 供应链权限码的模块归属。
 * 共享基础层（物料/分类/仓库/库存/期初/参数/列方案/报表）与通用单据动作（审核/删除）
 * 三模块共用；往来单位委外也要用；其余为进销存专属。
 */
const SCM_PERMISSION_MODULES: Record<string, LicenseModuleKey[]> = {
  'scm:item': SHARED_SCM_MODULES,
  'scm:category': SHARED_SCM_MODULES,
  'scm:warehouse': SHARED_SCM_MODULES,
  'scm:stock': SHARED_SCM_MODULES,
  'scm:opening': SHARED_SCM_MODULES,
  'scm:param': SHARED_SCM_MODULES,
  'scm:colscheme': SHARED_SCM_MODULES,
  'scm:report': SHARED_SCM_MODULES,
  'scm:audit': SHARED_SCM_MODULES,
  'scm:delete': SHARED_SCM_MODULES,
  'scm:partner': ['scm', 'outsource'],
  'scm:production': ['production'],
  'scm:outsource': ['outsource'],
}

/**
 * 权限码 → 所需模块（任一即可）；返回空数组表示不受模块授权限制（系统管理等基础功能）。
 * 命名规范 module:action，见 server/src/db/permissions.ts。
 */
export function permissionToModules(code: string): LicenseModuleKey[] {
  if (code === '*') return []
  const [prefix] = code.split(':')
  switch (prefix) {
    case 'voucher':
    case 'ledger':
    case 'report':
    case 'base':
    case 'period':
      return ['gl']
    case 'cashier':
      return ['cashier']
    case 'asset':
      return ['asset']
    case 'scm':
      return SCM_PERMISSION_MODULES[code] ?? ['scm']
    default:
      return []
  }
}

/**
 * 展开注册码里的模块列表：`undefined`（v1）或包含 `'*'` 表示全部；
 * 未知 key 忽略（向前兼容以后新增的模块），结果去重且按目录顺序排列。
 */
export function expandLicenseModules(mods?: readonly string[] | null): LicenseModuleKey[] {
  if (!mods) return [...ALL_MODULE_KEYS]
  if (mods.includes('*')) return [...ALL_MODULE_KEYS]
  const wanted = new Set(mods.filter(isLicenseModuleKey))
  return ALL_MODULE_KEYS.filter(key => wanted.has(key))
}

/** 任一所需模块已授权即可 */
export function hasLicensedModule(
  licensed: readonly string[],
  required: LicenseModuleKey | readonly LicenseModuleKey[]
): boolean {
  const list = Array.isArray(required) ? required : [required as LicenseModuleKey]
  if (list.length === 0) return true
  return list.some(key => licensed.includes(key))
}
