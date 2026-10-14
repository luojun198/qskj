import type { GlFlowNode, GlLinkItem, GlNodeColor } from './glWorkspace'

/**
 * 应收应付工作页面配置：应收 / 应付两个镜像分区 + 报表查询分区。
 *
 * - ARAP_SIDES：左右镜像的两个分区，流程「发票 → 收/付款 → 往来核销 → 对账单」，
 *   收/付款节点下方挂预收/预付款单；分区底部为按方向预置筛选的快捷链接。
 *   发票节点属于销售/采购模块，这里只是跨模块快捷入口（菜单不变）。
 * - ARAP_REPORT_LINKS：报表查询分区，不分方向。
 *
 * 带 side / arap_type 参数的链接会让目标页面直接定位到对应方向。
 */

export interface ArapSide {
  key: 'ar' | 'ap'
  title: string
  /** 分区识别色（标题条与图标） */
  accent: GlNodeColor
  nodes: GlFlowNode[]
  links: GlLinkItem[]
}

export const ARAP_SIDES: ArapSide[] = [
  {
    key: 'ar',
    title: '应收管理',
    accent: 'mint',
    nodes: [
      { id: 'ar-invoice', title: '销售发票', icon: 'Receipt', color: 'lilac', path: '/scm/docs?doc_type=RS' },
      {
        id: 'ar-receive',
        title: '收款单',
        icon: 'ArrowDownToLine',
        color: 'mint',
        path: '/scm/docs?doc_type=RCV',
        below: {
          id: 'ar-advance',
          title: '预收款单',
          icon: 'FileInput',
          color: 'foam',
          path: '/scm/docs?doc_type=RCV&payment_mode=advance',
        },
      },
      { id: 'ar-verify', title: '应收核销', icon: 'BadgeCheck', color: 'blue', path: '/scm/arap-verify?side=ar' },
      { id: 'ar-statement', title: '客户对账单', icon: 'ScrollText', color: 'amber', path: '/scm/statements?direction=ar' },
    ],
    links: [
      { title: '应收核销记录', path: '/scm/arap-verify-records?side=ar' },
      { title: '对账明细表', path: '/scm/statements/detail-report?direction=ar' },
      { title: '往来对账查询', path: '/scm/arap-statement?arap_type=ar' },
      { title: '应收余额表', path: '/scm/arap?arap_type=ar' },
      { title: '应收明细账', path: '/scm/arap-detail?arap_type=ar' },
    ],
  },
  {
    key: 'ap',
    title: '应付管理',
    accent: 'amber',
    nodes: [
      { id: 'ap-invoice', title: '采购发票', icon: 'Receipt', color: 'lilac', path: '/scm/docs?doc_type=RP' },
      {
        id: 'ap-pay',
        title: '付款单',
        icon: 'ArrowUpFromLine',
        color: 'rose',
        path: '/scm/docs?doc_type=PAY',
        below: {
          id: 'ap-advance',
          title: '预付款单',
          icon: 'FileOutput',
          color: 'foam',
          path: '/scm/docs?doc_type=PAY&payment_mode=advance',
        },
      },
      { id: 'ap-verify', title: '应付核销', icon: 'BadgeCheck', color: 'blue', path: '/scm/arap-verify?side=ap' },
      { id: 'ap-statement', title: '供应商对账单', icon: 'ScrollText', color: 'amber', path: '/scm/statements?direction=ap' },
    ],
    links: [
      { title: '应付核销记录', path: '/scm/arap-verify-records?side=ap' },
      { title: '对账明细表', path: '/scm/statements/detail-report?direction=ap' },
      { title: '往来对账查询', path: '/scm/arap-statement?arap_type=ap' },
      { title: '应付余额表', path: '/scm/arap?arap_type=ap' },
      { title: '应付明细账', path: '/scm/arap-detail?arap_type=ap' },
    ],
  },
]

/** 报表查询分区：应收应付合并查询（不预置方向） */
export const ARAP_REPORT_LINKS: (GlLinkItem & { icon: string })[] = [
  { title: '往来余额表', path: '/scm/arap', icon: 'Table2' },
  { title: '往来明细账', path: '/scm/arap-detail', icon: 'ListOrdered' },
  { title: '应收应付账龄', path: '/scm/arap-aging', icon: 'Hourglass' },
  { title: '到期提醒/信用', path: '/scm/arap-due', icon: 'Bell' },
  { title: '核销单记录', path: '/scm/arap-verify-records', icon: 'ListChecks' },
  { title: '往来汇率重估', path: '/scm/arap-fx-reval', icon: 'Coins' },
]
