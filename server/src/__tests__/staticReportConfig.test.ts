import { describe, expect, it } from 'vitest'
import {
  detectStaticReportStandard,
  getBalanceSheetConfig,
  getCashFlowConfig,
  getIncomeStatementConfig,
} from '../services/staticReportConfig.js'

function createMockDb(rows: Array<{ code: string; name: string }>) {
  return {
    prepare: () => ({
      all: () => rows,
    }),
  } as any
}

describe('staticReportConfig', () => {
  it('应识别小企业会计准则科目体系', () => {
    const db = createMockDb([
      { code: '5001', name: '主营业务收入' },
      { code: '5401', name: '主营业务成本' },
      { code: '3103', name: '本年利润' },
    ])

    expect(detectStaticReportStandard(db, 'account-set-1')).toBe('small_business')
  })

  it('应识别政府会计制度科目体系', () => {
    const db = createMockDb([
      { code: '4001', name: '财政拨款收入' },
      { code: '5001', name: '业务活动费用' },
      { code: '3001', name: '累计盈余' },
    ])

    expect(detectStaticReportStandard(db, 'account-set-1')).toBe('government')
  })

  it('应识别新企业会计准则科目体系', () => {
    const db = createMockDb([
      { code: '6001', name: '主营业务收入' },
      { code: '6401', name: '主营业务成本' },
      { code: '6602', name: '管理费用' },
    ])

    expect(detectStaticReportStandard(db, 'account-set-1')).toBe('enterprise')
  })

  it('政府预算科目 6601/6602 不应误判为企业费用科目', () => {
    const db = createMockDb([
      { code: '4001', name: '财政拨款收入' },
      { code: '6601', name: '非同级财政拨款预算收入' },
      { code: '6602', name: '投资预算收益' },
    ])
    expect(detectStaticReportStandard(db, 'account-set-1')).toBe('government')
  })

  it('新企业会计准则利润表配置应使用 6 字头收入与 64/66 字头成本费用', () => {
    const incomeStatement = getIncomeStatementConfig('enterprise')
    expect(incomeStatement.revenueGroups.主营业务收入).toEqual(['6001'])
    expect(incomeStatement.revenueGroups.利息收入).toEqual(['6011'])
    expect(incomeStatement.expenseGroups.主营业务成本).toEqual(['6401'])
    expect(incomeStatement.expenseGroups.管理费用).toEqual(['6602'])
    expect(incomeStatement.expenseGroups.资产减值损失).toEqual(['6701'])
  })

  it('政府会计制度收入费用科目应对齐 2019 政府会计制度', () => {
    const incomeStatement = getIncomeStatementConfig('government')
    expect(incomeStatement.revenueGroups.捐赠收入).toEqual(['4603', '4601'])
    expect(incomeStatement.revenueGroups.投资收益).toEqual(['4602'])
    expect(incomeStatement.revenueGroups.利息收入).toEqual(['4604', '4701'])
    expect(incomeStatement.revenueGroups.其他收入).toEqual(['4609', '4901'])
    expect(incomeStatement.expenseGroups.资产处置费用).toEqual(['5301', '5901'])
    expect(incomeStatement.expenseGroups.上缴上级费用).toEqual(['5401', '5301'])
    expect(incomeStatement.expenseGroups.所得税费用).toEqual(['5801', '5501'])
    expect(incomeStatement.expenseGroups.利息费用).toEqual(['5701'])
    expect(incomeStatement.expenseGroups.其他费用).toEqual(['5901', '5601'])
  })

  it('小企业静态报表配置不应使用政府报表的收入费用口径', () => {
    const balanceSheet = getBalanceSheetConfig('small_business')
    const incomeStatement = getIncomeStatementConfig('small_business')
    const cashFlow = getCashFlowConfig('small_business')

    expect(incomeStatement.revenueGroups.主营业务收入).toEqual(['5001'])
    expect(incomeStatement.expenseGroups.主营业务成本).toEqual(['5401'])
    expect(incomeStatement.expenseGroups.业务活动费用).toBeUndefined()
    expect(balanceSheet.equityGroups.所有者权益).toContain('3103')
    expect(cashFlow.operatingInflowCodes['销售商品和提供劳务收到的现金']).toContain('5001')
    expect(cashFlow.investingInflowCodes['取得投资收益收到的现金']).toEqual(['5111'])
    expect(cashFlow.investingOutflowCodes['投资支付的现金']).toContain('1501')
    expect(cashFlow.operatingInflowCodes['收到的税费返还']).not.toEqual(
      cashFlow.operatingInflowCodes['收到其他与经营活动有关的现金']
    )
  })

  it('政府会计制度现金流量表应包含投资筹资分项行次', () => {
    const cashFlow = getCashFlowConfig('government')
    expect(cashFlow.operatingInflowCodes['财政拨款收到的现金']).toEqual(['4001'])
    expect(cashFlow.investingInflowCodes['取得投资收益收到的现金']).toContain('4602')
    expect(cashFlow.investingInflowCodes['取得投资收益收到的现金']).toContain('4701')
    expect(cashFlow.investingOutflowCodes['对外投资支付的现金']).toContain('1501')
    expect(cashFlow.financingInflowCodes['财政资本性项目拨款收到的现金']).toEqual(['4001'])
  })
})
