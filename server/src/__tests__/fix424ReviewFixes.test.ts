import { describe, expect, it } from 'vitest'
import { allocateAsProductCost } from '../routes/scmDoc.js'
import { deficitImpairmentPart } from '../services/assetInventory.js'
import { computeMonthDepr, type DeprAsset } from '../services/fixedAssetDepreciation.js'
import { getVoucherStatusAfterUnpost } from '../services/voucherPosting.js'

/** 2026-10-16 全项目评审复核后的代码修复（FIX-424 ~ FIX-430）里可做纯函数验证的部分 */

describe('SCM-2 组装单同组多行成品', () => {
  it('同一组号下两行成品按组内成品总数分摊，子件成本只入库一次', () => {
    const r = allocateAsProductCost(
      [{ product_group: 1, qty: 2 }, { product_group: 1, qty: 3 }],
      [{ product_group: 1, qty: 10, unitCost: 5 }], // 子件总成本 50
    )
    expect(r.byGroup).toBe(true)
    expect(r.unitCostByGroup.get(1)).toBe(10) // 50 / (2+3)
    // 两行合计入库成本 = 2×10 + 3×10 = 50，与子件出库相等
  })
})

describe('ASSET-1 盘亏结转减值准备', () => {
  it('账面减值 = 原值 − 累折 − 净值，按盘亏比例取份额', () => {
    expect(deficitImpairmentPart({ book_original_value: 1000, book_accum_depr: 300, book_net_value: 600, book_qty: 1, actual_qty: 0, actual_status: 'deficit' })).toBe(100)
    expect(deficitImpairmentPart({ book_original_value: 1000, book_accum_depr: 300, book_net_value: 600, book_qty: 4, actual_qty: 3, actual_status: 'deficit' })).toBe(25)
  })
  it('没有减值时为 0', () => {
    expect(deficitImpairmentPart({ book_original_value: 1000, book_accum_depr: 300, book_net_value: 700, book_qty: 1, actual_qty: 0 })).toBe(0)
  })
})

describe('ASSET-2 工作量法补尾差', () => {
  const base: DeprAsset = {
    id: 'a', asset_no: 'A1', asset_name: '设备', dept_code: null, purpose_code: null, depr_method: '2',
    original_value: 100, salvage_value: 0, use_months: 36, total_workload: 3, depr_months_done: 0, workload_done: 0,
    accum_depr: 0, net_value: 100, status_code: null, start_depr_date: null, expense_account: null, asset_account: null,
    depr_account_code: null,
  } as DeprAsset
  it('前两期各 33.33，最后一期补足到 33.34，提满后净值 = 残值', () => {
    expect(computeMonthDepr({ ...base }, 1)).toBe(33.33)
    expect(computeMonthDepr({ ...base, workload_done: 1, accum_depr: 33.33, net_value: 66.67 }, 1)).toBe(33.33)
    expect(computeMonthDepr({ ...base, workload_done: 2, accum_depr: 66.66, net_value: 33.34 }, 1)).toBe(33.34)
  })
})

describe('GL-5 反记账回到的状态', () => {
  it('必须审核：审核过的回已审核，直接记账的草稿回草稿', () => {
    expect(getVoucherStatusAfterUnpost(true, true)).toBe('audited')
    expect(getVoucherStatusAfterUnpost(true, false)).toBe('draft')
    expect(getVoucherStatusAfterUnpost(false, true)).toBe('draft')
  })
})
