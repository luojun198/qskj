import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generatePurchaseVoucher } from '../services/assetAcquisition.js'
import {
  createAssetTestDb,
  insertAsset,
  insertAccounts,
  insertAssetDicts,
  enableDeptAux,
  closePeriod,
  SET_ID,
} from './helpers/assetTestDb.js'

describe('固定资产购置凭证', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createAssetTestDb()
    insertAssetDicts(db)
    insertAccounts(db, [
      ['1601', '固定资产'],
      ['1001', '银行存款'],
    ])
    insertAsset(db, {
      asset_no: 'A1',
      original_value: 50000,
      net_value: 50000,
      acquire_date: '2026-03-05',
    })
  })

  afterEach(() => db.close())

  const asset = () => db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any

  const generate = (over: Record<string, unknown> = {}) =>
    generatePurchaseVoucher({
      db,
      accountSetId: SET_ID,
      asset: asset(),
      creditAccount: '1001',
      voucherTypeId: null,
      makerName: '测试',
      ...over,
    } as any)

  it('借固定资产 / 贷资金来源，金额为原值且借贷平衡', () => {
    const result = generate()
    const entries = db
      .prepare('SELECT * FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
      .all(result.voucherId) as any[]

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ account_code: '1601', direction: 'debit', amount: 50000 })
    expect(entries[1]).toMatchObject({ account_code: '1001', direction: 'credit', amount: 50000 })
  })

  it('凭证日期取资产取得日期，source 为 asset_purchase', () => {
    const result = generate()
    const voucher = db.prepare('SELECT * FROM vouchers WHERE id=?').get(result.voucherId) as any
    expect(voucher.source).toBe('asset_purchase')
    expect(voucher.voucher_date).toBe('2026-03-05')
    expect(voucher.period).toBe(3)
    expect(voucher.total_amount).toBe(50000)
  })

  it('借方科目取资产类别配置的 account_code', () => {
    db.prepare("UPDATE fixed_asset_category SET account_code='1611' WHERE code='C1'").run()
    insertAccounts(db, [['1611', '固定资产—专用设备']])
    const result = generate()
    const debit = db
      .prepare("SELECT * FROM voucher_entries WHERE voucher_id=? AND direction='debit'")
      .get(result.voucherId) as any
    expect(debit.account_code).toBe('1611')
  })

  it('科目不存在时抛出明确提示且不落库', () => {
    db.prepare("DELETE FROM accounts WHERE code='1001'").run()
    expect(() => generate()).toThrow(/1001/)
    expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 0 })
  })

  it('原值为 0 时拒绝生成', () => {
    db.prepare("UPDATE fixed_asset SET original_value=0 WHERE asset_no='A1'").run()
    expect(() => generate()).toThrow(/原值为 0/)
  })

  it('P0-1：固定资产科目启用部门辅助核算时借方写入 dept_id', () => {
    enableDeptAux(db, ['1601'])
    const result = generate()
    const debit = db
      .prepare("SELECT * FROM voucher_entries WHERE voucher_id=? AND direction='debit'")
      .get(result.voucherId) as any
    expect(debit.dept_id).toBe('auxitem-d1')
    expect(debit.dept_name).toBe('生产部')
  })

  it('P0-5：取得日期所属期间已结账时拒绝生成', () => {
    closePeriod(db, 2026, 3)
    expect(() => generate()).toThrow(/已结账/)
  })
})
