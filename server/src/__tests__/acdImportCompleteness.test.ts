/**
 * ACD 导入完整性（阶段三）单元测试
 *
 * 覆盖：
 *  - bzk 币种档案合并进 currencies（新增不覆盖、跳过 BWB/重复、识别本位币）
 *  - zjnc（资金来源期初）列映射：科目在 index 1、辅助编码在 index 0、年份 2、币别 3
 *  - pickBaseCurrencyRows 在自定义币别列位置下仍按 BWB 过滤
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  FUND_SOURCE_NC_COLUMNS,
  parseAcdNcAmounts,
  pickBaseCurrencyRows,
  importCurrencyArchive,
  type AcdRow,
} from '../scripts/importAcdToCurrentAccountSet.js'

const ASID = 'set-1'

function createDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE currencies (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      is_base INTEGER DEFAULT 0, default_rate REAL DEFAULT 1,
      begin_rate REAL DEFAULT 1, end_rate REAL DEFAULT 1, rate_decimals INTEGER DEFAULT 4,
      is_enabled INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
    CREATE TABLE system_params (id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT);
  `)
  db.prepare("INSERT INTO system_params VALUES ('p1', ?, 'base_currency', 'RMB')").run(ASID)
  return db
}

function newStats() {
  return { currencies: { inserted: 0, updated: 0 }, importedTables: [] as string[] }
}

describe('bzk 币种档案导入 importCurrencyArchive', () => {
  it('新增 fbgl 未覆盖的币种，跳过 BWB 与重复行', () => {
    const db = createDb()
    const stats = newStats()
    importCurrencyArchive(
      ASID,
      [
        ['BWB', '1', '1', ''], // 本位币占位行 → 跳过
        ['USD', '7.2000', '2', ''],
        ['HKD', '0.9000', '2', ''],
        ['USD', '7.3000', '2', ''], // 重复 → 跳过
      ],
      stats as any,
      false,
      db
    )
    const rows = db
      .prepare('SELECT code, default_rate, is_base FROM currencies WHERE account_set_id=? ORDER BY code')
      .all(ASID) as Array<{ code: string; default_rate: number; is_base: number }>
    expect(rows.map(r => r.code)).toEqual(['HKD', 'USD'])
    expect(rows.find(r => r.code === 'USD')!.default_rate).toBe(7.2)
    expect(rows.every(r => r.is_base === 0)).toBe(true)
    expect(stats.currencies.inserted).toBe(2)
    expect(stats.importedTables).toContain('bzk.txt')
  })

  it('已存在的币种不覆盖', () => {
    const db = createDb()
    db.prepare("INSERT INTO currencies (id, account_set_id, code, name, default_rate) VALUES ('c1', ?, 'USD', '美元', 6.9)").run(ASID)
    const stats = newStats()
    importCurrencyArchive(ASID, [['USD', '7.2000', '2', '']], stats as any, false, db)
    const usd = db.prepare("SELECT default_rate FROM currencies WHERE account_set_id=? AND code='USD'").get(ASID) as any
    expect(usd.default_rate).toBe(6.9)
    expect(stats.currencies.inserted).toBe(0)
  })

  it('bwbz=1 的币种标记为本位币', () => {
    const db = createDb()
    const stats = newStats()
    importCurrencyArchive(ASID, [['USD', '7.2', '1', '']], stats as any, false, db)
    const usd = db.prepare("SELECT is_base FROM currencies WHERE account_set_id=? AND code='USD'").get(ASID) as any
    expect(usd.is_base).toBe(1)
  })
})

describe('zjnc 资金来源期初列映射', () => {
  it('按 lybm/kmbm/nf/bz 位置解析年份与借贷', () => {
    // lybm, kmbm, nf, bz, nc_jf, nc_df, jq_jf, jq_df, ...
    const row: AcdRow = ['LY01', '3001', '2026', 'BWB', '1000', '0', '200', '0', '0', '0']
    const parsed = parseAcdNcAmounts(row, FUND_SOURCE_NC_COLUMNS, 2000)
    expect(parsed.year).toBe(2026)
    expect(parsed.openingDebit).toBe(1000)
    expect(parsed.openingCredit).toBe(0)
    expect(parsed.preBookDebit).toBe(200)
    expect(parsed.preBookCredit).toBe(0)
  })

  it('贷方余额净额化到 openingCredit', () => {
    const row: AcdRow = ['LY02', '3001', '2026', 'BWB', '0', '600', '0', '0', '0', '0']
    const parsed = parseAcdNcAmounts(row, FUND_SOURCE_NC_COLUMNS, 2000)
    expect(parsed.openingDebit).toBe(0)
    expect(parsed.openingCredit).toBe(600)
  })

  it('拾取本位币行：bz 位于 index 3', () => {
    const rows: AcdRow[] = [
      ['LY01', '3001', '2026', 'USD', '10', '0'],
      ['LY01', '3001', '2026', 'BWB', '70', '0'],
    ]
    const picked = pickBaseCurrencyRows(rows, FUND_SOURCE_NC_COLUMNS.bz)
    expect(picked.length).toBe(1)
    expect(picked[0][3]).toBe('BWB')
  })
})
