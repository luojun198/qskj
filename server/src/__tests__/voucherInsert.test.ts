import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { VOUCHER_NO_SEQ_SQL } from '../services/voucherEntry.js'

/**
 * FIX-009 / P1-11：插入凭证路由前置校验
 *
 * 主路由逻辑较长，但核心防护点是「序号 >= targetSeq 范围内是否存在非草稿凭证」，
 * 本测试直接验证关键 SQL 查询能正确识别冲突凭证。
 */

function setup() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      voucher_type_id TEXT,
      voucher_no TEXT,
      year INTEGER,
      period INTEGER,
      status TEXT
    );
  `)

  // 同期 6 张凭证：001~004 草稿，005 已审核（占用号），006 已记账
  const rows: Array<[string, string | null, string, string]> = [
    ['v1', 't1', '记-001', 'draft'],
    ['v2', 't1', '记-002', 'draft'],
    ['v3', 't1', '记-003', 'draft'],
    ['v4', 't1', '记-004', 'draft'],
    ['v5', 't1', '记-005', 'audited'],
    ['v6', 't1', '记-006', 'posted'],
  ]
  const ins = db.prepare(
    `INSERT INTO vouchers VALUES (?, 'set1', ?, ?, 2026, 5, ?)`
  )
  for (const [id, typeId, no, status] of rows) ins.run(id, typeId, no, status)
  return db
}

function blockingQuery() {
  return `SELECT id, voucher_no, status
          FROM vouchers
          WHERE account_set_id = ?
            AND year = ?
            AND period = ?
            AND (voucher_type_id = ? OR (voucher_type_id IS NULL AND ? IS NULL))
            AND status <> 'draft'
            AND ${VOUCHER_NO_SEQ_SQL} >= ?
          ORDER BY ${VOUCHER_NO_SEQ_SQL}
          LIMIT 1`
}

describe('FIX-009 / P1-11 插入凭证前置查询', () => {
  it('targetSeq=3 时识别到 005 已审核 / 006 已记账，返回 005（最小冲突号）', () => {
    const db = setup()
    const row = db.prepare(blockingQuery()).get('set1', 2026, 5, 't1', 't1', 3) as any
    expect(row?.voucher_no).toBe('记-005')
    expect(row?.status).toBe('audited')
  })

  it('targetSeq=6 时只剩 006 已记账冲突', () => {
    const db = setup()
    const row = db.prepare(blockingQuery()).get('set1', 2026, 5, 't1', 't1', 6) as any
    expect(row?.voucher_no).toBe('记-006')
    expect(row?.status).toBe('posted')
  })

  it('targetSeq=7（已超过所有现有号）：无冲突', () => {
    const db = setup()
    const row = db.prepare(blockingQuery()).get('set1', 2026, 5, 't1', 't1', 7) as any
    expect(row).toBeUndefined()
  })

  it('targetSeq=1：找到第一个非草稿（005）', () => {
    const db = setup()
    const row = db.prepare(blockingQuery()).get('set1', 2026, 5, 't1', 't1', 1) as any
    expect(row?.voucher_no).toBe('记-005')
  })

  it('全部为草稿时无冲突', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE vouchers (
        id TEXT PRIMARY KEY, account_set_id TEXT, voucher_type_id TEXT,
        voucher_no TEXT, year INTEGER, period INTEGER, status TEXT
      );
      INSERT INTO vouchers VALUES ('v1', 'set1', 't1', '001', 2026, 5, 'draft');
      INSERT INTO vouchers VALUES ('v2', 'set1', 't1', '002', 2026, 5, 'draft');
    `)
    const row = db.prepare(blockingQuery()).get('set1', 2026, 5, 't1', 't1', 1) as any
    expect(row).toBeUndefined()
  })

  it('NULL voucher_type_id 凭证类型隔离正常', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE vouchers (
        id TEXT PRIMARY KEY, account_set_id TEXT, voucher_type_id TEXT,
        voucher_no TEXT, year INTEGER, period INTEGER, status TEXT
      );
      INSERT INTO vouchers VALUES ('v1', 'set1', NULL, '001', 2026, 5, 'draft');
      INSERT INTO vouchers VALUES ('v2', 'set1', NULL, '002', 2026, 5, 'posted');
      -- 同期但不同类型的凭证不应干扰
      INSERT INTO vouchers VALUES ('v3', 'set1', 't1', '002', 2026, 5, 'posted');
    `)
    const row = db.prepare(blockingQuery()).get('set1', 2026, 5, null, null, 1) as any
    expect(row?.voucher_no).toBe('002')
    expect(row?.id).toBe('v2') // 只命中 type_id=NULL 的那张
  })
})
