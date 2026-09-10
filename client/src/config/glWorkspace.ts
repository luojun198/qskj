import { normalizeNavPath } from './flowConfig'
import { getSubjectAnalysisPath } from './subjectAnalysis'

/**
 * 财务总账工作页面配置（严格参照经典总账软件的"左侧导航面板 + 流程图 + 账簿链接列"布局）。
 *
 * - GL_SIDEBAR_SECTIONS：左侧边栏三个折叠/分组卡片（账务报表、财务分析、基础档案）。
 * - GL_FLOW_NODES：顶部流程图。主干横向排列，`above` 挂在节点上方，`below` 挂在节点下方。
 * - GL_LINK_COLUMNS：底部账簿 / 报表链接列，严格分为 4 列。
 */

export type GlNodeColor = 'blue' | 'mint' | 'lilac' | 'amber' | 'rose' | 'foam'

export interface GlFlowNode {
  id: string
  title: string
  /** Lucide 图标键或自定义拟物图形标识 */
  icon: string
  color: GlNodeColor
  /** 路由路径；与 action 二选一 */
  path?: string
  /** 非路由动作 */
  action?: 'switch-user'
  /** 挂在节点上方的节点（如切换用户） */
  above?: GlFlowNode
  /** 挂在节点下方的节点（如凭证查询） */
  below?: GlFlowNode
}

export interface GlLinkItem {
  /** 路由路径；省略表示功能尚未实现，先占位展示 */
  path?: string
  /** 显示名，严格按参考图命名 */
  title: string
  /**
   * 该入口依赖的账套业务开关。菜单里找不到路径时用它区分两种灰显：
   * 开关没开（可引导用户去账套参数打开）还是真的没有权限。
   */
  requires?: 'foreign' | 'cashflow'
}

export interface GlLinkColumn {
  key: string
  label: string
  items: GlLinkItem[]
}

export interface GlSidebarItem {
  title: string
  path?: string
  action?: string
  /** 空占位行，仅用于让左右两列逐行对齐 */
  spacer?: boolean
  /** 与 GlLinkItem.requires 同义：该入口依赖的账套业务开关，用于区分「开关没开」与「无权限」 */
  requires?: GlLinkItem['requires']
}

export interface GlSidebarSection {
  key: string
  title: string
  /** 顶部强调大按钮（如账务报表里的「日常业务」） */
  pillButton?: {
    title: string
    active?: boolean
    action?: string
    path?: string
  }
  /** 左侧和右侧双列排列 */
  leftItems: GlSidebarItem[]
  rightItems: GlSidebarItem[]
}

/** 使用该工作页面布局的应用键 */
export const GL_WORKSPACE_APP_KEY = 'finance'

/** 左侧侧边栏 3 大面板配置 */
export const GL_SIDEBAR_SECTIONS: GlSidebarSection[] = [
  {
    key: 'reports',
    title: '日常业务',
    leftItems: [
      { title: '凭证录入', path: '/voucher/entry' },
      { title: '凭证审核', path: '/voucher/audit?status=draft' },
      { title: '凭证过账', path: '/voucher/audit?status=audited' },
      { title: '期末调汇', path: '/voucher/fx-reval', requires: 'foreign' },
      { title: '月度结转', path: '/voucher/auto-transfer' },
      { title: '报表', path: '/ledger/standard-report' },
    ],
    rightItems: [
      { title: '凭证查询', path: '/voucher/query' },
      { title: '汇总余额表', path: '/ledger/general' },
      { title: '凭证汇总表', path: '/ledger/voucher-summary' },
      { title: '明细账', path: '/ledger/detail' },
      { title: '数据备份', path: '/security/backup' },
      // 右列补1个空位保持左右两列逐行对齐
      { title: '', spacer: true },
    ],
  },
  {
    key: 'analysis',
    title: '财务分析',
    // 六项共用 SubjectAnalysis 页，仅预置科目不同；预置表见 config/subjectAnalysis.ts
    leftItems: [
      { title: '管理费用', path: getSubjectAnalysisPath('admin') },
      { title: '销售费用', path: getSubjectAnalysisPath('sales') },
      { title: '财务费用', path: getSubjectAnalysisPath('finance') },
      { title: '账龄分析', path: '/scm/arap-aging' },
    ],
    rightItems: [
      { title: '应收账款', path: getSubjectAnalysisPath('ar') },
      { title: '应付账款', path: getSubjectAnalysisPath('ap') },
      { title: '其它科目分析', path: getSubjectAnalysisPath('custom') },
      { title: '自定义分析', path: '/report/dynamic' },
    ],
  },
  {
    key: 'base',
    title: '基础档案',
    leftItems: [
      { title: '科目维护', path: '/base/account' },
      { title: '凭证类型', path: '/base/voucher-type' },
      { title: '结转类型', path: '/base/transfer-type' },
      { title: '外币类型', path: '/base/currency', requires: 'foreign' },
      { title: '辅助档案', path: '/base/project' },
      { title: '期初录入', path: '/base/init-balance' },
    ],
    rightItems: [
      { title: '套账信息', path: '/base/account-set-info' },
      { title: '套账管理', path: '/system/account-set' },
      { title: '凭证打印设置', path: '/base/print-template' },
      { title: '修改密码', action: 'change-password' },
      { title: '用户管理', path: '/system/user' },
      { title: '自动备份设置', path: '/security/backup' },
    ],
  },
]

