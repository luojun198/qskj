import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  previewDepreciation,
  executeDepreciation,
  generateDeprVoucher,
  reverseDepreciation,
} from '../services/fixedAssetDepreciation.js'
import {
  createAssetTestDb,
  insertAsset,
  insertAccounts,
  insertAssetDicts,
  enableDeptAux,
  SET_ID,
} from './helpers/assetTestDb.js'

describe('固定资产折旧引擎', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createAssetTestDb()
    insertAssetDicts(db)
    insertAccounts(db, [
      ['1601', '固定资产'],
      ['1602', '累计折旧'],
      ['660201', '制造费用—折旧'],
    ])
  })

  afterEach(() => db.close())

  const preview = (year: number, month: number, workloadMap?: Record<string, number>) =>
    previewDepreciation({ db, accountSetId: SET_ID, year, month, workloadMap })

  // ── 四种折旧方法 ──────────────────────────────────────────

  describe('折旧方法公式', () => {
    it('平均年限法：(原值-残值)/使用月数', () => {
      insertAsset(db, {
        asset_no: 'A1',
        depr_method: '1',
        original_value: 12000,
        salvage_value: 1200,
        net_value: 12000,
        use_months: 12,
      })
      // (12000-1200)/12 = 900
      expect(preview(2026, 2)[0].month_depr).toBe(900)
    })

    it('工作量法：(原值-残值)/总工作量 × 当月工作量', () => {
      insertAsset(db, {
        asset_no: 'A2',
        depr_method: '2',
        original_value: 100000,
        salvage_value: 0,
        net_value: 100000,
        use_months: 120,
        total_workload: 500000,
      })
      // 100000/500000 × 8000 = 1600
      expect(preview(2026, 2, { A2: 8000 })[0].month_depr).toBe(1600)
    })

    it('工作量法：未录入当月工作量时不计提', () => {
      insertAsset(db, {
        asset_no: 'A2',
        depr_method: '2',
        original_value: 100000,
        salvage_value: 0,
        net_value: 100000,
        use_months: 120,
        total_workload: 500000,
      })
      expect(preview(2026, 2)).toHaveLength(0)
    })

    it('双倍余额递减法：净值 × 2/使用月数', () => {
      insertAsset(db, {
        asset_no: 'A3',
        depr_method: '3',
        original_value: 24000,
        salvage_value: 0,
        net_value: 24000,
        use_months: 24,
        depr_months_done: 0,
      })
      // 24000 × 2/24 = 2000
      expect(preview(2026, 2)[0].month_depr).toBe(2000)
    })

    it('双倍余额递减法：剩余 ≤2 个月改用直线法平摊净值', () => {
      insertAsset(db, {
        asset_no: 'A3',
        depr_method: '3',
        original_value: 24000,
        salvage_value: 500,
        net_value: 2500,
        use_months: 24,
        depr_months_done: 22, // 剩余 2 个月
      })
      // (2500-500)/2 = 1000，而非 2500×2/24=208.33
      expect(preview(2026, 2)[0].month_depr).toBe(1000)
    })

    it('年数总和法：按「月」计算，depreciable × 剩余月数 / (n(n+1)/2)', () => {
      insertAsset(db, {
        asset_no: 'A4',
        depr_method: '4',
        original_value: 10000,
        salvage_value: 1000,
        net_value: 10000,
        use_months: 4,
        depr_months_done: 0,
      })
      // 9000 × 4 / (4×5/2=10) = 3600
      expect(preview(2026, 2)[0].month_depr).toBe(3600)
    })

    it('年数总和法：已提月数增加后逐月递减', () => {
      insertAsset(db, {
        asset_no: 'A4',
        depr_method: '4',
        original_value: 10000,
        salvage_value: 1000,
        net_value: 6400,
        use_months: 4,
        depr_months_done: 1,
      })
      // 9000 × 3 / 10 = 2700
      expect(preview(2026, 2)[0].month_depr).toBe(2700)
    })
  })

  // ── 过滤条件与封顶 ────────────────────────────────────────

  describe('计提范围过滤', () => {
    it('起折当月不提，次月起提', () => {
      insertAsset(db, {
        asset_no: 'A1',
        start_depr_date: '2026-03-10',
        original_value: 12000,
        net_value: 12000,
      })
      expect(preview(2026, 3)).toHaveLength(0)
      expect(preview(2026, 4)).toHaveLength(1)
    })

    it('状态不可计提（depreciable=0）的资产被排除', () => {
      insertAsset(db, {
        asset_no: 'A1',
        status_code: '02',
        original_value: 12000,
        net_value: 12000,
      })
      expect(preview(2026, 2)).toHaveLength(0)
    })

    it('已提月数达到使用月数的资产被排除', () => {
      insertAsset(db, {
        asset_no: 'A1',
        original_value: 12000,
        net_value: 0,
        use_months: 12,
        depr_months_done: 12,
      })
      expect(preview(2026, 2)).toHaveLength(0)
    })

    it('本月已计提过的资产不再重复出现', () => {
      insertAsset(db, { asset_no: 'A1', original_value: 12000, net_value: 12000 })
      db.prepare(
        'INSERT INTO fixed_asset_depr (id, account_set_id, asset_no, year, month, month_depr, accum_depr) VALUES (?,?,?,?,?,?,?)'
      ).run('d1', SET_ID, 'A1', 2026, 2, 1000, 1000)
      expect(preview(2026, 2)).toHaveLength(0)
    })

    it('最后一期折旧封顶为「净值 - 残值」，不多提', () => {
      insertAsset(db, {
        asset_no: 'A1',
        depr_method: '1',
        original_value: 12000,
        salvage_value: 1200,
        net_value: 1500, // 剩余可折 300，而公式算出 900
        use_months: 12,
        depr_months_done: 11,
      })
      expect(preview(2026, 2)[0].month_depr).toBe(300)
    })
  })

  // ── 凭证生成 ──────────────────────────────────────────────

  describe('折旧凭证生成', () => {
    const seedAsset = () =>
      insertAsset(db, {
        asset_no: 'A1',
        depr_method: '1',
        original_value: 12000,
        salvage_value: 1200,
        net_value: 12000,
        use_months: 12,
      })

    it('借贷平衡，凭证日期为当月最后一天，source 为 asset_depr', () => {
      seedAsset()
      const lines = preview(2026, 2)
      const result = generateDeprVoucher({
        db,
        accountSetId: SET_ID,
        year: 2026,
        month: 2,
        lines,
        deprAccumAccount: '1602',
        makerName: '测试',
      })

      const voucher = db.prepare('SELECT * FROM vouchers WHERE id=?').get(result.voucherId) as any
      expect(voucher.source).toBe('asset_depr')
      expect(voucher.voucher_date).toBe('2026-02-28')
      expect(voucher.period).toBe(2)

      const entries = db
        .prepare('SELECT direction, amount FROM voucher_entries WHERE voucher_id=?')
        .all(result.voucherId) as Array<{ direction: string; amount: number }>
      const debit = entries.filter(e => e.direction === 'debit').reduce((s, e) => s + e.amount, 0)
      const credit = entries.filter(e => e.direction === 'credit').reduce((s, e) => s + e.amount, 0)
      expect(debit).toBe(credit)
      expect(debit).toBe(900)
    })

    it('类别仍绑一级 1602、其下已有两个明细时，用本次指定的明细科目', () => {
      insertAccounts(db, [
        ['1602001', '累计折旧'],
        ['1602002', '累计折旧'],
      ])
      seedAsset()
      const lines = preview(2026, 2)
      const result = generateDeprVoucher({
        db,
        accountSetId: SET_ID,
        year: 2026,
        month: 2,
        lines,
        deprAccumAccount: '1602001',
        makerName: '测试',
      })
      const credit = db
        .prepare("SELECT account_code FROM voucher_entries WHERE voucher_id=? AND direction='credit'")
        .get(result.voucherId) as { account_code: string }
      expect(credit.account_code).toBe('1602001')
    })

    it('一级 1602 下有多个明细且未指定时，列出明细并拒绝记在上级上', () => {
      insertAccounts(db, [
        ['1602001', '累计折旧'],
        ['1602002', '累计折旧'],
      ])
      seedAsset()
      const lines = preview(2026, 2)
      expect(() =>
        generateDeprVoucher({
          db,
          accountSetId: SET_ID,
          year: 2026,
          month: 2,
          lines,
          deprAccumAccount: '1602',
          makerName: '测试',
        })
      ).toThrow(/1602001[\s\S]*1602002/)
      expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 0 })
    })

    it('一级科目下只有一个明细时，自动改记到该明细', () => {
      insertAccounts(db, [['1602001', '累计折旧']])
      seedAsset()
      const lines = preview(2026, 2)
      const result = generateDeprVoucher({
        db,
        accountSetId: SET_ID,
        year: 2026,
        month: 2,
        lines,
        deprAccumAccount: '1602',
        makerName: '测试',
      })
      const credit = db
        .prepare("SELECT account_code FROM voucher_entries WHERE voucher_id=? AND direction='credit'")
        .get(result.voucherId) as { account_code: string }
      expect(credit.account_code).toBe('1602001')
    })

    it('类别已是明细科目时，不改用本次另外指定的科目', () => {
      insertAccounts(db, [
        ['1602001', '房屋累计折旧'],
        ['1602002', '设备累计折旧'],
      ])
      db.prepare("UPDATE fixed_asset_category SET depr_account_code='1602001'").run()
      seedAsset()
      const lines = preview(2026, 2)
      const result = generateDeprVoucher({
        db,
        accountSetId: SET_ID,
        year: 2026,
        month: 2,
        lines,
        deprAccumAccount: '1602002',
        makerName: '测试',
      })
      const credit = db
        .prepare("SELECT account_code FROM voucher_entries WHERE voucher_id=? AND direction='credit'")
        .get(result.voucherId) as { account_code: string }
      expect(credit.account_code).toBe('1602001')
    })

    it('科目不存在时抛出明确提示，不生成半截凭证', () => {
      db.prepare("DELETE FROM accounts WHERE code='660201'").run()
      seedAsset()
      const lines = preview(2026, 2)
      expect(() =>
        generateDeprVoucher({
          db,
          accountSetId: SET_ID,
          year: 2026,
          month: 2,
          lines,
          deprAccumAccount: '1602',
          makerName: '测试',
        })
      ).toThrow(/660201/)
      expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 0 })
    })

    it('P0-1：费用科目启用部门辅助核算时，借方分录写入 dept_id 与 aux_data', () => {
      enableDeptAux(db, ['660201'])
      seedAsset()
      const lines = preview(2026, 2)
      const result = generateDeprVoucher({
        db,
        accountSetId: SET_ID,
        year: 2026,
        month: 2,
        lines,
        deprAccumAccount: '1602',
        makerName: '测试',
      })

      const debitEntry = db
        .prepare("SELECT * FROM voucher_entries WHERE voucher_id=? AND direction='debit'")
        .get(result.voucherId) as any
      expect(debitEntry.dept_id).toBe('auxitem-d1')
      expect(debitEntry.dept_name).toBe('生产部')
      expect(JSON.parse(debitEntry.aux_data).dept.id).toBe('auxitem-d1')

      // 累计折旧科目未启用辅助核算，不应被塞入部门
      const creditEntry = db
        .prepare("SELECT * FROM voucher_entries WHERE voucher_id=? AND direction='credit'")
        .get(result.voucherId) as any
      expect(creditEntry.dept_id).toBeNull()
      expect(creditEntry.aux_data).toBeNull()
    })

    it('P0-1：同一费用科目下不同部门拆成多条借方分录', () => {
      enableDeptAux(db, ['660201'])
      db.prepare(
        'INSERT INTO aux_items (id, account_set_id, type, code, name) VALUES (?,?,?,?,?)'
      ).run('auxitem-d2', SET_ID, 'auxcat-dept', 'D2', '销售部')
      db.prepare('INSERT INTO fixed_asset_dept (id, account_set_id, code, name) VALUES (?,?,?,?)').run(
        'dp-2',
        SET_ID,
        'D2',
        '销售部'
      )
      seedAsset()
      insertAsset(db, {
        asset_no: 'A2',
        dept_code: 'D2',
        depr_method: '1',
        original_value: 6000,
        salvage_value: 0,
        net_value: 6000,
        use_months: 12,
      })

      const lines = preview(2026, 2)
      const result = generateDeprVoucher({
        db,
        accountSetId: SET_ID,
        year: 2026,
        month: 2,
        lines,
        deprAccumAccount: '1602',
        makerName: '测试',
      })

      const debits = db
        .prepare(
          "SELECT dept_id, amount FROM voucher_entries WHERE voucher_id=? AND direction='debit' ORDER BY dept_id"
        )
        .all(result.voucherId) as Array<{ dept_id: string; amount: number }>
      // 同一 660201 科目，因部门不同拆成两条
      expect(debits).toHaveLength(2)
      expect(debits.map(d => d.dept_id)).toEqual(['auxitem-d1', 'auxitem-d2'])
      expect(debits.find(d => d.dept_id === 'auxitem-d1')!.amount).toBe(900)
      expect(debits.find(d => d.dept_id === 'auxitem-d2')!.amount).toBe(500)

      // 贷方累计折旧未开辅助核算，仍合并为一条
      const credits = db
        .prepare("SELECT amount FROM voucher_entries WHERE voucher_id=? AND direction='credit'")
        .all(result.voucherId) as Array<{ amount: number }>
      expect(credits).toHaveLength(1)
      expect(credits[0].amount).toBe(1400)
    })

    it('P0-5：目标期间已结账时拒绝生成凭证', () => {
      db.prepare(
        "INSERT INTO period_closing (id, account_set_id, year, period, status) VALUES ('pc1',?,2026,2,'closed')"
      ).run(SET_ID)
      seedAsset()
      const lines = preview(2026, 2)
      expect(() =>
        generateDeprVoucher({
          db,
          accountSetId: SET_ID,
          year: 2026,
          month: 2,
          lines,
          deprAccumAccount: '1602',
          makerName: '测试',
        })
      ).toThrow(/已结账/)
    })
  })

  // ── 反折旧 ────────────────────────────────────────────────

  describe('反折旧', () => {
    const seedAndExecute = (year: number, month: number) => {
      const lines = preview(year, month)
      executeDepreciation({ db, accountSetId: SET_ID, year, month, lines })
      return lines
    }

    beforeEach(() => {
      insertAsset(db, {
        asset_no: 'A1',
        depr_method: '1',
        original_value: 12000,
        salvage_value: 1200,
        net_value: 12000,
        use_months: 12,
      })
    })

    it('回退累计折旧、净值与已提月数', () => {
      seedAndExecute(2026, 2)
      const afterExec = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any
      expect(afterExec.accum_depr).toBe(900)
      expect(afterExec.net_value).toBe(11100)
      expect(afterExec.depr_months_done).toBe(1)

      reverseDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 2 })

      const afterReverse = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any
      expect(afterReverse.accum_depr).toBe(0)
      expect(afterReverse.net_value).toBe(12000)
      expect(afterReverse.depr_months_done).toBe(0)
      expect(db.prepare('SELECT COUNT(*) c FROM fixed_asset_depr').get()).toEqual({ c: 0 })
    })

    it('存在更晚期间折旧时拒绝反折旧', () => {
      seedAndExecute(2026, 2)
      seedAndExecute(2026, 3)
      expect(() =>
        reverseDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 2 })
      ).toThrow(/更晚期间/)
    })

    it('该期折旧涉及的资产已处置时拒绝反折旧，且不回退任何数据', () => {
      seedAndExecute(2026, 2)
      db.prepare("UPDATE fixed_asset SET scrap_date='2026-02-20' WHERE asset_no='A1'").run()
      expect(() =>
        reverseDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 2 })
      ).toThrow(/已处置/)
      const a = db.prepare("SELECT accum_depr FROM fixed_asset WHERE asset_no='A1'").get() as any
      expect(a.accum_depr).toBe(900)
      expect(db.prepare('SELECT COUNT(*) c FROM fixed_asset_depr').get()).toEqual({ c: 1 })
    })

    it('该期无折旧记录时报错', () => {
      expect(() =>
        reverseDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 5 })
      ).toThrow(/没有折旧记录/)
    })

    it('关联凭证已记账时拒绝反折旧', () => {
      const lines = seedAndExecute(2026, 2)
      const result = generateDeprVoucher({
        db,
        accountSetId: SET_ID,
        year: 2026,
        month: 2,
        lines,
        deprAccumAccount: '1602',
        makerName: '测试',
      })
      db.prepare('UPDATE fixed_asset_depr SET voucher_id=? WHERE year=2026 AND month=2').run(
        result.voucherId
      )
      db.prepare("UPDATE vouchers SET status='posted' WHERE id=?").run(result.voucherId)

      expect(() =>
        reverseDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 2 })
      ).toThrow(/已记账/)
    })

    it('反折旧同时删除该期折旧凭证及其分录', () => {
      const lines = seedAndExecute(2026, 2)
      const result = generateDeprVoucher({
        db,
        accountSetId: SET_ID,
        year: 2026,
        month: 2,
        lines,
        deprAccumAccount: '1602',
        makerName: '测试',
      })
      db.prepare('UPDATE fixed_asset_depr SET voucher_id=? WHERE year=2026 AND month=2').run(
        result.voucherId
      )

      reverseDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 2 })

      expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 0 })
      expect(db.prepare('SELECT COUNT(*) c FROM voucher_entries').get()).toEqual({ c: 0 })
    })
  })
})
