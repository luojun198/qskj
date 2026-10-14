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
  { code: 'voucher:entry',    name: '凭证录入',     module: 'voucher', moduleName: '凭证管理' },
  { code: 'voucher:query',    name: '凭证查询',     module: 'voucher', moduleName: '凭证管理' },
  { code: 'voucher:audit',    name: '凭证审核',     module: 'voucher', moduleName: '凭证管理' },
  { code: 'voucher:post',     name: '凭证记账',     module: 'voucher', moduleName: '凭证管理' },
  { code: 'voucher:unpost',   name: '凭证反记账',   module: 'voucher', moduleName: '凭证管理' },
  { code: 'voucher:print',    name: '凭证打印',     module: 'voucher', moduleName: '凭证管理' },
  { code: 'voucher:export',   name: '凭证导出',     module: 'voucher', moduleName: '凭证管理' },

  // ── 账簿查询 ──────────────────────────────────────────
  { code: 'ledger:general',   name: '总分类账',     module: 'ledger',  moduleName: '账簿查询' },
  { code: 'ledger:detail',    name: '明细账',       module: 'ledger',  moduleName: '账簿查询' },
  { code: 'ledger:balance',   name: '科目余额表',   module: 'ledger',  moduleName: '账簿查询' },
  { code: 'ledger:multirow',  name: '多栏账',       module: 'ledger',  moduleName: '账簿查询' },
  { code: 'ledger:cash',      name: '现金日记账',   module: 'ledger',  moduleName: '账簿查询' },
  { code: 'ledger:bank',      name: '银行日记账',   module: 'ledger',  moduleName: '账簿查询' },
  { code: 'ledger:aux',       name: '辅助明细账',   module: 'ledger',  moduleName: '账簿查询' },
  { code: 'ledger:qty',       name: '数量余额表',   module: 'ledger',  moduleName: '账簿查询' },
  { code: 'ledger:foreign',   name: '外币余额表',   module: 'ledger',  moduleName: '账簿查询' },
  { code: 'ledger:vsummary',  name: '凭证汇总表',   module: 'ledger',  moduleName: '账簿查询' },
  { code: 'ledger:cashflow',  name: '现金流量表',   module: 'ledger',  moduleName: '账簿查询' },

  // ── 报表管理 ──────────────────────────────────────────
  { code: 'report:view',      name: '报表查看',     module: 'report',  moduleName: '报表管理' },
  { code: 'report:define',    name: '报表定义',     module: 'report',  moduleName: '报表管理' },
  { code: 'report:export',    name: '报表导出',     module: 'report',  moduleName: '报表管理' },
  { code: 'report:print',     name: '报表打印',     module: 'report',  moduleName: '报表管理' },
  { code: 'report:analysis',  name: '财务分析',     module: 'report',  moduleName: '报表管理' },

  // ── 基础设置 ──────────────────────────────────────────
  { code: 'base:account',     name: '科目维护',     module: 'base',    moduleName: '基础设置' },
  { code: 'base:vtype',       name: '凭证类型维护', module: 'base',    moduleName: '基础设置' },
  { code: 'base:summary',     name: '摘要维护',     module: 'base',    moduleName: '基础设置' },
  { code: 'base:currency',    name: '外币类型维护', module: 'base',    moduleName: '基础设置' },
  { code: 'base:settle',      name: '结算类型维护', module: 'base',    moduleName: '基础设置' },
  { code: 'base:transfer',    name: '结转类型维护', module: 'base',    moduleName: '基础设置' },
  { code: 'base:template',    name: '凭证模板维护', module: 'base',    moduleName: '基础设置' },
  { code: 'base:project',     name: '项目信息维护', module: 'base',    moduleName: '基础设置' },
  { code: 'base:dept',        name: '部门信息维护', module: 'base',    moduleName: '基础设置' },
  { code: 'base:customer',    name: '客户信息维护', module: 'base',    moduleName: '基础设置' },
  { code: 'base:person',      name: '人员信息维护', module: 'base',    moduleName: '基础设置' },
  { code: 'base:cashitem',    name: '现金项目维护', module: 'base',    moduleName: '基础设置' },
  { code: 'base:aux',         name: '辅助核算维护', module: 'base',    moduleName: '基础设置' },

  // ── 期间管理 ──────────────────────────────────────────
  { code: 'period:init',      name: '期初录入',     module: 'period',  moduleName: '期间管理' },
  { code: 'period:carry',     name: '月度结转',     module: 'period',  moduleName: '期间管理' },
  { code: 'period:close',     name: '结账',         module: 'period',  moduleName: '期间管理' },
  { code: 'period:unclose',   name: '反结账',       module: 'period',  moduleName: '期间管理' },
  { code: 'period:open',      name: '开工准备',     module: 'period',  moduleName: '期间管理' },
  { code: 'period:log',       name: '操作日志',     module: 'period',  moduleName: '期间管理' },

  // ── 系统管理 ──────────────────────────────────────────
  { code: 'system:user',      name: '操作员管理',   module: 'system',  moduleName: '系统管理' },
  { code: 'system:role',      name: '角色权限管理', module: 'system',  moduleName: '系统管理' },
  { code: 'system:init',      name: '系统初始化',   module: 'system',  moduleName: '系统管理' },
  { code: 'system:account',   name: '套账管理',     module: 'system',  moduleName: '系统管理' },
  { code: 'system:check',     name: '综合检查',     module: 'system',  moduleName: '系统管理' },
  { code: 'system:backup',    name: '数据备份',     module: 'system',  moduleName: '系统管理' },
  { code: 'system:restore',   name: '数据恢复',     module: 'system',  moduleName: '系统管理' },
  { code: 'system:print',     name: '打印',         module: 'system',  moduleName: '系统管理' },
  { code: 'system:export',    name: '导出',         module: 'system',  moduleName: '系统管理' },
  { code: 'system:save',      name: '另存',         module: 'system',  moduleName: '系统管理' },
  { code: 'system:dashboard', name: '主页查看',     module: 'system',  moduleName: '系统管理' },

  // ── 出纳管理 ──────────────────────────────────────────
  { code: 'cashier:journal',  name: '出纳日记账',   module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:initbal',  name: '出纳期初',     module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:reconcile',name: '银行对账',     module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:voucher',  name: '出纳生成/删除凭证', module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:import',   name: '银行对账单导入', module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:report',   name: '出纳日报/报表', module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:param',    name: '出纳参数设置', module: 'cashier', moduleName: '出纳管理' },
  { code: 'cashier:dict',     name: '结算方式维护', module: 'cashier', moduleName: '出纳管理' },

  // ── 固定资产 ──────────────────────────────────────────
  { code: 'asset:view',       name: '固定资产查看', module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:edit',       name: '固定资产编辑', module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:dict',       name: '资产档案字典', module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:depr',       name: '资产折旧计提', module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:dispose',    name: '资产处置',     module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:inventory',  name: '资产盘点',     module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:report',     name: '资产报表',     module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:param',      name: '资产参数设置', module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:change',     name: '资产变动',     module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:impair',     name: '资产减值改良', module: 'asset',   moduleName: '固定资产' },
  { code: 'asset:requisition',name: '资产领用归还', module: 'asset',   moduleName: '固定资产' },

  // ── 供应链 ──────────────────────────────────────────
  { code: 'scm:item',         name: '物料档案',     module: 'scm',     moduleName: '供应链' },
  { code: 'scm:partner',      name: '往来单位档案', module: 'scm',     moduleName: '供应链' },
  { code: 'scm:master-audit', name: '档案审核（物料 / 往来单位）', module: 'scm', moduleName: '供应链' },
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
  { code: 'scm:outsource-price', name: '委外加工单价修改', module: 'scm', moduleName: '供应链' },
  { code: 'scm:arap',         name: '往来收付/对账', module: 'scm',     moduleName: '供应链' },
  { code: 'scm:verify-delete', name: '核销单删除（取消核销）', module: 'scm', moduleName: '供应链' },
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

// ===================== ACD 权限对照 =====================

/** 本系统确实没有对应模块的 ACD 功能分组 */
export type AcdUnsupportedGroup = '工资' | '发票'

export interface AcdPermissionEntry {
  /** 润衡 b_rights.txt 里的功能代码 */
  acdCode: string
  /** 润衡里的功能名称，仅用于提示与人工核对 */
  acdName: string
  /** 对应的 CW 权限码；空数组表示本系统暂无对应功能 */
  cw: string[]
  /** cw 为空时的归类，导入时按分组汇总提示，不逐条刷屏 */
  unsupported?: AcdUnsupportedGroup
  /** 模块根节点这类非功能项：不映射也不提示 */
  silent?: boolean
}

/**
 * ACD 功能代码 → CW 权限的完整对照表。
 *
 * 这里是**唯一真相**：以前 ACD_TO_CW 是从 PERMISSIONS[].acdCode 顺带推导出来的，
 * 后加的出纳 / 固定资产 / 供应链三个模块（共 34 个权限）一个 acdCode 都没填，
 * 于是这三块在导入时整体静默落空——数据导进来了，权限却一条都没有。
 * 改成显式表格后，漏映射会在 acdPermissionMapping 测试里直接暴露。
 *
 * 基准样本：109 个功能代码（取自真实账套备份的 b_rights.txt）。
 */
export const ACD_PERMISSION_CATALOG: AcdPermissionEntry[] = [
  // ── 凭证 ──────────────────────────────────────────────
  { acdCode: '401', acdName: '凭证输入',   cw: ['voucher:entry'] },
  { acdCode: '402', acdName: '浏览查询',   cw: ['voucher:query'] },
  { acdCode: '403', acdName: '凭证审核',   cw: ['voucher:audit'] },
  { acdCode: '404', acdName: '凭证过帐',   cw: ['voucher:post'] },
  { acdCode: '472', acdName: '帐务反过帐', cw: ['voucher:unpost'] },

  // ── 账簿 ──────────────────────────────────────────────
  { acdCode: '413', acdName: '汇总余额表',         cw: ['ledger:balance'] },
  { acdCode: '414', acdName: '外币余额表',         cw: ['ledger:foreign'] },
  { acdCode: '415', acdName: '数量余额表',         cw: ['ledger:qty'] },
  // CW 只有「辅助项目余额表 / 辅助项目明细账」两个页面、共用 ledger:aux，
  // 不按外币 / 数量 / 多栏细分，因此 416~418、426、427 同归一处。
  { acdCode: '416', acdName: '辅助余额表',         cw: ['ledger:aux'] },
  { acdCode: '417', acdName: '辅助外币余额表',     cw: ['ledger:aux'] },
  { acdCode: '418', acdName: '辅助数量余额表',     cw: ['ledger:aux'] },
  { acdCode: '419', acdName: '现金流量试算平衡表', cw: ['ledger:cashflow'] },
  { acdCode: '421', acdName: '总分类帐',           cw: ['ledger:general'] },
  { acdCode: '422', acdName: '现金日记帐',         cw: ['ledger:cash', 'cashier:journal'] },
  { acdCode: '423', acdName: '银行日记帐',         cw: ['ledger:bank'] },
  { acdCode: '424', acdName: '明细帐',             cw: ['ledger:detail'] },
  { acdCode: '425', acdName: '多栏帐',             cw: ['ledger:multirow'] },
  { acdCode: '426', acdName: '辅助明细帐',         cw: ['ledger:aux'] },
  { acdCode: '427', acdName: '辅助多栏明细帐',     cw: ['ledger:aux'] },

  // ── 报表 ──────────────────────────────────────────────
  { acdCode: '430', acdName: '报表管理', cw: ['report:view'] },
  { acdCode: '431', acdName: '报表定义', cw: ['report:define'] },
  { acdCode: '435', acdName: '财务分析', cw: ['report:analysis'] },

  // ── 往来 / 合同：CW 归在供应链的往来收付里 ────────────
  { acdCode: '43A', acdName: '期初往来单据', cw: ['scm:arap'] },
  { acdCode: '43B', acdName: '单据核销',     cw: ['scm:arap', 'scm:verify-delete'] },
  { acdCode: '43C', acdName: '往来信息查询', cw: ['scm:arap'] },
  { acdCode: '43M', acdName: '合同档案管理', cw: ['scm:arap'] },
  { acdCode: '43N', acdName: '合同帐款查询', cw: ['scm:arap'] },

  // ── 基础设置 ──────────────────────────────────────────
  { acdCode: '440', acdName: '科目维护',     cw: ['base:account'] },
  { acdCode: '441', acdName: '摘要信息维护', cw: ['base:summary'] },
  { acdCode: '442', acdName: '凭证类型维护', cw: ['base:vtype'] },
  // 结算方式在 CW 里既是基础档案，也是出纳菜单的一项
  { acdCode: '443', acdName: '结算类型维护', cw: ['base:settle', 'cashier:dict'] },
  { acdCode: '444', acdName: '外币类型维护', cw: ['base:currency'] },
  { acdCode: '445', acdName: '结转类型维护', cw: ['base:transfer'] },
  { acdCode: '446', acdName: '凭证模版维护', cw: ['base:template'] },
  { acdCode: '460', acdName: '项目信息维护', cw: ['base:project'] },
  { acdCode: '461', acdName: '客户信息维护', cw: ['base:customer'] },
  { acdCode: '462', acdName: '部门信息维护', cw: ['base:dept'] },
  { acdCode: '463', acdName: '人员信息维护', cw: ['base:person'] },
  { acdCode: '464', acdName: '现金项目维护', cw: ['base:cashitem'] },

  // ── 期初：CW 的分类期初统一由 period:init 把关 ────────
  { acdCode: '450', acdName: '期初录入',     cw: ['period:init'] },
  { acdCode: '451', acdName: '项目期初录入', cw: ['period:init'] },
  { acdCode: '452', acdName: '客户期初录入', cw: ['period:init'] },
  { acdCode: '453', acdName: '部门期初录入', cw: ['period:init'] },
  { acdCode: '454', acdName: '个人期初录入', cw: ['period:init'] },

  // ── 期间 / 账务 ───────────────────────────────────────
  { acdCode: '411', acdName: '月度结转',     cw: ['period:carry'] },
  { acdCode: '412', acdName: '结帐',         cw: ['period:close'] },
  { acdCode: '470', acdName: '帐务开工准备', cw: ['period:open'] },
  { acdCode: '471', acdName: '帐务套帐信息', cw: ['system:account'] },
  { acdCode: '473', acdName: '帐务反结帐',   cw: ['period:unclose'] },
  { acdCode: '474', acdName: '帐务操作日志', cw: ['period:log'] },

  // ── 系统 ──────────────────────────────────────────────
  { acdCode: '101', acdName: '操作员管理', cw: ['system:user'] },
  { acdCode: '801', acdName: '系统初始化', cw: ['system:init'] },
  { acdCode: '802', acdName: '套帐管理',   cw: ['system:account'] },
  { acdCode: '803', acdName: '综合检查',   cw: ['system:check'] },
  { acdCode: '804', acdName: '数据备份',   cw: ['system:backup'] },
  { acdCode: '805', acdName: '数据恢复',   cw: ['system:restore'] },

  // ── 通用动作 ──────────────────────────────────────────
  { acdCode: 'A02', acdName: '打印', cw: ['voucher:print', 'report:print', 'system:print'] },
  { acdCode: 'A03', acdName: '另存', cw: ['system:save'] },
  { acdCode: 'A04', acdName: '导出', cw: ['voucher:export', 'report:export', 'system:export'] },

  // ── 固定资产：CW 有完整 asset 模块，此前一条都没对上 ──
  { acdCode: '491', acdName: '固定资产套帐信息', cw: ['asset:param'] },
  { acdCode: '492', acdName: '固定资产台帐管理', cw: ['asset:view', 'asset:edit', 'asset:dispose', 'asset:change', 'asset:impair', 'asset:requisition'] },
  { acdCode: '493', acdName: '固定资产计提折旧', cw: ['asset:depr'] },
  { acdCode: '494', acdName: '固定资产折旧查询', cw: ['asset:view', 'asset:report'] },
  { acdCode: '495', acdName: '固定资产辅助维护', cw: ['asset:dict'] },
  { acdCode: '496', acdName: '固定资产开工准备', cw: ['asset:param'] },
  { acdCode: '497', acdName: '固定资产反过帐',   cw: ['asset:depr'] },
  // asset:inventory（资产盘点）ACD 无对应功能，属 CW 原生，只能手工授权。

  // ── 出纳：同上，CW 有 cashier 模块但此前一条都没对上 ──
  { acdCode: '4A1', acdName: '出纳初始化', cw: ['cashier:initbal', 'cashier:param'] },
  { acdCode: '4A2', acdName: '期初录入',   cw: ['cashier:initbal'] },
  { acdCode: '4A3', acdName: '反结账',     cw: ['cashier:param'] },
  { acdCode: '4AA', acdName: '单据录入',   cw: ['cashier:journal', 'cashier:voucher'] },
  { acdCode: '4AB', acdName: '对账',       cw: ['cashier:reconcile', 'cashier:import'] },
  { acdCode: '4AC', acdName: '结账',       cw: ['cashier:param'] },
  { acdCode: '4AD', acdName: '汇总余额表', cw: ['cashier:report'] },
  { acdCode: '4AE', acdName: '出纳日记账', cw: ['cashier:journal'] },

  // ── 成本 / 进销存 → CW 供应链 ─────────────────────────
  // 注意：511/512 只给 scm:inventory，不给 scm:purchase / scm:sale。
  // ACD 的入出库单不区分采购与销售，硬拆会造成越权授权；
  // 确实需要采购销售单据的，由管理员另行勾选。
  { acdCode: '501', acdName: '成本初始化',   cw: ['scm:param'] },
  { acdCode: '502', acdName: '成本反过帐',   cw: ['scm:audit'] },
  { acdCode: '503', acdName: '成本套帐信息', cw: ['scm:param'] },
  { acdCode: '504', acdName: '产品档案',     cw: ['scm:item', 'scm:category'] },
  { acdCode: '505', acdName: '期初库存',     cw: ['scm:opening'] },
  { acdCode: '506', acdName: '打印格式定义', cw: ['system:print'] },
  { acdCode: '511', acdName: '入库单管理',   cw: ['scm:inventory'] },
  { acdCode: '512', acdName: '出库单管理',   cw: ['scm:inventory'] },
  { acdCode: '513', acdName: '当前库存',     cw: ['scm:stock'] },
  { acdCode: '514', acdName: '盘点表',       cw: ['scm:inventory'] },
  { acdCode: '515', acdName: '成本计算',     cw: ['scm:production'] },
  { acdCode: '517', acdName: '库存台帐',     cw: ['scm:stock', 'scm:report'] },
  { acdCode: '521', acdName: '入库汇总',     cw: ['scm:report'] },
  { acdCode: '522', acdName: '出库汇总',     cw: ['scm:report'] },
  { acdCode: '523', acdName: '进销存表',     cw: ['scm:report'] },
  { acdCode: '524', acdName: '成本利润表',   cw: ['scm:report'] },
  { acdCode: '525', acdName: '费用分摊',     cw: ['scm:production'] },

  // ── 本系统暂无对应模块：工资 ──────────────────────────
  { acdCode: '481', acdName: '工资套帐信息', cw: [], unsupported: '工资' },
  { acdCode: '482', acdName: '工资人事管理', cw: [], unsupported: '工资' },
  { acdCode: '483', acdName: '工资管理',     cw: [], unsupported: '工资' },
  { acdCode: '484', acdName: '工资结构设置', cw: [], unsupported: '工资' },
  { acdCode: '485', acdName: '工资计算公式', cw: [], unsupported: '工资' },
  { acdCode: '486', acdName: '工资打印格式', cw: [], unsupported: '工资' },
  { acdCode: '487', acdName: '工资凭证设置', cw: [], unsupported: '工资' },
  { acdCode: '488', acdName: '工资部门维护', cw: [], unsupported: '工资' },
  { acdCode: '489', acdName: '工资初始化',   cw: [], unsupported: '工资' },
  { acdCode: '48a', acdName: '工资反过帐',   cw: [], unsupported: '工资' },

  // ── 本系统暂无对应模块：发票 ──────────────────────────
  { acdCode: '4C1', acdName: '发票初始化',   cw: [], unsupported: '发票' },
  { acdCode: '4C2', acdName: '发票参数设置', cw: [], unsupported: '发票' },
  { acdCode: '4C3', acdName: '发票录入',     cw: [], unsupported: '发票' },
  { acdCode: '4C4', acdName: '凭证生成',     cw: [], unsupported: '发票' },
  { acdCode: '4C5', acdName: '季度汇总表',   cw: [], unsupported: '发票' },
  { acdCode: '4C6', acdName: '发票结账',     cw: [], unsupported: '发票' },
  { acdCode: '4C7', acdName: '发票反结账',   cw: [], unsupported: '发票' },

  // ── 非功能项 ──────────────────────────────────────────
  // 400 是账务模块的根节点，本身不代表任何功能，不映射也不提示
  { acdCode: '400', acdName: '账务模块', cw: [], silent: true },
]

/**
 * 导入用户无条件获得的权限。
 * ACD 里没有「主页」这个概念，不补的话导入用户能登录却进不了首页。
 */
export const ACD_IMPORT_BASE_PERMISSIONS = ['system:dashboard']

/** ACD 功能代码 → CW 权限代码映射（一对多） */
export const ACD_TO_CW: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {}
  for (const entry of ACD_PERMISSION_CATALOG) {
    if (entry.cw.length > 0) map[entry.acdCode] = entry.cw
  }
  return map
})()

