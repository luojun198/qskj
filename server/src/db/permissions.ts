/**
 * CW 财务系统权限代码定义
 * 参考润衡 ACD 功能代码体系，按模块组织
 *
 * 命名规范: module:action
 * 对应 ACD 功能代码映射见注释
 */

export interface PermissionDef {
  code: string
  name: string
  module: string
  moduleName: string
  acdCode?: string  // 对应的 ACD 功能代码
  description?: string
}

export const PERMISSION_MODULES = [
  { key: 'voucher',  name: '凭证管理' },
  { key: 'ledger',   name: '账簿查询' },
  { key: 'report',   name: '报表管理' },
  { key: 'base',     name: '基础设置' },
  { key: 'period',   name: '期间管理' },
  { key: 'system',   name: '系统管理' },
  { key: 'cashier',  name: '出纳管理' },
  { key: 'asset',    name: '固定资产' },
  { key: 'scm',      name: '供应链' },
] as const

export const PERMISSIONS: PermissionDef[] = [
  // ── 凭证管理 ──────────────────────────────────────────
  { code: 'voucher:entry',    name: '凭证录入',     module: 'voucher', moduleName: '凭证管理', acdCode: '401' },
  { code: 'voucher:query',    name: '凭证查询',     module: 'voucher', moduleName: '凭证管理', acdCode: '402' },
  { code: 'voucher:audit',    name: '凭证审核',     module: 'voucher', moduleName: '凭证管理', acdCode: '403' },
  { code: 'voucher:post',     name: '凭证记账',     module: 'voucher', moduleName: '凭证管理', acdCode: '404' },
  { code: 'voucher:unpost',   name: '凭证反记账',   module: 'voucher', moduleName: '凭证管理', acdCode: '472' },
  { code: 'voucher:print',    name: '凭证打印',     module: 'voucher', moduleName: '凭证管理', acdCode: 'A02' },
  { code: 'voucher:export',   name: '凭证导出',     module: 'voucher', moduleName: '凭证管理', acdCode: 'A04' },

  // ── 账簿查询 ──────────────────────────────────────────
  { code: 'ledger:general',   name: '总分类账',     module: 'ledger',  moduleName: '账簿查询', acdCode: '421' },
  { code: 'ledger:detail',    name: '明细账',       module: 'ledger',  moduleName: '账簿查询', acdCode: '424' },
  { code: 'ledger:balance',   name: '科目余额表',   module: 'ledger',  moduleName: '账簿查询', acdCode: '413' },
  { code: 'ledger:multirow',  name: '多栏账',       module: 'ledger',  moduleName: '账簿查询', acdCode: '425' },
  { code: 'ledger:cash',      name: '现金日记账',   module: 'ledger',  moduleName: '账簿查询', acdCode: '422' },
  { code: 'ledger:bank',      name: '银行日记账',   module: 'ledger',  moduleName: '账簿查询', acdCode: '423' },
  { code: 'ledger:aux',       name: '辅助明细账',   module: 'ledger',  moduleName: '账簿查询', acdCode: '426' },
  { code: 'ledger:qty',       name: '数量余额表',   module: 'ledger',  moduleName: '账簿查询', acdCode: '415' },
  { code: 'ledger:foreign',   name: '外币余额表',   module: 'ledger',  moduleName: '账簿查询', acdCode: '414' },
  { code: 'ledger:cashflow',  name: '现金流量表',   module: 'ledger',  moduleName: '账簿查询', acdCode: '419' },

  // ── 报表管理 ──────────────────────────────────────────
  { code: 'report:view',      name: '报表查看',     module: 'report',  moduleName: '报表管理', acdCode: '430' },
  { code: 'report:define',    name: '报表定义',     module: 'report',  moduleName: '报表管理', acdCode: '431' },
  { code: 'report:export',    name: '报表导出',     module: 'report',  moduleName: '报表管理', acdCode: 'A04' },
  { code: 'report:print',     name: '报表打印',     module: 'report',  moduleName: '报表管理', acdCode: 'A02' },
  { code: 'report:analysis',  name: '财务分析',     module: 'report',  moduleName: '报表管理', acdCode: '435' },

  // ── 基础设置 ──────────────────────────────────────────
  { code: 'base:account',     name: '科目维护',     module: 'base',    moduleName: '基础设置', acdCode: '440' },
  { code: 'base:vtype',       name: '凭证类型维护', module: 'base',    moduleName: '基础设置', acdCode: '442' },
  { code: 'base:summary',     name: '摘要维护',     module: 'base',    moduleName: '基础设置', acdCode: '441' },
  { code: 'base:currency',    name: '外币类型维护', module: 'base',    moduleName: '基础设置', acdCode: '444' },
  { code: 'base:settle',      name: '结算类型维护', module: 'base',    moduleName: '基础设置', acdCode: '443' },
  { code: 'base:transfer',    name: '结转类型维护', module: 'base',    moduleName: '基础设置', acdCode: '445' },
  { code: 'base:template',    name: '凭证模板维护', module: 'base',    moduleName: '基础设置', acdCode: '446' },
  { code: 'base:project',     name: '项目信息维护', module: 'base',    moduleName: '基础设置', acdCode: '460' },
  { code: 'base:dept',        name: '部门信息维护', module: 'base',    moduleName: '基础设置', acdCode: '462' },
  { code: 'base:customer',    name: '客户信息维护', module: 'base',    moduleName: '基础设置', acdCode: '461' },
  { code: 'base:person',      name: '人员信息维护', module: 'base',    moduleName: '基础设置', acdCode: '463' },
  { code: 'base:cashitem',    name: '现金项目维护', module: 'base',    moduleName: '基础设置', acdCode: '464' },
  { code: 'base:aux',         name: '辅助核算维护', module: 'base',    moduleName: '基础设置' },

  // ── 期间管理 ──────────────────────────────────────────
  { code: 'period:init',      name: '期初录入',     module: 'period',  moduleName: '期间管理', acdCode: '450' },
  { code: 'period:carry',     name: '月度结转',     module: 'period',  moduleName: '期间管理', acdCode: '411' },
  { code: 'period:close',     name: '结账',         module: 'period',  moduleName: '期间管理', acdCode: '412' },
  { code: 'period:unclose',   name: '反结账',       module: 'period',  moduleName: '期间管理', acdCode: '473' },
  { code: 'period:open',      name: '开工准备',     module: 'period',  moduleName: '期间管理', acdCode: '470' },
  { code: 'period:log',       name: '操作日志',     module: 'period',  moduleName: '期间管理', acdCode: '474' },

  // ── 系统管理 ──────────────────────────────────────────
  { code: 'system:user',      name: '操作员管理',   module: 'system',  moduleName: '系统管理', acdCode: '101' },
  { code: 'system:role',      name: '角色权限管理', module: 'system',  moduleName: '系统管理' },
  { code: 'system:init',      name: '系统初始化',   module: 'system',  moduleName: '系统管理', acdCode: '801' },
  { code: 'system:account',   name: '套账管理',     module: 'system',  moduleName: '系统管理', acdCode: '802' },
  { code: 'system:check',     name: '综合检查',     module: 'system',  moduleName: '系统管理', acdCode: '803' },
  { code: 'system:backup',    name: '数据备份',     module: 'system',  moduleName: '系统管理', acdCode: '804' },
  { code: 'system:restore',   name: '数据恢复',     module: 'system',  moduleName: '系统管理', acdCode: '805' },
  { code: 'system:print',     name: '打印',         module: 'system',  moduleName: '系统管理', acdCode: 'A02' },
  { code: 'system:export',    name: '导出',         module: 'system',  moduleName: '系统管理', acdCode: 'A04' },
  { code: 'system:save',      name: '另存',         module: 'system',  moduleName: '系统管理', acdCode: 'A03' },
  { code: 'system:dashboard', name: '主页查看',     module: 'system',  moduleName: '系统管理' },

  // ── 出纳管理 ──────────────────────────────────────────
  { code: 'cashier:journal',  name: '出纳日记账',   module: 'cashier', moduleName: '出纳管理', acdCode: '422' },
  { code: 'cashier:initbal',  name: '出纳期初',     module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:reconcile',name: '银行对账',     module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:voucher',  name: '出纳生成/删除凭证', module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:import',   name: '银行对账单导入', module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:report',   name: '出纳日报/报表', module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:param',    name: '出纳参数设置', module: 'cashier', moduleName: '出纳管理' },

  // ── 固定资产 ──────────────────────────────────────────
  { code: 'asset:view',       name: '固定资产查看', module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:edit',       name: '固定资产编辑', module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:dict',       name: '资产档案字典', module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:depr',       name: '资产折旧计提', module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:dispose',    name: '资产处置',     module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:inventory',  name: '资产盘点',     module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:report',     name: '资产报表',     module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:param',      name: '资产参数设置', module: 'asset',   moduleName: '固定资产' },

  // ── 供应链 ──────────────────────────────────────────
  { code: 'scm:item',         name: '物料档案',     module: 'scm',     moduleName: '供应链' },
  { code: 'scm:partner',      name: '往来单位档案', module: 'scm',     moduleName: '供应链' },
  { code: 'scm:warehouse',    name: '仓库档案',     module: 'scm',     moduleName: '供应链' },
  { code: 'scm:category',     name: '物料分类',     module: 'scm',     moduleName: '供应链' },
  { code: 'scm:stock',        name: '库存查询',     module: 'scm',     moduleName: '供应链' },
  { code: 'scm:opening',      name: '期初库存',     module: 'scm',     moduleName: '供应链' },
  { code: 'scm:import',       name: '供应链ACD导入',module: 'scm',     moduleName: '供应链' },
  { code: 'scm:param',        name: '供应链参数',   module: 'scm',     moduleName: '供应链' },
  // 业务域单据权限（细化自原 scm:stock 一刀切）
  { code: 'scm:purchase',     name: '采购业务单据', module: 'scm',     moduleName: '供应链' },
  { code: 'scm:sale',         name: '销售业务单据', module: 'scm',     moduleName: '供应链' },
  { code: 'scm:inventory',    name: '库存业务单据', module: 'scm',     moduleName: '供应链' },
  { code: 'scm:production',   name: '生产业务单据', module: 'scm',     moduleName: '供应链' },
  { code: 'scm:outsource',    name: '委外业务单据', module: 'scm',     moduleName: '供应链' },
  { code: 'scm:arap',         name: '往来收付/对账', module: 'scm',     moduleName: '供应链' },
  { code: 'scm:report',       name: '供应链报表',   module: 'scm',     moduleName: '供应链' },
  // 跨单据操作权限
  { code: 'scm:audit',        name: '单据审核/反审核', module: 'scm',  moduleName: '供应链' },
  { code: 'scm:delete',       name: '单据删除',     module: 'scm',     moduleName: '供应链' },
  { code: 'scm:colscheme',    name: '列方案设置',   module: 'scm',     moduleName: '供应链' },
]

/** 按模块分组 */
export function getPermissionsByModule(): Record<string, PermissionDef[]> {
  const result: Record<string, PermissionDef[]> = {}
  for (const p of PERMISSIONS) {
    if (!result[p.module]) result[p.module] = []
    result[p.module].push(p)
  }
  return result
}

/** ACD 功能代码 → CW 权限代码映射（一对多） */
export const ACD_TO_CW: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {}
  for (const p of PERMISSIONS) {
    if (p.acdCode) {
      if (!map[p.acdCode]) map[p.acdCode] = []
      map[p.acdCode].push(p.code)
    }
  }
  return map
})()

