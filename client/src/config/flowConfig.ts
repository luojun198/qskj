export type LayoutType = 'flow' | 'bento' | 'grid'

export interface FlowNode {
  id: string
  path?: string // 用以匹配权限菜单
  title?: string // 默认从菜单读，如果找不到可作为后备
  /** Lucide 图标键；省略时使用菜单项自带图标 */
  icon?: string
  color?: string // 可选的主题色（如 blue, green, orange, purple）
  next?: string[] // 连接的下一节点 ID
  branches?: FlowNode[] // 从该节点向下延伸的分支节点
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
        branches: [{ id: 'sr', path: '/scm/docs?doc_type=SR', color: 'red' }],
      },
      { id: 'rs', path: '/scm/docs?doc_type=RS', color: 'purple', next: ['rcv'] },
      { id: 'rcv', path: '/scm/docs?doc_type=RCV', color: 'green' },
    ],
    auxNodes: [
      { id: 'relations', path: '/scm/sales-order-relations', color: 'cyan' },
      { id: 'summary', path: '/scm/report/sales/summary', color: 'blue' },
      { id: 'detail', path: '/scm/report/sales/detail', color: 'blue' },
      { id: 'ranking', path: '/scm/report/sales/ranking', color: 'orange' },
      { id: 'profit', path: '/scm/report/sales/profit', color: 'green' },
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
        branches: [{ id: 'pr', path: '/scm/docs?doc_type=PR', color: 'red' }],
      },
      { id: 'rp', path: '/scm/docs?doc_type=RP', color: 'purple', next: ['pay'] },
      { id: 'pay', path: '/scm/docs?doc_type=PAY', color: 'green' },
    ],
    auxNodes: [
      { id: 'advice', path: '/scm/report/purchase-advice', color: 'cyan' },
      { id: 'summary', path: '/scm/report/purchase/summary', color: 'blue' },
      { id: 'detail', path: '/scm/report/purchase/detail', color: 'blue' },
      { id: 'tracking', path: '/scm/report/purchase/order-tracking', color: 'orange' },
      { id: 'ranking', path: '/scm/report/purchase/ranking', color: 'orange' },
      { id: 'cost', path: '/scm/report/purchase/cost', color: 'green' },
      { id: 'trend', path: '/scm/report/purchase/trend', color: 'purple' },
      { id: 'custom', path: '/scm/report/buysell?kind=purchase', color: 'cyan' },
    ],
  },
  财务总账: {
    layout: 'flow',
    mainNodes: [
      {
        id: 'account',
        path: '/base/account',
        title: '科目与基础资料',
        color: 'cyan',
        next: ['init'],
        branches: [
          { id: 'voucherType', path: '/base/voucher-type', color: 'cyan' },
          { id: 'template', path: '/voucher/template', color: 'cyan' },
        ],
      },
      { id: 'init', path: '/base/init-balance', color: 'orange', next: ['entry'] },
      { id: 'entry', path: '/voucher/entry', color: 'blue', next: ['audit'] },
      { id: 'audit', path: '/voucher/audit', color: 'blue', next: ['ledgerCheck'] },
      {
        id: 'ledgerCheck',
        path: '/ledger/general',
        title: '账簿核对',
        color: 'green',
        next: ['transfer'],
        branches: [
          { id: 'detail', path: '/ledger/detail', color: 'green' },
          { id: 'chronological', path: '/ledger/chronological', color: 'green' },
        ],
      },
      {
        id: 'transfer',
        path: '/voucher/auto-transfer',
        title: '期末结转',
        color: 'purple',
        next: ['report'],
        branches: [{ id: 'transferType', path: '/base/transfer-type', color: 'purple' }],
      },
      { id: 'report', path: '/ledger/standard-report', color: 'purple', next: ['close'] },
      { id: 'close', path: '/voucher/period-close', color: 'red' },
    ],
    auxNodes: [
      { id: 'query', path: '/voucher/query', color: 'cyan' },
      { id: 'balance', path: '/ledger/balance', color: 'green' },
      { id: 'cashJournal', path: '/ledger/cash-journal', color: 'green' },
      { id: 'auxProject', path: '/base/project', color: 'orange' },
      { id: 'auxBalance', path: '/ledger/aux-balance', color: 'orange' },
      { id: 'auxDetail', path: '/ledger/aux-detail', color: 'orange' },
      { id: 'cashFlowTrial', path: '/ledger/cash-flow-trial-balance', color: 'blue' },
      { id: 'reportMaintain', path: '/report/dynamic', color: 'purple' },
      { id: 'printTemplate', path: '/base/print-template', color: 'cyan' },
    ],
  },
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
      { id: 'qc', path: '/scm/qc-docs', color: 'green' },
      { id: 'cost', path: '/scm/cost-variance', color: 'purple' },
      { id: 'execution', path: '/scm/report/production/execution', color: 'cyan' },
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
    auxNodes: [{ id: 'execution', path: '/scm/report/outsource/execution', color: 'cyan' }],
  },
  出纳管理: {
    layout: 'flow',
    mainNodes: [
      { id: 'journal', path: '/cashier/journal', color: 'blue', next: ['flow'] },
      { id: 'flow', path: '/cashier/flow-query', color: 'blue', next: ['report'] },
      { id: 'report', path: '/cashier/daily-report', color: 'purple', next: ['summary'] },
      { id: 'summary', path: '/cashier/summary-report', color: 'green' },
    ],
    auxNodes: [
      { id: 'docs', path: '/cashier/document-query', color: 'cyan' },
      { id: 'settle', path: '/cashier/settle-type', color: 'orange' },
      { id: 'init', path: '/cashier/init-balance', color: 'orange' },
    ],
  },
  应收应付: {
    layout: 'flow',
    mainNodes: [
      { id: 'rcv', path: '/scm/docs?doc_type=RCV', color: 'green', next: ['verify'] },
      { id: 'verify', path: '/scm/arap-verify', color: 'blue', next: ['statement'] },
      { id: 'statement', path: '/scm/arap-statement', color: 'purple', next: ['aging'] },
      { id: 'aging', path: '/scm/arap-aging', color: 'orange' },
    ],
    auxNodes: [
      { id: 'pay', path: '/scm/docs?doc_type=PAY', color: 'red' },
      { id: 'rcvAdv', path: '/scm/docs?doc_type=RCV&payment_mode=advance', color: 'green' },
      { id: 'payAdv', path: '/scm/docs?doc_type=PAY&payment_mode=advance', color: 'red' },
      { id: 'balance', path: '/scm/arap', color: 'blue' },
      { id: 'detail', path: '/scm/arap-detail', color: 'blue' },
      { id: 'due', path: '/scm/arap-due', color: 'orange' },
    ],
  },
}
