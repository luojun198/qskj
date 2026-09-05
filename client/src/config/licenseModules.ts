/**
 * 注册码模块授权目录（镜像自 server/src/services/licenseModules.ts，两处需同步修改）
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

/** 供应链「共享基础层」：物料 / 仓库 / 库存 / 参数 / 期初入库等，三个模块任一授权即可 */
export const SHARED_SCM_MODULES: LicenseModuleKey[] = ['scm', 'production', 'outsource']

/** 生产 / 委外共享（不含进销存） */
export const PRODUCTION_OR_OUTSOURCE_MODULES: LicenseModuleKey[] = ['production', 'outsource']

/** 供应链单据类型 → 模块（数组表示任一授权即可） */
export const DOC_TYPE_MODULE: Record<string, LicenseModuleKey | LicenseModuleKey[]> = {
  SQ: 'scm',
  SOa: 'scm',
  SO: 'scm',
  SR: 'scm',
  RS: 'scm',
  MR: 'scm',
  PQ: 'scm',
  PO: 'scm',
  PI: 'scm',
  PR: 'scm',
  RP: 'scm',
  RCV: 'scm',
  PAY: 'scm',
  IS: SHARED_SCM_MODULES,
  OI: 'scm',
  OO: 'scm',
  TR: 'scm',
  CK: 'scm',
  PL: 'production',
  PB: 'production',
  PF: 'production',
  PS: 'production',
  PJ: 'production',
  AS: 'production',
  DS: 'production',
  WO: 'outsource',
  WI: 'outsource',
}

/** 单据类型 → 所需模块（任一即可）；未知单据类型返回空数组 */
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

/** 供应链权限码的模块归属（共享基础层与通用单据动作三模块共用） */
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

/** 权限码 → 所需模块（任一即可）；空数组表示不受模块授权限制 */
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
