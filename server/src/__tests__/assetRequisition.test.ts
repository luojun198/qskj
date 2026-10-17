import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createRequisition,
  deleteRequisition,
  listRequisitions,
  getAssetRequisitions,
  isCheckedOut,
} from '../services/assetRequisition.js'
import {
  createAssetTestDb,
  insertAsset,
  insertAssetDicts,
  closePeriod,
  SET_ID,
} from './helpers/assetTestDb.js'

describe('固定资产领用归还', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createAssetTestDb()
    insertAssetDicts(db)
    db.prepare('INSERT INTO fixed_asset_dept (id, account_set_id, code, name) VALUES (?,?,?,?)').run(
      'dp-2',
      SET_ID,
      'D2',
      '销售部'
    )
    insertAsset(db, {
      asset_no: 'A1',
      original_value: 12000,
      net_value: 12000,
      user_name: null,
      keeper: '老王',
      install_place: '一号车间',
    })
  })

  afterEach(() => db.close())

  const asset = () => db.prepare("SELECT * FROM fixed_asset WHERE asset_no='A1'").get() as any

  const checkout = (over: Record<string, unknown> = {}) =>
    createRequisition({
      db,
      accountSetId: SET_ID,
      assetId: 'fa-A1',
      action: 'out',
      actionDate: '2026-06-01',
      userName: '张三',
      operatorName: '测试',
      ...over,
    } as any)

  const checkin = (over: Record<string, unknown> = {}) =>
    createRequisition({
      db,
      accountSetId: SET_ID,
      assetId: 'fa-A1',
      action: 'in',
      actionDate: '2026-07-01',
      operatorName: '测试',
      ...over,
    } as any)

  // ── 领用 ──────────────────────────────────────────────────

  describe('领用登记', () => {
    it('写入台账并回写卡片上的使用人', () => {
      checkout()
      expect(asset().user_name).toBe('张三')
      const row = db.prepare("SELECT * FROM fixed_asset_requisition WHERE asset_no='A1'").get() as any
      expect(row.action).toBe('out')
      expect(row.user_name).toBe('张三')
    })

    it('可同时更新保管人与存放地点', () => {
      checkout({ keeper: '李四', installPlace: '二号车间' })
      const a = asset()
      expect(a.keeper).toBe('李四')
      expect(a.install_place).toBe('二号车间')
    })

    it('未填保管人/地点时保持卡片原值', () => {
      checkout()
      const a = asset()
      expect(a.keeper).toBe('老王')
      expect(a.install_place).toBe('一号车间')
    })

    it('领用必须填写领用人', () => {
      expect(() => checkout({ userName: '' })).toThrow(/领用人/)
    })

    it('已领用未归还时不能重复领用', () => {
      checkout()
      expect(() => checkout({ actionDate: '2026-06-15' })).toThrow(/尚未归还/)
    })

    it('已处置资产不能办理领用', () => {
      db.prepare("UPDATE fixed_asset SET scrap_date='2026-05-01' WHERE asset_no='A1'").run()
      expect(() => checkout()).toThrow(/已处置/)
    })

    it('部门编码不存在时拒绝', () => {
      expect(() => checkout({ deptCode: 'D9' })).toThrow(/不存在/)
    })

    it('日期格式非法时拒绝', () => {
      expect(() => checkout({ actionDate: '2026/06/01' })).toThrow(/YYYY-MM-DD/)
    })

    it('预计归还日期格式非法时拒绝', () => {
      expect(() => checkout({ expectReturnDate: '下个月' })).toThrow(/预计归还日期/)
    })
  })

  // ── 部门联动 ──────────────────────────────────────────────

  describe('评审 P2：日期与期间校验', () => {
    it('非真实日期、未来月份、已结账期间一律拒绝', () => {
      expect(() => checkout({ actionDate: '2026-02-30' })).toThrow(/不是有效日期/)
      expect(() => checkout({ actionDate: '2099-01-01' })).toThrow(/不能晚于当前期间/)
      closePeriod(db, 2026, 6)
      expect(() => checkout({ actionDate: '2026-06-01' })).toThrow()
    })

    it('归还日期不能早于领用日期；已结账期间的记录不能删除', () => {
      checkout()
      expect(() => checkin({ actionDate: '2026-05-20' })).toThrow(/不能早于该资产上一条领用记录/)
      const r = checkin()
      closePeriod(db, 2026, 7)
      expect(() => deleteRequisition({ db, accountSetId: SET_ID, requisitionId: r.id })).toThrow()
    })
  })

  describe('领用引起部门变化时联动记变动流水', () => {
    it('部门变化 → 写一条 change_kind=dept 的流水', () => {
      const result = checkout({ deptCode: 'D2' })
      expect(result.deptChangeId).toBeTruthy()
      expect(asset().dept_code).toBe('D2')

      const change = db.prepare("SELECT * FROM fixed_asset_change WHERE asset_no='A1'").get() as any
      expect(change.change_kind).toBe('dept')
      expect(change.old_text).toBe('D1')
      expect(change.new_text).toBe('D2')
      expect(change.change_item).toContain('资产领用')
      expect(change.year).toBe(2026)
      expect(change.period).toBe(6)
    })

    it('部门未变化 → 不写变动流水', () => {
      const result = checkout({ deptCode: 'D1' })
      expect(result.deptChangeId).toBeNull()
      expect(db.prepare('SELECT COUNT(*) c FROM fixed_asset_change').get()).toEqual({ c: 0 })
    })

    it('未指定部门 → 不写变动流水，卡片部门保持不变', () => {
      const result = checkout()
      expect(result.deptChangeId).toBeNull()
      expect(asset().dept_code).toBe('D1')
    })
  })

  // ── 归还 ──────────────────────────────────────────────────

  describe('归还登记', () => {
    it('清空卡片上的使用人', () => {
      checkout()
      checkin()
      expect(asset().user_name).toBeNull()
    })

    it('可记录归还时的成色说明', () => {
      checkout()
      checkin({ conditionNote: '外壳有划痕' })
      const row = db
        .prepare("SELECT * FROM fixed_asset_requisition WHERE action='in'")
        .get() as any
      expect(row.condition_note).toBe('外壳有划痕')
    })

    it('领用时调了部门 → 归还自动调回原部门并记一条调拨流水', () => {
      checkout({ deptCode: 'D2' })
      expect(asset().dept_code).toBe('D2')
      const r = checkin()
      expect(asset().dept_code).toBe('D1')
      expect(r.deptChangeId).toBeTruthy()
      const back = db.prepare('SELECT * FROM fixed_asset_change WHERE id=?').get(r.deptChangeId) as any
      expect(back.change_item).toContain('资产归还')
      expect(back.old_text).toBe('D2')
      expect(back.new_text).toBe('D1')
    })

    it('领用未调部门 → 归还不动部门', () => {
      checkout()
      const r = checkin()
      expect(asset().dept_code).toBe('D1')
      expect(r.deptChangeId).toBeNull()
    })

    it('领用后又手工调拨到别的部门 → 归还不回调', () => {
      checkout({ deptCode: 'D2' })
      db.prepare("INSERT INTO fixed_asset_dept (id, account_set_id, code, name) VALUES ('dp-3', ?, 'D3', '财务部')").run(SET_ID)
      db.prepare("UPDATE fixed_asset SET dept_code='D3' WHERE asset_no='A1'").run()
      checkin()
      expect(asset().dept_code).toBe('D3')
    })

    it('归还时指定部门以指定为准', () => {
      checkout({ deptCode: 'D2' })
      db.prepare("INSERT INTO fixed_asset_dept (id, account_set_id, code, name) VALUES ('dp-3', ?, 'D3', '财务部')").run(SET_ID)
      checkin({ deptCode: 'D3' })
      expect(asset().dept_code).toBe('D3')
    })

    it('没有未归还的领用记录时拒绝归还', () => {
      expect(() => checkin()).toThrow(/没有未归还/)
    })

    it('重复归还被拒绝', () => {
      checkout()
      checkin()
      expect(() => checkin({ actionDate: '2026-07-15' })).toThrow(/没有未归还/)
    })

    it('归还后可以再次领用', () => {
      checkout()
      checkin()
      expect(() => checkout({ actionDate: '2026-08-01', userName: '王五' })).not.toThrow()
      expect(asset().user_name).toBe('王五')
    })
  })

  // ── 状态判定 ──────────────────────────────────────────────

  describe('已领用未归还判定', () => {
    it('领用后为已领用状态', () => {
      expect(isCheckedOut(db, SET_ID, 'A1')).toBe(false)
      checkout()
      expect(isCheckedOut(db, SET_ID, 'A1')).toBe(true)
      checkin()
      expect(isCheckedOut(db, SET_ID, 'A1')).toBe(false)
    })

    it('同日领用后归还，按写入顺序判定为已归还', () => {
      checkout({ actionDate: '2026-06-01' })
      checkin({ actionDate: '2026-06-01' })
      expect(isCheckedOut(db, SET_ID, 'A1')).toBe(false)
    })
  })

  // ── 查询 ──────────────────────────────────────────────────

  describe('领用记录查询', () => {
    beforeEach(() => {
      checkout({ actionDate: '2026-06-01', expectReturnDate: '2026-06-30' })
      checkin({ actionDate: '2026-07-01' })
      insertAsset(db, { asset_no: 'A2', original_value: 5000, net_value: 5000 })
      createRequisition({
        db,
        accountSetId: SET_ID,
        assetId: 'fa-A2',
        action: 'out',
        actionDate: '2026-07-05',
        userName: '李四',
        expectReturnDate: '2020-01-01', // 早于今天 → 逾期
        operatorName: '测试',
      })
    })

    it('默认按日期倒序返回并带出资产名称与部门名', () => {
      const { total, rows } = listRequisitions({ db, accountSetId: SET_ID, filters: {} })
      expect(total).toBe(3)
      expect(rows[0].asset_no).toBe('A2')
      expect(rows[0].asset_name).toBe('资产A2')
    })

    it('只看未归还', () => {
      const { total, rows } = listRequisitions({
        db,
        accountSetId: SET_ID,
        filters: { outstandingOnly: true },
      })
      expect(total).toBe(1)
      expect(rows[0].asset_no).toBe('A2')
      expect(rows[0].outstanding).toBe(true)
    })

    it('只看逾期未还', () => {
      const { total, rows } = listRequisitions({
        db,
        accountSetId: SET_ID,
        filters: { overdueOnly: true },
      })
      expect(total).toBe(1)
      expect(rows[0].asset_no).toBe('A2')
    })

    it('已归还的领用记录不算未归还', () => {
      const { rows } = listRequisitions({
        db,
        accountSetId: SET_ID,
        filters: { assetNo: 'A1', action: 'out' },
      })
      expect(rows[0].outstanding).toBe(false)
    })

    it('按操作类型筛选', () => {
      const { total } = listRequisitions({ db, accountSetId: SET_ID, filters: { action: 'in' } })
      expect(total).toBe(1)
    })

    it('按领用人筛选', () => {
      const { total } = listRequisitions({
        db,
        accountSetId: SET_ID,
        filters: { userName: '李四' },
      })
      expect(total).toBe(1)
    })

    it('按日期区间筛选', () => {
      const { total } = listRequisitions({
        db,
        accountSetId: SET_ID,
        filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' },
      })
      expect(total).toBe(2)
    })

    it('按关键字筛选（编号/名称/领用人）', () => {
      const { total } = listRequisitions({
        db,
        accountSetId: SET_ID,
        filters: { keyword: '张三' },
      })
      expect(total).toBe(1)
    })

    it('分页生效', () => {
      const { rows } = listRequisitions({
        db,
        accountSetId: SET_ID,
        filters: { page: 2, pageSize: 2 },
      })
      expect(rows).toHaveLength(1)
    })

    it('按卡片查询历史', () => {
      const rows = getAssetRequisitions({ db, accountSetId: SET_ID, assetId: 'fa-A1' })
      expect(rows).toHaveLength(2)
    })
  })

  // ── 删除 ──────────────────────────────────────────────────

  describe('删除领用记录', () => {
    it('可删除最后一条', () => {
      const out = checkout()
      deleteRequisition({ db, accountSetId: SET_ID, requisitionId: out.id })
      expect(db.prepare('SELECT COUNT(*) c FROM fixed_asset_requisition').get()).toEqual({ c: 0 })
      expect(isCheckedOut(db, SET_ID, 'A1')).toBe(false)
    })

    it('删除归还记录 → 撤销联动的调回，部门回到领用部门', () => {
      checkout({ deptCode: 'D2' })
      const back = checkin()
      expect(asset().dept_code).toBe('D1')
      deleteRequisition({ db, accountSetId: SET_ID, requisitionId: back.id })
      expect(asset().dept_code).toBe('D2')
      expect(isCheckedOut(db, SET_ID, 'A1')).toBe(true)
    })

    it('删除领用记录 → 撤销联动的调拨，部门还原', () => {
      const out = checkout({ deptCode: 'D2' })
      deleteRequisition({ db, accountSetId: SET_ID, requisitionId: out.id })
      expect(asset().dept_code).toBe('D1')
      expect(db.prepare("SELECT COUNT(*) c FROM fixed_asset_change WHERE change_kind='dept'").get()).toEqual({ c: 0 })
    })

    it('不能删除中间记录（会让领用状态推演错乱）', () => {
      const out = checkout()
      checkin()
      expect(() => deleteRequisition({ db, accountSetId: SET_ID, requisitionId: out.id })).toThrow(
        /最后一条/
      )
    })

    it('记录不存在时报错', () => {
      expect(() =>
        deleteRequisition({ db, accountSetId: SET_ID, requisitionId: 'nope' })
      ).toThrow(/不存在/)
    })
  })
})
