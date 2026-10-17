/**
 * FIX-422：账套备份导入后，模块参数里的凭证类型 id 仍指向源账套，生成折旧凭证外键失败
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getEffectiveVoucherTypeId } from '../services/voucherEntry.js'
import { remapSystemParamIdValues } from '../services/accountSetBackupRestore.js'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, sort_order INTEGER);
    CREATE TABLE vouchers (id TEXT, account_set_id TEXT, year INTEGER, period INTEGER, voucher_type_id TEXT, created_at TEXT, updated_at TEXT, voucher_date TEXT, voucher_no TEXT);
    CREATE TABLE system_params (id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT);
    INSERT INTO voucher_types VALUES ('vt-new', 'S', '1', '记账', 1);
    INSERT INTO voucher_types VALUES ('vt-other', 'OTHER', '1', '记账', 1);
  `)
})
afterEach(() => db.close())

describe('getEffectiveVoucherTypeId', () => {
  it('本账套的凭证类型照用', () => {
    expect(getEffectiveVoucherTypeId({ db, accountSetId: 'S', year: 2026, period: 11, voucherTypeId: 'vt-new' })).toBe('vt-new')
  })
  it('不存在或属于别的账套时忽略，回退到本账套默认', () => {
    expect(getEffectiveVoucherTypeId({ db, accountSetId: 'S', year: 2026, period: 11, voucherTypeId: 'vt-gone' })).toBe('vt-new')
    expect(getEffectiveVoucherTypeId({ db, accountSetId: 'S', year: 2026, period: 11, voucherTypeId: 'vt-other' })).toBe('vt-new')
  })
})

describe('remapSystemParamIdValues', () => {
  it('整值命中旧 id 的参数改为新 id，其他参数不动', () => {
    db.exec(`
      INSERT INTO system_params VALUES ('p1','S','asset:depr_voucher_type_id','vt-old');
      INSERT INTO system_params VALUES ('p2','S','asset:disposal_bank_account','1001');
      INSERT INTO system_params VALUES ('p3','OTHER','asset:depr_voucher_type_id','vt-old');
    `)
    const n = remapSystemParamIdValues(db, 'S', [new Map([['vt-old', 'vt-new'], ['1001x', 'zzz']])])
    expect(n).toBe(1)
    const get = (id: string) => (db.prepare('SELECT param_value v FROM system_params WHERE id=?').get(id) as any).v
    expect([get('p1'), get('p2'), get('p3')]).toEqual(['vt-new', '1001', 'vt-old'])
  })
})
