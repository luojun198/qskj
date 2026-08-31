import { validateStaticCashFlowReport } from './cashFlowReconciliation.js'

/**
 * 报表数据验证服务
 * 检查报表数据的合理性，提供异常提示和建议
 */

export interface ReportValidationResult {
  isValid: boolean
  warnings: ReportWarning[]
  suggestions: string[]
}

export interface ReportWarning {
  type: string
  message: string
  severity: 'error' | 'warning' | 'info'
}

/**
 * 验证资产负债表数据
 */
export function validateBalanceSheet(data: any): ReportValidationResult {
  const warnings: ReportWarning[] = []
  const suggestions: string[] = []

  // 检查资产负债是否平衡
  const totalAssets = data.totalAssets || 0
  const totalLiabilitiesAndEquity = (data.totalLiabilities || 0) + (data.totalEquity || 0)
  const difference = Math.abs(totalAssets - totalLiabilitiesAndEquity)

  if (difference > 0.01) {
    warnings.push({
      type: 'balance_mismatch',
      message: `资产负债不平衡，差额 ${difference.toFixed(2)} 元`,
      severity: 'error',
    })
    suggestions.push('请检查期初余额设置是否正确')
    suggestions.push('请检查所有凭证是否已记账')
    suggestions.push('请检查是否有未完成的结转操作')
  }

  // 检查负数项目
  if (data.items) {
    for (const item of data.items) {
      if (item.amount < -0.01) {
        warnings.push({
          type: 'negative_amount',
          message: `项目"${item.name}"金额为负数：${item.amount.toFixed(2)} 元`,
          severity: 'warning',
        })
      }
    }
  }

  return {
    isValid: warnings.filter(w => w.severity === 'error').length === 0,
    warnings,
    suggestions,
  }
}

/**
 * 验证利润表数据
 */
export function validateIncomeStatement(data: any): ReportValidationResult {
  const warnings: ReportWarning[] = []
  const suggestions: string[] = []

  // 检查收入支出计算
  const revenue = data.revenue || 0
  const expenses = data.expenses || 0
  const netIncome = data.netIncome || 0
  const calculatedNetIncome = revenue - expenses
  const difference = Math.abs(netIncome - calculatedNetIncome)

  if (difference > 0.01) {
    warnings.push({
      type: 'calculation_error',
      message: `净利润计算不正确，差额 ${difference.toFixed(2)} 元`,
      severity: 'error',
    })
    suggestions.push('请检查损益类科目的余额方向是否正确')
    suggestions.push('请检查是否已执行结转损益')
  }

  // 检查异常数据
  if (revenue < 0) {
    warnings.push({
      type: 'negative_revenue',
      message: `收入为负数：${revenue.toFixed(2)} 元`,
      severity: 'warning',
    })
    suggestions.push('请检查收入类科目的凭证方向是否正确')
  }

  if (expenses < 0) {
    warnings.push({
      type: 'negative_expenses',
      message: `费用为负数：${expenses.toFixed(2)} 元`,
      severity: 'warning',
    })
    suggestions.push('请检查费用类科目的凭证方向是否正确')
  }

  return {
    isValid: warnings.filter(w => w.severity === 'error').length === 0,
    warnings,
    suggestions,
  }
}

/**
 * 验证现金流量表数据（静态 API：operatingActivities / investingActivities / financingActivities）
 */
export function validateCashFlow(data: any): ReportValidationResult {
  return validateStaticCashFlowReport(data)
}

/**
 * 通用报表数据验证
 */
export function validateReportData(reportType: string, data: any): ReportValidationResult {
  switch (reportType) {
    case 'balance_sheet':
      return validateBalanceSheet(data)
    case 'income_statement':
      return validateIncomeStatement(data)
    case 'cash_flow':
      return validateCashFlow(data)
    default:
      return {
        isValid: true,
        warnings: [],
        suggestions: [],
      }
  }
}