/** CW 权限代码 → 对应的 ACD 功能代码（反向索引，供权限接口回显） */
export const CW_TO_ACD: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {}
  for (const entry of ACD_PERMISSION_CATALOG) {
    for (const code of entry.cw) {
      if (!map[code]) map[code] = []
      map[code].push(entry.acdCode)
    }
  }
  return map
})()

/** ACD 功能代码 → 「本系统暂无此模块」的分组名 */
export const ACD_UNSUPPORTED: Record<string, AcdUnsupportedGroup> = (() => {
  const map: Record<string, AcdUnsupportedGroup> = {}
  for (const entry of ACD_PERMISSION_CATALOG) {
    if (entry.unsupported) map[entry.acdCode] = entry.unsupported
  }
  return map
})()

/** 非功能项：导入时静默忽略，不计入任何提示 */
export const ACD_SILENT_CODES: Set<string> = new Set(
  ACD_PERMISSION_CATALOG.filter(entry => entry.silent).map(entry => entry.acdCode)
)

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
      'cashier:voucher', 'cashier:import', 'cashier:report', 'cashier:param', 'cashier:dict',
      'asset:view', 'asset:edit', 'asset:dict', 'asset:depr',
      'asset:dispose', 'asset:inventory', 'asset:report', 'asset:param',
      'asset:change', 'asset:impair', 'asset:requisition',
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
