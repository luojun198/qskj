import type { GlFlowNode, GlSidebarSection, GlLinkItem } from './glWorkspace'

/**
 * 固定资产工作页面配置（参照经典 ERP 软件"左侧导航面板 + 流程图"布局）。
 *
 * - ASSET_SIDEBAR_SECTIONS：左侧边栏两个分组卡片（日常业务、基础档案）。
 * - ASSET_FLOW_NODES：主流程图节点（固定资产管理 → 计提折旧 → 凭证生成 → 折旧查询，计提折旧上方挂取消折旧）。
 */

export const ASSET_SIDEBAR_SECTIONS: GlSidebarSection[] = [
  {
    key: 'asset-daily',
    title: '日常业务',
    leftItems: [
      { title: '资产明细账', path: '/asset/detail' },
      { title: '资产清单', path: '/asset/list' },
      { title: '固定资产台帐', path: '/asset/list' },
      { title: '附属设备表', path: '/asset/report' },
      { title: '到期资产清单', path: '/asset/report' },
    ],
    rightItems: [
      { title: '资产增加清单', path: '/asset/change' },
      { title: '资产减少清单', path: '/asset/change' },
      { title: '资产分布表', path: '/asset/report' },
      { title: '打印资产标签', path: '/asset/list' },
      { title: '', spacer: true },
    ],
  },
  {
    key: 'asset-base',
    title: '基础档案',
    leftItems: [
      { title: '资产初始化', path: '/asset/dict' },
      { title: '部门设置', path: '/asset/dict' },
      { title: '资产类别', path: '/asset/dict' },
      { title: '资产用途', path: '/asset/dict' },
      { title: '使用状态', path: '/asset/dict' },
      { title: '注销原因', path: '/asset/dict' },
    ],
    rightItems: [
      { title: '套账信息', path: '/base/account-set-info' },
      { title: '凭证设置', path: '/base/voucher-type' },
      { title: '自改密码', action: 'change-password' },
      { title: '打印机设置', path: '/base/print-template' },
    ],
  },
]

export const ASSET_FLOW_NODES: GlFlowNode[] = [
  {
    id: 'asset-mgmt',
    title: '固定资产管理',
    icon: 'Building2',
    color: 'blue',
    path: '/asset/list',
  },
  {
    id: 'depreciation',
    title: '计提折旧',
    icon: 'TrendingDown',
    color: 'mint',
    // 进页自动预览当前期间（贴近 ACD 一键计提）
    path: '/asset/depreciation?action=preview',
    above: {
      id: 'cancel-depr',
      title: '取消折旧',
      icon: 'Undo2',
      color: 'amber',
      path: '/asset/depreciation/reverse',
    },
  },
  {
    id: 'voucher-gen',
    title: '凭证生成',
    icon: 'FilePen',
    color: 'lilac',
    // 历史记录页签可按期补生成折旧凭证
    path: '/asset/depreciation?tab=history',
  },
  {
    id: 'depr-query',
    title: '折旧查询',
    icon: 'FileSearch',
    color: 'foam',
    path: '/asset/report?tab=depr-summary',
  },
]

/** 底部链接列（流程图下方）：资产报表与查询 */
export const ASSET_LINK_COLUMNS: { key: string; label: string; items: GlLinkItem[] }[] = [
  {
    key: 'col1',
    label: '资产账簿',
    items: [
      { path: '/asset/list', title: '资产卡片' },
      { path: '/asset/detail', title: '资产明细账' },
      { path: '/asset/change', title: '资产变动' },
    ],
  },
  {
    key: 'col2',
    label: '资产业务',
    items: [
      { path: '/asset/requisition', title: '领用归还' },
      { path: '/asset/depreciation', title: '折旧计提' },
      { path: '/asset/depreciation/reverse', title: '取消折旧' },
      { path: '/asset/inventory', title: '资产盘点' },
    ],
  },
  {
    key: 'col3',
    label: '资产报表',
    items: [
      { path: '/asset/report', title: '资产报表' },
    ],
  },
  {
    key: 'col4',
    label: '资产设置',
    items: [
      { path: '/asset/dict', title: '资产档案' },
    ],
  },
]
