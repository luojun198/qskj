/**
 * 第七份反馈第二批：固定资产
 * - 折旧查询：年月范围、条件筛选、折旧为零不显示、带出规格 / 参考编号 / 月工作量
 * - 卡片补充字段（v169）：导入写入规格型号 / 参考编号 / 制造厂家 / 制造日期；卡片修改白名单
 */
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { queryDeprRecords } from '../services/assetDeprQuery.js'
import { ASSET_IMPORT_COLUMNS, batchImportAssets } from '../services/assetBatchImport.js'
import { buildAssetCardUpdate } from '../services/assetCard.js'
import { up as assetCardExtraFieldsUp } from '../db/migrations/20261017_asset_card_extra_fields.js'
import { createAssetTestDb, insertAsset, insertAssetDicts, SET_ID } from './helpers/assetTestDb.js'

let db: Database.Database
beforeEach(() => {
  db = createAssetTestDb()
  insertAssetDicts(db)
})
afterEach(() => db.close())

const depr = (asset_no: string, year: number, month: number, month_depr: number, extra: Record<string, unknown> = {}) =>
  db.prepare(`INSERT INTO fixed_asset_depr (id, account_set_id, asset_no, year, month, dept_code, purpose_code, depr_method, month_depr, accum_depr)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(`${asset_no}-${year}-${month}`, SET_ID, asset_no, year, month,
    extra.dept_code ?? 'D1', extra.purpose_code ?? 'P1', extra.depr_method ?? '1', month_depr, month_depr)

describe('折旧查询', () => {
  beforeEach(() => {
    insertAsset(db, { asset_no: 'A01', asset_name: '手动叉车', spec: 'ETX-G', ref_no: 'R-01' })
    insertAsset(db, { asset_no: 'A02', asset_name: '打印机', spec: 'LQ-690K' })
    depr('A01', 2026, 7, 81.81)
    depr('A01', 2026, 8, 81.81)
    depr('A02', 2026, 8, 0)
    depr('A02', 2026, 9, 21.38)
    db.prepare("INSERT INTO fixed_asset_workload (id, account_set_id, asset_no, year, month, workload) VALUES ('w1',?,?,?,?,?)").run(SET_ID, 'A01', 2026, 8, 120)
  })

  it('按年月范围（含两端）逐月列出，带出名称 / 规格 / 参考编号 / 类别 / 部门 / 用途 / 月工作量', () => {
    const rows = queryDeprRecords(db as any, SET_ID, { fromYm: 202608, toYm: 202608 }) as any[]
    expect(rows.map(r => r.asset_no)).toEqual(['A01', 'A02'])
    expect(rows[0]).toMatchObject({
      asset_name: '手动叉车', spec: 'ETX-G', ref_no: 'R-01', category_name: '机器设备',
      dept_name: '生产部', purpose_name: '生产用', month_workload: 120, month_depr: 81.81,
    })
    expect((queryDeprRecords(db as any, SET_ID, { fromYm: 202607, toYm: 202609 }) as any[]).length).toBe(4)
  })

  it('折旧为零不显示、关键字查规格型号', () => {
    expect((queryDeprRecords(db as any, SET_ID, { fromYm: 202608, toYm: 202608, hideZero: true }) as any[]).map(r => r.asset_no)).toEqual(['A01'])
    expect((queryDeprRecords(db as any, SET_ID, { fromYm: 202601, toYm: 202612, keyword: 'LQ-690' }) as any[]).map(r => r.month)).toEqual([8, 9])
  })

  it('部门按计提当时的记录筛选；起止颠倒报错', () => {
    depr('A02', 2026, 10, 5, { dept_code: 'D9' })
    expect((queryDeprRecords(db as any, SET_ID, { fromYm: 202601, toYm: 202612, dept_code: 'D9' }) as any[]).length).toBe(1)
    expect(() => queryDeprRecords(db as any, SET_ID, { fromYm: 202609, toYm: 202608 })).toThrow(/起止年月/)
  })
})

describe('卡片补充字段（v169）', () => {
  it('迁移可重复执行', () => {
    expect(() => { assetCardExtraFieldsUp(db); assetCardExtraFieldsUp(db) }).not.toThrow()
  })

  it('导入模板含规格型号 / 参考编号 / 制造厂家 / 制造日期并写入卡片', () => {
    const keys = ASSET_IMPORT_COLUMNS.map(c => c.key)
    expect(keys).toEqual(expect.arrayContaining(['spec', 'ref_no', 'manufacturer', 'manufacture_date']))
    const r = batchImportAssets({ db: db as any, accountSetId: SET_ID, rows: [{
      asset_no: 'B01', asset_name: '冷柜', original_value: 1000, use_months: 36, start_depr_date: '2026-01-01',
      spec: 'BD-2288', ref_no: 'R9', manufacturer: '美的', manufacture_date: '2025/12/01',
    }] })
    expect(r.errors).toEqual([])
    expect(db.prepare("SELECT spec, ref_no, manufacturer, manufacture_date FROM fixed_asset WHERE asset_no='B01'").get())
      .toEqual({ spec: 'BD-2288', ref_no: 'R9', manufacturer: '美的', manufacture_date: '2025-12-01' })
  })

  it('制造日期格式不对时报错', () => {
    const r = batchImportAssets({ db: db as any, accountSetId: SET_ID, rows: [{ asset_no: 'B02', asset_name: 'x', original_value: 1, use_months: 12, manufacture_date: '2025-13-40' }] })
    expect(r.errors.some(e => /制造日期/.test(e.message))).toBe(true)
  })

  it('卡片修改允许改补充字段，空串落 NULL', () => {
    const f = buildAssetCardUpdate({ spec: 'X1', manufacturer: '' }, { original_value: 100, accum_depr: 0, salvage_rate: 0.05, salvage_value: 5 } as any)
    expect(f).toMatchObject({ spec: 'X1', manufacturer: null })
  })
})
