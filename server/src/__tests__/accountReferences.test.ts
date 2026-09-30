import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountService } from '../services/accountService.js'
import {
  assertLeafAccountCode,
  auditNonLeafReferences,
  findAccountReferences,
  firstLeafDescendant,
  normalizeNonLeafReferences,
} from '../services/accountReferences.js'

const S = 'set-1'

describe('科目引用登记表', () => {
  let db: Database.Database
  let service: AccountService

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE system_params (id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT NOT NULL, param_value TEXT NOT NULL);
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, direction TEXT NOT NULL,
        level INTEGER NOT NULL, parent_id TEXT, is_aux INTEGER DEFAULT 0, aux_types TEXT, is_enabled INTEGER DEFAULT 1,
        is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0, allow_delete INTEGER DEFAULT 1, no_negative INTEGER DEFAULT 0,
        is_foreign INTEGER DEFAULT 0, currency_code TEXT, is_quantity INTEGER DEFAULT 0, quantity_unit TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE init_balances (id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, aux_item_id TEXT DEFAULT '');
      CREATE TABLE voucher_entries (id TEXT PRIMARY KEY, account_id TEXT, account_code TEXT, account_name TEXT);
      CREATE TABLE account_balances (id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, account_code TEXT, account_name TEXT);
      CREATE TABLE fixed_asset_category (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, account_code TEXT, depr_account_code TEXT);
      CREATE TABLE scm_item (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, inv_account TEXT);
      CREATE TABLE cashier_journal (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT);
      CREATE TABLE voucher_templates (id TEXT PRIMARY KEY, account_set_id TEXT, entries_data TEXT);
      CREATE TABLE role_account_scopes (id TEXT PRIMARY KEY, role_id TEXT, account_set_id TEXT, account_id TEXT, include_children INTEGER DEFAULT 1);
    `)
    const ins = db.prepare('INSERT INTO accounts (id,account_set_id,code,name,direction,level,parent_id) VALUES (?,?,?,?,?,?,?)')
    ins.run('a1601', S, '1601', '固定资产', 'debit', 1, null)
    ins.run('a1602', S, '1602', '累计折旧', 'credit', 1, null)
    service = new AccountService(db as any)
    db.prepare('INSERT INTO fixed_asset_category VALUES (?,?,?,?,?)').run('c1', S, '01', '1601', '1602')
    db.prepare('INSERT INTO scm_item VALUES (?,?,?,?)').run('i1', S, 'M1', '1601')
    db.prepare('INSERT INTO system_params VALUES (?,?,?,?)').run('p1', S, 'asset:disposal_gain_account', '1601')
    db.prepare('INSERT INTO cashier_journal VALUES (?,?,?)').run('j1', S, '1601')
    db.prepare('INSERT INTO voucher_templates VALUES (?,?,?)').run(
      't1', S, JSON.stringify([{ account_id: 'a1601', account_code: '1601', account_name: '固定资产' }])
    )
    db.prepare('INSERT INTO role_account_scopes VALUES (?,?,?,?,0)').run('rs1', 'r1', S, 'a1601')
  })

  afterEach(() => db.close())

  const addChild = (code: string, name: string, extra: Record<string, unknown> = {}) =>
    service.createAccountDetailed({ account_set_id: S, code, name, direction: 'debit', parent_id: 'a1601', ...extra } as any)

  it('父科目新增第一个子科目：设置类引用全部改指该子科目', () => {
    const r = addChild('160101', '房屋')
    expect(r.repointed?.total).toBeGreaterThanOrEqual(4)
    expect(db.prepare('SELECT account_code FROM fixed_asset_category').get()).toEqual({ account_code: '160101' })
    expect(db.prepare('SELECT inv_account FROM scm_item').get()).toEqual({ inv_account: '160101' })
    expect(db.prepare('SELECT param_value v FROM system_params').get()).toEqual({ v: '160101' })
    const tpl = JSON.parse((db.prepare('SELECT entries_data e FROM voucher_templates').get() as any).e)
    expect(tpl[0]).toMatchObject({ account_code: '160101', account_name: '房屋' })
    // 不含下级的父科目授权，补授权给新子科目
    expect(db.prepare('SELECT COUNT(*) n FROM role_account_scopes WHERE account_id=?').get(r.id)).toEqual({ n: 1 })
  })

  it('父科目没有数据要迁移时，出纳数据保持不动', () => {
    addChild('160101', '房屋')
    expect(db.prepare('SELECT account_code FROM cashier_journal').get()).toEqual({ account_code: '1601' })
  })

  it('迁移父科目数据时，account_balances 的 code/name 与出纳数据一并同步', () => {
    db.prepare("INSERT INTO account_balances VALUES ('b1', ?, 'a1601', '1601', '固定资产')").run(S)
    addChild('160101', '房屋', { migrate_from_parent: true })
    expect(db.prepare('SELECT account_code, account_name FROM account_balances').get()).toEqual({ account_code: '160101', account_name: '房屋' })
    expect(db.prepare('SELECT account_code FROM cashier_journal').get()).toEqual({ account_code: '160101' })
  })

  it('第二个子科目不再改指', () => {
    addChild('160101', '房屋')
    const r2 = addChild('160102', '机器')
    expect(r2.repointed).toBeNull()
    expect(db.prepare('SELECT account_code FROM fixed_asset_category').get()).toEqual({ account_code: '160101' })
  })

  it('全局检测发现指向父科目的设置，一键修复后为空且幂等', () => {
    // 绕过 createAccount 直接建子科目（模拟导入 / 层级修复）
    const ins = db.prepare('INSERT INTO accounts (id,account_set_id,code,name,direction,level,parent_id) VALUES (?,?,?,?,?,?,?)')
    ins.run('k1', S, '160104', '一般设备', 'debit', 2, 'a1601')
    ins.run('k0', S, '160101', '房屋', 'debit', 2, 'a1601')
    const issues = auditNonLeafReferences(db, S)
    expect(issues.length).toBeGreaterThanOrEqual(4)
    expect(issues.every(i => i.value === '1601' && i.suggested === '160101')).toBe(true)
    expect(normalizeNonLeafReferences(db, S).total).toBeGreaterThanOrEqual(4)
    expect(auditNonLeafReferences(db, S)).toEqual([])
    expect(normalizeNonLeafReferences(db, S).total).toBe(0)
    expect(firstLeafDescendant(db, S, '1601')).toEqual({ code: '160101', name: '房屋' })
  })

  it('被设置引用的科目不能删除', () => {
    expect(findAccountReferences(db, S, '1601').length).toBeGreaterThanOrEqual(4)
    expect(() => service.deleteAccount('a1601')).toThrow(/被以下设置引用/)
    db.exec('DELETE FROM fixed_asset_category; DELETE FROM scm_item; DELETE FROM system_params; DELETE FROM cashier_journal; DELETE FROM voucher_templates;')
    expect(() => service.deleteAccount('a1601')).not.toThrow()
  })

  it('保存设置时选父科目被拒绝', () => {
    addChild('160101', '房屋')
    expect(() => assertLeafAccountCode(db, S, '1601', '固定资产科目')).toThrow(/有下级科目/)
    expect(() => assertLeafAccountCode(db, S, '160101', '固定资产科目')).not.toThrow()
    expect(() => assertLeafAccountCode(db, S, '', '固定资产科目')).not.toThrow()
    expect(() => assertLeafAccountCode(db, S, '9999', '固定资产科目')).toThrow(/不存在/)
  })
})
