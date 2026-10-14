/**
 * flow：核心流程卡 + 辅助操作宫格；bento/grid：按分组宫格；
 * gl-workspace：财务总账专用工作页面（流程图 + 账簿链接列，配置见 glWorkspace.ts）
 * asset-workspace：固定资产专用工作页面（左侧导航面板 + 流程图 + 链接列，配置见 assetWorkspace.ts）
 * cashier-workspace：出纳管理专用工作页面（左侧导航面板 + 流程图 + 链接列，配置见 cashierWorkspace.ts）
 * arap-workspace：应收应付专用工作页面（应收 / 应付镜像分区 + 报表查询分区，配置见 arapWorkspace.ts）
 */
export type LayoutType = 'flow' | 'bento' | 'grid' | 'gl-workspace' | 'asset-workspace' | 'cashier-workspace' | 'arap-workspace'

export interface FlowNode {
  id: string
  path?: string // 用以匹配权限菜单
  title?: string // 默认从菜单读，如果找不到可作为后备
  /** Lucide 图标键；省略时使用菜单项自带图标 */
  icon?: string
  color?: string // 可选的主题色（如 blue, green, orange, purple）
  next?: string[] // 连接的下一节点 ID
  branches?: FlowNode[] // 从该节点向下延伸的分支节点
  /** 分支节点下方的说明文字（如退货与收付款的关系） */
  hint?: string
}

export interface ModuleFlowConfig {
  layout: LayoutType
  mainNodes?: FlowNode[] // 主干流程节点
  auxNodes?: FlowNode[] // 右侧或底部的辅助节点
}

/** 统一路径比较：去掉尾斜杠，查询参数按键排序，避免 ?a=1&b=2 与 ?b=2&a=1 对不上 */
export function normalizeNavPath(path: string): string {
  const trimmed = String(path || '').trim()
  if (!trimmed) return ''
  const qIndex = trimmed.indexOf('?')
  const pathname = (qIndex >= 0 ? trimmed.slice(0, qIndex) : trimmed).replace(/\/+$/, '') || '/'
  const query = qIndex >= 0 ? trimmed.slice(qIndex + 1) : ''
  if (!query) return pathname
  const pairs = [...new URLSearchParams(query).entries()].sort((a, b) => {
    if (a[0] === b[0]) return a[1].localeCompare(b[1])
    return a[0].localeCompare(b[0])
  })
  return `${pathname}?${pairs.map(([k, v]) => `${k}=${v}`).join('&')}`
}

function walkFlowNodes(nodes: FlowNode[] | undefined, visit: (node: FlowNode) => void) {
  for (const node of nodes || []) {
    visit(node)
    if (node.branches?.length) walkFlowNodes(node.branches, visit)
  }
}

/** 核心流程 + 分支 + 辅助操作已展示的路径（规范化后） */
export function collectFlowCoveredPaths(config: ModuleFlowConfig | null | undefined): Set<string> {
  const covered = new Set<string>()
  if (!config || config.layout !== 'flow') return covered
  const add = (node: FlowNode) => {
    if (node.path) covered.add(normalizeNavPath(node.path))
  }
  walkFlowNodes(config.mainNodes, add)
  walkFlowNodes(config.auxNodes, add)
  return covered
}

/**
 * 应用模块首页布局。键为 NavApp.title。
 * 未列出的应用默认使用 bento（按分组卡片）布局。
 */
