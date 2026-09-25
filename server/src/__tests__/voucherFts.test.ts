import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { ensureVoucherFts, isVoucherFtsHealthy } from '../services/voucherFts.js'
import { buildVoucherListQuery } from '../services/voucherQuery.js'

/**
 * FIX-320：凭证全文索引按 id 关联 + 启动自愈。
 * 原实现 vouchers_fts 存 rowid、voucher_entries_fts 存凭证 UUID，查询按 v.rowid 过滤，按分录摘要搜索永远命中不了；
 * 库重建后虚表丢失时关键字搜索整体报错。
 */
const SET = 's1'

function setup() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, name TEXT, code TEXT, sort_order INTEGER);
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT, year INTEGER, period INTEGER,
      status TEXT, remark TEXT, maker_name TEXT, auditor_name TEXT, poster_name TEXT, voucher_type_id TEXT, created_at TEXT);
    CREATE TABLE voucher_entries (id TEXT PRIMARY KEY, voucher_id TEXT, account_id TEXT, summary TEXT, account_code TEXT, account_name TEXT);
  `)
  db.prepare("INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_date, year, period, status, remark) VALUES ('v-a', ?, '记-1', '2026-09-01', 2026, 9, 'draft', '')").run(SET)
  db.prepare("INSERT INTO voucher_entries VALUES ('e-a', 'v-a', NULL, '安盾安保服务费', '6602', '管理费用')").run()
  return db
}

const search = (db: Database.Database, keyword: string) => {
  const q = buildVoucherListQuery({ accountSetId: SET, page: 1, pageSize: 20, keyword } as any, db as any)
  return (db.prepare(q.listSql).all(...q.listParams) as Array<{ id: string }>).map(r => r.id)
}

describe('凭证全文索引（FIX-320）', () => {
  it('虚表缺失时自愈重建，并回填已有凭证 / 分录', () => {
    const db = setup()
    expect(isVoucherFtsHealthy(db as any)).toBe(false)
    expect(ensureVoucherFts(db as any)).toBe(true)
    expect(isVoucherFtsHealthy(db as any)).toBe(true)
    expect(ensureVoucherFts(db as any)).toBe(false) // 幂等
  })

  it('按分录摘要前缀能搜到凭证（原 rowid / UUID 口径不一致时永远搜不到）', () => {
    const db = setup()
    ensureVoucherFts(db as any)
    expect(search(db, '安盾')).toEqual(['v-a'])
    expect(search(db, '记-1')).toEqual(['v-a'])
    expect(search(db, '不存在的词')).toEqual([])
  })

  it('触发器按 id 同步新增 / 修改 / 删除', () => {
    const db = setup()
    ensureVoucherFts(db as any)
    db.prepare("INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_date, year, period, status) VALUES ('v-b', ?, '记-2', '2026-09-02', 2026, 9, 'draft')").run(SET)
    db.prepare("INSERT INTO voucher_entries VALUES ('e-b', 'v-b', NULL, '差旅报销', '6602', '管理费用')").run()
    expect(search(db, '差旅')).toEqual(['v-b'])
    db.prepare("UPDATE voucher_entries SET summary='会议费' WHERE id='e-b'").run()
    expect(search(db, '差旅')).toEqual([])
    expect(search(db, '会议')).toEqual(['v-b'])
    db.prepare("DELETE FROM voucher_entries WHERE id='e-b'").run()
    expect(search(db, '会议')).toEqual([])
  })
})

describe('凭证全文索引按 rowid 定位（FIX-321）', () => {
  it('旧版触发器（按 UNINDEXED 列定位）视为不健康并自动重建为新版', () => {
    const db = setup()
    ensureVoucherFts(db as any)
    // 模拟迁移 149 留下的旧版更新触发器
    db.exec(`DROP TRIGGER vouchers_fts_update;
      CREATE TRIGGER vouchers_fts_update AFTER UPDATE ON vouchers BEGIN
        DELETE FROM vouchers_fts WHERE voucher_id = old.id;
      END;`)
    expect(isVoucherFtsHealthy(db as any)).toBe(false)
    expect(ensureVoucherFts(db as any)).toBe(true)
    expect(isVoucherFtsHealthy(db as any)).toBe(true)
    expect(search(db, '安盾')).toEqual(['v-a'])
  })

  it('只改状态等非检索字段不触发索引更新；改审核人等检索字段按 rowid 更新', () => {
    const db = setup()
    ensureVoucherFts(db as any)
    const plan = (db.prepare("EXPLAIN QUERY PLAN UPDATE vouchers_fts SET auditor_name='x' WHERE rowid = (SELECT k FROM voucher_fts_key WHERE voucher_id='v-a')").all() as any[]).map(r => r.detail).join(' | ')
    expect(plan).toMatch(/VIRTUAL TABLE INDEX 0:=|rowid/i)
    db.prepare("UPDATE vouchers SET status='audited' WHERE id='v-a'").run()
    db.prepare("UPDATE vouchers SET auditor_name='张审核' WHERE id='v-a'").run()
    expect(search(db, '张审核')).toEqual(['v-a'])
    db.prepare("DELETE FROM vouchers WHERE id='v-a'").run()
    expect((db.prepare('SELECT COUNT(*) c FROM voucher_fts_key').get() as any).c).toBe(0)
    expect((db.prepare('SELECT COUNT(*) c FROM vouchers_fts').get() as any).c).toBe(0)
  })
})
