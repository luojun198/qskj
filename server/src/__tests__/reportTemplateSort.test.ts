import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

function createSortTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE report_definitions (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      source_file TEXT,
      sort_order INTEGER DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
  `)
  return db
}

function insertReport(
  db: Database.Database,
  params: { id: string; accountSetId: string; code: string; name: string; sort_order: number }
) {
  db.prepare(
    `INSERT INTO report_definitions (id, account_set_id, code, name, source, sort_order, is_enabled)
     VALUES (?, ?, ?, ?, 'manual', ?, 1)`
  ).run(params.id, params.accountSetId, params.code, params.name, params.sort_order)
}

function applySortOrder(
  db: Database.Database,
  accountSetId: string,
  orders: { code: string; sort_order: number }[]
) {
  const existing = db
    .prepare('SELECT code FROM report_definitions WHERE account_set_id = ? ORDER BY sort_order ASC, code ASC')
    .all(accountSetId) as Array<{ code: string }>

  if (orders.length !== existing.length) {
    throw new Error(`orders 必须包含全部 ${existing.length} 个报表`)
  }

  const existingCodes = new Set(existing.map(row => row.code))
  for (const item of orders) {
    if (!existingCodes.has(item.code)) {
      throw new Error(`未找到报表: ${item.code}`)
    }
  }

  db.transaction(() => {
    const updateStmt = db.prepare(
      `UPDATE report_definitions SET sort_order = ?, updated_at = datetime('now') WHERE account_set_id = ? AND code = ?`
    )
    for (const item of orders) {
      updateStmt.run(item.sort_order, accountSetId, item.code)
    }
  })()
}

function listReports(db: Database.Database, accountSetId: string) {
  return db
    .prepare(
      `SELECT code, name, sort_order FROM report_definitions WHERE account_set_id = ? ORDER BY sort_order ASC, code ASC`
    )
    .all(accountSetId) as Array<{ code: string; name: string; sort_order: number }>
}

describe('reportTemplateSort', () => {
  it('应按 sort_order 更新全部报表顺序', () => {
    const db = createSortTestDb()
    const accountSetId = 'as1'
    insertReport(db, { id: '1', accountSetId, code: 'r03', name: '报表3', sort_order: 1 })
    insertReport(db, { id: '2', accountSetId, code: 'r01', name: '报表1', sort_order: 2 })
    insertReport(db, { id: '3', accountSetId, code: 'r02', name: '报表2', sort_order: 3 })

    applySortOrder(db, accountSetId, [
      { code: 'r02', sort_order: 1 },
      { code: 'r03', sort_order: 2 },
      { code: 'r01', sort_order: 3 },
    ])

    expect(listReports(db, accountSetId).map(row => row.code)).toEqual(['r02', 'r03', 'r01'])
  })

  it('orders 数量不足时应拒绝', () => {
    const db = createSortTestDb()
    const accountSetId = 'as1'
    insertReport(db, { id: '1', accountSetId, code: 'r01', name: '报表1', sort_order: 1 })
    insertReport(db, { id: '2', accountSetId, code: 'r02', name: '报表2', sort_order: 2 })

    expect(() =>
      applySortOrder(db, accountSetId, [{ code: 'r01', sort_order: 1 }])
    ).toThrow('orders 必须包含全部 2 个报表')
  })

  it('未知 code 时应拒绝', () => {
    const db = createSortTestDb()
    const accountSetId = 'as1'
    insertReport(db, { id: '1', accountSetId, code: 'r01', name: '报表1', sort_order: 1 })

    expect(() =>
      applySortOrder(db, accountSetId, [{ code: 'missing', sort_order: 1 }])
    ).toThrow('未找到报表: missing')
  })

  it('不同账套之间应隔离', () => {
    const db = createSortTestDb()
    insertReport(db, { id: '1', accountSetId: 'as1', code: 'r01', name: '账套1', sort_order: 1 })
    insertReport(db, { id: '2', accountSetId: 'as2', code: 'r01', name: '账套2', sort_order: 5 })

    applySortOrder(db, 'as2', [{ code: 'r01', sort_order: 2 }])

    expect(listReports(db, 'as1')[0].sort_order).toBe(1)
    expect(listReports(db, 'as2')[0].sort_order).toBe(2)
  })
})
