import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyAssetChange } from '../services/assetChange.js'
import { disposeAsset } from '../services/assetDisposal.js'
import { createInventory, completeInventory } from '../services/assetInventory.js'
import { previewDepreciation } from '../services/fixedAssetDepreciation.js'
import { queryChangeSummary, queryChangeDetail, queryCategorySummary, queryDeprSummary, queryDeprDetail, queryDeprForecast } from '../services/assetReportQuery.js'
import { createAssetTestDb, insertAsset, insertAccounts, insertAssetDicts, SET_ID } from './helpers/assetTestDb.js'

/**
 * 2026-09-17 综合评审批次 E（业务规则）：
 *  - P1-18 已提满资产增值后自动顺延使用月数
 *  - P1-19 增减变动表按变动流水取数，历史期间不再被追溯改写
 *  - P1-20 变动 / 处置 / 盘点不得填未来期间
 */

const nextMonthDate = () => {
  const d = new Date()
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 15)
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-15`
}

describe('固定资产业务规则（批次 E）', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createAssetTestDb()
    insertAssetDicts(db)
    insertAccounts(db, [['1601', '固定资产'], ['1602', '累计折旧'], ['1604', '在建工程'], ['1606', '固定资产清理'], ['6901', '待处理财产损溢'], ['660201', '制造费用—折旧']])
  })
  afterEach(() => db.close())

  it('P1-18：已提满资产原值增加后自动顺延使用月数，折旧预览重新出现', () => {
    // 原值 100000 / 残值 5000 / 60 月已提满（累折 95000 / 净值 5000）
    insertAsset(db, {
      asset_no: 'F1', original_value: 100000, salvage_rate: 0.05, salvage_value: 5000,
      use_months: 60, depr_months_done: 60, accum_depr: 95000, net_value: 5000, start_depr_date: '2020-01-15',
    })
    expect(previewDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 6 }).map((l: any) => l.asset_no)).not.toContain('F1')
    const r = applyAssetChange({ db, accountSetId: SET_ID, assetId: 'fa-F1', kind: 'original_value', changeDate: '2026-06-10', payload: { amount: 20000 }, operatorName: 't' })
    // 应折 25000 − 6000 = 19000；原月折旧 (100000−5000)/60 = 1583.33 → 12 个月
    expect(r.extendedMonths).toBe(12)
    const card = db.prepare("SELECT use_months, net_value, salvage_value FROM fixed_asset WHERE asset_no='F1'").get() as any
    expect(card).toEqual({ use_months: 72, net_value: 25000, salvage_value: 6000 })
    const lines = previewDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 6 })
    const line = lines.find((l: any) => l.asset_no === 'F1') as any
    expect(line).toBeTruthy()
    expect(line.month_depr).toBeCloseTo(19000 / 12, 2)
  })

  it('P1-20：变动 / 处置 / 盘点日期不得晚于当前月份', () => {
    insertAsset(db, { asset_no: 'F2', original_value: 1000, salvage_value: 50, use_months: 12, net_value: 1000, start_depr_date: '2026-01-15' })
    const future = nextMonthDate()
    expect(() =>
      applyAssetChange({ db, accountSetId: SET_ID, assetId: 'fa-F2', kind: 'original_value', changeDate: future, payload: { amount: 100 }, operatorName: 't' })
    ).toThrow(/变动日期不能晚于当前月份/)
    expect(() =>
      disposeAsset({ db, accountSetId: SET_ID, assetId: 'fa-F2', changeTypeCode: null, scrapDate: future, scrapReason: '报废' })
    ).toThrow(/处置日期不能晚于当前月份/)
    const invId = createInventory({ db, accountSetId: SET_ID, name: '未来盘点', inventoryDate: future })
    expect(() => completeInventory({ db, accountSetId: SET_ID, inventoryId: invId })).toThrow(/盘点日期不能晚于当前月份/)
    expect((db.prepare("SELECT original_value FROM fixed_asset WHERE asset_no='F2'").get() as any).original_value).toBe(1000)
  })

  it('P1-19：增减变动表按变动流水取数，登记原值增加后历史期间的期初不变、当期计入增加', () => {
    insertAsset(db, { asset_no: 'G1', original_value: 10000, salvage_value: 500, use_months: 60, net_value: 10000, acquire_date: '2026-01-10', start_depr_date: '2026-01-15' })
    insertAsset(db, { asset_no: 'G2', original_value: 3000, salvage_value: 150, use_months: 60, net_value: 3000, acquire_date: '2026-08-05', start_depr_date: '2026-08-15' })
    // 8 月：期初只有 G1（10000），本期增加 G2（3000）
    let aug = queryChangeSummary({ db, accountSetId: SET_ID, year: 2026, month: 8 })
    expect(aug).toHaveLength(1)
    expect(aug[0]).toMatchObject({ opening_count: 1, opening_original: 10000, increase_count: 1, increase_amount: 3000, decrease_amount: 0, closing_count: 2, closing_original: 13000 })

    // 9 月登记 G1 原值增加 5000（当前原值 15000）
    applyAssetChange({ db, accountSetId: SET_ID, assetId: 'fa-G1', kind: 'original_value', changeDate: '2026-09-10', payload: { amount: 5000 }, operatorName: 't' })
    // 回查 8 月：期初仍是 10000（此前用卡片当前原值会变成 15000）
    aug = queryChangeSummary({ db, accountSetId: SET_ID, year: 2026, month: 8 })
    expect(aug[0]).toMatchObject({ opening_original: 10000, closing_original: 13000 })
    // 9 月：期初 13000、本期增加 5000（原值变动，卡片数不变）、期末 18000
    const sep = queryChangeSummary({ db, accountSetId: SET_ID, year: 2026, month: 9 })
    expect(sep[0]).toMatchObject({ opening_count: 2, opening_original: 13000, increase_count: 0, increase_amount: 5000, closing_count: 2, closing_original: 18000 })
    const detail = queryChangeDetail({ db, accountSetId: SET_ID, year: 2026, month: 9, changeType: 'increase' })
    expect(detail).toEqual([expect.objectContaining({ asset_no: 'G1', original_value: 5000, change_item: '原值增减' })])

    // 9 月处置 G2：减少 3000，期末 15000（评审 P1-9：处置月须已计提）
    db.prepare("INSERT INTO fixed_asset_depr (id, account_set_id, asset_no, year, month, month_depr, accum_depr) VALUES ('d-g2', ?, 'G2', 2026, 9, 0, 0)").run(SET_ID)
    disposeAsset({ db, accountSetId: SET_ID, assetId: 'fa-G2', changeTypeCode: null, scrapDate: '2026-09-20', scrapReason: '出售' })
    const sep2 = queryChangeSummary({ db, accountSetId: SET_ID, year: 2026, month: 9 })
    expect(sep2[0]).toMatchObject({ decrease_count: 1, decrease_amount: 3000, closing_count: 1, closing_original: 15000 })
    // 分类汇总默认不含已处置
    expect(queryCategorySummary({ db, accountSetId: SET_ID })[0].asset_count).toBe(1)
    expect(queryCategorySummary({ db, accountSetId: SET_ID, includeDisposed: true })[0].asset_count).toBe(2)
  })
})

describe('批次 F：剩余 P2', () => {
  it('P2-18：无取得日期的卡片明细账按起折日期出购入行，购入原值为变动前原值，负净值不截断', async () => {
    const { queryAssetLedger } = await import('../services/assetReportQuery.js')
    const db = createAssetTestDb()
    insertAssetDicts(db)
    insertAccounts(db, [['1601', '固定资产'], ['1602', '累计折旧'], ['1604', '在建工程']])
    insertAsset(db, { asset_no: 'L1', original_value: 1500, salvage_value: 0, use_months: 12, net_value: 1500, acquire_date: null, start_depr_date: '2026-03-15', accum_depr: 0 })
    applyAssetChange({ db, accountSetId: SET_ID, assetId: 'fa-L1', kind: 'original_value', changeDate: '2026-06-10', payload: { amount: 500 }, operatorName: 't' })
    const ledger = queryAssetLedger({ db, accountSetId: SET_ID, assetId: 'fa-L1' })!
    expect(ledger.entries[0]).toMatchObject({ type: 'acquire', date: '2026-03-15', original_change: 1500, original_after: 1500 })
    expect(ledger.entries[1]).toMatchObject({ type: 'change', original_after: 2000, net_value_after: 2000 })
    // 人为把累折写超过原值：净值应为负而不是 0
    db.prepare("INSERT INTO fixed_asset_depr (id, account_set_id, asset_no, year, month, month_depr, accum_depr) VALUES ('d1', ?, 'L1', 2026, 7, 2500, 2500)").run(SET_ID)
    const ledger2 = queryAssetLedger({ db, accountSetId: SET_ID, assetId: 'fa-L1' })!
    expect(ledger2.entries.at(-1)!.net_value_after).toBe(-500)
    db.close()
  })
})

describe('评审 P2：折旧汇总按该期期末原值 / 减值', () => {
  it('后续原值变动与减值不改写历史月份的原值、净值', () => {
    const db = createAssetTestDb()
    insertAssetDicts(db)
    insertAccounts(db, [['1601', '固定资产'], ['1602', '累计折旧'], ['1603', '固定资产减值准备'], ['6701', '资产减值损失']])
    insertAsset(db, { asset_no: 'H1', original_value: 12000, salvage_value: 0, use_months: 60, net_value: 12000, accum_depr: 200, start_depr_date: '2026-01-15' })
    db.prepare("INSERT INTO fixed_asset_depr (id, account_set_id, asset_no, year, month, dept_code, month_depr, accum_depr) VALUES ('d1', ?, 'H1', 2026, 2, 'D1', 200, 200)").run(SET_ID)
    // 9 月原值 +3000、减值 500
    applyAssetChange({ db, accountSetId: SET_ID, assetId: 'fa-H1', kind: 'original_value', changeDate: '2026-09-10', payload: { amount: 3000 }, operatorName: 't' })
    applyAssetChange({ db, accountSetId: SET_ID, assetId: 'fa-H1', kind: 'impairment', changeDate: '2026-09-12', payload: { amount: 500 }, operatorName: 't' })

    const [row] = queryDeprSummary({ db, accountSetId: SET_ID, year: 2026, month: 2, groupBy: 'category' })
    expect(row.total_original).toBe(12000)
    expect(row.total_net_value).toBe(11800)
    const [detail] = queryDeprDetail({ db, accountSetId: SET_ID, year: 2026, month: 2, groupBy: 'dept', groupCode: 'D1' })
    expect(detail).toMatchObject({ original_value: 12000, net_value: 11800 })
    // 第六份反馈：按资产逐项列出（不按类别 / 部门过滤）
    const all = queryDeprDetail({ db, accountSetId: SET_ID, year: 2026, month: 2, groupBy: 'asset' })
    expect(all.map(r => r.asset_no)).toEqual(['H1'])
    expect(all[0]).toMatchObject({ month_depr: 200, accum_depr: 200, net_value: 11800 })
    db.close()
  })
})

describe('评审 P2：折旧预测与计提预览同口径', () => {
  it('发生原值变动（未来适用法）后，预测当月折旧额 = 预览折旧额', () => {
    const db = createAssetTestDb()
    insertAssetDicts(db)
    insertAccounts(db, [['1601', '固定资产'], ['1602', '累计折旧']])
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    insertAsset(db, { asset_no: 'K1', original_value: 12000, salvage_value: 0, use_months: 24, depr_months_done: 6, accum_depr: 3000, net_value: 9000, start_depr_date: '2020-01-15' })
    // 净值改为 7200 并登记一条折旧要素变动 → 未来适用法：剩余 18 个月摊 7200 = 400（全期口径会是 12000/24 = 500）
    db.prepare("UPDATE fixed_asset SET net_value=7200, accum_depr=4800 WHERE asset_no='K1'").run()
    db.prepare("INSERT INTO fixed_asset_change (id, account_set_id, asset_no, change_date, change_item, change_kind, amount) VALUES ('c1', ?, 'K1', '2020-03-01', '折旧要素', 'depr_factor', 0)").run(SET_ID)

    const preview = previewDepreciation({ db, accountSetId: SET_ID, year: y, month: m })
    const forecast = queryDeprForecast({ db, accountSetId: SET_ID, months: 1 })
    expect(preview[0].month_depr).toBe(400) // 7200 / 18
    expect(forecast[0]).toMatchObject({ year: y, month: m })
    expect(forecast[0].details[0].month_depr).toBe(preview[0].month_depr)
    db.close()
  })
})
