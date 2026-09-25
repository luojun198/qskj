import { describe, it, expect } from 'vitest'
import { acdAssetLife, acdAssetNetValue } from '../scripts/importAcdCashierAsset.js'

describe('ACD 固定资产卡片导入（评审 P0-1 / P0-2）', () => {
  it('synx 是年限、synx_y 是月数：use_months 取 synx_y', () => {
    // 卡片 2022030300：synx=3，synx_y=45，ACD 月折旧额 4558.13 =（215911.51 − 10795.58）/ 45
    expect(acdAssetLife('3', '45')).toEqual({ useMonths: 45, useYears: 3 })
    expect(acdAssetLife('0', '3')).toEqual({ useMonths: 3, useYears: 0 })
  })

  it('synx_y 缺失时按年限 × 12 兜底；两列都缺则为空', () => {
    expect(acdAssetLife('5', '')).toEqual({ useMonths: 60, useYears: 5 })
    expect(acdAssetLife('', '')).toEqual({ useMonths: null, useYears: null })
  })

  it('净值列有值时照用', () => {
    expect(acdAssetNetValue('1234.5', 5000, 100)).toEqual({ value: 1234.5, fallback: false })
    expect(acdAssetNetValue('0', 5000, 5000)).toEqual({ value: 0, fallback: false })
  })

  it('净值列为空时按「原值 − 累计折旧」补算，不再落 0', () => {
    expect(acdAssetNetValue('', 215911.51, 104775.6)).toEqual({ value: 111135.91, fallback: true })
    expect(acdAssetNetValue(undefined, 100, 0)).toEqual({ value: 100, fallback: true })
  })
})
