/**
 * FIX-254：参数模式导出数据源（序时账）——按月分批取数后的输出必须与一次性查询完全一致，
 * 月合计行位置与金额正确；不支持的 key 不会静默出现。
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { EXPORT_SOURCES } from '../services/exportSources.js'
import { buildChronologicalQuery } from '../services/ledgerQuery.js'

const ASID = 'set-1'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_type_id TEXT,
      voucher_date TEXT, year INTEGER, period INTEGER, status TEXT, maker_name TEXT, auditor_name TEXT);
    CREATE TABLE voucher_entries (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, account_name TEXT, direction TEXT, amount REAL, summary TEXT, aux_data TEXT);
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, name TEXT);
    INSERT INTO voucher_types VALUES ('vt', '记');
  `)
  const insV = db.prepare("INSERT INTO vouchers VALUES (?, ?, ?, 'vt', ?, ?, ?, 'posted', '张三', NULL)")
  const insE = db.prepare('INSERT INTO voucher_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
  // 2025-12 ~ 2026-03 各 2 张凭证，跨年
  const dates = ['2025-12-20', '2025-12-31', '2026-01-05', '2026-01-28', '2026-02-10', '2026-02-11', '2026-03-01', '2026-03-31']
  dates.forEach((d, i) => {
    const id = `v${i}`
    insV.run(id, ASID, String(i + 1), d, Number(d.slice(0, 4)), Number(d.slice(5, 7)))
    insE.run(`${id}e1`, ASID, id, 1, 'a1', '1001', '库存现金', 'debit', 100 + i, `摘要${i}`)
    insE.run(`${id}e2`, ASID, id, 2, 'a2', '6001', '收入', 'credit', 100 + i, `摘要${i}`)
  })
  return db
}

async function collect(it: AsyncIterable<any[]>) {
  const out: any[][] = []
  for await (const r of it) out.push(r)
  return out
}

describe('exportSources.chronological（FIX-254）', () => {
  const keys = ['voucher_date', 'voucher_no', 'account_code', 'summary', 'debit', 'credit']

  it('按月分批的输出与一次性查询逐行一致，并在月末插入本月合计', async () => {
    const db = createDb()
    const ctx = { db, accountSetId: ASID }
    const params = { start_date: '2025-12-01', end_date: '2026-03-31' }
    const rows = await collect(EXPORT_SOURCES.chronological.rows(ctx, params, keys))

    const q = buildChronologicalQuery({ accountSetId: ASID, startDate: '2025-12-01', endDate: '2026-03-31', page: 1, pageSize: 100000 })
    const direct = db.prepare(q.listSql).all(...q.listParams) as any[]
    const dataRows = rows.filter(r => r[3] !== '本月合计')
    expect(dataRows.map(r => [r[0], r[1], r[2]])).toEqual(direct.map(r => [r.voucher_date, r.voucher_no, r.account_code]))
    expect(dataRows).toHaveLength(16)

    const subtotals = rows.filter(r => r[3] === '本月合计')
    expect(subtotals.map(r => r[0])).toEqual(['2025-12-31', '2026-01-31', '2026-02-31', '2026-03-31'])
    // 2026-01：凭证 2、3 → 借 102 + 103
    expect(subtotals[1][4]).toBe(205)
    expect(subtotals[1][5]).toBe(205)
    // 每个月合计紧跟在该月最后一行之后
    const idx = rows.findIndex(r => r[3] === '本月合计')
    expect(rows[idx - 1][0]).toBe('2025-12-31')
    expect(rows[idx + 1][0]).toBe('2026-01-05')
  })

  it('year + period 与 year 两种参数都能正确切窗', async () => {
    const db = createDb()
    const ctx = { db, accountSetId: ASID }
    const feb = await collect(EXPORT_SOURCES.chronological.rows(ctx, { year: 2026, period: 2 }, keys))
    expect(feb.filter(r => r[3] !== '本月合计')).toHaveLength(4)
    const year = await collect(EXPORT_SOURCES.chronological.rows(ctx, { year: 2026 }, keys))
    expect(year.filter(r => r[3] !== '本月合计')).toHaveLength(12)
    expect(year.filter(r => r[3] === '本月合计')).toHaveLength(3)
    expect(EXPORT_SOURCES.chronological.count(ctx, { year: 2026 })).toBe(12)
  })

  it('无任何日期参数时按账套凭证首末日期补齐窗口', async () => {
    const db = createDb()
    const rows = await collect(EXPORT_SOURCES.chronological.rows({ db, accountSetId: ASID }, {}, keys))
    expect(rows.filter(r => r[3] !== '本月合计')).toHaveLength(16)
  })
})
