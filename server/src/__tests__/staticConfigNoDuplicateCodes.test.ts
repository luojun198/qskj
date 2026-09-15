import { describe, expect, it } from 'vitest'
import { getIncomeStatementConfig } from '../services/staticReportConfig.js'
import { getCashFlowMappingConfig } from '../config/staticCashFlowMappings.js'

/**
 * FIX-141：静态报表配置中任一科目编码只能属于一个组，
 * 否则 cashFlowIndirectMethod / reportCashFlow 逐组累加时会把同一科目算两遍。
 */
const STANDARDS = ['small_business', 'enterprise', 'government'] as const

function findDuplicates(groups: Record<string, string[]>[]) {
  const seen = new Map<string, string[]>()
  for (const group of groups) {
    for (const [name, codes] of Object.entries(group)) {
      for (const code of codes) {
        const owners = seen.get(code) || []
        owners.push(name)
        seen.set(code, owners)
      }
    }
  }
  return [...seen.entries()].filter(([, owners]) => owners.length > 1)
}

describe('静态报表配置：编码跨组唯一', () => {
  for (const standard of STANDARDS) {
    it(`${standard} 损益配置 revenueGroups + expenseGroups 无重复编码`, () => {
      const cfg = getIncomeStatementConfig(standard)
      expect(findDuplicates([cfg.revenueGroups, cfg.expenseGroups])).toEqual([])
    })

    it(`${standard} 现金流量映射：流入侧（贷方）与流出侧（借方）各自无重复编码`, () => {
      const cfg = getCashFlowMappingConfig(standard)
      expect(
        findDuplicates([cfg.operatingInflowCodes, cfg.investingInflowCodes, cfg.financingInflowCodes])
      ).toEqual([])
      expect(
        findDuplicates([cfg.operatingOutflowCodes, cfg.investingOutflowCodes, cfg.financingOutflowCodes])
      ).toEqual([])
    })
  }

  it('新准则现金流映射不残留小企业编码', () => {
    const cfg = getCashFlowMappingConfig('enterprise')
    const all = Object.values({ ...cfg.investingInflowCodes, ...cfg.financingOutflowCodes }).flat()
    expect(all).not.toContain('5111')
    expect(all).not.toContain('5603')
    expect(all).toContain('6111')
    expect(all).toContain('6603')
  })
})
