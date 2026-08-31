import type { StaticReportStandard } from '../services/staticReportConfig.js'

/** 间接法调节行：按科目前缀余额变动推算对现金流的影响 */
export type IndirectAdjustmentKind =
  | 'non_cash_add'
  | 'working_capital_asset'
  | 'working_capital_liability'

export type IndirectAdjustmentLine = {
  label: string
  patterns: string[]
  kind: IndirectAdjustmentKind
}

export type IndirectMethodMapping = {
  standard: StaticReportStandard
  profitLabel: string
  adjustments: IndirectAdjustmentLine[]
}

/** 小企业会计准则 — 附注间接法常用调节项（估算口径） */
export const SMALL_BUSINESS_INDIRECT: IndirectMethodMapping = {
  standard: 'small_business',
  profitLabel: '净利润',
  adjustments: [
    { label: '加：折旧及摊销', patterns: ['1602', '1702'], kind: 'non_cash_add' },
    {
      label: '经营性应收项目的减少（减：增加）',
      patterns: ['1121', '1122', '1123', '1221'],
      kind: 'working_capital_asset',
    },
    {
      label: '存货的减少（减：增加）',
      patterns: ['1401', '1402', '1403', '1405'],
      kind: 'working_capital_asset',
    },
    {
      label: '经营性应付项目的增加（减：减少）',
      patterns: ['2201', '2202', '2203', '2211', '2221'],
      kind: 'working_capital_liability',
    },
    {
      label: '其他流动负债的变动',
      patterns: ['2231', '2232', '2241'],
      kind: 'working_capital_liability',
    },
  ],
}

/** 政府会计制度 — 以本期盈余为起点 */
export const GOVERNMENT_INDIRECT: IndirectMethodMapping = {
  standard: 'government',
  profitLabel: '本期盈余',
  adjustments: [
    { label: '加：折旧及摊销', patterns: ['1602', '1603', '1702', '1703'], kind: 'non_cash_add' },
    {
      label: '应收及预付款项的减少（减：增加）',
      patterns: ['1211', '1212', '1214', '1218'],
      kind: 'working_capital_asset',
    },
    {
      label: '存货的减少（减：增加）',
      patterns: ['1301', '1401'],
      kind: 'working_capital_asset',
    },
    {
      label: '应付及预收款项的增加（减：减少）',
      patterns: ['2301', '2302', '2305', '2201', '2202'],
      kind: 'working_capital_liability',
    },
  ],
}

export function getIndirectMethodMapping(standard: StaticReportStandard): IndirectMethodMapping {
  return standard === 'small_business' ? SMALL_BUSINESS_INDIRECT : GOVERNMENT_INDIRECT
}
