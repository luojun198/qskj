import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { buildVoucherListQuery } from '../services/voucherQuery.js'

const AID = 'as1'
let db: Database.Database

function ids(extra: Record<string, unknown>) {
  const q = buildVoucherListQuery({ accountSetId: AID, page: 1, pageSize: 50, ...extra } as any, db)
  return (db.prepare(q.listSql).all(...q.listParams) as any[]).map(r => r.id)
}

beforeAll(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE voucher_types (id TEXT, account_set_id TEXT, code TEXT, name TEXT, sort_order INTEGER);
    CREATE TABLE vouchers (id TEXT, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT, voucher_date TEXT, status TEXT,
      total_amount REAL, maker_name TEXT, auditor_name TEXT, poster_name TEXT, created_at TEXT);
    CREATE TABLE voucher_entries (id TEXT, voucher_id TEXT, direction TEXT, amount REAL);
  `)
  const vt = db.prepare('INSERT INTO voucher_types VALUES (?,?,?,?,?)')
  vt.run('T1', AID, '1', '记', 1); vt.run('T2', AID, '2', '收', 2); vt.run('T3', AID, '3', '付', 3)
  const v = db.prepare('INSERT INTO vouchers VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  v.run('v1', AID, '2', 'T1', '2026-10-02', 'draft', 100, '张三', null, null, '2026-10-02 01:00:00')
  v.run('v2', AID, '1', 'T1', '2026-10-01', 'audited', 300, '李四', '王五', null, '2026-10-01 01:00:00')
  v.run('v3', AID, '1', 'T2', '2026-10-01', 'draft', 200, '张三', null, null, '2026-10-01 02:00:00')
  v.run('v4', AID, '1', 'T3', '2026-10-03', 'draft', 50, '张三', null, null, '2026-10-03 01:00:00')
  const e = db.prepare('INSERT INTO voucher_entries VALUES (?,?,?,?)')
  for (const [id, amt] of [['v1', 100], ['v2', 300], ['v3', 200], ['v4', 50]] as const) { e.run(`${id}d`, id, 'debit', amt); e.run(`${id}c`, id, 'credit', amt) }
})

describe('凭证列表多级排序（sorts）', () => {
  it('未传 sorts：保持旧逻辑 —— 凭证类型在前，再按 sortField/sortOrder', () => {
    expect(ids({ sortField: 'voucher_date', sortOrder: 'asc' })).toEqual(['v2', 'v1', 'v3', 'v4'])
  })

  it('第一排序日期降序、第二排序凭证类型升序（类型不再强制排最前）', () => {
    expect(ids({ sorts: 'voucher_date:desc,voucher_type:asc' })).toEqual(['v4', 'v1', 'v2', 'v3'])
  })

  it('凭证类型降序（多段表达式整体反向），第二排序凭证号升序', () => {
    expect(ids({ sorts: 'voucher_type:desc,voucher_no:asc' })).toEqual(['v4', 'v3', 'v2', 'v1'])
  })

  it('借方合计降序（凭证级汇总）；贷方合计与制单人等字段也可排', () => {
    expect(ids({ sorts: 'debit_amount:desc' })).toEqual(['v2', 'v3', 'v1', 'v4'])
    expect(ids({ sorts: 'maker_name:asc,total_amount:desc' })).toEqual(['v3', 'v1', 'v4', 'v2'])   // 制单人名称按二进制序：张三 < 李四
  })

  it('空值置后：审核人升序时未审核的凭证在最后', () => {
    const r = ids({ sorts: 'auditor_name:asc' })
    expect(r[0]).toBe('v2')
    expect(new Set(r.slice(1))).toEqual(new Set(['v1', 'v3', 'v4']))
  })

  it('非法 / 注入的排序键被忽略，回退旧排序', () => {
    const q = buildVoucherListQuery({ accountSetId: AID, page: 1, pageSize: 50, sorts: 'x;DROP TABLE vouchers:asc' } as any, db)
    expect(q.listSql).not.toMatch(/DROP/)
    expect(ids({ sorts: 'bogus:asc', sortField: 'voucher_date', sortOrder: 'asc' })).toEqual(['v2', 'v1', 'v3', 'v4'])
  })
})
