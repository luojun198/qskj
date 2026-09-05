import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { disposeAsset, cancelDisposal } from '../services/assetDisposal.js'
import {
  createAssetTestDb,
  insertAsset,
  insertAccounts,
  insertAssetDicts,
  enableDeptAux,
  closePeriod,
  SET_ID,
} from './helpers/assetTestDb.js'

/** 取某张凭证的借贷合计，用于平衡断言 */
function voucherTotals(db: Database.Database, voucherId: string) {
  const entries = db
    .prepare('SELECT direction, amount FROM voucher_entries WHERE voucher_id=?')
    .all(voucherId) as Array<{ direction: string; amount: number }>
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    debit: round(entries.filter(e => e.direction === 'debit').reduce((s, e) => s + e.amount, 0)),
    credit: round(entries.filter(e => e.direction === 'credit').reduce((s, e) => s + e.amount, 0)),
    count: entries.length,
  }
}

describe('固定资产处置', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createAssetTestDb()
    insertAssetDicts(db)
    insertAccounts(db, [
      ['1601', '固定资产'],
      ['1602', '累计折旧'],
      ['1606', '固定资产清理'],
      ['1001', '银行存款'],
      ['6301', '营业外收入'],
      ['6711', '营业外支出'],
    ])
    db.prepare(
      "INSERT INTO fixed_asset_change_type (id, account_set_id, code, name, direction) VALUES ('ct1',?,'11','出售','decrease')"
    ).run(SET_ID)
    // 原值 10000，已提折旧 4000，净值 6000
    insertAsset(db, {
      asset_no: 'A1',
      original_value: 10000,
      accum_depr: 4000,
      net_value: 6000,
      salvage_value: 500,
    })
  })

  afterEach(() => db.close())

  const dispose = (over: Record<string, unknown> = {}) =>
    disposeAsset({
      db,
      accountSetId: SET_ID,
      assetId: 'fa-A1',
      changeTypeCode: '11',
      scrapDate: '2026-06-20',
      scrapReason: '出售',
      generateVoucher: true,
      operatorName: '测试',
      ...over,
    } as any)

  const currentVoucherId = () =>
    (db.prepare("SELECT scrap_voucher_id v FROM fixed_asset WHERE asset_no='A1'").get() as any).v

  // ── 借贷平衡（P0-2 核心）────────────────────────────────

  it('无收入无费用：借累计折旧+清理净值 / 贷固定资产原值，借贷平衡', () => {
    dispose()
    const totals = voucherTotals(db, currentVoucherId())
    // 4000 + 6000 = 10000（净损失 6000 再补 6711/1606 一对）
    expect(totals.debit).toBe(totals.credit)
  })

  it('有处置收入与费用时借贷仍平衡', () => {
    dispose({ disposalIncome: 8000, disposalExpense: 300 })
    const totals = voucherTotals(db, currentVoucherId())
    expect(totals.debit).toBe(totals.credit)
  })

  it('处置净收益结转至营业外收入', () => {
    // 收入 8000 - 费用 0 - 净值 6000 = +2000
    dispose({ disposalIncome: 8000 })
    const gain = db
      .prepare("SELECT * FROM voucher_entries WHERE voucher_id=? AND account_code='6301'")
      .get(currentVoucherId()) as any
    expect(gain.direction).toBe('credit')
    expect(gain.amount).toBe(2000)
  })

  it('处置净损失结转至营业外支出', () => {
    // 收入 1000 - 费用 0 - 净值 6000 = -5000
    dispose({ disposalIncome: 1000 })
    const loss = db
      .prepare("SELECT * FROM voucher_entries WHERE voucher_id=? AND account_code='6711'")
      .get(currentVoucherId()) as any
    expect(loss.direction).toBe('debit')
    expect(loss.amount).toBe(5000)
  })

  it('P0-2：银行存款科目缺失时抛出明确错误，而非静默跳过分录生成不平凭证', () => {
    db.prepare("DELETE FROM accounts WHERE code='1001'").run()
    expect(() => dispose({ disposalIncome: 8000 })).toThrow(/1001/)
    // 资产未被改动，凭证未落库
    expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 0 })
    const asset = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any
    expect(asset.scrap_date).toBeNull()
  })

  it('P0-2：营业外支出科目缺失且确有净损失时抛错', () => {
    db.prepare("DELETE FROM accounts WHERE code='6711'").run()
    expect(() => dispose()).toThrow(/6711/)
  })

  it('P0-2：不产生损益时不要求营业外收支科目存在', () => {
    db.prepare("DELETE FROM accounts WHERE code IN ('6301','6711')").run()
    // 收入 6000 = 净值 6000，损益为 0
    expect(() => dispose({ disposalIncome: 6000 })).not.toThrow()
  })

  // ── 凭证属性 ────────────────────────────────────────────

  it('凭证 source 为 asset_disposal，日期与期间取处置日期', () => {
    dispose()
    const voucher = db.prepare('SELECT * FROM vouchers WHERE id=?').get(currentVoucherId()) as any
    expect(voucher.source).toBe('asset_disposal')
    expect(voucher.voucher_date).toBe('2026-06-20')
    expect(voucher.year).toBe(2026)
    expect(voucher.period).toBe(6)
  })

  it('P0-2：处置凭证类型不再恒为 null，可由参数指定', () => {
    db.prepare("INSERT INTO voucher_types (id, account_set_id, name, code) VALUES ('vt1',?,'记账凭证','1')").run(
      SET_ID
    )
    dispose({ voucherTypeId: 'vt1' })
    const voucher = db.prepare('SELECT * FROM vouchers WHERE id=?').get(currentVoucherId()) as any
    expect(voucher.voucher_type_id).toBe('vt1')
    expect(voucher.voucher_no).toBe('记-001')
  })

  it('P0-1：清理科目启用部门辅助核算时写入 dept_id', () => {
    enableDeptAux(db, ['1606'])
    dispose()
    const clearing = db
      .prepare("SELECT * FROM voucher_entries WHERE voucher_id=? AND account_code='1606' LIMIT 1")
      .get(currentVoucherId()) as any
    expect(clearing.dept_id).toBe('auxitem-d1')
  })

  // ── 业务规则 ────────────────────────────────────────────

  it('资产状态置为已报废并保存处置前状态', () => {
    dispose()
    const asset = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any
    expect(asset.status_code).toBe('04')
    expect(asset.pre_scrap_status).toBe('01')
    expect(asset.scrap_date).toBe('2026-06-20')
  })

  it('写入资产减少变动流水', () => {
    dispose()
    const change = db.prepare("SELECT * FROM fixed_asset_change WHERE asset_no='A1'").get() as any
    expect(change.change_item).toBe('资产减少（出售）')
    expect(change.amount).toBe(-10000)
  })

  it('重复处置被拒绝', () => {
    dispose()
    expect(() => dispose()).toThrow(/已处置/)
  })

  it('P0-5：处置期间已结账时拒绝', () => {
    closePeriod(db, 2026, 6)
    expect(() => dispose({ generateVoucher: false })).toThrow(/已结账/)
  })

  it('撤销处置还原资产状态并删除清理凭证', () => {
    dispose()
    const voucherId = currentVoucherId()
    expect(voucherId).toBeTruthy()

    cancelDisposal({ db, accountSetId: SET_ID, assetId: 'fa-A1' })

    const asset = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any
    expect(asset.status_code).toBe('01')
    expect(asset.scrap_date).toBeNull()
    expect(db.prepare('SELECT COUNT(*) c FROM vouchers WHERE id=?').get(voucherId)).toEqual({ c: 0 })
  })

  it('清理凭证已记账时拒绝撤销处置', () => {
    dispose()
    db.prepare("UPDATE vouchers SET status='posted' WHERE id=?").run(currentVoucherId())
    expect(() => cancelDisposal({ db, accountSetId: SET_ID, assetId: 'fa-A1' })).toThrow()
  })
})
