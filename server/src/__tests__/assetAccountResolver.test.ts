import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { ensureDefaultAssetDicts } from '../services/accountSetDefaults.js'
import { ASSET_ACCOUNT_SPECS, fallbackOriginalAccount, resolveAssetAccount } from '../services/assetAccountResolver.js'

const S = 'as1'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1);
    CREATE TABLE fixed_asset_category (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, salvage_rate REAL,
      account_code TEXT, depr_account_code TEXT, clearing_account_code TEXT, impairment_account_code TEXT);
    CREATE TABLE fixed_asset_purpose (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, expense_account TEXT);
  `)
  return db
}

function add(db: Database.Database, code: string, name: string, parentCode?: string) {
  const parent = parentCode ? (db.prepare('SELECT id FROM accounts WHERE code=?').get(parentCode) as any)?.id : null
  db.prepare('INSERT INTO accounts (id,account_set_id,code,name,parent_id) VALUES (?,?,?,?,?)').run(`id-${code}`, S, code, name, parent)
}

describe('资产默认科目：按名称定位并下探最底层', () => {
  let db: Database.Database
  beforeEach(() => { db = makeDb() })

  it('企业制度：固定资产有下级 → 类别配到对应末级，累计折旧/清理/减值配末级', () => {
    add(db, '1601', '固定资产')
    add(db, '1601001', '房屋及建筑物', '1601')
    add(db, '1601004', '一般设备', '1601')
    add(db, '1602', '累计折旧')
    add(db, '1603', '固定资产减值准备')
    add(db, '1606', '固定资产清理')
    add(db, '6602', '管理费用')
    add(db, '6602010', '折旧', '6602')
    const res = ensureDefaultAssetDicts(db as any, S)
    expect(res.unresolved).toEqual(expect.arrayContaining(['经营用折旧费用科目', '生产用折旧费用科目']))
    const cats = db.prepare('SELECT code, account_code, depr_account_code, clearing_account_code, impairment_account_code FROM fixed_asset_category ORDER BY code').all() as any[]
    expect(cats.find(c => c.code === '01')).toMatchObject({ account_code: '1601001', depr_account_code: '1602', clearing_account_code: '1606', impairment_account_code: '1603' })
    expect(cats.find(c => c.code === '04')!.account_code).toBe('1601004')
    expect((db.prepare("SELECT expense_account FROM fixed_asset_purpose WHERE code='01'").get() as any).expense_account).toBe('6602010')
  })

  it('行政事业制度：没有清理/减值/销售费用等科目 → 留空并提示，不写不存在的编码', () => {
    add(db, '1601', '固定资产')
    add(db, '160103', '通用设备', '1601')
    add(db, '1602', '固定资产累计折旧')
    add(db, '5101', '单位管理费用')
    const res = ensureDefaultAssetDicts(db as any, S)
    const cat = db.prepare("SELECT * FROM fixed_asset_category WHERE code='01'").get() as any
    expect(cat.account_code).toBe('160103')
    expect(cat.depr_account_code).toBe('1602')
    expect(cat.clearing_account_code).toBeNull()
    expect(cat.impairment_account_code).toBeNull()
    expect((db.prepare("SELECT expense_account FROM fixed_asset_purpose WHERE code='01'").get() as any).expense_account).toBe('5101')
    expect(res.unresolved).toEqual(expect.arrayContaining(['固定资产清理科目', '固定资产减值准备科目', '生产用折旧费用科目']))
  })

  it('同码异名不被采纳：5001 是「主营业务收入」时，生产用折旧费用科目留空', () => {
    add(db, '5001', '主营业务收入')
    const r = resolveAssetAccount(db as any, S, ASSET_ACCOUNT_SPECS.depreciationExpense(['制造费用'], ['5001']))
    expect(r).toBeNull()
  })

  it('折旧费用科目：根有下级但没有「折旧」末级时留空，不随手取「维修费」', () => {
    add(db, '6601', '销售费用')
    add(db, '6601001', '商品维修费', '6601')
    expect(resolveAssetAccount(db as any, S, ASSET_ACCOUNT_SPECS.depreciationExpense(['销售费用'], ['6601']))).toBeNull()
    add(db, '6601002', '折旧费', '6601')
    expect(resolveAssetAccount(db as any, S, ASSET_ACCOUNT_SPECS.depreciationExpense(['销售费用'], ['6601']))?.code).toBe('6601002')
  })

  it('多级嵌套取到最底层', () => {
    add(db, '1601', '固定资产')
    add(db, '160101', '生产设备', '1601')
    add(db, '16010101', '机床', '160101')
    add(db, '16010102', '车床', '160101')
    expect(resolveAssetAccount(db as any, S, ASSET_ACCOUNT_SPECS.original(['车']))?.code).toBe('16010102')
    expect(resolveAssetAccount(db as any, S, ASSET_ACCOUNT_SPECS.original())?.code).toBe('16010101')
  })

  it('固定资产清理/累计折旧不会被误认成固定资产原值', () => {
    add(db, '1602', '累计折旧')
    add(db, '1606', '固定资产清理')
    expect(resolveAssetAccount(db as any, S, ASSET_ACCOUNT_SPECS.original())).toBeNull()
    expect(fallbackOriginalAccount(db as any, S)).toBe('1601')
  })

  it('已停用的科目不参与匹配', () => {
    add(db, '1601', '固定资产')
    db.prepare("UPDATE accounts SET is_enabled=0 WHERE code='1601'").run()
    expect(resolveAssetAccount(db as any, S, ASSET_ACCOUNT_SPECS.original())).toBeNull()
  })
})
