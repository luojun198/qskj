import type { GlFlowNode, GlSidebarSection, GlLinkItem } from './glWorkspace'

/**
 * 出纳工作页面配置（严格参照经典出纳软件布局）。
 *
 * - CASHIER_SIDEBAR_SECTIONS：左侧边栏「出纳工作」卡片，内含「日常业务」标签与单列功能。
 * - CASHIER_FLOW_NODES：主流程图节点（单据录入 → 凭证生成 → 对账 → 结账，结账上方挂反结账）。
 */

export const CASHIER_SIDEBAR_SECTIONS: GlSidebarSection[] = [
  {
    key: 'cashier-work',
    title: '出纳工作',
    pillButton: { title: '日常业务', active: true },
    leftItems: [
      { title: '单据录入', path: '/cashier/journal' },
      { title: '凭证生成', path: '/cashier/journal' },
      { title: '对账', path: '/cashier/reconcile' },
      { title: '结账', path: '/cashier/period-close' },
      { title: '反结账', path: '/cashier/period-close' },
    ],
    rightItems: [],
  },
]

export const CASHIER_FLOW_NODES: GlFlowNode[] = [
  {
    id: 'doc-entry',
    title: '单据录入',
    icon: 'Banknote',
    color: 'blue',
    path: '/cashier/journal',
  },
  {
    id: 'voucher-gen',
    title: '凭证生成',
    icon: 'FilePen',
    color: 'mint',
    path: '/cashier/journal',
  },
  {
    id: 'reconcile',
    title: '对账',
    icon: 'ListChecks',
    color: 'lilac',
    path: '/cashier/reconcile',
  },
  {
    id: 'close',
    title: '结账',
    icon: 'CalendarCheck',
    color: 'foam',
    path: '/cashier/period-close',
    above: {
      id: 'reopen',
      title: '反结账',
      icon: 'Undo2',
      color: 'amber',
      path: '/cashier/period-close',
    },
  },
]

/** 底部链接列（流程图下方）：严格按参考图 2 列排列 */
export const CASHIER_LINK_COLUMNS: { key: string; label: string; items: GlLinkItem[] }[] = [
  {
    key: 'col1',
    label: '出纳账簿',
    items: [
      { path: '/cashier/summary-report', title: '汇总余额表' },
      { path: '/cashier/summary-report', title: '外币汇总余额表' },
      { path: '/cashier/daily-report', title: '出纳日记账' },
    ],
  },
  {
    key: 'col2',
    label: '出纳查询',
    items: [
      { path: '/cashier/document-query', title: '出纳单据浏览' },
      { path: '/cashier/document-query', title: '出纳单据综合查询' },
    ],
  },
]