export const groupFlowMap: Record<string, ModuleFlowConfig> = {
  销售管理: {
    layout: 'flow',
    mainNodes: [
      { id: 'sq', path: '/scm/docs?doc_type=SQ', color: 'blue', next: ['soa'] },
      { id: 'soa', path: '/scm/docs?doc_type=SOa', color: 'blue', next: ['so'] },
      {
        id: 'so',
        path: '/scm/docs?doc_type=SO',
        color: 'blue',
        next: ['rs'],
        branches: [{ id: 'sr', path: '/scm/docs?doc_type=SR', color: 'red', hint: '审核即冲减应收 → 收款单' }],
      },
      { id: 'rs', path: '/scm/docs?doc_type=RS', color: 'purple', next: ['rcv'] },
      { id: 'rcv', path: '/scm/docs?doc_type=RCV', color: 'green' },
    ],
    auxNodes: [
      { id: 'relations', path: '/scm/sales-order-relations', color: 'cyan' },
      { id: 'orderChange', path: '/scm/order-changes?doc_type=SOa', color: 'orange' },
      { id: 'summary', path: '/scm/report/sales/summary', color: 'blue' },
      { id: 'detail', path: '/scm/report/sales/detail', color: 'blue' },
      { id: 'return', path: '/scm/report/sales/return', color: 'red' },
      { id: 'returnQuery', path: '/scm/report/sales/return-query', color: 'red' },
      { id: 'invoiceQuery', path: '/scm/report/sales/invoice-query', color: 'purple' },
      { id: 'ranking', path: '/scm/report/sales/ranking', color: 'orange' },
      { id: 'profit', path: '/scm/report/sales/profit', color: 'green' },
      { id: 'salesExec', path: '/scm/report/sales/execution', color: 'cyan' },
      { id: 'trend', path: '/scm/report/sales/trend', color: 'purple' },
      { id: 'custom', path: '/scm/report/buysell?kind=sales', color: 'cyan' },
    ],
  },
  采购管理: {
    layout: 'flow',
    mainNodes: [
      { id: 'mr', path: '/scm/docs?doc_type=MR', color: 'red', next: ['pq'] },
      { id: 'pq', path: '/scm/docs?doc_type=PQ', color: 'orange', next: ['po'] },
      { id: 'po', path: '/scm/docs?doc_type=PO', color: 'orange', next: ['pi'] },
      {
        id: 'pi',
        path: '/scm/docs?doc_type=PI',
        color: 'orange',
        next: ['rp'],
        branches: [{ id: 'pr', path: '/scm/docs?doc_type=PR', color: 'red', hint: '审核即冲减应付 → 付款单' }],
      },
      { id: 'rp', path: '/scm/docs?doc_type=RP', color: 'purple', next: ['pay'] },
      { id: 'pay', path: '/scm/docs?doc_type=PAY', color: 'green' },
    ],
    auxNodes: [
      { id: 'advice', path: '/scm/report/purchase-advice', color: 'cyan' },
      { id: 'orderChange', path: '/scm/order-changes?doc_type=PO', color: 'orange' },
      { id: 'summary', path: '/scm/report/purchase/summary', color: 'blue' },
      { id: 'detail', path: '/scm/report/purchase/detail', color: 'blue' },
      { id: 'tracking', path: '/scm/report/purchase/order-tracking', color: 'orange' },
      { id: 'return', path: '/scm/report/purchase/return', color: 'red' },
      { id: 'returnQuery', path: '/scm/report/purchase/return-query', color: 'red' },
      { id: 'invoiceQuery', path: '/scm/report/purchase/invoice-query', color: 'purple' },
      { id: 'ranking', path: '/scm/report/purchase/ranking', color: 'orange' },
      { id: 'cost', path: '/scm/report/purchase/cost', color: 'green' },
      { id: 'trend', path: '/scm/report/purchase/trend', color: 'purple' },
      { id: 'custom', path: '/scm/report/buysell?kind=purchase', color: 'cyan' },
    ],
  },
  // 财务总账：流程图 + 账簿链接列的专用工作页面，节点与链接见 glWorkspace.ts
  财务总账: { layout: 'gl-workspace' },
  // 固定资产：左侧导航面板 + 流程图 + 链接列，配置见 assetWorkspace.ts
  固定资产: { layout: 'asset-workspace' },
  // 出纳管理：左侧导航面板 + 流程图 + 链接列，配置见 cashierWorkspace.ts
  出纳管理: { layout: 'cashier-workspace' },
  生产制造: {
    layout: 'flow',
    mainNodes: [
      { id: 'bom', path: '/scm/boms', color: 'purple', next: ['mrp'] },
      { id: 'mrp', path: '/scm/mrp', color: 'cyan', next: ['plan'] },
      { id: 'plan', path: '/scm/production-plans?plan_type=self', color: 'blue', next: ['pl'] },
      {
        id: 'pl',
        path: '/scm/docs?doc_type=PL',
        color: 'orange',
        next: ['report'],
        branches: [
          { id: 'pb', path: '/scm/docs?doc_type=PB', color: 'orange' },
          { id: 'pj', path: '/scm/docs?doc_type=PJ', color: 'orange' },
        ],
      },
      { id: 'report', path: '/scm/work-reports', color: 'blue', next: ['pf'] },
      {
        id: 'pf',
        path: '/scm/docs?doc_type=PF',
        color: 'green',
        branches: [{ id: 'ps', path: '/scm/docs?doc_type=PS', color: 'red' }],
      },
    ],
    auxNodes: [
      { id: 'kitting', path: '/scm/kitting', color: 'cyan' },
      { id: 'planChange', path: '/scm/plan-changes', color: 'orange' },
      { id: 'schedule', path: '/scm/schedule', color: 'blue' },
      { id: 'qc', path: '/scm/qc-docs', color: 'green' },
      { id: 'qcStandard', path: '/scm/qc-standards', color: 'green' },
      { id: 'cost', path: '/scm/cost-variance', color: 'purple' },
      { id: 'ohVariance', path: '/scm/costing/overhead-variance', color: 'purple' },
      { id: 'execution', path: '/scm/report/production/execution', color: 'cyan' },
      { id: 'planCost', path: '/scm/report/production/cost', color: 'purple' },
      { id: 'hours', path: '/scm/report/production/hours', color: 'cyan' },
      { id: 'daily', path: '/scm/report/production/daily', color: 'cyan' },
      { id: 'processWip', path: '/scm/report/production/process-wip', color: 'cyan' },
      { id: 'capacity', path: '/scm/report/production/capacity', color: 'cyan' },
      { id: 'workCenter', path: '/scm/work-centers', color: 'blue' },
      { id: 'routing', path: '/scm/routings', color: 'blue' },
      { id: 'as', path: '/scm/docs?doc_type=AS', color: 'orange' },
      { id: 'ds', path: '/scm/docs?doc_type=DS', color: 'red' },
    ],
  },
  委外管理: {
    layout: 'flow',
    mainNodes: [
      { id: 'plan', path: '/scm/production-plans?plan_type=outsource', color: 'blue', next: ['wo'] },
      { id: 'wo', path: '/scm/docs?doc_type=WO', color: 'orange', next: ['wi'] },
      { id: 'wi', path: '/scm/docs?doc_type=WI', color: 'green' },
    ],
    auxNodes: [
      { id: 'execution', path: '/scm/report/outsource/execution', color: 'cyan' },
      { id: 'op', path: '/scm/docs?doc_type=OP', color: 'orange' },
    ],
  },
  // 应收应付：应收 / 应付镜像分区 + 报表查询分区，配置见 arapWorkspace.ts
  应收应付: { layout: 'arap-workspace' },
}
