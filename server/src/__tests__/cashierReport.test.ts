import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { v4 as uuid } from 'uuid'
import {
  AUX_NONE, getBalanceReport, getReportFilterMeta, getSummaryReport, searchJournalsReport, buildJournalWhere,
  hasJournalDetailFilter, listJournalFiltered,
} from '../services/cashierReport.js'
import { syncJournalAux, parseCounterAux } from '../services/cashierJournalAux.js'
import { EXPORT_SOURCES } from '../services/exportSources.js'
import { enrichJournalRows, listAuxColumns } from '../services/cashierQuery.js'

const S = 's1'

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, parent_id TEXT,
      is_enabled INTEGER DEFAULT 1, is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0, is_foreign INTEGER DEFAULT 0, currency_code TEXT);
    CREATE TABLE cashier_journal (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB',
      biz_date TEXT, seq INTEGER DEFAULT 0, summary TEXT, debit REAL DEFAULT 0, credit REAL DEFAULT 0,
      exchange_rate REAL DEFAULT 1, base_debit REAL DEFAULT 0, base_credit REAL DEFAULT 0,
      settle_type TEXT, bill_no TEXT, counter_unit TEXT, counter_account TEXT, reconciled INTEGER DEFAULT 0,
      voucher_id TEXT, voucher_no INTEGER, voucher_year INTEGER, voucher_month INTEGER, voucher_type INTEGER,
      counter_aux_item_id TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE cashier_init_balance (id TEXT PRIMARY KEY, account_set_id TEXT, account_code TEXT, currency TEXT DEFAULT 'RMB', balance REAL DEFAULT 0);
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, sort_order INTEGER DEFAULT 0);
    CREATE TABLE aux_items (id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT);
    CREATE TABLE settle_type (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE vouchers (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE cashier_journal_aux (id TEXT PRIMARY KEY, account_set_id TEXT, journal_id TEXT REFERENCES cashier_journal(id) ON DELETE CASCADE,
      category_id TEXT, category_code TEXT, item_id TEXT, UNIQUE(journal_id, category_id));
  `)
  const acc = db.prepare('INSERT INTO accounts (id,account_set_id,code,name,is_cash,is_bank) VALUES (?,?,?,?,?,?)')
  acc.run('a1001', S, '1001', '库存现金', 1, 0)
  acc.run('a1002', S, '1002', '银行存款', 0, 1)
  acc.run('a6602', S, '6602', '管理费用', 0, 0)
  acc.run('a6001', S, '6001', '主营业务收入', 0, 0)
  db.prepare('INSERT INTO aux_categories VALUES (?,?,?,?,0)').run('cat-dept', S, 'dept', '部门')
  db.prepare('INSERT INTO aux_items VALUES (?,?,?,?,?)').run('i-sales', S, 'cat-dept', 'D01', '销售部')
  db.prepare('INSERT INTO aux_items VALUES (?,?,?,?,?)').run('i-fin', S, 'cat-dept', 'D02', '财务部')
  db.prepare('INSERT INTO settle_type VALUES (?,?,?,?)').run('st1', S, '01', '现金')
  db.prepare('INSERT INTO settle_type VALUES (?,?,?,?)').run('st2', S, '04', '网银')
  db.prepare("INSERT INTO cashier_init_balance VALUES ('ib1', ?, '1001', 'RMB', 1000)").run(S)
  db.prepare("INSERT INTO cashier_init_balance VALUES ('ib2', ?, '1002', 'RMB', 5000.5)").run(S)
  return db
}

interface J { acc: string; date: string; d?: number; c?: number; settle?: string; counter?: string; aux?: Record<string, string>; rec?: number; voucherStatus?: string; summary?: string }
function addJ(db: Database.Database, j: J) {
  const id = uuid()
  let voucherId: string | null = null
  if (j.voucherStatus) { voucherId = uuid(); db.prepare('INSERT INTO vouchers VALUES (?,?)').run(voucherId, j.voucherStatus) }
  const aux = j.aux ? JSON.stringify(j.aux) : null
  db.prepare(`INSERT INTO cashier_journal (id,account_set_id,account_code,biz_date,summary,debit,credit,base_debit,base_credit,settle_type,counter_account,reconciled,voucher_id,counter_aux_item_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, S, j.acc, j.date, j.summary || null, j.d || 0, j.c || 0, j.d || 0, j.c || 0, j.settle || null, j.counter || null, j.rec || 0, voucherId, aux)
  syncJournalAux(db, S, id, aux)
  return id
}

describe('出纳报表统一查询', () => {
  let db: Database.Database
  beforeEach(() => {
    db = makeDb()
    addJ(db, { acc: '1001', date: '2026-08-20', d: 200 })                       // 区间前
    addJ(db, { acc: '1001', date: '2026-09-02', c: 350.3, settle: '01', counter: '6602', aux: { 'cat-dept': 'i-sales' }, summary: '差旅' })
    addJ(db, { acc: '1001', date: '2026-09-10', d: 100.1, settle: '01', counter: '6001', aux: { dept: 'i-fin' } }) // key 用类别 code
    addJ(db, { acc: '1002', date: '2026-09-05', d: 8000.25, settle: '04', counter: '6001', rec: 1, voucherStatus: 'posted' })
    addJ(db, { acc: '1002', date: '2026-09-15', c: 1200, settle: '04', counter: '6602', aux: { 'cat-dept': 'i-fin' }, voucherStatus: 'draft' })
  })

  it('辅助子表同步：类别 id / code 两种 key 都能落库，非法 JSON 忽略', () => {
    expect((db.prepare('SELECT COUNT(*) n FROM cashier_journal_aux').get() as any).n).toBe(3)
    expect(parseCounterAux('not json')).toEqual({})
    expect(parseCounterAux('[1,2]')).toEqual({})
    const id = addJ(db, { acc: '1001', date: '2026-09-20', d: 1, aux: { 'cat-dept': 'i-sales' } })
    syncJournalAux(db, S, id, null) // 清空辅助
    expect((db.prepare('SELECT COUNT(*) n FROM cashier_journal_aux WHERE journal_id=?').get(id) as any).n).toBe(0)
    db.prepare('DELETE FROM cashier_journal WHERE id=?').run(id)
  })

  it('删除流水级联删除辅助子表行', () => {
    const before = (db.prepare('SELECT COUNT(*) n FROM cashier_journal_aux').get() as any).n
    const jid = (db.prepare("SELECT journal_id j FROM cashier_journal_aux LIMIT 1").get() as any).j
    db.prepare('DELETE FROM cashier_journal WHERE id=?').run(jid)
    expect((db.prepare('SELECT COUNT(*) n FROM cashier_journal_aux').get() as any).n).toBe(before - 1)
  })

  it('余额表：按账户分开，期初+收入−支出=期末，合计=各行之和', () => {
    const r = getBalanceReport(db, { accountSetId: S, startDate: '2026-09-01', endDate: '2026-09-30' })
    const cash = r.rows.find(x => x.account_code === '1001')!
    expect(cash).toMatchObject({ opening: 1200, income: 100.1, expense: 350.3, closing: 949.8, count: 2 })
    const bank = r.rows.find(x => x.account_code === '1002')!
    expect(bank).toMatchObject({ opening: 5000.5, income: 8000.25, expense: 1200, closing: 11800.75, unreconciled_count: 1 })
    for (const row of r.rows) expect(Math.round((row.opening + row.income - row.expense) * 100)).toBe(Math.round(row.closing * 100))
    expect(r.totals).toHaveLength(1)
    expect(r.totals[0].closing).toBe(Math.round((949.8 + 11800.75) * 100) / 100)
    expect(r.total_base.closing).toBe(r.totals[0].closing)
  })

  it('余额表：账户类型与科目多选', () => {
    const cashOnly = getBalanceReport(db, { accountSetId: S, startDate: '2026-09-01', endDate: '2026-09-30', accountType: 'cash' })
    expect(cashOnly.rows.map(x => x.account_code)).toEqual(['1001'])
    const one = getBalanceReport(db, { accountSetId: S, startDate: '2026-09-01', endDate: '2026-09-30', accountCodes: ['1002'] })
    expect(one.rows.map(x => x.account_code)).toEqual(['1002'])
  })

  it('余额表：选了没有数据的币种，给出 empty_accounts 提示而不是静默', () => {
    const r = getBalanceReport(db, { accountSetId: S, startDate: '2026-09-01', endDate: '2026-09-30', currency: 'USD' })
    expect(r.rows).toHaveLength(0)
    expect(r.empty_accounts).toBe(2)
  })

  it('多维汇总：按 科目 → 结算方式 两级，小计与总计自洽且与余额表借贷一致', () => {
    const f = { accountSetId: S, startDate: '2026-09-01', endDate: '2026-09-30' }
    const sum = getSummaryReport(db, f, ['account', 'settle_type'])
    const bal = getBalanceReport(db, f)
    expect(sum.root.income).toBe(bal.total_base.income)
    expect(sum.root.expense).toBe(bal.total_base.expense)
    const cash = sum.root.children!.find(n => n.key === '1001')!
    expect(cash.children!.map(c => c.name)).toEqual(['现金'])
    const childIncome = Math.round(sum.root.children!.reduce((s, n) => s + n.income, 0) * 100)
    expect(childIncome).toBe(Math.round(sum.root.income * 100))
    expect(cash.income_ratio).toBeCloseTo(100.1 / 8100.35, 6)
  })

  it('多维汇总：按辅助类别汇总，未指定单列；筛选辅助项目只保留命中行', () => {
    const f = { accountSetId: S, startDate: '2026-09-01', endDate: '2026-09-30' }
    const sum = getSummaryReport(db, f, ['aux:cat-dept'])
    const names = sum.root.children!.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['D01 销售部', 'D02 财务部', '（未指定）']))
    const fin = sum.root.children!.find(c => c.name === 'D02 财务部')!
    expect(fin).toMatchObject({ income: 100.1, expense: 1200, count: 2 })

    const onlySales = getSummaryReport(db, { ...f, aux: [{ categoryId: 'cat-dept', itemIds: ['i-sales'] }] }, ['account'])
    expect(onlySales.root).toMatchObject({ income: 0, expense: 350.3, count: 1 })
    const none = getSummaryReport(db, { ...f, aux: [{ categoryId: 'cat-dept', itemIds: [AUX_NONE] }] }, ['account'])
    expect(none.root.count).toBe(1) // 只有银行那笔 8000.25 没填部门
    expect(none.root.income).toBe(8000.25)
  })

  it('多维汇总：维度校验', () => {
    const f = { accountSetId: S }
    expect(() => getSummaryReport(db, f, [])).toThrow()
    expect(() => getSummaryReport(db, f, ['account', 'account'])).toThrow()
    expect(() => getSummaryReport(db, f, ['nope'])).toThrow(/不支持/)
  })

  it('综合查询：凭证状态过滤、全量合计不受分页影响、带辅助文本与对方科目名', () => {
    const f = { accountSetId: S, startDate: '2026-09-01', endDate: '2026-09-30' }
    const page1 = searchJournalsReport(db, f, 1, 2)
    expect(page1.list).toHaveLength(2)
    expect(page1.total).toBe(4)
    expect(page1.totals).toEqual({ income: 8100.35, expense: 1550.3, count: 4 })
    const drafts = searchJournalsReport(db, { ...f, voucherStatus: ['draft'] })
    expect(drafts.list).toHaveLength(1)
    expect(drafts.list[0]).toMatchObject({ voucher_status: 'draft', counter_account_name: '管理费用', aux_text: '部门:财务部' })
    const none = searchJournalsReport(db, { ...f, voucherStatus: ['none'] })
    expect(none.total).toBe(2)
    const both = searchJournalsReport(db, { ...f, voucherStatus: ['none', 'posted'] })
    expect(both.total).toBe(3)
  })

  it('综合查询：摘要含 % 与 _ 按字面匹配、金额区间与方向', () => {
    addJ(db, { acc: '1001', date: '2026-09-25', d: 50, summary: '100%达标_奖励' })
    const f = { accountSetId: S, startDate: '2026-09-01', endDate: '2026-09-30' }
    expect(searchJournalsReport(db, { ...f, summary: '100%' }).total).toBe(1)
    expect(searchJournalsReport(db, { ...f, summary: '0%达' }).total).toBe(1)
    expect(searchJournalsReport(db, { ...f, summary: 'x_y' }).total).toBe(0)
    expect(searchJournalsReport(db, { ...f, amountDirection: 'income', minAmount: 100 }).total).toBe(2)
  })

  it('科目授权收敛：受限时只看到授权科目的数据', () => {
    const restricted: any = { bypass: false, restricted: true, allowedAccountIds: new Set(['a1001']) }
    const w = buildJournalWhere(db, { accountSetId: S, scope: restricted })
    const rows = db.prepare(`SELECT DISTINCT j.account_code c FROM cashier_journal j WHERE ${w.conds.join(' AND ')}`).all(...w.params) as any[]
    expect(rows.map(r => r.c)).toEqual(['1001'])
  })

  it('筛选元数据：只列出流水里用过的辅助类别 / 结算方式 / 对方科目', () => {
    const m = getReportFilterMeta(db, S)
    expect(m.aux_categories).toHaveLength(1)
    expect(m.aux_categories[0]).toMatchObject({ code: 'dept', journal_count: 3, item_count: 2 })
    expect(m.settle_types.map(x => x.code).sort()).toEqual(['', '01', '04'])
    expect(m.counter_accounts.map(x => x.code)).toEqual(['6001', '6602'])
  })

  async function collect(type: string, params: Record<string, unknown>, keys: string[], scope?: any) {
    const src = EXPORT_SOURCES[type]
    const ctx = { db, accountSetId: S, accountScope: scope }
    const rows: any[][] = []
    for await (const r of src.rows(ctx, params, keys)) rows.push(r)
    return { count: src.count(ctx, params), rows }
  }

  it('导出数据源：综合查询全量、含辅助列与凭证状态，行数与页面一致', async () => {
    const params = { start_date: '2026-09-01', end_date: '2026-09-30', currency: 'ALL' }
    const { count, rows } = await collect('cashierSearch', params, ['biz_date', 'account_name', 'aux:cat-dept', 'voucher_status', 'debit', 'credit'])
    expect(count).toBe(4)
    expect(rows).toHaveLength(4)
    // 辅助项目按类别拆成独立列（动态 key aux:<类别id>），不再是合并文本
    expect(rows.map(r => r[2]).sort()).toEqual(['', '财务部', '财务部', '销售部'])
    expect(rows.map(r => r[3])).toEqual(expect.arrayContaining(['草稿', '已记账']))
  })

  it('导出数据源：余额表与多维汇总（含小计、合计）', async () => {
    const bal = await collect('cashierBalance', { start_date: '2026-09-01', end_date: '2026-09-30' }, ['account_code', 'opening', 'income', 'expense', 'closing'])
    expect(bal.rows).toEqual([['1001', 1200, 100.1, 350.3, 949.8], ['1002', 5000.5, 8000.25, 1200, 11800.75]])
    const sum = await collect('cashierSummary', { start_date: '2026-09-01', end_date: '2026-09-30', group_by: ['account', 'settle_type'] }, ['dim_0', 'dim_1', 'income', 'expense'])
    // 小计 / 合计标签落在其所在层级的列：账户小计在 dim_0，合计在第一列
    expect(sum.rows.some(r => String(r[0]).includes('小计'))).toBe(true)
    const total = sum.rows.find(r => r[0] === '合计')!
    expect(total[2]).toBe(8100.35)
    expect(total[3]).toBe(1550.3)
  })

  it('导出数据源：受限科目授权下只导出授权科目', async () => {
    const scope: any = { bypass: false, restricted: true, allowedAccountIds: new Set(['a1002']) }
    const { rows } = await collect('cashierSearch', { start_date: '2026-09-01', end_date: '2026-09-30', currency: 'ALL' }, ['account_code'], scope)
    expect(new Set(rows.map(r => r[0]))).toEqual(new Set(['1002']))
  })

  it('性能冒烟：3 万条流水下余额表 / 多维汇总 / 辅助筛选都在秒级内', () => {
    db.exec('CREATE INDEX IF NOT EXISTS idx_perf ON cashier_journal(account_set_id, account_code, currency, biz_date)')
    const ins = db.prepare(`INSERT INTO cashier_journal (id,account_set_id,account_code,biz_date,debit,credit,base_debit,base_credit,settle_type,counter_account,counter_aux_item_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    const insAux = db.prepare('INSERT INTO cashier_journal_aux (id,account_set_id,journal_id,category_id,category_code,item_id) VALUES (?,?,?,?,?,?)')
    db.transaction(() => {
      for (let i = 0; i < 30000; i++) {
        const id = uuid()
        const acc = i % 2 ? '1001' : '1002'
        const d = i % 3 ? 100 + (i % 7) : 0
        const c = i % 3 ? 0 : 50 + (i % 5)
        const day = String(1 + (i % 28)).padStart(2, '0')
        ins.run(id, S, acc, `2026-09-${day}`, d, c, d, c, i % 2 ? '01' : '04', i % 4 ? '6602' : '6001', null)
        insAux.run(uuid(), S, id, 'cat-dept', 'dept', i % 2 ? 'i-sales' : 'i-fin')
      }
    })()
    const f = { accountSetId: S, startDate: '2026-09-01', endDate: '2026-09-30' }
    const t0 = Date.now()
    const bal = getBalanceReport(db, f)
    const sum = getSummaryReport(db, f, ['account', 'settle_type', 'aux:cat-dept'])
    const flt = searchJournalsReport(db, { ...f, aux: [{ categoryId: 'cat-dept', itemIds: ['i-sales'] }] }, 1, 100)
    const ms = Date.now() - t0
    expect(ms).toBeLessThan(3000)
    expect(sum.root.income).toBe(bal.total_base.income)
    expect(flt.total).toBeGreaterThan(10000)
  })

  it('综合查询：辅助类别按列拆开——aux_columns 取筛选全集（翻页不变），行带 aux_values', () => {
    // 再加一个「人员」类别，只在某一天的一笔流水里出现
    db.prepare('INSERT INTO aux_categories VALUES (?,?,?,?,1)').run('cat-person', S, 'person', '人员')
    db.prepare('INSERT INTO aux_items VALUES (?,?,?,?,?)').run('p-zhang', S, 'cat-person', 'P01', '张三')
    addJ(db, { acc: '1001', date: '2026-09-28', d: 10, aux: { 'cat-dept': 'i-sales', 'cat-person': 'p-zhang' } })
    const f = { accountSetId: S, startDate: '2026-09-01', endDate: '2026-09-30' }
    const p1 = searchJournalsReport(db, f, 1, 2)
    const p2 = searchJournalsReport(db, f, 2, 2)
    expect(p1.aux_columns.map(c => c.name)).toEqual(['部门', '人员']) // 按类别 sort_order
    expect(p2.aux_columns).toEqual(p1.aux_columns)                      // 翻页不变
    const row = searchJournalsReport(db, f, 1, 50).list.find(r => r.biz_date === '2026-09-28')!
    expect(row.aux_values).toEqual({ 'cat-dept': '销售部', 'cat-person': '张三' })
    // 筛选范围内没有人员数据时，「人员」列不出现
    const early = searchJournalsReport(db, { ...f, endDate: '2026-09-20' }, 1, 50)
    expect(early.aux_columns.map(c => c.name)).toEqual(['部门'])
    // 完全没有辅助数据的范围：无动态列
    const none = searchJournalsReport(db, { accountSetId: S, startDate: '2026-08-01', endDate: '2026-08-31' }, 1, 50)
    expect(none.aux_columns).toEqual([])
  })

  it('流水账口径：enrichJournalRows 带 aux_values / aux_text，listAuxColumns 按条件取类别', () => {
    const rows = db.prepare("SELECT * FROM cashier_journal WHERE account_code='1001' ORDER BY biz_date").all() as any[]
    enrichJournalRows(db, S, rows)
    const r = rows.find(x => x.biz_date === '2026-09-02')
    expect(r.aux_values).toEqual({ 'cat-dept': '销售部' })
    expect(r.aux_text).toBe('部门:销售部')
    expect(r.counter_account_name).toBe('管理费用')
    const cols = listAuxColumns(db, S, "SELECT 1 FROM cashier_journal j WHERE j.id = ax.journal_id AND j.account_code = ?", ['1002'])
    expect(cols.map(c => c.name)).toEqual(['部门'])
    const colsNone = listAuxColumns(db, S, "SELECT 1 FROM cashier_journal j WHERE j.id = ax.journal_id AND j.account_code = ?", ['9999'])
    expect(colsNone).toEqual([])
  })

  it('导出数据源声明动态列前缀 aux:（流水账导出的行映射见下一条用例的 enrich 结果）', () => {
    expect(EXPORT_SOURCES.cashierSearch.keyPrefixes).toContain('aux:')
    expect(EXPORT_SOURCES.cashierJournal.keyPrefixes).toContain('aux:')
    expect(EXPORT_SOURCES.cashierJournal.keys).not.toContain('aux')
    expect(EXPORT_SOURCES.cashierSearch.keys).not.toContain('aux')
  })

  describe('流水账表头筛选：只列命中行，余额仍是完整流水里的真实余额', () => {
    const base = { opening: 1200, currency: 'RMB', totalDebit: 100.1, totalCredit: 350.3, totalBaseDebit: 100.1, totalBaseCredit: 350.3 }
    const p = { accountSetId: S, accountCode: '1001', startDate: '2026-09-01', endDate: '2026-09-30' }
    const f = (extra: any) => ({ accountSetId: S, ...extra })

    it('检测是否带明细筛选', () => {
      expect(hasJournalDetailFilter({})).toBe(false)
      expect(hasJournalDetailFilter({ settleTypes: ['01'] })).toBe(true)
      expect(hasJournalDetailFilter({ reconciled: 0 })).toBe(true)
      expect(hasJournalDetailFilter({ aux: [{ categoryId: '' }] })).toBe(false)
    })

    it('按对方科目筛选：命中行的余额包含被筛掉的前序流水', () => {
      const r = listJournalFiltered(db, p, f({ counterAccounts: ['6001'] }), base)
      expect(r.rows).toHaveLength(1)
      // 期初 1200 − 09-02 支出 350.3（已被筛掉）+ 本行收入 100.1 = 949.8
      expect(r.rows[0].balance).toBe(949.8)
      expect(r.total).toBe(1)
      expect(r.filteredTotalDebit).toBe(100.1)
      expect(r.filteredTotalCredit).toBe(0)
      expect(r.opening).toBe(1200) // 期初保持全量
    })

    it('按辅助项目 / 结算方式 / 摘要筛选，行带按类别的辅助值', () => {
      const a = listJournalFiltered(db, p, f({ aux: [{ categoryId: 'cat-dept', itemIds: ['i-sales'] }] }), base)
      expect(a.rows.map(r => r.biz_date)).toEqual(['2026-09-02'])
      expect(a.rows[0].balance).toBe(849.7)
      expect((a.rows[0] as any).aux_values).toEqual({ 'cat-dept': '销售部' })
      expect(listJournalFiltered(db, p, f({ settleTypes: ['01'] }), base).total).toBe(2)
      expect(listJournalFiltered(db, p, f({ summary: '差旅' }), base).total).toBe(1)
      expect(listJournalFiltered(db, p, f({ summary: '不存在' }), base).rows).toEqual([])
    })

    it('凭证状态与对账状态筛选，翻页有效', () => {
      addJ(db, { acc: '1001', date: '2026-09-12', d: 5, voucherStatus: 'audited', rec: 1 })
      const v = listJournalFiltered(db, p, f({ voucherStatus: ['audited'] }), base)
      expect(v.total).toBe(1)
      expect(v.rows[0].balance).toBe(954.8) // 949.8 + 5
      expect(listJournalFiltered(db, p, f({ reconciled: 1 }), base).total).toBe(1)
      const pg = listJournalFiltered(db, { ...p, page: 2, pageSize: 1 }, f({ settleTypes: ['01'] }), base)
      expect(pg.total).toBe(2)
      expect(pg.rows.map(r => r.biz_date)).toEqual(['2026-09-10'])
    })
  })

  it('多维汇总：两个辅助类别同时分组（部门 × 人员），各一层且合计自洽', () => {
    db.prepare('INSERT INTO aux_categories VALUES (?,?,?,?,1)').run('cat-person', S, 'person', '人员')
    db.prepare('INSERT INTO aux_items VALUES (?,?,?,?,?)').run('p-zhang', S, 'cat-person', 'P01', '张三')
    db.prepare('INSERT INTO aux_items VALUES (?,?,?,?,?)').run('p-li', S, 'cat-person', 'P02', '李四')
    addJ(db, { acc: '1001', date: '2026-09-11', d: 10, aux: { 'cat-dept': 'i-sales', 'cat-person': 'p-zhang' } })
    addJ(db, { acc: '1001', date: '2026-09-12', d: 20, aux: { 'cat-dept': 'i-sales', 'cat-person': 'p-li' } })
    addJ(db, { acc: '1001', date: '2026-09-13', d: 40, aux: { 'cat-dept': 'i-fin' } })
    const f = { accountSetId: S, startDate: '2026-09-11', endDate: '2026-09-13' }
    const sum = getSummaryReport(db, f, ['aux:cat-dept', 'aux:cat-person'])
    expect(sum.root).toMatchObject({ income: 70, expense: 0, count: 3 })
    const sales = sum.root.children!.find(c => c.name === 'D01 销售部')!
    expect(sales.children!.map(c => [c.name, c.income])).toEqual([['P01 张三', 10], ['P02 李四', 20]])
    const fin = sum.root.children!.find(c => c.name === 'D02 财务部')!
    expect(fin.children!.map(c => c.name)).toEqual(['（未指定）']) // 财务部那笔没填人员
    const childSum = sum.root.children!.reduce((t, c) => t + Math.round(c.income * 100), 0)
    expect(childSum).toBe(7000)
  })
})
