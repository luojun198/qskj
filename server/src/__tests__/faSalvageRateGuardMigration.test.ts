import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { up, down } from '../db/migrations/20260917_fa_salvage_rate_guard.js'

/** 2026-09-17 综合评审 P0-3：残值率 DB 触发器兜底 */
function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE fixed_asset (id TEXT PRIMARY KEY, account_set_id TEXT, asset_no TEXT, salvage_rate REAL, original_value REAL);
    CREATE TABLE fixed_asset_category (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, salvage_rate REAL);
  `)
  db.prepare("INSERT INTO fixed_asset VALUES ('a', 's', 'A1', 5, 1000)").run()
  db.prepare("INSERT INTO fixed_asset VALUES ('b', 's', 'A2', 0.05, 1000)").run()
  db.prepare("INSERT INTO fixed_asset_category VALUES ('c', 's', 'C1', 10)").run()
  return db
}

describe('迁移 126 fa_salvage_rate_guard', () => {
  it('存量 >1 修正为小数，触发器拒绝再写入百分数 / 负数，小数正常写入', () => {
    const db = makeDb()
    up(db)
    expect(db.prepare("SELECT salvage_rate FROM fixed_asset WHERE asset_no='A1'").get()).toEqual({ salvage_rate: 0.05 })
    expect(db.prepare("SELECT salvage_rate FROM fixed_asset_category WHERE code='C1'").get()).toEqual({ salvage_rate: 0.1 })

    expect(() => db.prepare("INSERT INTO fixed_asset VALUES ('x', 's', 'A3', 5, 1000)").run()).toThrow(/salvage_rate/)
    expect(() => db.prepare("UPDATE fixed_asset SET salvage_rate=500 WHERE asset_no='A2'").run()).toThrow(/salvage_rate/)
    expect(() => db.prepare("UPDATE fixed_asset SET salvage_rate=-0.1 WHERE asset_no='A2'").run()).toThrow(/salvage_rate/)
    expect(() => db.prepare("INSERT INTO fixed_asset_category VALUES ('y', 's', 'C2', 5)").run()).toThrow(/salvage_rate/)

    db.prepare("INSERT INTO fixed_asset VALUES ('z', 's', 'A4', 0.03, 1000)").run()
    db.prepare("UPDATE fixed_asset SET salvage_rate=0.08 WHERE asset_no='A2'").run()
    db.prepare("UPDATE fixed_asset SET original_value=2000 WHERE asset_no='A2'").run()
    expect(db.prepare("SELECT salvage_rate FROM fixed_asset WHERE asset_no='A2'").get()).toEqual({ salvage_rate: 0.08 })

    // 幂等
    expect(() => up(db)).not.toThrow()
    down(db)
    db.prepare("INSERT INTO fixed_asset VALUES ('w', 's', 'A5', 5, 1000)").run()
  })
})
