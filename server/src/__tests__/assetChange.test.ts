import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyAssetChange,
  revokeAssetChange,
  listAssetChanges,
  batchApplyAssetChange,
} from '../services/assetChange.js'
import { previewDepreciation, executeDepreciation } from '../services/fixedAssetDepreciation.js'
import {
  createAssetTestDb,
  insertAsset,
  insertAccounts,
  insertAssetDicts,
  enableDeptAux,
  closePeriod,
  SET_ID,
} from './helpers/assetTestDb.js'

describe('固定资产变动引擎', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createAssetTestDb()
    insertAssetDicts(db)
    insertAccounts(db, [
      ['1601', '固定资产'],
      ['1602', '累计折旧'],
      ['1604', '在建工程'],
      ['1001', '银行存款'],
      ['6701', '资产减值损失'],
      ['660201', '制造费用—折旧'],
    ])
    db.prepare(
      'INSERT INTO fixed_asset_dept (id, account_set_id, code, name) VALUES (?,?,?,?)'
    ).run('dp-2', SET_ID, 'D2', '销售部')
    // 原值 12000 / 残值率 10% / 残值 1200 / 使用 12 个月 / 已提 2 个月 1800 / 净值 10200
    insertAsset(db, {
      asset_no: 'A1',
      original_value: 12000,
      salvage_rate: 0.1,
      salvage_value: 1200,
      use_months: 12,
      depr_months_done: 2,
      accum_depr: 1800,
      net_value: 10200,
      start_depr_date: '2026-01-15',
    })
  })

  afterEach(() => db.close())

  const asset = () => db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any

  const change = (over: Record<string, unknown>) =>
    applyAssetChange({
      db,
      accountSetId: SET_ID,
      assetId: 'fa-A1',
      changeDate: '2026-06-15',
      operatorName: '测试',
      ...over,
    } as any)

  // ── 通用前置校验 ──────────────────────────────────────────

  describe('前置校验', () => {
    it('已处置资产不能再登记变动', () => {
      db.prepare("UPDATE fixed_asset SET scrap_date='2026-05-01' WHERE asset_no='A1'").run()
      expect(() => change({ kind: 'dept', payload: { dept_code: 'D2' } })).toThrow(/已处置/)
    })

    it('变动日期不能早于开始折旧日期', () => {
      expect(() =>
        change({ kind: 'dept', changeDate: '2025-12-01', payload: { dept_code: 'D2' } })
      ).toThrow(/开始折旧日期/)
    })

    it('变动日期不能早于最后一次已计提折旧的期间', () => {
      db.prepare(
        'INSERT INTO fixed_asset_depr (id, account_set_id, asset_no, year, month, month_depr, accum_depr) VALUES (?,?,?,?,?,?,?)'
      ).run('d1', SET_ID, 'A1', 2026, 8, 900, 2700)
      expect(() => change({ kind: 'dept', payload: { dept_code: 'D2' } })).toThrow(
        /已计提至 2026年8月/
      )
    })

    it('已结账期间不能登记变动', () => {
      closePeriod(db, 2026, 6)
      expect(() => change({ kind: 'dept', payload: { dept_code: 'D2' } })).toThrow(/已结账/)
    })

    it('日期格式非法时报错', () => {
      expect(() => change({ kind: 'dept', changeDate: '2026/06/15', payload: {} })).toThrow(
        /YYYY-MM-DD/
      )
    })
  })

  // ── 原值变动 ──────────────────────────────────────────────

  describe('原值变动', () => {
    it('原值增加时同步重算残值与净值', () => {
      change({ kind: 'original_value', payload: { amount: 3000 } })
      const a = asset()
      expect(a.original_value).toBe(15000)
      expect(a.salvage_value).toBe(1500) // 15000 × 10%
      expect(a.net_value).toBe(13200) // 15000 - 1800 累折
    })

    it('原值减少同样生效', () => {
      change({ kind: 'original_value', payload: { amount: -2000 } })
      expect(asset().original_value).toBe(10000)
    })

    it('变动金额为 0 时拒绝', () => {
      expect(() => change({ kind: 'original_value', payload: { amount: 0 } })).toThrow(/不能为 0/)
    })

    it('变动后原值为负时拒绝', () => {
      expect(() => change({ kind: 'original_value', payload: { amount: -20000 } })).toThrow(
        /不能为负数/
      )
    })

    it('生成凭证：原值增加 借固定资产 / 贷对方科目', () => {
      const result = change({
        kind: 'original_value',
        payload: { amount: 3000 },
        generateVoucher: true,
        counterAccount: '1001',
      })
      expect(result.voucherId).toBeTruthy()

      const entries = db
        .prepare('SELECT * FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
        .all(result.voucherId!) as any[]
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({ account_code: '1601', direction: 'debit', amount: 3000 })
      expect(entries[1]).toMatchObject({ account_code: '1001', direction: 'credit', amount: 3000 })

      const voucher = db.prepare('SELECT * FROM vouchers WHERE id=?').get(result.voucherId!) as any
      expect(voucher.source).toBe('asset_change')
      expect(voucher.period).toBe(6)
    })

    it('生成凭证：原值减少时分录方向反转', () => {
      const result = change({
        kind: 'original_value',
        payload: { amount: -3000 },
        generateVoucher: true,
        counterAccount: '1001',
      })
      const debit = db
        .prepare("SELECT * FROM voucher_entries WHERE voucher_id=? AND direction='debit'")
        .get(result.voucherId!) as any
      expect(debit.account_code).toBe('1001')
    })

    it('生成凭证但未指定对方科目时报错', () => {
      expect(() =>
        change({ kind: 'original_value', payload: { amount: 3000 }, generateVoucher: true })
      ).toThrow(/对方科目/)
    })

    it('凭证生成失败时整笔变动回滚（资产原值不变）', () => {
      expect(() =>
        change({
          kind: 'original_value',
          payload: { amount: 3000 },
          generateVoucher: true,
          counterAccount: '9999',
        })
      ).toThrow(/9999/)
      expect(asset().original_value).toBe(12000)
      expect(db.prepare('SELECT COUNT(*) c FROM fixed_asset_change').get()).toEqual({ c: 0 })
    })
  })

  // ── 部门调拨 ──────────────────────────────────────────────

  describe('部门调拨', () => {
    it('更新部门并写入可读的变动流水', () => {
      change({ kind: 'dept', payload: { dept_code: 'D2' } })
      expect(asset().dept_code).toBe('D2')
      const row = db.prepare("SELECT * FROM fixed_asset_change WHERE asset_no='A1'").get() as any
      expect(row.change_kind).toBe('dept')
      expect(row.change_item).toBe('部门调拨：生产部 → 销售部')
      expect(row.old_text).toBe('D1')
      expect(row.new_text).toBe('D2')
    })

    it('可同时变更使用人与存放地点', () => {
      change({
        kind: 'dept',
        payload: { dept_code: 'D2', user_name: '张三', install_place: '二号车间' },
      })
      const a = asset()
      expect(a.user_name).toBe('张三')
      expect(a.install_place).toBe('二号车间')
    })

    it('调入部门与当前部门相同时拒绝', () => {
      expect(() => change({ kind: 'dept', payload: { dept_code: 'D1' } })).toThrow(/相同/)
    })

    it('部门编码不存在时拒绝', () => {
      expect(() => change({ kind: 'dept', payload: { dept_code: 'D9' } })).toThrow(/不存在/)
    })

    it('调拨后折旧凭证的部门辅助项随之改变', () => {
      enableDeptAux(db, ['660201'])
      db.prepare(
        'INSERT INTO aux_items (id, account_set_id, type, code, name) VALUES (?,?,?,?,?)'
      ).run('auxitem-d2', SET_ID, 'auxcat-dept', 'D2', '销售部')

      change({ kind: 'dept', payload: { dept_code: 'D2' } })

      const lines = previewDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 7 })
      expect(lines[0].dept_code).toBe('D2')
    })
  })

  // ── 使用状态变更 ──────────────────────────────────────────

  describe('使用状态变更', () => {
    it('切换到不可计提状态后停止计提折旧', () => {
      expect(previewDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 7 })).toHaveLength(1)
      change({ kind: 'status', payload: { status_code: '02' } })
      expect(asset().status_code).toBe('02')
      expect(previewDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 7 })).toHaveLength(0)
    })

    it('变动流水中标注「停止计提折旧」', () => {
      change({ kind: 'status', payload: { status_code: '02' } })
      const row = db.prepare("SELECT * FROM fixed_asset_change WHERE asset_no='A1'").get() as any
      expect(row.change_item).toContain('停止计提折旧')
    })

    it('不允许通过状态变更设为已报废', () => {
      expect(() => change({ kind: 'status', payload: { status_code: '04' } })).toThrow(/资产处置/)
    })

    it('状态编码不存在时拒绝', () => {
      expect(() => change({ kind: 'status', payload: { status_code: '99' } })).toThrow(/不存在/)
    })
  })

  // ── 折旧要素调整 ──────────────────────────────────────────

  describe('折旧要素调整', () => {
    it('一次调整多个要素，每个字段各写一条流水', () => {
      const result = change({
        kind: 'depr_factor',
        payload: { depr_method: '4', use_months: 24 },
      })
      expect(result.changeIds).toHaveLength(2)
      const a = asset()
      expect(a.depr_method).toBe('4')
      expect(a.use_months).toBe(24)
    })

    it('调整残值率时同步重算残值', () => {
      change({ kind: 'depr_factor', payload: { salvage_rate: 0.05 } })
      expect(asset().salvage_value).toBe(600) // 12000 × 5%
    })

    it('使用月数不得小于等于已计提月数', () => {
      expect(() => change({ kind: 'depr_factor', payload: { use_months: 2 } })).toThrow(
        /必须大于已计提月数/
      )
    })

    it('折旧方法非法时拒绝', () => {
      expect(() => change({ kind: 'depr_factor', payload: { depr_method: '9' } })).toThrow(
        /折旧方法/
      )
    })

    it('没有实际变化时拒绝', () => {
      expect(() => change({ kind: 'depr_factor', payload: { use_months: 12 } })).toThrow(
        /没有需要调整/
      )
    })
  })

  // ── 未来适用法（剩余期间摊余）─────────────────────────────

  describe('变动后折旧按剩余期间摊余（未来适用法）', () => {
    it('未发生变动时，平均年限法沿用全期平均口径', () => {
      const line = previewDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 7 })[0]
      // (12000-1200)/12 = 900
      expect(line.month_depr).toBe(900)
    })

    it('原值变动后改按「(净值-残值)/剩余月数」摊余', () => {
      change({ kind: 'original_value', payload: { amount: 3000 } })
      // 变动后：原值 15000，残值 1500，累折 1800，净值 13200，剩余 10 个月
      // (13200 - 1500) / 10 = 1170
      const line = previewDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 7 })[0]
      expect(line.month_depr).toBe(1170)
    })

    it('延长使用年限后按新剩余月数摊余', () => {
      change({ kind: 'depr_factor', payload: { use_months: 22 } })
      // 净值 10200，残值 1200，剩余 22-2=20 个月 → (10200-1200)/20 = 450
      const line = previewDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 7 })[0]
      expect(line.month_depr).toBe(450)
    })

    it('历史折旧不被重算', () => {
      executeDepreciation({
        db,
        accountSetId: SET_ID,
        year: 2026,
        month: 3,
        lines: previewDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 3 }),
      })
      const before = db
        .prepare("SELECT month_depr FROM fixed_asset_depr WHERE asset_no='A1' AND month=3")
        .get() as any

      change({ kind: 'original_value', changeDate: '2026-04-10', payload: { amount: 3000 } })

      const after = db
        .prepare("SELECT month_depr FROM fixed_asset_depr WHERE asset_no='A1' AND month=3")
        .get() as any
      expect(after.month_depr).toBe(before.month_depr)
    })
  })

  // ── 资产减值 ──────────────────────────────────────────────

  describe('计提减值准备', () => {
    beforeEach(() => {
      db.prepare("UPDATE fixed_asset_category SET impairment_account_code='1603' WHERE code='C1'").run()
      insertAccounts(db, [['1603', '固定资产减值准备']])
    })

    it('累计减值准备增加，净值随之减少', () => {
      change({ kind: 'impairment', payload: { amount: 2000 } })
      const a = asset()
      expect(a.impairment_amount).toBe(2000)
      // 12000 - 1800 - 2000 = 8200
      expect(a.net_value).toBe(8200)
    })

    it('生成凭证：借资产减值损失 / 贷类别配置的减值准备科目', () => {
      const result = change({
        kind: 'impairment',
        payload: { amount: 2000 },
        generateVoucher: true,
      })
      const entries = db
        .prepare('SELECT * FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
        .all(result.voucherId!) as any[]
      expect(entries[0]).toMatchObject({ account_code: '6701', direction: 'debit', amount: 2000 })
      expect(entries[1]).toMatchObject({ account_code: '1603', direction: 'credit', amount: 2000 })
      const voucher = db.prepare('SELECT * FROM vouchers WHERE id=?').get(result.voucherId!) as any
      expect(voucher.source).toBe('asset_impairment')
    })

    it('减值金额超过净值时拒绝', () => {
      expect(() => change({ kind: 'impairment', payload: { amount: 99999 } })).toThrow(/超过资产当前净值/)
    })

    it('类别未配置减值准备科目且要生成凭证时给出明确提示', () => {
      db.prepare("UPDATE fixed_asset_category SET impairment_account_code=NULL WHERE code='C1'").run()
      expect(() =>
        change({ kind: 'impairment', payload: { amount: 2000 }, generateVoucher: true })
      ).toThrow(/减值准备科目/)
    })

    it('减值后折旧基数按新净值摊余', () => {
      change({ kind: 'impairment', payload: { amount: 2000 } })
      // 净值 8200，残值 1200，剩余 10 个月 → (8200-1200)/10 = 700
      const line = previewDepreciation({ db, accountSetId: SET_ID, year: 2026, month: 7 })[0]
      expect(line.month_depr).toBe(700)
    })
  })

  // ── 大修改良 ──────────────────────────────────────────────

  describe('大修改良', () => {
    it('增加原值并可同时延长使用月数', () => {
      change({
        kind: 'improvement',
        payload: { amount: 6000, use_months: 24 },
        generateVoucher: true,
        counterAccount: '1604',
      })
      const a = asset()
      expect(a.original_value).toBe(18000)
      expect(a.use_months).toBe(24)
    })

    it('延长后的使用月数必须大于已计提月数', () => {
      expect(() =>
        change({ kind: 'improvement', payload: { amount: 6000, use_months: 1 } })
      ).toThrow(/必须大于已计提月数/)
    })
  })

  // ── 资产拆分 ──────────────────────────────────────────────

  describe('资产拆分', () => {
    it('原卡片减值、子卡片建立，原值与累计折旧总额守恒', () => {
      const result = change({
        kind: 'split',
        payload: {
          children: [
            { asset_no: 'A1-1', asset_name: '拆分件一', original_value: 3000 },
            { asset_no: 'A1-2', asset_name: '拆分件二', original_value: 1000 },
          ],
        },
      })
      expect(result.createdAssets).toHaveLength(2)

      const rows = db
        .prepare("SELECT asset_no, original_value, accum_depr, net_value FROM fixed_asset ORDER BY asset_no")
        .all() as any[]
      const totalOriginal = rows.reduce((s, r) => s + r.original_value, 0)
      const totalAccum = rows.reduce((s, r) => s + r.accum_depr, 0)
      expect(totalOriginal).toBe(12000)
      expect(totalAccum).toBeCloseTo(1800, 2)

      const remain = rows.find(r => r.asset_no === 'A1')!
      expect(remain.original_value).toBe(8000)
      // 拆出 4000/12000 = 1/3 的累计折旧 = 600
      expect(remain.accum_depr).toBe(1200)
    })

    it('子卡片继承折旧要素与已提月数', () => {
      change({
        kind: 'split',
        payload: { children: [{ asset_no: 'A1-1', original_value: 3000 }] },
      })
      const child = db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1-1'").get() as any
      expect(child.depr_method).toBe('1')
      expect(child.use_months).toBe(12)
      expect(child.depr_months_done).toBe(2)
      expect(child.source).toBe('拆分自 A1')
    })

    it('拆分合计不得大于等于原值', () => {
      expect(() =>
        change({ kind: 'split', payload: { children: [{ original_value: 12000 }] } })
      ).toThrow(/必须小于资产原值/)
    })

    it('子卡片编号重复时拒绝', () => {
      expect(() =>
        change({ kind: 'split', payload: { children: [{ asset_no: 'A1', original_value: 1000 }] } })
      ).toThrow(/已存在/)
    })

    it('未指定编号时自动取号', () => {
      const result = change({
        kind: 'split',
        payload: { children: [{ original_value: 1000 }] },
      })
      expect(result.createdAssets![0].asset_no).toBeTruthy()
    })

    it('原卡片与每张子卡片各记一条拆分流水', () => {
      change({
        kind: 'split',
        payload: {
          children: [
            { asset_no: 'A1-1', original_value: 3000 },
            { asset_no: 'A1-2', original_value: 1000 },
          ],
        },
      })
      const rows = db.prepare("SELECT * FROM fixed_asset_change WHERE change_kind='split'").all() as any[]
      expect(rows).toHaveLength(3)
    })
  })

  // ── 撤销变动 ──────────────────────────────────────────────

  describe('撤销变动', () => {
    it('撤销原值变动并删除关联凭证', () => {
      const result = change({
        kind: 'original_value',
        payload: { amount: 3000 },
        generateVoucher: true,
        counterAccount: '1001',
      })
      revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeId })

      const a = asset()
      expect(a.original_value).toBe(12000)
      expect(a.salvage_value).toBe(1200)
      expect(a.net_value).toBe(10200)
      expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toEqual({ c: 0 })
      expect(db.prepare('SELECT COUNT(*) c FROM fixed_asset_change').get()).toEqual({ c: 0 })
    })

    it('撤销部门调拨还原原部门', () => {
      const result = change({ kind: 'dept', payload: { dept_code: 'D2' } })
      revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeId })
      expect(asset().dept_code).toBe('D1')
    })

    it('撤销状态变更还原原状态', () => {
      const result = change({ kind: 'status', payload: { status_code: '02' } })
      revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeId })
      expect(asset().status_code).toBe('01')
    })

    it('撤销折旧要素调整还原字段值', () => {
      const result = change({ kind: 'depr_factor', payload: { use_months: 24 } })
      revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeId })
      expect(asset().use_months).toBe(12)
    })

    it('撤销减值还原累计减值与净值', () => {
      db.prepare("UPDATE fixed_asset_category SET impairment_account_code='1603' WHERE code='C1'").run()
      insertAccounts(db, [['1603', '固定资产减值准备']])
      const result = change({ kind: 'impairment', payload: { amount: 2000 }, generateVoucher: true })
      revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeId })
      const a = asset()
      expect(a.impairment_amount).toBe(0)
      expect(a.net_value).toBe(10200)
    })

    // ── A1 / A2 / A5 回归 ───────────────────────────────────

    it('A1：撤销改良时还原被延长的使用月数', () => {
      const result = change({
        kind: 'improvement',
        payload: { amount: 3000, use_months: 24 },
        generateVoucher: true,
        counterAccount: '1604',
      })
      expect(asset().use_months).toBe(24)

      revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeId })
      const a = asset()
      expect(a.use_months).toBe(12)
      expect(a.original_value).toBe(12000)
      expect(a.salvage_value).toBe(1200)
      expect(a.net_value).toBe(10200)
    })

    it('A1：撤销原值变动时还原一并调整的残值率与残值', () => {
      const result = change({
        kind: 'original_value',
        payload: { amount: 3000, salvage_rate: 0.2 },
        generateVoucher: true,
        counterAccount: '1001',
      })
      expect(asset().salvage_rate).toBe(0.2)
      expect(asset().salvage_value).toBe(3000)

      revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeId })
      const a = asset()
      expect(a.salvage_rate).toBe(0.1)
      expect(a.salvage_value).toBe(1200)
      expect(a.original_value).toBe(12000)
    })

    it('A2：撤销残值率调整时按还原后的残值率重算残值', () => {
      const result = change({ kind: 'depr_factor', payload: { salvage_rate: 0.25 } })
      expect(asset().salvage_value).toBe(3000)

      revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeIds[0] })
      const a = asset()
      expect(a.salvage_rate).toBe(0.1)
      expect(a.salvage_value).toBe(1200)
    })

    it('A5：撤销使用月数会使其不大于已计提月数时拦截', () => {
      const result = change({ kind: 'depr_factor', payload: { use_months: 36 } })
      // 期间之外补提折旧游标，模拟已提月数追上原月数的场景
      db.prepare("UPDATE fixed_asset SET depr_months_done=12 WHERE asset_no='A1'").run()
      expect(() =>
        revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeIds[0] })
      ).toThrow(/不大于已计提月数/)
    })

    it('存在更晚变动时必须逆序撤销', () => {
      const first = change({ kind: 'dept', changeDate: '2026-06-15', payload: { dept_code: 'D2' } })
      change({ kind: 'status', changeDate: '2026-07-15', payload: { status_code: '02' } })
      expect(() =>
        revokeAssetChange({ db, accountSetId: SET_ID, changeId: first.changeId })
      ).toThrow(/更晚的变动/)
    })

    it('变动期间及之后已计提折旧时拒绝撤销', () => {
      const result = change({ kind: 'dept', payload: { dept_code: 'D2' } })
      db.prepare(
        'INSERT INTO fixed_asset_depr (id, account_set_id, asset_no, year, month, month_depr, accum_depr) VALUES (?,?,?,?,?,?,?)'
      ).run('d1', SET_ID, 'A1', 2026, 6, 900, 2700)
      expect(() =>
        revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeId })
      ).toThrow(/请先反折旧/)
    })

    it('关联凭证已记账时拒绝撤销', () => {
      const result = change({
        kind: 'original_value',
        payload: { amount: 3000 },
        generateVoucher: true,
        counterAccount: '1001',
      })
      db.prepare("UPDATE vouchers SET status='posted' WHERE id=?").run(result.voucherId!)
      expect(() =>
        revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeId })
      ).toThrow(/已记账/)
    })

    it('资产拆分不支持撤销', () => {
      const result = change({
        kind: 'split',
        payload: { children: [{ asset_no: 'A1-1', original_value: 3000 }] },
      })
      expect(() =>
        revokeAssetChange({ db, accountSetId: SET_ID, changeId: result.changeId })
      ).toThrow(/不支持撤销/)
    })
  })

  // ── 变动查询 ──────────────────────────────────────────────

  describe('变动记录查询', () => {
    beforeEach(() => {
      change({ kind: 'dept', changeDate: '2026-06-15', payload: { dept_code: 'D2' } })
      change({ kind: 'status', changeDate: '2026-07-15', payload: { status_code: '02' } })
    })

    it('默认按变动日期倒序返回并带出资产名称', () => {
      const { total, rows } = listAssetChanges({ db, accountSetId: SET_ID, filters: {} })
      expect(total).toBe(2)
      expect(rows[0].change_kind).toBe('status')
      expect(rows[0].asset_name).toBe('资产A1')
    })

    it('按变动类型筛选', () => {
      const { total } = listAssetChanges({ db, accountSetId: SET_ID, filters: { kind: 'dept' } })
      expect(total).toBe(1)
    })

    it('按期间筛选', () => {
      const { total } = listAssetChanges({
        db,
        accountSetId: SET_ID,
        filters: { year: 2026, period: 7 },
      })
      expect(total).toBe(1)
    })

    it('按关键字筛选（编号/名称/变动事项）', () => {
      const { total } = listAssetChanges({
        db,
        accountSetId: SET_ID,
        filters: { keyword: '部门调拨' },
      })
      expect(total).toBe(1)
    })

    it('分页生效', () => {
      const { rows } = listAssetChanges({
        db,
        accountSetId: SET_ID,
        filters: { page: 2, pageSize: 1 },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0].change_kind).toBe('dept')
    })
  })
  // ── 批量变动（P4-2）──────────────────────────────────────

  describe('批量变动', () => {
    beforeEach(() => {
      // 再建两张同样可变动的卡片
      for (const no of ['A2', 'A3']) {
        insertAsset(db, {
          asset_no: no,
          original_value: 6000,
          salvage_rate: 0.1,
          salvage_value: 600,
          use_months: 12,
          depr_months_done: 2,
          accum_depr: 900,
          net_value: 5100,
          start_depr_date: '2026-01-15',
        })
      }
    })

    const batch = (over: Record<string, unknown> = {}) =>
      batchApplyAssetChange({
        db,
        accountSetId: SET_ID,
        assetIds: ['fa-A1', 'fa-A2', 'fa-A3'],
        kind: 'dept',
        changeDate: '2026-06-15',
        payload: { dept_code: 'D2' },
        operatorName: '测试',
        ...over,
      } as any)

    it('批量部门调拨全部生效', () => {
      const result = batch()
      expect(result.successCount).toBe(3)
      expect(result.errors).toEqual([])
      const depts = (
        db.prepare('SELECT dept_code FROM fixed_asset ORDER BY asset_no').all() as any[]
      ).map(r => r.dept_code)
      expect(depts).toEqual(['D2', 'D2', 'D2'])
      expect(db.prepare('SELECT COUNT(*) c FROM fixed_asset_change').get()).toEqual({ c: 3 })
    })

    it('批量状态变更全部生效', () => {
      const result = batch({ kind: 'status', payload: { status_code: '02' } })
      expect(result.successCount).toBe(3)
      const statuses = (
        db.prepare('SELECT status_code FROM fixed_asset').all() as any[]
      ).map(r => r.status_code)
      expect(statuses.every(s => s === '02')).toBe(true)
    })

    it('批量折旧要素调整全部生效', () => {
      const result = batch({ kind: 'depr_factor', payload: { use_months: 24 } })
      expect(result.successCount).toBe(3)
      const months = (db.prepare('SELECT use_months FROM fixed_asset').all() as any[]).map(
        r => r.use_months
      )
      expect(months.every(m => m === 24)).toBe(true)
    })

    it('返回结果带出每张卡片的资产编号', () => {
      const result = batch()
      expect(result.results.map(r => r.assetNo).sort()).toEqual(['A1', 'A2', 'A3'])
    })

    it('任一张失败即整批回滚，且返回失败清单', () => {
      // A3 已处置，无法变动
      db.prepare("UPDATE fixed_asset SET scrap_date='2026-05-01' WHERE asset_no='A3'").run()
      const result = batch()

      expect(result.successCount).toBe(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].assetNo).toBe('A3')
      expect(result.errors[0].message).toContain('已处置')

      // A1/A2 的部门必须原样未变
      const depts = (
        db.prepare("SELECT dept_code FROM fixed_asset WHERE asset_no IN ('A1','A2')").all() as any[]
      ).map(r => r.dept_code)
      expect(depts).toEqual(['D1', 'D1'])
      expect(db.prepare('SELECT COUNT(*) c FROM fixed_asset_change').get()).toEqual({ c: 0 })
    })

    it('原值变动不支持批量（金额需逐条填写）', () => {
      expect(() => batch({ kind: 'original_value', payload: { amount: 100 } })).toThrow(
        /不支持批量/
      )
    })

    it('资产拆分不支持批量', () => {
      expect(() => batch({ kind: 'split', payload: {} })).toThrow(/不支持批量/)
    })

    it('减值不支持批量', () => {
      expect(() => batch({ kind: 'impairment', payload: { amount: 100 } })).toThrow(/不支持批量/)
    })

    it('未选择卡片时拒绝', () => {
      expect(() => batch({ assetIds: [] })).toThrow(/至少选择/)
    })

    it('超过 500 张时拒绝', () => {
      expect(() => batch({ assetIds: Array.from({ length: 501 }, (_, i) => `x${i}`) })).toThrow(
        /500/
      )
    })

    it('已结账期间批量变动整批被拒', () => {
      closePeriod(db, 2026, 6)
      const result = batch()
      expect(result.successCount).toBe(0)
      expect(result.errors).toHaveLength(3)
      expect(result.errors[0].message).toContain('已结账')
    })
  })
})