export const GL_FLOW_NODES: GlFlowNode[] = [
  {
    id: 'entry',
    title: '凭证录入',
    icon: 'FilePen',
    color: 'blue',
    path: '/voucher/entry',
    below: { id: 'query', title: '凭证查询', icon: 'FileSearch', color: 'foam', path: '/voucher/query' },
  },
  {
    id: 'audit',
    title: '凭证审核',
    icon: 'FileCheck2',
    color: 'blue',
    path: '/voucher/audit?status=draft',
    above: { id: 'switchUser', title: '切换用户', icon: 'UsersRound', color: 'amber', action: 'switch-user' },
  },

  { id: 'post', title: '凭证过账', icon: 'BookOpenCheck', color: 'mint', path: '/voucher/audit?status=audited' },
  {
    id: 'transfer',
    title: '月度结转',
    icon: 'ArrowRightLeft',
    color: 'lilac',
    path: '/voucher/auto-transfer',
    below: { id: 'close', title: '结账', icon: 'CalendarCheck', color: 'rose', path: '/voucher/period-close' },
  },
  {
    id: 'report',
    title: '报表',
    icon: 'FileBarChart2',
    color: 'amber',
    path: '/ledger/standard-report',
    below: { id: 'backup', title: '数据备份', icon: 'DatabaseBackup', color: 'foam', path: '/security/backup' },
  },
]

/** 底部链接列：严格按参考图 4 列排列与命名；未实现的功能先占位展示 */
export const GL_LINK_COLUMNS: GlLinkColumn[] = [
  {
    key: 'col1',
    label: '账簿类',
    items: [
      { path: '/ledger/balance', title: '总分类账' },
      { path: '/ledger/cash-journal?scope=bank', title: '银行日记账' },
      { path: '/ledger/cash-journal', title: '现金日记账' },
    ],
  },
  {
    key: 'col2',
    label: '余额类',
    items: [
      { path: '/ledger/general', title: '汇总余额表' },
      { path: '/ledger/foreign-balance', title: '外币余额表', requires: 'foreign' },
      { path: '/ledger/aux-balance', title: '辅助项目余额表' },
      { path: '/ledger/aux-foreign-balance', title: '辅助项目外币余额表', requires: 'foreign' },
      { path: '/ledger/voucher-summary', title: '凭证汇总表' },
    ],
  },
  {
    key: 'col3',
    label: '明细类',
    items: [
      { path: '/ledger/detail', title: '明细账' },
      { path: '/ledger/vat-detail', title: '增值税明细账' },
      { path: '/ledger/multi-column', title: '多栏账' },
      { path: '/ledger/aux-detail', title: '辅助项目明细账' },
      { path: '/ledger/aux-multi-column', title: '辅助项目多栏明细账' },
    ],
  },
  {
    key: 'col4',
    label: '报表与综合类',
    items: [
      { path: '/ledger/quantity-balance', title: '库存数量金额表' },
      { path: '/ledger/aux-quantity-balance', title: '辅助项目库存数量金额表' },
      { path: '/ledger/cash-flow-trial-balance', title: '现金流量试算平衡表', requires: 'cashflow' },
    ],
  },
]

function walkNodes(nodes: GlFlowNode[], visit: (node: GlFlowNode) => void) {
  for (const node of nodes) {
    visit(node)
    if (node.above) visit(node.above)
    if (node.below) visit(node.below)
  }
}

/** 流程图 + 链接列已展示的路径（规范化、去掉查询串） */
export function collectGlCoveredPaths(): Set<string> {
  const covered = new Set<string>()
  const add = (path?: string) => {
    if (path) covered.add(normalizeNavPath(path.split('?')[0]))
  }
  walkNodes(GL_FLOW_NODES, node => add(node.path))
  for (const column of GL_LINK_COLUMNS) for (const item of column.items) add(item.path)
  return covered
}

