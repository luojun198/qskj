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

  it('完成盘点后统计数写回主表且状态变为 completed', () => {
    markAs('deficit', 0)
    complete()
    const inv = db.prepare('SELECT * FROM fixed_asset_inventory WHERE id=?').get(inventoryId) as any
    expect(inv.status).toBe('completed')
    expect(inv.deficit_count).toBe(1)
    expect(inv.match_count).toBe(0)
  })
})
