import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  batchImportAssets,
  loadImportDicts,
  validateImportRow,
  normalizeDate,
  ASSET_IMPORT_COLUMNS,
} from '../services/assetBatchImport.js'
import {
  createAssetTestDb,
  insertAsset,
  insertAssetDicts,
  SET_ID,
} from './helpers/assetTestDb.js'

describe('固定资产批量导入', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createAssetTestDb()
    insertAssetDicts(db)
  })

  afterEach(() => db.close())

  const goodRow = (over: Record<string, unknown> = {}) => ({
    asset_no: 'IM0001',
    asset_name: '导入设备',
    category_code: 'C1',
    status_code: '01',
    dept_code: 'D1',
    purpose_code: 'P1',
    acquire_date: '2026-01-05',
    start_depr_date: '2026-01-15',
    original_value: 12000,
    salvage_rate: 0.1,
    depr_method: '1',
    use_months: 12,
    depr_months_done: 0,
    accum_depr: 0,
    qty: 1,
    unit: '台',
    ...over,
  })

  const importRows = (rows: Record<string, unknown>[]) =>
    batchImportAssets({ db, accountSetId: SET_ID, rows })

  const validate = (row: Record<string, unknown>, seen = new Set<string>()) =>
    validateImportRow({
      row,
      rowNumber: 2,
      dicts: loadImportDicts(db, SET_ID),
      seenNos: seen,
    })

  // ── 日期归一化 ────────────────────────────────────────────

  describe('normalizeDate', () => {
    it('接受 YYYY-MM-DD', () => {
      expect(normalizeDate('2026-03-05')).toBe('2026-03-05')
    })

    it('接受 YYYY/MM/DD', () => {
      expect(normalizeDate('2026/03/05')).toBe('2026-03-05')
    })

    it('接受 Date 对象', () => {
      expect(normalizeDate(new Date(Date.UTC(2026, 2, 5)))).toBe('2026-03-05')
    })

    it('接受 Excel 日期序列号', () => {
      // Excel 以 1899-12-30 为 0：46081 天后是 2026-02-28
      expect(normalizeDate(46081)).toBe('2026-02-28')
      expect(normalizeDate(45658)).toBe('2025-01-01')
    })

    it('空值返回 undefined（表示未填，不是错误）', () => {
      expect(normalizeDate('')).toBeUndefined()
      expect(normalizeDate(null)).toBeUndefined()
    })

    it('无法识别返回 null（表示格式错误）', () => {
      expect(normalizeDate('去年三月')).toBeNull()
    })
  })

  // ── 模板列 ────────────────────────────────────────────────

  it('导入模板包含必填标记与中文列名', () => {
    const required = ASSET_IMPORT_COLUMNS.filter(c => c.required).map(c => c.key)
    expect(required).toEqual(['asset_no', 'asset_name', 'original_value'])
    expect(ASSET_IMPORT_COLUMNS.find(c => c.key === 'depr_method')?.label).toBe('折旧方法')
  })

  // ── 逐行校验 ──────────────────────────────────────────────

  describe('行校验', () => {
    it('合法行无错误', () => {
      expect(validate(goodRow())).toEqual([])
    })

    it('必填项为空时报错', () => {
      const errs = validate(goodRow({ asset_no: '', asset_name: '', original_value: '' }))
      expect(errs.map(e => e.field).sort()).toEqual(['asset_name', 'asset_no', 'original_value'])
    })

    it('编号与账套内已有资产重复时报错', () => {
      insertAsset(db, { asset_no: 'IM0001', original_value: 100, net_value: 100 })
      const errs = validate(goodRow())
      expect(errs[0].message).toContain('已存在')
    })

    it('本批次内部重号被检出', () => {
      const seen = new Set(['IM0001'])
      const errs = validate(goodRow(), seen)
      expect(errs[0].message).toContain('本次导入中重复')
    })

    it('字典编码不存在时报错', () => {
      const errs = validate(goodRow({ category_code: 'CX', dept_code: 'DX' }))
      expect(errs).toHaveLength(2)
      expect(errs.every(e => e.message.includes('不存在'))).toBe(true)
    })

    it('日期格式无法识别时报错', () => {
      const errs = validate(goodRow({ acquire_date: '前年' }))
      expect(errs[0].field).toBe('acquire_date')
    })

    it('原值为负数时报错', () => {
      expect(validate(goodRow({ original_value: -1 }))[0].message).toContain('不能为负数')
    })

    it('原值非数字时报错', () => {
      expect(validate(goodRow({ original_value: '一万二' }))[0].message).toContain('必须是数字')
    })

    it('残值率超出 0~1 时报错', () => {
      expect(validate(goodRow({ salvage_rate: 10 }))[0].message).toContain('0~1')
    })

    it('折旧方法非法时报错', () => {
      expect(validate(goodRow({ depr_method: '9' }))[0].field).toBe('depr_method')
    })

    it('已提月数大于使用月数时报错', () => {
      expect(validate(goodRow({ use_months: 12, depr_months_done: 13 }))[0].message).toContain(
        '不能大于使用月数'
      )
    })

    it('累计折旧大于原值时报错', () => {
      expect(validate(goodRow({ original_value: 1000, accum_depr: 2000 }))[0].message).toContain(
        '不能大于原值'
      )
    })

    it('工作量法必须填总工作量', () => {
      expect(validate(goodRow({ depr_method: '2' }))[0].field).toBe('total_workload')
      expect(validate(goodRow({ depr_method: '2', total_workload: 5000 }))).toEqual([])
    })

    it('错误带出 Excel 行号，便于定位', () => {
      const errs = validateImportRow({
        row: goodRow({ asset_no: '' }),
        rowNumber: 17,
        dicts: loadImportDicts(db, SET_ID),
        seenNos: new Set(),
      })
      expect(errs[0].row).toBe(17)
    })
  })

  // ── 整批导入 ──────────────────────────────────────────────

  describe('批量写入', () => {
    it('成功导入并按原值与残值率算出残值与净值', () => {
      const result = importRows([goodRow({ original_value: 12000, salvage_rate: 0.1, accum_depr: 2000 })])
      expect(result.successCount).toBe(1)
      expect(result.errors).toEqual([])

      const a = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='IM0001'").get() as any
      expect(a.salvage_value).toBe(1200)
      expect(a.net_value).toBe(10000)
      expect(a.impairment_amount).toBe(0)
    })

    it('日期被归一化后落库', () => {
      importRows([goodRow({ acquire_date: '2026/02/03' })])
      const a = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='IM0001'").get() as any
      expect(a.acquire_date).toBe('2026-02-03')
    })

    it('可一次导入多行', () => {
      const result = importRows([
        goodRow({ asset_no: 'IM0001' }),
        goodRow({ asset_no: 'IM0002', asset_name: '第二台' }),
      ])
      expect(result.successCount).toBe(2)
      expect(db.prepare('SELECT COUNT(*) c FROM fixed_asset').get()).toEqual({ c: 2 })
    })

    it('任一行有错则整批不写入（全有或全无）', () => {
      const result = importRows([
        goodRow({ asset_no: 'IM0001' }),
        goodRow({ asset_no: 'IM0002', original_value: -5 }),
      ])
      expect(result.successCount).toBe(0)
      // 负原值同时触发「原值不能为负数」与「累计折旧不能大于原值」，
      // 这里只关心错误全部指向出问题的那一行
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.every(e => e.row === 3)).toBe(true)
      expect(db.prepare('SELECT COUNT(*) c FROM fixed_asset').get()).toEqual({ c: 0 })
    })

    it('空数据集给出明确提示', () => {
      expect(importRows([]).errors[0].message).toContain('没有可导入的数据')
    })

    it('超过 5000 行被拒绝', () => {
      const rows = Array.from({ length: 5001 }, (_, i) =>
        goodRow({ asset_no: `IM${String(i).padStart(5, '0')}` })
      )
      expect(importRows(rows).errors[0].message).toContain('5000')
    })

    it('未填的可选字段落库为 NULL 而不是空串', () => {
      importRows([goodRow({ unit: '', user_name: '', remark: '' })])
      const a = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='IM0001'").get() as any
      expect(a.unit).toBeNull()
      expect(a.user_name).toBeNull()
      expect(a.remark).toBeNull()
    })

    it('数量未填时默认为 1', () => {
      importRows([goodRow({ qty: '' })])
      const a = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='IM0001'").get() as any
      expect(a.qty).toBe(1)
    })
  })
})
