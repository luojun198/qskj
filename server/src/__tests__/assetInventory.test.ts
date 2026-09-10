import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createInventory,
  updateInventoryItem,
  completeInventory,
} from '../services/assetInventory.js'
import {
  createAssetTestDb,
  insertAsset,
  insertAccounts,
  insertAssetDicts,
  enableDeptAux,
  SET_ID,
} from './helpers/assetTestDb.js'

describe('固定资产盘点', () => {
  let db: Database.Database
  let inventoryId: string

  beforeEach(() => {
    db = createAssetTestDb()
    insertAssetDicts(db)
    insertAccounts(db, [
      ['1601', '固定资产'],
      ['1602', '累计折旧'],
      ['6901', '待处理财产损溢'],
    ])
    // 原值 10000 / 累折 4000 / 净值 6000
    insertAsset(db, {
      asset_no: 'A1',
      original_value: 10000,
      accum_depr: 4000,
      net_value: 6000,
    })
    inventoryId = createInventory({
      db,
      accountSetId: SET_ID,
      name: '2026年6月盘点',
      inventoryDate: '2026-06-30',
    })
  })

  afterEach(() => db.close())

  const itemId = () =>
    (
      db
        .prepare("SELECT id FROM fixed_asset_inventory_item WHERE asset_no='A1'")
        .get() as any
    ).id

  const markAs = (status: string, qty: number) =>
    updateInventoryItem({
      db,
      accountSetId: SET_ID,
      itemId: itemId(),
      actualQty: qty,
      actualStatus: status,
    })

  const complete = () =>
    completeInventory({
      db,
      accountSetId: SET_ID,
      inventoryId,
      generateVoucher: true,
      operatorName: '测试',
    })

  const latestVoucher = () =>
    db.prepare('SELECT * FROM vouchers ORDER BY rowid DESC LIMIT 1').get() as any

  const totalsOf = (voucherId: string) => {
    const entries = db
      .prepare('SELECT direction, amount FROM voucher_entries WHERE voucher_id=?')
      .all(voucherId) as Array<{ direction: string; amount: number }>
    const round = (n: number) => Math.round(n * 100) / 100
    return {
      debit: round(entries.filter(e => e.direction === 'debit').reduce((s, e) => s + e.amount, 0)),
      credit: round(entries.filter(e => e.direction === 'credit').reduce((s, e) => s + e.amount, 0)),
    }
  }

  it('创建盘点时按未处置资产生成明细，默认标记为账实相符', () => {
    const items = db.prepare('SELECT * FROM fixed_asset_inventory_item').all() as any[]
    expect(items).toHaveLength(1)
    expect(items[0].actual_status).toBe('normal')
    expect(items[0].book_net_value).toBe(6000)
  })

  it('全部相符时不生成凭证', () => {
    const result = complete()
    expect(result.surplusCount).toBe(0)
    expect(result.deficitCount).toBe(0)
    expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 0 })
  })

  it('盘亏凭证借贷平衡：借损溢(净值)+借累计折旧 / 贷固定资产(原值)', () => {
    markAs('deficit', 0)
    const result = complete()
    expect(result.deficitCount).toBe(1)
    expect(result.voucherWarning).toBeNull()

    const voucher = latestVoucher()
    const totals = totalsOf(voucher.id)
    // 6000 + 4000 = 10000
    expect(totals.debit).toBe(10000)
    expect(totals.credit).toBe(10000)
  })

  it('盘盈凭证借贷平衡：借固定资产 / 贷损溢', () => {
    markAs('surplus', 2)
    complete()
    const totals = totalsOf(latestVoucher().id)
    expect(totals.debit).toBe(6000)
    expect(totals.credit).toBe(6000)
  })

  it('凭证 source 为 asset_inventory（原实现漏写，导致不受资产凭证删除拦截保护）', () => {
    markAs('deficit', 0)
    complete()
    expect(latestVoucher().source).toBe('asset_inventory')
  })

  it('凭证期间取盘点日期所属期间，而非当前系统月份', () => {
    markAs('deficit', 0)
    complete()
    const voucher = latestVoucher()
    expect(voucher.voucher_date).toBe('2026-06-30')
    expect(voucher.year).toBe(2026)
    expect(voucher.period).toBe(6)
  })

  it('科目缺失时以 voucherWarning 返回明确提示，不生成半截凭证', () => {
    db.prepare("DELETE FROM accounts WHERE code='6901'").run()
    markAs('deficit', 0)
    const result = complete()
    expect(result.voucherWarning).toMatch(/6901/)
    expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 0 })
  })

  it('P0-1：固定资产科目启用部门辅助核算时分录写入 dept_id', () => {
    enableDeptAux(db, ['1601'])
    markAs('deficit', 0)
    complete()
    const entry = db
      .prepare("SELECT * FROM voucher_entries WHERE account_code='1601' LIMIT 1")
      .get() as any
    expect(entry.dept_id).toBe('auxitem-d1')
  })

  // ── A3 / A4 / A9 回归 ─────────────────────────────────────

  it('A3：盘亏完成后资产卡片置为处置状态，不再留在账上', () => {
    markAs('deficit', 0)
    complete()
    const asset = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any
    expect(asset.status_code).toBe('04')
    expect(asset.scrap_date).toBe('2026-06-30')
    expect(asset.scrap_reason).toBe('盘亏')
    expect(asset.pre_scrap_status).toBe('01')
  })

  it('A3：盘亏资产写入 dispose 变动流水，便于追溯与撤销', () => {
    markAs('deficit', 0)
    complete()
    const change = db
      .prepare("SELECT * FROM fixed_asset_change WHERE asset_no='A1' AND change_kind='dispose'")
      .get() as any
    expect(change).toBeTruthy()
    expect(change.change_item).toBe('盘亏处置')
    expect(change.year).toBe(2026)
    expect(change.period).toBe(6)
  })

  it('A3：盘亏资产不再进入折旧取数（status 04 不可折旧）', () => {
    markAs('deficit', 0)
    complete()
    const row = db
      .prepare(
        `SELECT COUNT(*) c FROM fixed_asset fa
         LEFT JOIN fixed_asset_status fs
           ON fs.account_set_id = fa.account_set_id AND fs.code = fa.status_code
         WHERE fa.account_set_id=? AND (fs.depreciable = 1 OR fa.status_code IS NULL)`
      )
      .get(SET_ID) as any
    expect(row.c).toBe(0)
  })

  it('A4：盘盈只就数量差入账，不重复计一整张卡片的净值', () => {
    // 账面 1 台、实盘 3 台 → 盘盈 2 台，单位净值 6000
    markAs('surplus', 3)
    complete()
    const totals = totalsOf(latestVoucher().id)
    expect(totals.debit).toBe(12000)
    expect(totals.credit).toBe(12000)
  })

  it('A4：盘盈同步调增卡片数量与原值', () => {
    markAs('surplus', 3)
    complete()
    const asset = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any
    expect(asset.qty).toBe(3)
    expect(asset.original_value).toBe(30000)
    // 累折不变，净值随原值同步调增
    expect(asset.net_value).toBe(26000)
  })

  it('A9：已完成的盘点不能重复完成（避免重复生成凭证 / 重复处置卡片）', () => {
    markAs('deficit', 0)
    complete()
    expect(() => complete()).toThrow(/已完成/)
    expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 1 })
  })

  it('完成盘点后统计数写回主表且状态变为 completed', () => {
    markAs('deficit', 0)
    complete()
    const inv = db.prepare('SELECT * FROM fixed_asset_inventory WHERE id=?').get(inventoryId) as any
    expect(inv.status).toBe('completed')
    expect(inv.deficit_count).toBe(1)
    expect(inv.match_count).toBe(0)
  })
})
