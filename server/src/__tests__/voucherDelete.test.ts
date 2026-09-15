import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  deleteVouchersWithRefs,
  deleteVoucherWithRefs,
  getVoucherUndeletableReason,
} from '../services/voucherDelete.js'

/** FIX-132：批量删除与单张删除共用来源守卫与关联清理 */

const SET = 'set1'

function setup() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, status TEXT, source TEXT,
      reversed_by_voucher_id TEXT, reversal_of_voucher_id TEXT
    );
    CREATE TABLE voucher_entries (id TEXT PRIMARY KEY, voucher_id TEXT);
    CREATE TABLE voucher_attachments (id TEXT PRIMARY KEY, voucher_id TEXT);
    CREATE TABLE auto_transfer_runs (id TEXT PRIMARY KEY, voucher_id TEXT);
    CREATE TABLE fx_revaluation_runs (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT);
    CREATE TABLE scm_doc (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT);
  `)
  const ins = db.prepare('INSERT INTO vouchers (id, account_set_id, voucher_no, status, source, reversed_by_voucher_id, reversal_of_voucher_id) VALUES (?,?,?,?,?,?,?)')
  ins.run('v-orig', SET, '记-1', 'draft', 'manual', 'v-red', null)
  ins.run('v-red', SET, '记-2', 'draft', 'manual', null, 'v-orig')
  ins.run('v-cash', SET, '记-3', 'draft', 'cashier', null, null)
  ins.run('v-fx', SET, '记-4', 'draft', 'fx_reval', null, null)
  db.prepare('INSERT INTO voucher_entries VALUES (?,?)').run('e1', 'v-red')
  db.prepare('INSERT INTO fx_revaluation_runs VALUES (?,?,?)').run('r1', SET, 'v-fx')
  db.prepare('INSERT INTO scm_doc VALUES (?,?,?)').run('d1', SET, 'v-red')
  return db
}

const get = (db: Database.Database, id: string) => db.prepare('SELECT * FROM vouchers WHERE id=?').get(id) as any

describe('FIX-132 凭证删除守卫与关联清理', () => {
  it('守卫：posted / cashier / asset_* 不可删', () => {
    expect(getVoucherUndeletableReason({ id: 'x', status: 'posted' })).toContain('已记账')
    expect(getVoucherUndeletableReason({ id: 'x', status: 'draft', source: 'cashier' })).toContain('出纳')
    expect(getVoucherUndeletableReason({ id: 'x', status: 'draft', source: 'asset_depreciation' })).toContain('固定资产')
    expect(getVoucherUndeletableReason({ id: 'x', status: 'draft', source: 'manual' })).toBeNull()
  })

  it('批量删除命中出纳凭证时整批拒绝，任何凭证都不被删', () => {
    const db = setup()
    expect(() => deleteVouchersWithRefs(db, SET, [get(db, 'v-red'), get(db, 'v-cash')])).toThrow(/出纳.*记-3/)
    expect(get(db, 'v-red')).toBeTruthy()
    expect(get(db, 'v-cash')).toBeTruthy()
  })

  it('删红字凭证后原凭证 reversed_by_voucher_id 置空，scm_doc 回写清除', () => {
    const db = setup()
    deleteVouchersWithRefs(db, SET, [get(db, 'v-red')])
    expect(get(db, 'v-red')).toBeUndefined()
    expect(get(db, 'v-orig').reversed_by_voucher_id).toBeNull()
    expect((db.prepare('SELECT voucher_id FROM scm_doc WHERE id=?').get('d1') as any).voucher_id).toBeNull()
    expect(db.prepare('SELECT COUNT(*) c FROM voucher_entries').get()).toEqual({ c: 0 })
  })

  it('删调汇凭证释放 fx_revaluation_runs', () => {
    const db = setup()
    deleteVoucherWithRefs(db, SET, get(db, 'v-fx'))
    expect(db.prepare('SELECT COUNT(*) c FROM fx_revaluation_runs').get()).toEqual({ c: 0 })
  })
})
