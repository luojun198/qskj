/**
 * FIX-262：日记账批量写入（对账单导入共用）——疑似重复跳过、试算不写库、序号接续、错误行号取源文件行号
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { importJournalRows } from '../services/cashierJournalImport.js'

const AS = 'as1'

describe('importJournalRows', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, is_foreign INTEGER, currency_code TEXT);
      CREATE TABLE cashier_journal (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT, biz_date TEXT, seq INTEGER,
        summary TEXT, debit REAL, credit REAL, exchange_rate REAL, base_debit REAL, base_credit REAL, settle_type TEXT, bill_no TEXT,
        counter_unit TEXT, counter_account TEXT, bank_name TEXT, bank_account TEXT, unit_code TEXT, counter_aux_item_id TEXT, created_by TEXT);
      INSERT INTO accounts VALUES ('a', '${AS}', '1002', 0, NULL);
      INSERT INTO cashier_journal (id, account_set_id, account_code, currency, biz_date, seq, debit, credit, bill_no)
        VALUES ('old1', '${AS}', '1002', 'RMB', '2026-09-02', 7, 50000, 0, 'DH0902'),
               ('old2', '${AS}', '1002', 'RMB', '2026-09-05', 8, 0, 12000, NULL);
    `)
  })

  const rows = [
    { biz_date: '2026-09-02', debit: 50000, bill_no: 'DH0902', row_no: 4 },   // 重复（票据号一致）
    { biz_date: '2026-09-02', debit: 50000, bill_no: 'XX999', row_no: 5 },    // 票据号不同 → 不算重复
    { biz_date: '2026-09-05', credit: 12000, row_no: 6 },                      // 重复（已有行无票据号）
    { biz_date: '2026-09-05', credit: 12000, row_no: 7 },                      // 同文件第二笔相同交易：已有行只认领一次
    { biz_date: '2026-13-01', debit: 1, row_no: 8 },                           // 日期错误
  ]

  it('试算：识别疑似重复与错误，不写库', async () => {
    const r = await importJournalRows(db, { accountSetId: AS, accountCode: '1002', rows, maker: 't', skipDuplicates: true, dryRun: true })
    if ('error' in r) throw new Error(r.error)
    expect(r.skipped.map(s => s.row)).toEqual([4, 6])
    expect(r.errors.map(e => e.row)).toEqual([8])
    expect(r.inserted).toBe(2)
    expect((db.prepare('SELECT COUNT(*) n FROM cashier_journal').get() as any).n).toBe(2)
  })

  it('票据号相同、日期相差 ≤ 7 天也算重复（出纳 9-28 记账、银行 9-29 到账）；无票据号时日期不同不算', async () => {
    db.exec(`INSERT INTO cashier_journal (id, account_set_id, account_code, currency, biz_date, seq, debit, credit, bill_no)
      VALUES ('old3', '${AS}', '1002', 'RMB', '2026-09-28', 9, 8000, 0, 'DH0928')`)
    const r = await importJournalRows(db, {
      accountSetId: AS, accountCode: '1002', maker: 't', skipDuplicates: true, dryRun: true,
      rows: [
        { biz_date: '2026-09-29', debit: 8000, bill_no: 'DH0928', row_no: 1 },  // 同票据号、晚 1 天 → 重复
        { biz_date: '2026-09-29', debit: 8000, row_no: 2 },                      // 无票据号、日期不同 → 不算
        { biz_date: '2026-10-20', debit: 50000, bill_no: 'DH0902', row_no: 3 },  // 同票据号但相差 48 天 → 不算
      ],
    })
    if ('error' in r) throw new Error(r.error)
    expect(r.skipped.map(s => s.row)).toEqual([1])
  })

  it('正式导入：跳过重复，序号接在最大序号之后；关闭跳过则全部写入', async () => {
    const r = await importJournalRows(db, { accountSetId: AS, accountCode: '1002', rows, maker: 't', skipDuplicates: true })
    if ('error' in r) throw new Error(r.error)
    expect(r.inserted).toBe(2)
    const seqs = (db.prepare("SELECT seq FROM cashier_journal WHERE id NOT LIKE 'old%' ORDER BY seq").all() as any[]).map(x => x.seq)
    expect(seqs).toEqual([9, 10])
    const all = await importJournalRows(db, { accountSetId: AS, accountCode: '1002', rows: rows.slice(0, 4), maker: 't', skipDuplicates: false })
    if ('error' in all) throw new Error(all.error)
    expect(all.inserted).toBe(4)
  })
})