/** 预设角色权限配置 */
export const PRESET_ROLES = [
  {
    code: 'admin',
    name: '系统管理员',
    description: '系统全部权限',
    is_system: 1,
    permissions: ['*'],
  },
  {
    code: 'accountant',
    name: '财务会计',
    description: '凭证录入、账簿查看、报表查看',
    is_system: 1,
    permissions: [
      'system:dashboard',
      'voucher:entry', 'voucher:query', 'voucher:print', 'voucher:export',
      'ledger:general', 'ledger:detail', 'ledger:balance', 'ledger:multirow',
      'ledger:cash', 'ledger:bank', 'ledger:cashflow',
      'report:view', 'report:print', 'report:export',
      'base:account', 'base:summary', 'base:template',
      'period:init',
      'cashier:journal', 'cashier:initbal', 'cashier:reconcile',
      'cashier:voucher', 'cashier:import', 'cashier:report', 'cashier:param',
      'asset:view', 'asset:edit', 'asset:dict', 'asset:depr',
      'asset:dispose', 'asset:inventory', 'asset:report', 'asset:param',
    ],
  },
  {
    code: 'auditor',
    name: '审核人员',
    description: '凭证审核、账簿查看',
    is_system: 1,
    permissions: [
      'system:dashboard',
      'voucher:audit', 'voucher:query', 'voucher:print',
      'ledger:general', 'ledger:detail', 'ledger:balance',
      'report:view',
    ],
  },
  {
    code: 'poster',
    name: '记账人员',
    description: '凭证记账、反记账、结账',
    is_system: 1,
    permissions: [
      'system:dashboard',
      'voucher:post', 'voucher:unpost', 'voucher:query',
      'ledger:general', 'ledger:detail', 'ledger:balance',
      'period:carry', 'period:close', 'period:unclose', 'period:open',
      'report:view',
    ],
  },
  {
    code: 'reporter',
    name: '报表管理员',
    description: '报表编制与导出',
    is_system: 1,
    permissions: [
      'system:dashboard',
      'report:view', 'report:define', 'report:export', 'report:print', 'report:analysis',
      'ledger:general', 'ledger:detail', 'ledger:balance',
    ],
  },
  {
    code: 'readonly',
    name: '只读用户',
    description: '仅查看账簿和报表',
    is_system: 1,
    permissions: [
      'system:dashboard',
      'voucher:query',
      'ledger:general', 'ledger:detail', 'ledger:balance',
      'report:view',
    ],
  },
]
