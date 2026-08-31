import type { Database } from 'better-sqlite3'
import { getCashFlowMappingConfig } from '../config/staticCashFlowMappings.js'
import {
  getAccountingStandardParam,
} from './accountingStandard.js'

export type StaticReportStandard = 'government' | 'small_business' | 'enterprise'
export type ResolvedAccountingStandard = StaticReportStandard | 'custom'

export interface BalanceSheetGroup {
  codes: string[]
  deductCodes?: string[]
}

export interface BalanceSheetConfig {
  standard: StaticReportStandard
  standardName: string
  assetGroups: Record<string, BalanceSheetGroup>
  liabilityGroups: Record<string, string[]>
  equityGroups: Record<string, string[]>
}

export interface IncomeStatementConfig {
  standard: StaticReportStandard
  standardName: string
  revenueGroups: Record<string, string[]>
  expenseGroups: Record<string, string[]>
}

export interface CashFlowConfig {
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

type AccountProbe = {
  code: string
  name: string
}

/**
 * FIX-004 / P0-8：按会计准则返回损益类科目编码前缀，用于年结前校验损益必须已结转。
 *
 * - enterprise（企业会计准则）：6xxx 损益类（6001 主营业务收入、6601 销售费用、6602 管理费用、6603 财务费用、6701 资产减值损失 等）
 * - small_business（小企业会计准则）：5xxx 损益类（5001 主营业务收入、5401 主营业务成本、5501 营业费用 等）
 * - government（政府会计制度，财务会计口径）：4xxx 收入类 + 5xxx 费用类
 *
 * 注意：政府会计准则下"业务活动费用"科目编码 5xxx 与"成本"在企业准则下的 5xxx 冲突，
 *       因此该函数必须依赖 detectStaticReportStandard 的识别结果。
 */
export function getProfitLossAccountCodePrefixes(
  standard: StaticReportStandard
): string[] {
  switch (standard) {
    case 'enterprise':
      return ['6']
    case 'small_business':
      return ['5']
    case 'government':
      return ['4', '5']
    default:
      return ['6']
  }
}

export function detectStaticReportStandard(
  db: Database,
  accountSetId: string
): StaticReportStandard {
  const rows = db
    .prepare(
      `
      SELECT code, name
      FROM accounts
      WHERE account_set_id = ?
        AND code IN ('3001','3103','4001','4101','5001','5401','6001','6401','6601','6602')
    `
    )
    .all(accountSetId) as AccountProbe[]

  const hasAccount = (code: string, namePart?: string) =>
    rows.some(row => row.code === code && (!namePart || row.name.includes(namePart)))

  if (
    hasAccount('6001', '主营') ||
    hasAccount('6401', '主营') ||
    hasAccount('6601', '销售费用') ||
    hasAccount('6602', '管理费用')
  ) {
    return 'enterprise'
  }

  if (
    hasAccount('5001', '主营业务收入') ||
    hasAccount('5401', '主营业务成本') ||
    hasAccount('3103', '本年利润') ||
    hasAccount('3001', '实收资本')
  ) {
    return 'small_business'
  }

  if (
    hasAccount('4001', '财政拨款收入') ||
    hasAccount('4101', '事业收入') ||
    hasAccount('5001', '业务活动费用') ||
    hasAccount('3001', '累计盈余')
  ) {
    return 'government'
  }

  return 'government'
}

export function resolveAccountingStandard(
  db: Database,
  accountSetId: string
): ResolvedAccountingStandard {
  const param = getAccountingStandardParam(db, accountSetId)
  if (param === 'custom') return 'custom'
  if (param === 'auto') return detectStaticReportStandard(db, accountSetId)
  return param
}

export function getBalanceSheetConfig(standard: StaticReportStandard): BalanceSheetConfig {
  if (standard === 'small_business') {
    return {
      standard,
      standardName: '小企业会计准则',
      assetGroups: {
        流动资产: {
          codes: [
            '1001',
            '1002',
            '1012',
            '1101',
            '1121',
            '1122',
            '1123',
            '1131',
            '1132',
            '1221',
            '1401',
            '1402',
            '1403',
            '1405',
            '1408',
            '1411',
            '1421',
          ],
          deductCodes: ['1404', '1407'],
        },
        长期投资: {
          codes: ['1501', '1511'],
        },
        固定资产: {
          codes: ['1601'],
          deductCodes: ['1602'],
        },
        在建工程及工程物资: {
          codes: ['1604', '1605', '1606'],
        },
        生产性生物资产: {
          codes: ['1621'],
          deductCodes: ['1622'],
        },
        无形资产: {
          codes: ['1701'],
          deductCodes: ['1702'],
        },
        其他非流动资产: {
          codes: ['1801', '1901'],
        },
      },
      liabilityGroups: {
        流动负债: [
          '2001',
          '2201',
          '2202',
          '2203',
          '2211',
          '2221',
          '2231',
          '2232',
          '2241',
          '2401',
        ],
        非流动负债: ['2501', '2701'],
      },
      equityGroups: {
        所有者权益: ['3001', '3002', '3101', '3103', '3104'],
      },
    }
  }

  return {
    standard,
    standardName: '政府会计制度',
    assetGroups: {
      流动资产: {
        codes: [
          '1001',
          '1002',
          '1011',
          '1012',
          '1021',
          '1101',
          '1211',
          '1212',
          '1214',
          '1301',
          '1401',
          '1501',
          '1511',
        ],
      },
      非流动资产: {
        codes: ['1218', '1611', '1613', '1891', '1901'],
      },
      固定资产: {
        codes: ['1601'],
        deductCodes: ['1602', '1603'],
      },
      公共基础设施: {
        codes: ['1801'],
        deductCodes: ['1802'],
      },
      无形资产: {
        codes: ['1701'],
        deductCodes: ['1702', '1703'],
      },
      政府储备物资: {
        codes: ['1803'],
      },
      文物文化资产: {
        codes: ['1811'],
      },
      保障性住房: {
        codes: ['1821'],
      },
    },
    liabilityGroups: {
      流动负债: [
        '2001',
        '2101',
        '2102',
        '2103',
        '2105',
        '2106',
        '2201',
        '2202',
        '2301',
        '2302',
        '2305',
        '2401',
        '2901',
      ],
      非流动负债: ['2501', '2502', '2601'],
    },
    equityGroups: {
      净资产: ['3001', '3101', '3201', '3301', '3302', '3401', '3501'],
    },
  }
}

export function getIncomeStatementConfig(standard: StaticReportStandard): IncomeStatementConfig {
  if (standard === 'enterprise') {
    return {
      standard,
      standardName: '新企业会计准则',
      revenueGroups: {
        主营业务收入: ['6001'],
        其他业务收入: ['6051'],
        利息收入: ['6011'],
        公允价值变动损益: ['6101'],
        投资收益: ['6111'],
        营业外收入: ['6301'],
      },
      expenseGroups: {
        主营业务成本: ['6401'],
        其他业务成本: ['6402'],
        税金及附加: ['6403'],
        销售费用: ['6601'],
        管理费用: ['6602'],
        财务费用: ['6603'],
        资产减值损失: ['6701'],
        营业外支出: ['6711'],
        所得税费用: ['6801'],
      },
    }
  }

  if (standard === 'small_business') {
    return {
      standard,
      standardName: '小企业会计准则',
      revenueGroups: {
        主营业务收入: ['5001'],
        其他业务收入: ['5051'],
        投资收益: ['5111'],
        营业外收入: ['5301'],
      },
      expenseGroups: {
        主营业务成本: ['5401'],
        其他业务成本: ['5402'],
        税金及附加: ['5403'],
        销售费用: ['5601'],
        管理费用: ['5602'],
        财务费用: ['5603'],
        营业外支出: ['5711'],
        所得税费用: ['5801'],
        以前年度损益调整: ['5901'],
      },
    }
  }

  return {
    standard,
    standardName: '政府会计制度',
    revenueGroups: {
      财政拨款收入: ['4001'],
      事业收入: ['4101'],
      上级补助收入: ['4201'],
      附属单位上缴收入: ['4301'],
      经营收入: ['4401'],
      非同级财政拨款收入: ['4601'],
      投资收益: ['4602'],
      // 4603 为官方编码；4601/4701/4801/4901 为旧版账套常见编码，按科目名称匹配
      捐赠收入: ['4603', '4601'],
      利息收入: ['4604', '4701'],
      租金收入: ['4605', '4801'],
      其他收入: ['4609', '4901'],
    },
    expenseGroups: {
      业务活动费用: ['5001'],
      单位管理费用: ['5101'],
      经营费用: ['5201'],
      // 5301–5901 段：官方编码 + 旧版账套常见编码（按科目名称区分）
      资产处置费用: ['5301', '5901'],
      上缴上级费用: ['5401', '5301'],
      对附属单位补助费用: ['5501', '5401'],
      所得税费用: ['5801', '5501'],
      利息费用: ['5701'],
      其他费用: ['5901', '5601'],
    },
  }
}

export function getCashFlowConfig(standard: StaticReportStandard): CashFlowConfig {
  const mapped = getCashFlowMappingConfig(standard)
  return {
    standard: mapped.standard,
    standardName: mapped.standardName,
    cashCodes: mapped.cashCodes,
    operatingInflowCodes: mapped.operatingInflowCodes,
    operatingOutflowCodes: mapped.operatingOutflowCodes,
    investingInflowCodes: mapped.investingInflowCodes,
    investingOutflowCodes: mapped.investingOutflowCodes,
    financingInflowCodes: mapped.financingInflowCodes,
    financingOutflowCodes: mapped.financingOutflowCodes,
  }
}

export function collectBalanceSheetCodes(config: BalanceSheetConfig): string[] {
  const codes = new Set<string>()

  for (const group of Object.values(config.assetGroups)) {
    group.codes.forEach(code => codes.add(code))
    group.deductCodes?.forEach(code => codes.add(code))
  }
  for (const groupCodes of Object.values(config.liabilityGroups)) {
    groupCodes.forEach(code => codes.add(code))
  }
  for (const groupCodes of Object.values(config.equityGroups)) {
    groupCodes.forEach(code => codes.add(code))
  }

  return [...codes]
}

export function collectIncomeStatementCodes(config: IncomeStatementConfig): string[] {
  const codes = new Set<string>()
  for (const groupCodes of Object.values(config.revenueGroups)) {
    groupCodes.forEach(code => codes.add(code))
  }
  for (const groupCodes of Object.values(config.expenseGroups)) {
    groupCodes.forEach(code => codes.add(code))
  }
  return [...codes]
}

export function collectCashFlowCodes(config: CashFlowConfig): string[] {
  const codes = new Set<string>(config.cashCodes)
  for (const groups of [
    config.operatingInflowCodes,
    config.operatingOutflowCodes,
    config.investingInflowCodes,
    config.investingOutflowCodes,
    config.financingInflowCodes,
    config.financingOutflowCodes,
  ]) {
    for (const groupCodes of Object.values(groups)) {
      groupCodes.forEach(code => codes.add(code))
    }
  }
  return [...codes]
}
