import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDictDeleteBlockReason, buildAssetCardUpdate } from '../services/assetCard.js'
import {
  createAssetTestDb,
  insertAsset,
  insertAssetDicts,
  SET_ID,
} from './helpers/assetTestDb.js'

describe('资产字典删除引用检查', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createAssetTestDb()
    insertAssetDicts(db)
    db.prepare(
      "INSERT INTO fixed_asset_change_type (id, account_set_id, code, name, direction) VALUES ('ct1',?,'11','出售','decrease')"
    ).run(SET_ID)
  })

  afterEach(() => db.close())

  const check = (type: string, code: string, name: string) =>
    getDictDeleteBlockReason({ db, accountSetId: SET_ID, type, row: { code, name } })

  it('无引用时放行', () => {
    expect(check('category', 'C1', '机器设备')).toBeNull()
    expect(check('dept', 'D1', '生产部')).toBeNull()
  })

  it('类别被卡片引用时拦截并给出数量', () => {
    insertAsset(db, { asset_no: 'A1', category_code: 'C1', original_value: 1, net_value: 1 })
    insertAsset(db, { asset_no: 'A2', category_code: 'C1', original_value: 1, net_value: 1 })
    const reason = check('category', 'C1', '机器设备')
    expect(reason).toContain('2 张资产卡片')
    expect(reason).toContain('资产类别')
  })

  it('状态被引用时拦截', () => {
    insertAsset(db, { asset_no: 'A1', status_code: '01', original_value: 1, net_value: 1 })
    expect(check('status', '01', '在用')).toContain('使用状态')
  })

  it('用途被引用时拦截', () => {
    insertAsset(db, { asset_no: 'A1', purpose_code: 'P1', original_value: 1, net_value: 1 })
    expect(check('purpose', 'P1', '生产用')).toContain('资产用途')
  })

  it('部门被引用时拦截', () => {
    insertAsset(db, { asset_no: 'A1', dept_code: 'D1', original_value: 1, net_value: 1 })
    expect(check('dept', 'D1', '生产部')).toContain('使用部门')
  })

  it('只统计同一账套的引用', () => {
    insertAsset(db, { asset_no: 'A1', category_code: 'C1', original_value: 1, net_value: 1 })
    db.prepare("UPDATE fixed_asset SET account_set_id='other' WHERE asset_no='A1'").run()
    expect(check('category', 'C1', '机器设备')).toBeNull()
  })

  it('增减方式被变动流水引用时拦截', () => {
    db.prepare(
      `INSERT INTO fixed_asset_change
         (id, account_set_id, asset_no, change_date, change_item, change_kind, change_type_code)
       VALUES ('ch1',?,'A1','2026-06-15','资产减少（出售）','dispose','11')`
    ).run(SET_ID)
    expect(check('change_type', '11', '出售')).toContain('1 条资产变动记录')
  })

  it('增减方式无引用时放行', () => {
    expect(check('change_type', '11', '出售')).toBeNull()
  })

  it('未知字典类型不做检查', () => {
    expect(check('unknown', 'X', 'X')).toBeNull()
  })
})

describe('资产卡片更新字段构建', () => {
  const snapshot = {
    original_value: 12000,
    salvage_rate: 0.1,
    salvage_value: 1200,
    accum_depr: 1800,
    impairment_amount: 0,
  }

  it('未出现在请求体里的字段不写入', () => {
    const fields = buildAssetCardUpdate({ asset_name: '新名称' }, snapshot)
    expect(fields.asset_name).toBe('新名称')
    expect(fields).not.toHaveProperty('dept_code')
    expect(fields).not.toHaveProperty('user_name')
  })

  it('传 null 会真的置空（原 COALESCE 实现下无法清空）', () => {
    const fields = buildAssetCardUpdate({ user_name: null, dept_code: null }, snapshot)
    expect(fields.user_name).toBeNull()
    expect(fields.dept_code).toBeNull()
  })

  it('传空串统一归一为 NULL，库里不出现两种空值', () => {
    const fields = buildAssetCardUpdate({ install_place: '', remark: '' }, snapshot)
    expect(fields.install_place).toBeNull()
    expect(fields.remark).toBeNull()
  })

  it('金额三列与净值始终重算写入', () => {
    const fields = buildAssetCardUpdate({}, snapshot)
    expect(fields.original_value).toBe(12000)
    expect(fields.accum_depr).toBe(1800)
    expect(fields.salvage_value).toBe(1200)
    expect(fields.net_value).toBe(10200)
  })

  it('改原值时残值按残值率同步重算', () => {
    const fields = buildAssetCardUpdate({ original_value: 20000 }, snapshot)
    expect(fields.original_value).toBe(20000)
    expect(fields.salvage_value).toBe(2000)
    expect(fields.net_value).toBe(18200)
  })

  it('同时改原值与残值率', () => {
    const fields = buildAssetCardUpdate({ original_value: 20000, salvage_rate: 0.05 }, snapshot)
    expect(fields.salvage_value).toBe(1000)
  })

  it('显式给定残值时以给定值为准', () => {
    const fields = buildAssetCardUpdate({ original_value: 20000, salvage_value: 500 }, snapshot)
    expect(fields.salvage_value).toBe(500)
  })

  it('净值扣减累计减值准备（P2 口径）', () => {
    const fields = buildAssetCardUpdate({}, { ...snapshot, impairment_amount: 2000 })
    expect(fields.net_value).toBe(8200)
  })

  it('改累计折旧时净值随之变化', () => {
    const fields = buildAssetCardUpdate({ accum_depr: 3000 }, snapshot)
    expect(fields.accum_depr).toBe(3000)
    expect(fields.net_value).toBe(9000)
  })

  it('金额按两位小数规整，不留浮点噪声', () => {
    const fields = buildAssetCardUpdate(
      { original_value: 10000, salvage_rate: 0.333 },
      { ...snapshot, accum_depr: 0 }
    )
    expect(fields.salvage_value).toBe(3330)
    expect(fields.net_value).toBe(10000)
  })

  it('不在白名单里的字段被忽略（防止改写 asset_no / account_set_id 等）', () => {
    const fields = buildAssetCardUpdate(
      { asset_no: 'HACK', account_set_id: 'other', id: 'x', impairment_amount: 999 },
      snapshot
    )
    expect(fields).not.toHaveProperty('asset_no')
    expect(fields).not.toHaveProperty('account_set_id')
    expect(fields).not.toHaveProperty('id')
    expect(fields).not.toHaveProperty('impairment_amount')
  })
})
