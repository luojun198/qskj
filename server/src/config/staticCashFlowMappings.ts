import type { StaticReportStandard } from '../services/staticReportConfig.js'

/**
 * 静态现金流量表行次 → 科目编码前缀映射（估算口径）
 * 取数时按「编码前缀」展开账套内所有子科目，再汇总借贷发生额。
 */
export type CashFlowMappingConfig = {
  standard: StaticReportStandard
  standardName: string
  cashCodes: string[]
  operatingInflowCodes: Record<string, string[]>
  operatingOutflowCodes: Record<string, string[]>
  investingInflowCodes: Record<string, string[]>
  investingOutflowCodes: Record<string, string[]>
  financingInflowCodes: Record<string, string[]>
  financingOutflowCodes: Record<string, string[]>
}

/** 小企业会计准则 — 参考 CAS 31 小企业应用指南常用行次 */
export const SMALL_BUSINESS_CASH_FLOW: CashFlowMappingConfig = {
  standard: 'small_business',
  standardName: '小企业会计准则',
  cashCodes: ['1001', '1002', '1012'],
  operatingInflowCodes: {
    '销售商品和提供劳务收到的现金': ['5001', '5051'],
    '收到的税费返还': ['2221'],
    '收到其他与经营活动有关的现金': ['5301'],
  },
  operatingOutflowCodes: {
    '购买商品和接受劳务支付的现金': ['5401', '5402', '5403'],
    '支付给职工以及为职工支付的现金': ['5601', '5602'],
    '支付的各项税费': ['5403', '5801'],
    '支付其他与经营活动有关的现金': ['5603', '5711'],
  },
  investingInflowCodes: {
    '收回短期投资、长期债券投资和长期股权投资收到的现金': ['1101', '1501', '1511'],
    '取得投资收益收到的现金': ['5111'],
    '处置固定资产、无形资产和其他长期资产收回的现金': ['1601', '1701'],
  },
  investingOutflowCodes: {
    '购建固定资产、无形资产和其他长期资产支付的现金': ['1601', '1604', '1605', '1701'],
    '投资支付的现金': ['1101', '1501', '1511'],
  },
  financingInflowCodes: {
    '取得借款收到的现金': ['2001', '2501', '2701'],
    '吸收投资者投资收到的现金': ['3001', '3103'],
  },
  financingOutflowCodes: {
    '偿还借款本金支付的现金': ['2001', '2501', '2701'],
    '分配利润、偿付利息支付的现金': ['3103', '5603'],
  },
}

/** 政府会计制度 — 参考 optional 现金流量表日常/投资/筹资活动分类 */
export const GOVERNMENT_CASH_FLOW: CashFlowMappingConfig = {
  standard: 'government',
  standardName: '政府会计制度',
  cashCodes: ['1001', '1002', '1012'],
  operatingInflowCodes: {
    '财政拨款收到的现金': ['4001'],
    '事业活动收到的除财政拨款以外的现金': ['4101', '4201', '4301', '4401'],
    '经营收入收到的现金': ['4401'],
    '其他日常活动收到的现金': ['4601', '4602', '4603', '4604', '4605', '4609', '4701', '4801', '4901'],
  },
  operatingOutflowCodes: {
    '购买商品和接受劳务支付的现金': ['5001', '5201'],
    '支付给职工以及为职工支付的现金': ['5001', '5101'],
    '支付各项税费': ['5801', '5501'],
    '支付其他日常活动现金': ['5101', '5301', '5401', '5501', '5601', '5901'],
  },
  investingInflowCodes: {
    '收回投资收到的现金': ['1501', '1511', '1021'],
    '取得投资收益收到的现金': ['4602', '4601', '4701'],
    '处置固定资产和无形资产收回的现金': ['1601', '1701'],
  },
  investingOutflowCodes: {
    '购建固定资产支付的现金': ['1601', '1611'],
    '购建无形资产支付的现金': ['1701'],
    '对外投资支付的现金': ['1501', '1511'],
  },
  financingInflowCodes: {
    '取得借款收到的现金': ['2001', '2501'],
    '财政资本性项目拨款收到的现金': ['4001'],
  },
  financingOutflowCodes: {
    '偿还借款支付的现金': ['2001', '2501'],
    '偿付利息支付的现金': ['5901', '5601'],
  },
}

export function getCashFlowMappingConfig(standard: StaticReportStandard): CashFlowMappingConfig {
  if (standard === 'small_business') return SMALL_BUSINESS_CASH_FLOW
  if (standard === 'enterprise') {
    return {
      ...SMALL_BUSINESS_CASH_FLOW,
      standard: 'enterprise',
      standardName: '新企业会计准则',
      operatingInflowCodes: {
        '销售商品和提供劳务收到的现金': ['6001', '6051'],
        '收到的税费返还': ['2221'],
        '收到其他与经营活动有关的现金': ['6301'],
      },
      operatingOutflowCodes: {
        '购买商品和接受劳务支付的现金': ['6401', '6402', '6403'],
        '支付给职工以及为职工支付的现金': ['6601', '6602'],
        '支付的各项税费': ['6403', '6801'],
        '支付其他与经营活动有关的现金': ['6603', '6711'],
      },
    }
  }
  return GOVERNMENT_CASH_FLOW
}
