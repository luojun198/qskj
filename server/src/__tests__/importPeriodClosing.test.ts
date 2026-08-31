import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  buildStats,
  importPeriodClosing,
  parseAcdStartDate,
  parseAcdYearMonth,
  updateAccountSetStartDateFromXt,
} from '../scripts/importAcdToCurrentAccountSet.js'

function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY);
    CREATE TABLE period_closing (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      closed_by TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, year, period)
    );
    INSERT INTO account_sets VALUES ('set1');
  `)
  return db
}

function fetchAll(db: Database.Database, accountSetId: string) {
  return db
    .prepare(
      `SELECT year, period, status, closed_by, closed_at
       FROM period_closing WHERE account_set_id = ? ORDER BY year, period`
    )
    .all(accountSetId) as Array<{
    year: number
    period: number
    status: string
    closed_by: string | null
    closed_at: string | null
  }>
}

describe('parseAcdYearMonth', () => {
  it('应支持 "2026.01"、"2026.01.01"、"2026-01"、"2026/01/01" 各种格式', () => {
    expect(parseAcdYearMonth('2026.01')).toEqual({ year: 2026, month: 1 })
    expect(parseAcdYearMonth('2026.01.01')).toEqual({ year: 2026, month: 1 })
    expect(parseAcdYearMonth('2026-12')).toEqual({ year: 2026, month: 12 })
    expect(parseAcdYearMonth('2024/10/15')).toEqual({ year: 2024, month: 10 })
  })

  it('空 / 无效 / 越界值返回 null', () => {
    expect(parseAcdYearMonth('')).toBeNull()
    expect(parseAcdYearMonth(undefined)).toBeNull()
    expect(parseAcdYearMonth(null)).toBeNull()
    expect(parseAcdYearMonth('abc')).toBeNull()
    expect(parseAcdYearMonth('2026.13')).toBeNull() // 月份越界
    expect(parseAcdYearMonth('1800.01')).toBeNull() // 年越界
  })
})

describe('importPeriodClosing', () => {
  let db: Database.Database
  let stats: ReturnType<typeof buildStats>

  beforeEach(() => {
    db = createTestDb()
    stats = buildStats('set1', 'test')
  })

  it('正常场景：xt_kzrq=2026.01.01, xt_jzyf=2026.05 应有 1~4 月共 4 行 closed', () => {
    const xt = new Map([
      ['xt_kzrq', '2026.01.01'],
      ['xt_jzyf', '2026.05'],
    ])
    const result = importPeriodClosing('set1', xt, stats, false, db)

    expect(result.closedCount).toBe(4)
    expect(result.from).toBe('2026-01')
    expect(result.to).toBe('2026-04')

    const rows = fetchAll(db, 'set1')
    expect(rows).toHaveLength(4)
    expect(rows.map(r => `${r.year}-${r.period}`)).toEqual([
      '2026-1',
      '2026-2',
      '2026-3',
      '2026-4',
    ])
    expect(rows.every(r => r.status === 'closed')).toBe(true)
    // closed_by / closed_at 留空
    expect(rows.every(r => r.closed_by === null && r.closed_at === null)).toBe(true)
  })

  it('跨年场景：xt_kzrq=2024.10.01, xt_jzyf=2026.03 应有 17 行 closed（2024.10~2026.02）', () => {
    const xt = new Map([
      ['xt_kzrq', '2024.10.01'],
      ['xt_jzyf', '2026.03'],
    ])
    const result = importPeriodClosing('set1', xt, stats, false, db)

    expect(result.closedCount).toBe(17)
    expect(result.from).toBe('2024-10')
    expect(result.to).toBe('2026-02')

    const rows = fetchAll(db, 'set1')
    expect(rows).toHaveLength(17)
    expect(rows[0]).toMatchObject({ year: 2024, period: 10, status: 'closed' })
    expect(rows[2]).toMatchObject({ year: 2024, period: 12, status: 'closed' })
    expect(rows[3]).toMatchObject({ year: 2025, period: 1, status: 'closed' })
    expect(rows[16]).toMatchObject({ year: 2026, period: 2, status: 'closed' })
  })

  it('当前期即开账期：xt_kzrq=2026.01.01, xt_jzyf=2026.01 应有 0 行（账套刚开账未结过任何期）', () => {
    const xt = new Map([
      ['xt_kzrq', '2026.01.01'],
      ['xt_jzyf', '2026.01'],
    ])
    const result = importPeriodClosing('set1', xt, stats, false, db)

    expect(result.closedCount).toBe(0)
    expect(fetchAll(db, 'set1')).toHaveLength(0)
  })

  it('缺 xt_jzyf：函数无副作用、不抛错、返回 closedCount=0 并加 warning', () => {
    const xt = new Map([['xt_kzrq', '2026.01.01']])
    const result = importPeriodClosing('set1', xt, stats, false, db)

    expect(result.closedCount).toBe(0)
    expect(fetchAll(db, 'set1')).toHaveLength(0)
    expect(stats.warnings.some(w => w.includes('xt_jzyf'))).toBe(true)
  })

  it('缺 xt_kzrq：fallback 到 xt_jzyf 同年 1 月', () => {
    const xt = new Map([['xt_jzyf', '2026.05']])
    const result = importPeriodClosing('set1', xt, stats, false, db)

    expect(result.closedCount).toBe(4)
    expect(result.from).toBe('2026-01')
    expect(result.to).toBe('2026-04')
  })

  it('幂等性：连续调用两次结果一致；预先手工 close 的 closed_by 不被覆盖', () => {
    // 预先插入一条手工结账记录
    db.prepare(
      `INSERT INTO period_closing (id, account_set_id, year, period, status, closed_by, closed_at, created_at)
       VALUES ('preexist', 'set1', 2026, 2, 'closed', 'user-alice', '2026-03-01T10:00:00', datetime('now'))`
    ).run()

    const xt = new Map([
      ['xt_kzrq', '2026.01.01'],
      ['xt_jzyf', '2026.05'],
    ])
    importPeriodClosing('set1', xt, stats, false, db)
    const rowsFirst = fetchAll(db, 'set1')
    importPeriodClosing('set1', xt, stats, false, db)
    const rowsSecond = fetchAll(db, 'set1')

    expect(rowsFirst).toHaveLength(4)
    expect(rowsSecond).toHaveLength(4)

    // 原 closed_by/closed_at 保留
    const manual = rowsSecond.find(r => r.year === 2026 && r.period === 2)
    expect(manual?.closed_by).toBe('user-alice')
    expect(manual?.closed_at).toBe('2026-03-01T10:00:00')

    // 其它期间仍是 closed_by=NULL
    const others = rowsSecond.filter(r => !(r.year === 2026 && r.period === 2))
    expect(others.every(r => r.closed_by === null)).toBe(true)
  })

  it('dryRun=true 时不写库，但 stats 仍记录统计', () => {
    const xt = new Map([
      ['xt_kzrq', '2026.01.01'],
      ['xt_jzyf', '2026.05'],
    ])
    const result = importPeriodClosing('set1', xt, stats, true, db)

    expect(result.closedCount).toBe(4)
    expect(stats.periodClosing.closedCount).toBe(4)
    expect(fetchAll(db, 'set1')).toHaveLength(0)
  })
})

describe('parseAcdStartDate', () => {
  it('解析完整日期', () => {
    expect(parseAcdStartDate('2026.01.01')).toBe('2026-01-01')
    expect(parseAcdStartDate('2024-10-15')).toBe('2024-10-15')
  })

  it('缺日则默认为 1 日', () => {
    expect(parseAcdStartDate('2026.01')).toBe('2026-01-01')
    expect(parseAcdStartDate('2026-05')).toBe('2026-05-01')
  })

  it('无效值返回 null', () => {
    expect(parseAcdStartDate('')).toBeNull()
    expect(parseAcdStartDate('invalid')).toBeNull()
  })
})

describe('updateAccountSetStartDateFromXt', () => {
  function createAccountSetDb(startDate = '2026-01-01') {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE account_sets (
        id TEXT PRIMARY KEY,
        start_date TEXT NOT NULL,
        fiscal_year INTEGER,
        updated_at TEXT
      );
      CREATE TABLE system_params (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        param_key TEXT NOT NULL,
        param_value TEXT,
        description TEXT,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(account_set_id, param_key)
      );
      INSERT INTO account_sets VALUES ('set1', '${startDate}', 2026, '2026-01-01');
    `)
    return db
  }

  it('账套已有建账日期时保留用户填写值，不被 ACD xt_kzrq 覆盖', () => {
    const db = createAccountSetDb('2026-05-01')
    const xt = new Map([['xt_kzrq', '2024.10.01']])
    const result = updateAccountSetStartDateFromXt(db, 'set1', xt)

    expect(result).toBe('2026-05-01')
    const row = db.prepare('SELECT start_date FROM account_sets WHERE id = ?').get('set1') as {
      start_date: string
    }
    expect(row.start_date).toBe('2026-05-01')
    const param = db
      .prepare(
        `SELECT param_value FROM system_params WHERE account_set_id='set1' AND param_key='start_date'`
      )
      .get() as { param_value: string }
    expect(param.param_value).toBe('2026-05-01')
  })

  it('账套无有效建账日期时从 xt_kzrq 写入', () => {
    const db = createAccountSetDb('')
    const xt = new Map([['xt_kzrq', '2024.10.01']])
    const result = updateAccountSetStartDateFromXt(db, 'set1', xt)

    expect(result).toBe('2024-10-01')
    const row = db.prepare('SELECT start_date FROM account_sets WHERE id = ?').get('set1') as {
      start_date: string
    }
    expect(row.start_date).toBe('2024-10-01')
  })

  it('缺少 xt_kzrq 时保持原建账日期', () => {
    const db = createAccountSetDb()
    const result = updateAccountSetStartDateFromXt(db, 'set1', new Map())

    expect(result).toBe('2026-01-01')
    const row = db.prepare('SELECT start_date FROM account_sets WHERE id = ?').get('set1') as {
      start_date: string
    }
    expect(row.start_date).toBe('2026-01-01')
  })
})
