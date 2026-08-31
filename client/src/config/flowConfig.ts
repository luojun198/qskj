export type LayoutType = 'flow' | 'bento' | 'grid'

export interface FlowNode {
  id: string
  path?: string // 用以匹配权限菜单
  title?: string // 默认从菜单读，如果找不到可作为后备
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

export const groupFlowMap: Record<string, ModuleFlowConfig> = {
  '销售管理': {
    layout: 'flow',
    mainNodes: [
      { id: 'sq', path: '/scm/docs?doc_type=SQ', icon: 'Document', color: 'blue', next: ['soa'] },
      { id: 'soa', path: '/scm/docs?doc_type=SOa', icon: 'Tickets', color: 'blue', next: ['so'] },
      { 
        id: 'so', 
        path: '/scm/docs?doc_type=SO', 
        icon: 'Van', 
        color: 'blue', 
        next: ['rcv'],
        branches: [
          { id: 'sr', path: '/scm/docs?doc_type=SR', icon: 'Box', color: 'red' }
        ]
      },
      { id: 'rcv', path: '/scm/docs?doc_type=RCV', icon: 'Money', color: 'green', next: ['rs'] },
      { id: 'rs', path: '/scm/docs?doc_type=RS', icon: 'Printer', color: 'purple' },
    ]
  },
  '采购管理': {
    layout: 'flow',
    mainNodes: [
      { id: 'pq', path: '/scm/docs?doc_type=PQ', icon: 'ChatLineSquare', color: 'orange', next: ['po'] },
      { id: 'po', path: '/scm/docs?doc_type=PO', icon: 'DocumentChecked', color: 'orange', next: ['pi'] },
      { 
        id: 'pi', 
        path: '/scm/docs?doc_type=PI', 
        icon: 'Box', 
        color: 'orange', 
        next: ['pay'],
        branches: [
          { id: 'pr', path: '/scm/docs?doc_type=PR', icon: 'Van', color: 'red' }
        ]
      },
      { id: 'pay', path: '/scm/docs?doc_type=PAY', icon: 'Wallet', color: 'green', next: ['rp'] },
      { id: 'rp', path: '/scm/docs?doc_type=RP', icon: 'Printer', color: 'purple' },
    ]
  },
  '凭证管理': {
    layout: 'flow',
    mainNodes: [
      {
        id: 'account',
        path: '/base/account',
        title: '科目与基础资料',
        icon: 'Reading',
        color: 'cyan',
        next: ['init'],
        branches: [
          { id: 'voucherType', path: '/base/voucher-type', title: '凭证类型', icon: 'Tickets', color: 'cyan' },
          { id: 'template', path: '/voucher/template', title: '凭证模板', icon: 'Postcard', color: 'cyan' }
        ]
      },
      { id: 'init', path: '/base/init-balance', title: '期初余额', icon: 'Coin', color: 'orange', next: ['entry'] },
      { id: 'entry', path: '/voucher/entry', title: '凭证录入', icon: 'Memo', color: 'blue', next: ['audit'] },
      { id: 'audit', path: '/voucher/audit', title: '审核记账', icon: 'DocumentChecked', color: 'blue', next: ['ledgerCheck'] },
      {
        id: 'ledgerCheck',
        path: '/ledger/general',
        title: '账簿核对',
        icon: 'ScaleToOriginal',
        color: 'green',
        next: ['transfer'],
        branches: [
          { id: 'detail', path: '/ledger/detail', title: '明细账', icon: 'Notebook', color: 'green' },
          { id: 'chronological', path: '/ledger/chronological', title: '序时账', icon: 'Files', color: 'green' }
        ]
      },
      {
        id: 'transfer',
        path: '/voucher/auto-transfer',
        title: '期末结转',
        icon: 'Wallet',
        color: 'purple',
        next: ['report'],
        branches: [
          { id: 'transferType', path: '/base/transfer-type', title: '结转维护', icon: 'Operation', color: 'purple' }
        ]
      },
      { id: 'report', path: '/ledger/standard-report', title: '标准报表', icon: 'Histogram', color: 'purple', next: ['close'] },
      { id: 'close', path: '/voucher/period-close', title: '期间结账', icon: 'Lock', color: 'red' },
    ],
    auxNodes: [
      { id: 'query', path: '/voucher/query', title: '凭证查询', icon: 'Search', color: 'cyan' },
      { id: 'balance', path: '/ledger/balance', title: '总分类账', icon: 'Reading', color: 'green' },
      { id: 'general', path: '/ledger/general', title: '科目余额表', icon: 'DataBoard', color: 'green' },
      { id: 'cashJournal', path: '/ledger/cash-journal', title: '现金银行日记账', icon: 'CreditCard', color: 'green' },
      { id: 'auxBalance', path: '/ledger/aux-balance', title: '辅助项目余额表', icon: 'FolderChecked', color: 'orange' },
      { id: 'auxDetail', path: '/ledger/aux-detail', title: '辅助项目明细账', icon: 'Notebook', color: 'orange' },
      { id: 'cashFlowTrial', path: '/ledger/cash-flow-trial-balance', title: '现金流量试算平衡表', icon: 'PieChart', color: 'blue' },
      { id: 'reportMaintain', path: '/report/dynamic', title: '报表维护', icon: 'TrendCharts', color: 'purple' },
      { id: 'printTemplate', path: '/base/print-template', title: '打印模板', icon: 'Printer', color: 'cyan' }
    ]
  },
  '生产管理': {
    layout: 'flow',
    mainNodes: [
      { id: 'bom', path: '/scm/boms', icon: 'Connection', color: 'purple', next: ['plan'] },
      { id: 'plan', path: '/scm/production-plans', icon: 'Calendar', color: 'blue', next: ['pl'] },
      { id: 'pl', path: '/scm/docs?doc_type=PL', icon: 'ShoppingCartFull', color: 'orange', next: ['pf'] },
      { 
        id: 'pf', 
        path: '/scm/docs?doc_type=PF', 
        icon: 'Present', 
        color: 'green',
        branches: [
          { id: 'ps', path: '/scm/docs?doc_type=PS', icon: 'Warning', color: 'red' },
          { id: 'pj', path: '/scm/docs?doc_type=PJ', icon: 'Box', color: 'orange' }
        ]
      },
    ],
    auxNodes: [
      { id: 'as', path: '/scm/docs?doc_type=AS', icon: 'SetUp', color: 'blue' },
      { id: 'ds', path: '/scm/docs?doc_type=DS', icon: 'Scissor', color: 'red' }
    ]
  },
  '委外管理': {
    layout: 'flow',
    mainNodes: [
      { id: 'wo', path: '/scm/docs?doc_type=WO', icon: 'Van', color: 'orange', next: ['wi'] },
      { id: 'wi', path: '/scm/docs?doc_type=WI', icon: 'Box', color: 'green' }
    ]
  },
  '出纳管理': {
    layout: 'flow',
    mainNodes: [
      { id: 'journal', path: '/cashier/journal', icon: 'Edit', color: 'blue', next: ['flow'] },
      { id: 'flow', path: '/cashier/flow-query', icon: 'List', color: 'blue', next: ['report'] },
      { id: 'report', path: '/cashier/daily-report', icon: 'DataLine', color: 'purple', next: ['summary'] },
      { id: 'summary', path: '/cashier/summary-report', icon: 'PieChart', color: 'green' },
    ],
    auxNodes: [
      { id: 'docs', path: '/cashier/document-query', icon: 'Search', color: 'cyan' }
    ]
  },
  '账簿管理': {
    layout: 'bento' // 使用便当盒拼图布局
  },
  '基础设置': {
    layout: 'bento'
  },
  '系统管理': {
    layout: 'bento'
  },
  '固定资产': {
    layout: 'bento'
  },
  '库存': {
    layout: 'bento'
  },
  '报表管理': {
    layout: 'bento'
  },
  '辅助核算': {
    layout: 'bento'
  }
}
