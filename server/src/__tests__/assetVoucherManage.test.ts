import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listAssetVouchers,
  deleteAssetVoucherOnly,
  regenerateAssetVoucher,
  generateDeprVoucherForPeriod,
} from '../services/assetVoucherManage.js'
import { disposeAsset } from '../services/assetDisposal.js'
import { applyAssetChange } from '../services/assetChange.js'
import { createInventory, updateInventoryItem, completeInventory } from '../services/assetInventory.js'
import {
  createAssetTestDb,
  insertAsset,
  insertAccounts,
  insertAssetDicts,
  closePeriod,
  markDepreciated,
  SET_ID,
} from './helpers/assetTestDb.js'

describe('固定资产凭证管理（只删凭证 + 重新生成）', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createAssetTestDb()
    insertAssetDicts(db)
    insertAccounts(db, [
      ['1601', '固定资产'],
      ['1602', '累计折旧'],
      ['1604', '在建工程'],
      ['1606', '固定资产清理'],
      ['1001', '银行存款'],
      ['1901', '待处理财产损溢'],
      ['6301', '营业外收入'],
      ['6701', '资产减值损失'],
      ['6711', '营业外支出'],
      ['6901', '以前年度损益调整'],
      ['660201', '制造费用—折旧'],
    ])
    insertAsset(db, {
      asset_no: 'A1',
      original_value: 10000,
      accum_depr: 0,
      net_value: 10000,
      acquire_date: '2026-06-10',
    })
  })

  afterEach(() => db.close())

  const assetRow = () => db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any
  const voucherCount = () => (db.prepare('SELECT COUNT(*) c FROM vouchers').get() as any).c as number
  const totals = (voucherId: string) => {
    const es = db
      .prepare('SELECT direction, amount FROM voucher_entries WHERE voucher_id=?')
      .all(voucherId) as Array<{ direction: string; amount: number }>
    const sum = (d: string) =>
      Math.round(es.filter(e => e.direction === d).reduce((s, e) => s + e.amount, 0) * 100) / 100
    return { debit: sum('debit'), credit: sum('credit') }
  }
  const regen = (kind: any, refId: string, input: any = {}) =>
    regenerateAssetVoucher({ db, accountSetId: SET_ID, kind, refId, input, operatorName: '测试' })
  const del = (kind: any, refId: string) => deleteAssetVoucherOnly({ db, accountSetId: SET_ID, kind, refId })
  const list = (filters: any = {}) => listAssetVouchers(db, SET_ID, filters)

  describe('购置凭证', () => {
    it('卡片无购置凭证时：期初前取得的不列，账套无启用日期时只列有凭证的', () => {
      expect(list({ kind: 'purchase' }).total).toBe(0)
    })

    it('生成时指定凭证类型优先于资产参数', () => {
      db.prepare("INSERT INTO voucher_types (id, account_set_id, name, code) VALUES ('vt-a', ?, '记', '1'), ('vt-b', ?, '转', '2')").run(SET_ID, SET_ID)
      const r = regen('purchase', 'fa-A1', { creditAccount: '1001', voucherTypeId: 'vt-b' })
      expect((db.prepare('SELECT voucher_type_id t FROM vouchers WHERE id=?').get(r.voucherId) as any).t).toBe('vt-b')
    })

    it('生成 → 列表可见且借贷平衡、回链写入', () => {
      const r = regen('purchase', 'fa-A1', { creditAccount: '1001' })
      expect(assetRow().purchase_voucher_id).toBe(r.voucherId)
      expect(totals(r.voucherId)).toEqual({ debit: 10000, credit: 10000 })
      const rows = list({ kind: 'purchase' }).list
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ hasVoucher: true, voucherNo: r.voucherNo, voucherStatus: 'draft' })
    })

    it('已有凭证时重复生成被拒', () => {
      regen('purchase', 'fa-A1')
      expect(() => regen('purchase', 'fa-A1')).toThrow(/已有购置凭证/)
    })

    it('只删凭证：卡片保留、回链清空、凭证与分录消失；可再次生成', () => {
      const r = regen('purchase', 'fa-A1')
      const out = del('purchase', 'fa-A1')
      expect(out.voucherNo).toBe(r.voucherNo)
      expect(out.affectedGroups).toHaveLength(1)
      expect(assetRow().purchase_voucher_id).toBeNull()
      expect(assetRow().original_value).toBe(10000)
      expect(voucherCount()).toBe(0)
      expect((db.prepare('SELECT COUNT(*) c FROM voucher_entries').get() as any).c).toBe(0)
      const r2 = regen('purchase', 'fa-A1', { creditAccount: '1001' })
      expect(assetRow().purchase_voucher_id).toBe(r2.voucherId)
    })

    it('删除后卡片原值改了，重新生成按新原值入账', () => {
      regen('purchase', 'fa-A1')
      del('purchase', 'fa-A1')
      db.prepare("UPDATE fixed_asset SET original_value=9000, net_value=9000 WHERE asset_no='A1'").run()
      const r = regen('purchase', 'fa-A1')
      expect(totals(r.voucherId)).toEqual({ debit: 9000, credit: 9000 })
    })

    it('已记账凭证不能删', () => {
      const r = regen('purchase', 'fa-A1')
      db.prepare("UPDATE vouchers SET status='posted' WHERE id=?").run(r.voucherId)
      expect(() => del('purchase', 'fa-A1')).toThrow(/已记账/)
      expect(list({ kind: 'purchase' }).list[0].deleteBlockReason).toMatch(/已记账/)
      expect(assetRow().purchase_voucher_id).toBe(r.voucherId)
    })

    it('已审核（未记账）凭证可以删', () => {
      const r = regen('purchase', 'fa-A1')
      db.prepare("UPDATE vouchers SET status='audited' WHERE id=?").run(r.voucherId)
      expect(() => del('purchase', 'fa-A1')).not.toThrow()
    })

    it('期间已结账：不能删，也不能重新生成', () => {
      const r = regen('purchase', 'fa-A1')
      closePeriod(db, 2026, 6)
      expect(() => del('purchase', 'fa-A1')).toThrow(/已结账/)
      db.prepare('DELETE FROM voucher_entries').run()
      db.prepare('DELETE FROM vouchers WHERE id=?').run(r.voucherId) // 模拟凭证被别的途径删掉，回链悬空
      expect(() => regen('purchase', 'fa-A1')).toThrow(/已结账/)
    })

    it('回链悬空（凭证已不存在）：列表视为未生成，删除只清回链', () => {
      const r = regen('purchase', 'fa-A1')
      db.prepare('DELETE FROM voucher_entries').run()
      db.prepare('DELETE FROM vouchers WHERE id=?').run(r.voucherId)
      expect(list({ kind: 'purchase', status: 'generated' }).total).toBe(0)
      del('purchase', 'fa-A1')
      expect(assetRow().purchase_voucher_id).toBeNull()
    })

    it('列表状态过滤：账套启用后取得且无凭证的卡片列为「未生成」', () => {
      db.exec(
        "CREATE TABLE account_sets (id TEXT PRIMARY KEY, start_date TEXT); INSERT INTO account_sets VALUES ('set-1','2026-01-01')"
      )
      expect(list({ kind: 'purchase', status: 'missing' }).total).toBe(1)
      regen('purchase', 'fa-A1')
      expect(list({ kind: 'purchase', status: 'missing' }).total).toBe(0)
      expect(list({ kind: 'purchase', status: 'generated' }).total).toBe(1)
    })
  })

  it('拆分转入的子卡片价值来自原卡片，不列为「缺购置凭证」', () => {
    db.exec(
      "CREATE TABLE account_sets (id TEXT PRIMARY KEY, start_date TEXT); INSERT INTO account_sets VALUES ('set-1','2026-01-01')"
    )
    insertAsset(db, { asset_no: 'A2', original_value: 3000, net_value: 3000, acquire_date: '2026-06-10' })
    db.prepare(
      `INSERT INTO fixed_asset_change (id, account_set_id, asset_no, change_date, change_item, amount, change_kind, year, period)
       VALUES ('c-split', ?, 'A2', '2026-06-15', '资产拆分转入（来自 A1）', 3000, 'split', 2026, 6)`
    ).run(SET_ID)
    const missing = list({ kind: 'purchase', status: 'missing' }).list
    expect(missing.map(r => r.assetNo)).toEqual(['A1'])
  })

  describe('折旧凭证', () => {
    beforeEach(() => {
      db.prepare(
        `INSERT INTO fixed_asset_depr (id, account_set_id, asset_no, year, month, dept_code, purpose_code, depr_method, month_depr, accum_depr)
         VALUES ('d1', ?, 'A1', 2026, 6, 'D1', 'P1', '1', 500, 500)`
      ).run(SET_ID)
    })

    it('只删凭证：折旧记录与卡片累折保持不变，可补生成', () => {
      const first = generateDeprVoucherForPeriod({
        db, accountSetId: SET_ID, year: 2026, month: 6, makerName: '测试', voucherTypeId: null,
      })
      expect(totals(first.voucherId)).toEqual({ debit: 500, credit: 500 })
      expect((db.prepare('SELECT voucher_id v FROM fixed_asset_depr').get() as any).v).toBe(first.voucherId)

      del('depr', '2026-6')
      expect((db.prepare('SELECT COUNT(*) c FROM fixed_asset_depr').get() as any).c).toBe(1)
      expect((db.prepare('SELECT voucher_id v FROM fixed_asset_depr').get() as any).v).toBeNull()
      expect(voucherCount()).toBe(0)

      const second = regen('depr', '2026-6', { accumAccount: '1602' })
      expect(totals(second.voucherId)).toEqual({ debit: 500, credit: 500 })
    })

    it('已生成时重复补生成被拒（与原补生成路由文案一致）', () => {
      generateDeprVoucherForPeriod({ db, accountSetId: SET_ID, year: 2026, month: 6, makerName: '测试', voucherTypeId: null })
      expect(() => regen('depr', '2026-6')).toThrow(/请勿重复生成/)
    })

    it('折旧期间格式不对被拒', () => {
      expect(() => del('depr', '2026')).toThrow(/年-月/)
    })
  })

  describe('变动凭证', () => {
    const changeRowId = () => (db.prepare('SELECT id FROM fixed_asset_change').get() as any).id as string

    it('原值变动：只删凭证保留流水与卡片原值；重新生成需对方科目', () => {
      const res = applyAssetChange({
        db, accountSetId: SET_ID, assetId: 'fa-A1', changeDate: '2026-06-15', operatorName: '测试',
        kind: 'original_value', payload: { amount: 2000 }, generateVoucher: true, counterAccount: '1604',
      } as any)
      expect(res.voucherId).toBeTruthy()
      const id = changeRowId()

      del('change', id)
      expect((db.prepare('SELECT voucher_id v FROM fixed_asset_change WHERE id=?').get(id) as any).v).toBeNull()
      expect(assetRow().original_value).toBe(12000)
      expect(voucherCount()).toBe(0)

      expect(() => regen('change', id)).toThrow(/对方科目/)
      const r = regen('change', id, { counterAccount: '1001' })
      expect(totals(r.voucherId)).toEqual({ debit: 2000, credit: 2000 })
      expect((db.prepare('SELECT voucher_id v FROM fixed_asset_change WHERE id=?').get(id) as any).v).toBe(r.voucherId)
    })

    it('原值减少：重新生成方向反向（借对方 / 贷固定资产）', () => {
      applyAssetChange({
        db, accountSetId: SET_ID, assetId: 'fa-A1', changeDate: '2026-06-15', operatorName: '测试',
        kind: 'original_value', payload: { amount: -1000 }, generateVoucher: false,
      } as any)
      const id = changeRowId()
      const r = regen('change', id, { counterAccount: '1001' })
      const entries = db
        .prepare('SELECT account_code, direction FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
        .all(r.voucherId) as any[]
      expect(entries).toEqual([
        { account_code: '1001', direction: 'debit' },
        { account_code: '1601', direction: 'credit' },
      ])
    })

    it('减值：重新生成无需对方科目', () => {
      db.prepare("UPDATE fixed_asset_category SET impairment_account_code='1603' WHERE code='C1'").run()
      insertAccounts(db, [['1603', '固定资产减值准备']])
      applyAssetChange({
        db, accountSetId: SET_ID, assetId: 'fa-A1', changeDate: '2026-06-15', operatorName: '测试',
        kind: 'impairment', payload: { amount: 300 }, generateVoucher: true,
      } as any)
      const id = changeRowId()
      del('change', id)
      const r = regen('change', id)
      expect(totals(r.voucherId)).toEqual({ debit: 300, credit: 300 })
    })

    it('不产生凭证的变动类型（部门调拨）不出现在列表里，也不能重新生成', () => {
      insertAccounts(db, [])
      db.prepare('INSERT INTO fixed_asset_dept (id, account_set_id, code, name) VALUES (?,?,?,?)').run('dp-2', SET_ID, 'D2', '销售部')
      applyAssetChange({
        db, accountSetId: SET_ID, assetId: 'fa-A1', changeDate: '2026-06-15', operatorName: '测试',
        kind: 'dept', payload: { dept_code: 'D2' },
      } as any)
      expect(list({ kind: 'change' }).total).toBe(0)
      expect(() => regen('change', changeRowId())).toThrow(/不产生凭证/)
    })
  })

  describe('处置凭证', () => {
    const disposeWithVoucher = () => {
      markDepreciated(db, 'A1', 2026, 6)
      db.prepare("UPDATE fixed_asset SET accum_depr=4000, net_value=6000, original_value=10000 WHERE asset_no='A1'").run()
      return disposeAsset({
        db, accountSetId: SET_ID, assetId: 'fa-A1', changeTypeCode: null,
        scrapDate: '2026-06-20', scrapReason: '报废', generateVoucher: true, operatorName: '测试',
      } as any)
    }

    it('只删处置凭证：卡片仍为已处置、处置流水保留；重新生成可填收入费用且借贷平衡', () => {
      disposeWithVoucher()
      expect(assetRow().scrap_voucher_id).toBeTruthy()
      del('disposal', 'fa-A1')
      expect(assetRow().scrap_voucher_id).toBeNull()
      expect(assetRow().scrap_date).toBe('2026-06-20')
      expect((db.prepare("SELECT COUNT(*) c FROM fixed_asset_change WHERE change_kind='dispose'").get() as any).c).toBe(1)
      expect(voucherCount()).toBe(0)

      const r = regen('disposal', 'fa-A1', { disposalIncome: 8000, disposalExpense: 300 })
      const t = totals(r.voucherId)
      expect(t.debit).toBe(t.credit)
      expect(assetRow().scrap_voucher_id).toBe(r.voucherId)
    })

    it('未处置的卡片不能生成处置凭证', () => {
      expect(() => regen('disposal', 'fa-A1')).toThrow(/未处置/)
    })

    it('已有处置凭证时重复生成被拒', () => {
      disposeWithVoucher()
      expect(() => regen('disposal', 'fa-A1')).toThrow(/已有处置凭证/)
    })
  })

  describe('盘点凭证', () => {
    it('盘亏完成盘点后：只删凭证保留盘点结果与卡片处置；重新生成借贷平衡并回写明细', () => {
      markDepreciated(db, 'A1', 2026, 6)
      db.prepare("UPDATE fixed_asset SET accum_depr=4000, net_value=6000 WHERE asset_no='A1'").run()
      const inventoryId = createInventory({ db, accountSetId: SET_ID, name: '6月盘点', inventoryDate: '2026-06-30' })
      const itemId = (db.prepare("SELECT id FROM fixed_asset_inventory_item WHERE asset_no='A1'").get() as any).id
      updateInventoryItem({ db, accountSetId: SET_ID, itemId, actualQty: 0, actualStatus: 'deficit' })
      completeInventory({ db, accountSetId: SET_ID, inventoryId, generateVoucher: true, operatorName: '测试' })

      expect(list({ kind: 'inventory', status: 'generated' }).total).toBe(1)
      del('inventory', inventoryId)
      expect(voucherCount()).toBe(0)
      expect((db.prepare('SELECT voucher_id v FROM fixed_asset_inventory_item').get() as any).v).toBeNull()
      expect(assetRow().scrap_date).toBe('2026-06-30') // 卡片处置仍在
      expect(list({ kind: 'inventory', status: 'missing' }).total).toBe(1)

      const r = regen('inventory', inventoryId)
      const t = totals(r.voucherId)
      expect(t.debit).toBe(t.credit)
      expect((db.prepare('SELECT voucher_id v FROM fixed_asset_inventory_item').get() as any).v).toBe(r.voucherId)
      expect(() => regen('inventory', inventoryId)).toThrow(/已有凭证/)
    })

    it('盘点卡片因盘亏核销的，处置类型不再把它列为「缺处置凭证」', () => {
      db.exec(
        "CREATE TABLE account_sets (id TEXT PRIMARY KEY, start_date TEXT); INSERT INTO account_sets VALUES ('set-1','2026-01-01')"
      )
      markDepreciated(db, 'A1', 2026, 6)
      const inventoryId = createInventory({ db, accountSetId: SET_ID, name: '6月盘点', inventoryDate: '2026-06-30' })
      const itemId = (db.prepare("SELECT id FROM fixed_asset_inventory_item WHERE asset_no='A1'").get() as any).id
      updateInventoryItem({ db, accountSetId: SET_ID, itemId, actualQty: 0, actualStatus: 'deficit' })
      completeInventory({ db, accountSetId: SET_ID, inventoryId, generateVoucher: false, operatorName: '测试' })
      expect(list({ kind: 'disposal', status: 'missing' }).total).toBe(0)
    })

    it('未完成的盘点不能生成凭证', () => {
      const inventoryId = createInventory({ db, accountSetId: SET_ID, name: '6月盘点', inventoryDate: '2026-06-30' })
      expect(() => regen('inventory', inventoryId)).toThrow(/尚未完成/)
    })
  })

  it('生成过程任一步失败（科目不存在）：不留凭证与回链', () => {
    db.prepare("UPDATE fixed_asset_category SET account_code='7777' WHERE code='C1'").run()
    expect(() => regen('purchase', 'fa-A1')).toThrow()
    expect(voucherCount()).toBe(0)
    expect(assetRow().purchase_voucher_id).toBeNull()
  })
})
