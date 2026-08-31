import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  buildYearEndBalances,
  closeAccountingPeriod,
  closeAllAccountingPeriods,
  getPeriodCloseYearBounds,
  openAccountingPeriod,
  openAllAccountingPeriods,
  splitSignedBalance,
  validateProfitLossClosedFromRows,
} from '../services/yearClosing.js'
import { getProfitLossAccountCodePrefixes } from '../services/staticReportConfig.js'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (
      id TEXT PRIMARY KEY,
      start_date TEXT NOT NULL
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      direction TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      init_balance REAL NOT NULL DEFAULT 0,
      init_debit REAL NOT NULL DEFAULT 0,
      init_credit REAL NOT NULL DEFAULT 0,
      aux_item_id TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      opening_debit REAL NOT NULL DEFAULT 0,
      opening_credit REAL NOT NULL DEFAULT 0,
      pre_book_debit REAL NOT NULL DEFAULT 0,
      pre_book_credit REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual', -- FIX-003 / P0-9
      UNIQUE(account_set_id, account_id, year, period, aux_item_id)
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      voucher_no TEXT NOT NULL,
      voucher_date TEXT NOT NULL,
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      status TEXT NOT NULL,
      total_amount REAL DEFAULT 0
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      voucher_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      account_id TEXT NOT NULL,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount REAL NOT NULL,
      dept_id TEXT,
      project_id TEXT,
      supplier_id TEXT,
      person_id TEXT,
      func_class_id TEXT,
      aux_data TEXT
    );
    CREATE TABLE period_closing (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      closed_by TEXT,
      closed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(account_set_id, year, period)
    );
  `)
  db.prepare('INSERT INTO account_sets (id, start_date) VALUES (?, ?)').run('set-1', '2026-01-01')
  db.prepare('INSERT INTO accounts (id, account_set_id, code, name, direction) VALUES (?, ?, ?, ?, ?)').run(
    'cash',
    'set-1',
    '1001',
    '库存现金',
    'debit'
  )
  db.prepare('INSERT INTO accounts (id, account_set_id, code, name, direction) VALUES (?, ?, ?, ?, ?)').run(
    'payable',
    'set-1',
    '2202',
    '应付账款',
    'credit'
  )
  return db
}

function closeMonths(db: Database.Database) {
  const insert = db.prepare(
    "INSERT INTO period_closing (id, account_set_id, year, period, status) VALUES (?, 'set-1', 2026, ?, 'closed')"
  )
  for (let period = 1; period <= 11; period += 1) {
    insert.run(`close-${period}`, period)
  }
}

function insertVoucher(db: Database.Database, params: { id: string; period: number; status?: string }) {
  db.prepare(
    `
    INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_date, year, period, status)
    VALUES (?, 'set-1', ?, ?, 2026, ?, ?)
  `
  ).run(params.id, params.id, `2026-${String(params.period).padStart(2, '0')}-15`, params.period, params.status || 'posted')
}

function insertEntry(
  db: Database.Database,
  params: {
    id: string
    voucherId: string
    accountId: string
    accountCode: string
    accountName: string
    direction: 'debit' | 'credit'
    amount: number
    deptId?: string
  }
) {
  db.prepare(
    `
    INSERT INTO voucher_entries (
      id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
      direction, amount, dept_id
    )
    VALUES (?, 'set-1', ?, 1, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    params.id,
    params.voucherId,
    params.accountId,
    params.accountCode,
    params.accountName,
    params.direction,
    params.amount,
    params.deptId || null
  )
}

describe('yearClosing', () => {
  it('按科目方向拆分下一年期初借贷金额', () => {
    expect(splitSignedBalance('debit', 120)).toEqual({ initBalance: 120, initDebit: 120, initCredit: 0 })
    expect(splitSignedBalance('debit', -80)).toEqual({ initBalance: -80, initDebit: 0, initCredit: 80 })
    expect(splitSignedBalance('credit', 300)).toEqual({ initBalance: 300, initDebit: 0, initCredit: 300 })
    expect(splitSignedBalance('credit', -40)).toEqual({ initBalance: -40, initDebit: 40, initCredit: 0 })
  })

  it('生成年末余额时按辅助核算维度分别结转', () => {
    const db = createDb()
    db.prepare(
      `
      INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id)
      VALUES ('ib1', 'set-1', 'cash', 'debit', 2026, 1, 100, 100, 0, '')
    `
    ).run()
    insertVoucher(db, { id: 'v1', period: 12 })
    insertEntry(db, {
      id: 'e1',
      voucherId: 'v1',
      accountId: 'cash',
      accountCode: '1001',
      accountName: '库存现金',
      direction: 'debit',
      amount: 50,
      deptId: 'dept-a',
    })
    insertEntry(db, {
      id: 'e2',
      voucherId: 'v1',
      accountId: 'cash',
      accountCode: '1001',
      accountName: '库存现金',
      direction: 'credit',
      amount: 20,
      deptId: 'dept-b',
    })

    const rows = buildYearEndBalances(db, 'set-1', 2026)

    expect(rows).toMatchObject([
      { accountId: 'cash', auxItemId: '', initBalance: 100, initDebit: 100, initCredit: 0 },
      { accountId: 'cash', auxItemId: 'dept:dept-a', initBalance: 50, initDebit: 50, initCredit: 0 },
      { accountId: 'cash', auxItemId: 'dept:dept-b', initBalance: -20, initDebit: 0, initCredit: 20 },
    ])
  })

  it('12月结账写入下一年度期初余额并关闭期间', () => {
    const db = createDb()
    closeMonths(db)
    db.prepare(
      `
      INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id)
      VALUES ('ib1', 'set-1', 'payable', 'credit', 2026, 1, 200, 0, 200, '')
    `
    ).run()
    insertVoucher(db, { id: 'v1', period: 12 })
    insertEntry(db, {
      id: 'e1',
      voucherId: 'v1',
      accountId: 'payable',
      accountCode: '2202',
      accountName: '应付账款',
      direction: 'credit',
      amount: 80,
    })

    const result = closeAccountingPeriod({
      db,
      accountSetId: 'set-1',
      year: 2026,
      period: 12,
      userId: 'u1',
    })

    expect(result).toEqual({
      closedYear: 2026,
      closedPeriod: 12,
      nextYear: 2027,
      carriedCount: 1,
      overwrittenNextYearOpening: false,
      preservedManualOpeningCount: 0, // FIX-003：无手工调整时为 0
    })
    expect(
      db.prepare('SELECT status FROM period_closing WHERE account_set_id=? AND year=? AND period=?').get('set-1', 2026, 12)
    ).toMatchObject({ status: 'closed' })
    expect(
      db.prepare('SELECT year, init_balance, init_debit, init_credit, opening_credit FROM init_balances WHERE year=2027').get()
    ).toMatchObject({ year: 2027, init_balance: 280, init_debit: 0, init_credit: 280, opening_credit: 280 })
  })

  it('存在未记账凭证时阻止结账', () => {
    const db = createDb()
    insertVoucher(db, { id: 'v1', period: 5, status: 'audited' })

    expect(() =>
      closeAccountingPeriod({
        db,
        accountSetId: 'set-1',
        year: 2026,
        period: 5,
      })
    ).toThrow('存在未记账凭证')
  })

  it('下一年度已有凭证时仍可重新计算并覆盖期初', () => {
    const db = createDb()
    closeMonths(db)
    insertVoucher(db, { id: 'v-next', period: 1 })
    db.prepare("UPDATE vouchers SET year=2027, voucher_date='2027-01-10' WHERE id='v-next'").run()

    const result = closeAccountingPeriod({
      db,
      accountSetId: 'set-1',
      year: 2026,
      period: 12,
    })

    expect(result).toMatchObject({
      closedYear: 2026,
      closedPeriod: 12,
      nextYear: 2027,
      overwrittenNextYearOpening: true,
    })
    expect(db.prepare('SELECT COUNT(*) as count FROM init_balances WHERE year=2027').get()).toMatchObject({
      count: 0,
    })
    expect(db.prepare('SELECT COUNT(*) as count FROM vouchers WHERE year=2027').get()).toMatchObject({
      count: 1,
    })
  })
  it('12月反结账会撤销下一年度期初余额', () => {
    const db = createDb()
    closeMonths(db)
    db.prepare(
      `
      INSERT INTO period_closing (id, account_set_id, year, period, status)
      VALUES ('close-12', 'set-1', 2026, 12, 'closed')
    `
    ).run()
    // FIX-003：模拟"年结自动写入"的下年期初行，反结账应当删除
    db.prepare(
      `
      INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id, source)
      VALUES ('next-ib', 'set-1', 'cash', 'debit', 2027, 1, 100, 100, 0, '', 'year_close_auto')
    `
    ).run()

    const result = openAccountingPeriod({
      db,
      accountSetId: 'set-1',
      year: 2026,
      period: 12,
    })

    expect(result).toMatchObject({
      openedYear: 2026,
      openedPeriod: 12,
      removedNextYearOpening: true,
      nextYear: 2027,
    })
    expect(db.prepare('SELECT COUNT(*) as count FROM init_balances WHERE year=2027').get()).toMatchObject({
      count: 0,
    })
    expect(db.prepare('SELECT status FROM period_closing WHERE id=?').get('close-12')).toMatchObject({
      status: 'open',
    })
  })

  it('下一年度已有凭证时仍可反结账并撤销期初', () => {
    const db = createDb()
    closeMonths(db)
    db.prepare(
      `
      INSERT INTO period_closing (id, account_set_id, year, period, status)
      VALUES ('close-12', 'set-1', 2026, 12, 'closed')
    `
    ).run()
    db.prepare(
      `
      INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id, source)
      VALUES ('next-ib', 'set-1', 'cash', 'debit', 2027, 1, 100, 100, 0, '', 'year_close_auto')
    `
    ).run()
    insertVoucher(db, { id: 'v-next', period: 1 })
    db.prepare("UPDATE vouchers SET year=2027, voucher_date='2027-01-10' WHERE id='v-next'").run()

    const result = openAccountingPeriod({
      db,
      accountSetId: 'set-1',
      year: 2026,
      period: 12,
    })

    expect(result).toMatchObject({
      openedYear: 2026,
      openedPeriod: 12,
      removedNextYearOpening: true,
      nextYear: 2027,
      nextYearVoucherCount: 1,
    })
    expect(db.prepare('SELECT COUNT(*) as count FROM init_balances WHERE year=2027').get()).toMatchObject({
      count: 0,
    })
    expect(db.prepare('SELECT COUNT(*) as count FROM vouchers WHERE year=2027').get()).toMatchObject({
      count: 1,
    })
    expect(db.prepare('SELECT status FROM period_closing WHERE id=?').get('close-12')).toMatchObject({
      status: 'open',
    })
  })

  it('反结账后重新年度结账可恢复下年期初', () => {
    const db = createDb()
    closeMonths(db)
    db.prepare(
      `
      INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id)
      VALUES ('ib1', 'set-1', 'payable', 'credit', 2026, 1, 200, 0, 200, '')
    `
    ).run()
    insertVoucher(db, { id: 'v1', period: 12 })
    insertEntry(db, {
      id: 'e1',
      voucherId: 'v1',
      accountId: 'payable',
      accountCode: '2202',
      accountName: '应付账款',
      direction: 'credit',
      amount: 80,
    })

    closeAccountingPeriod({ db, accountSetId: 'set-1', year: 2026, period: 12 })
    insertVoucher(db, { id: 'v-next', period: 1 })
    db.prepare("UPDATE vouchers SET year=2027, voucher_date='2027-01-10' WHERE id='v-next'").run()

    openAccountingPeriod({ db, accountSetId: 'set-1', year: 2026, period: 12 })

    const result = closeAccountingPeriod({
      db,
      accountSetId: 'set-1',
      year: 2026,
      period: 12,
    })

    expect(result.overwrittenNextYearOpening).toBe(true)
    expect(
      db.prepare('SELECT init_balance FROM init_balances WHERE year=2027 AND account_id=?').get('payable')
    ).toMatchObject({ init_balance: 280 })
    expect(db.prepare('SELECT COUNT(*) as count FROM vouchers WHERE year=2027').get()).toMatchObject({
      count: 1,
    })
  })

  it('全年结账依次关闭未结期间并年结', () => {
    const db = createDb()
    db.prepare(
      `
      INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id)
      VALUES ('ib1', 'set-1', 'payable', 'credit', 2026, 1, 200, 0, 200, '')
    `
    ).run()
    insertVoucher(db, { id: 'v1', period: 3 })
    insertEntry(db, {
      id: 'e1',
      voucherId: 'v1',
      accountId: 'payable',
      accountCode: '2202',
      accountName: '应付账款',
      direction: 'credit',
      amount: 50,
    })

    const result = closeAllAccountingPeriods({
      db,
      accountSetId: 'set-1',
      year: 2026,
      period: 12,
    })

    expect(result.closedPeriods).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(result.skippedPeriods).toEqual([])
    expect(result.carriedCount).toBe(1)
    expect(
      db.prepare('SELECT status FROM period_closing WHERE account_set_id=? AND year=? AND period=?').get(
        'set-1',
        2026,
        12
      )
    ).toMatchObject({ status: 'closed' })
  })

  it('全年反结账按后进先出打开全部已结期间', () => {
    const db = createDb()
    closeMonths(db)
    db.prepare(
      `
      INSERT INTO period_closing (id, account_set_id, year, period, status)
      VALUES ('close-12', 'set-1', 2026, 12, 'closed')
    `
    ).run()
    db.prepare(
      `
      INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id, source)
      VALUES ('next-ib', 'set-1', 'cash', 'debit', 2027, 1, 100, 100, 0, '', 'year_close_auto')
    `
    ).run()

    const result = openAllAccountingPeriods({
      db,
      accountSetId: 'set-1',
      year: 2026,
      period: 12,
    })

    expect(result.openedPeriods).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(db.prepare('SELECT COUNT(*) as count FROM period_closing WHERE account_set_id=? AND year=? AND status=?').get('set-1', 2026, 'closed')).toMatchObject({
      count: 0,
    })
    expect(db.prepare('SELECT COUNT(*) as count FROM init_balances WHERE year=2027').get()).toMatchObject({
      count: 0,
    })
  })

  it('全年均已结账时阻止重复全年结账', () => {
    const db = createDb()
    closeMonths(db)
    db.prepare(
      `INSERT INTO period_closing (id, account_set_id, year, period, status) VALUES ('close-12', 'set-1', 2026, 12, 'closed')`
    ).run()

    expect(() =>
      closeAllAccountingPeriods({
        db,
        accountSetId: 'set-1',
        year: 2026,
        period: 12,
      })
    ).toThrow('均已结账')
  })

  it('getPeriodCloseYearBounds 返回开账年与账末年', () => {
    const db = createDb()
    db.prepare('UPDATE account_sets SET start_date=? WHERE id=?').run('2024-06-01', 'set-1')
    db.prepare(
      `INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_date, year, period, status)
       VALUES ('v1', 'set-1', '1', '2026-03-15', 2026, 3, 'posted')`
    ).run()

    const bounds = getPeriodCloseYearBounds(db, 'set-1')
    expect(bounds.openingYear).toBe(2024)
    expect(bounds.lastVoucherYear).toBe(2026)
    expect(bounds.minYear).toBe(2024)
    expect(bounds.maxYear).toBeGreaterThanOrEqual(2026)
  })

  // ===================== FIX-003 / P0-9 反结账保护手工期初 =====================

  it('FIX-003: 反结账只删除 year_close_auto 行，手工 manual 行保留', () => {
    const db = createDb()
    closeMonths(db)
    db.prepare(
      `INSERT INTO period_closing (id, account_set_id, year, period, status)
       VALUES ('close-12', 'set-1', 2026, 12, 'closed')`
    ).run()

    // 年结自动行（应被反结账删除）
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id, source)
       VALUES ('auto1', 'set-1', 'cash', 'debit', 2027, 1, 100, 100, 0, '', 'year_close_auto')`
    ).run()
    // 用户手工行（应保留）
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id, source)
       VALUES ('manual1', 'set-1', 'payable', 'credit', 2027, 1, 500, 0, 500, '', 'manual')`
    ).run()

    openAccountingPeriod({ db, accountSetId: 'set-1', year: 2026, period: 12 })

    const surviving = db
      .prepare('SELECT id, source FROM init_balances WHERE year=2027 ORDER BY id')
      .all() as Array<{ id: string; source: string }>
    expect(surviving).toEqual([{ id: 'manual1', source: 'manual' }])
  })

  it('FIX-003: 年结时已存在手工下年期初的科目被保留，preservedManual 计数返回', () => {
    const db = createDb()
    closeMonths(db)
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id, source)
       VALUES ('ib2026', 'set-1', 'payable', 'credit', 2026, 1, 200, 0, 200, '', 'manual')`
    ).run()
    insertVoucher(db, { id: 'v1', period: 12 })
    insertEntry(db, {
      id: 'e1',
      voucherId: 'v1',
      accountId: 'payable',
      accountCode: '2202',
      accountName: '应付账款',
      direction: 'credit',
      amount: 80,
    })
    // 用户提前手工录入了 2027 期初（覆盖系统将要计算的 280）
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id, source)
       VALUES ('manual2027', 'set-1', 'payable', 'credit', 2027, 1, 999, 0, 999, '', 'manual')`
    ).run()

    const result = closeAccountingPeriod({
      db,
      accountSetId: 'set-1',
      year: 2026,
      period: 12,
    })

    expect(result.preservedManualOpeningCount).toBe(1)
    // 手工录入的 999 应保留，不被年结的 280 覆盖
    const row = db
      .prepare('SELECT init_balance, source FROM init_balances WHERE year=2027 AND account_id=?')
      .get('payable') as { init_balance: number; source: string }
    expect(row).toEqual({ init_balance: 999, source: 'manual' })
  })

  // ===================== FIX-004 / P0-8 年结前校验损益结转 =====================

  it('FIX-004: getProfitLossAccountCodePrefixes 按准则返回不同前缀', () => {
    expect(getProfitLossAccountCodePrefixes('enterprise')).toEqual(['6'])
    expect(getProfitLossAccountCodePrefixes('small_business')).toEqual(['5'])
    expect(getProfitLossAccountCodePrefixes('government')).toEqual(['4', '5'])
  })

  it('FIX-004: validateProfitLossClosedFromRows 在损益余额为 0 时通过', () => {
    expect(() =>
      validateProfitLossClosedFromRows(
        [
          {
            accountId: 'a1',
            accountCode: '6001',
            accountName: '主营业务收入',
            direction: 'credit',
            auxItemId: '',
            initBalance: 0,
            initDebit: 0,
            initCredit: 0,
          },
        ],
        ['6']
      )
    ).not.toThrow()
  })

  it('FIX-004: validateProfitLossClosedFromRows 在损益余额非零时抛错且消息含科目编码', () => {
    expect(() =>
      validateProfitLossClosedFromRows(
        [
          {
            accountId: 'a1',
            accountCode: '6001',
            accountName: '主营业务收入',
            direction: 'credit',
            auxItemId: '',
            initBalance: 500,
            initDebit: 0,
            initCredit: 500,
          },
        ],
        ['6']
      )
    ).toThrow(/6001 主营业务收入.*500\.00/)
  })

  it('FIX-004: 抛错信息中超过 10 条只显示前 10 条并提示总数', () => {
    const rows: any[] = []
    for (let i = 1; i <= 15; i++) {
      rows.push({
        accountId: `a${i}`,
        accountCode: `60${String(i).padStart(2, '0')}`,
        accountName: `损益科目${i}`,
        direction: 'credit',
        auxItemId: '',
        initBalance: 100,
        initDebit: 0,
        initCredit: 100,
      })
    }
    expect(() => validateProfitLossClosedFromRows(rows, ['6'])).toThrow(/共 15 项，仅显示前 10 项/)
  })

  it('FIX-004: 端到端 — 6001 损益余额非零时年结被拒，余额=0 时通过', () => {
    const db = createDb()
    closeMonths(db)
    // 增加损益科目 6001 主营业务收入
    db.prepare(
      `INSERT INTO accounts (id, account_set_id, code, name, direction) VALUES ('revenue', 'set-1', '6001', '主营业务收入', 'credit')`
    ).run()

    // 在 6001 上录入并过账一笔贷方 500（未结转，余额=500）
    insertVoucher(db, { id: 'v1', period: 11 })
    insertEntry(db, {
      id: 'e1',
      voucherId: 'v1',
      accountId: 'revenue',
      accountCode: '6001',
      accountName: '主营业务收入',
      direction: 'credit',
      amount: 500,
    })

    // 年结应被拒绝
    expect(() =>
      closeAccountingPeriod({
        db,
        accountSetId: 'set-1',
        year: 2026,
        period: 12,
      })
    ).toThrow(/损益类科目余额必须为 0[\s\S]*6001/)

    // 模拟结转：12 月录入借 500 转出
    insertVoucher(db, { id: 'v2', period: 12 })
    insertEntry(db, {
      id: 'e2',
      voucherId: 'v2',
      accountId: 'revenue',
      accountCode: '6001',
      accountName: '主营业务收入',
      direction: 'debit',
      amount: 500,
    })

    // 现在 6001 净余额=0，年结应成功
    const result = closeAccountingPeriod({
      db,
      accountSetId: 'set-1',
      year: 2026,
      period: 12,
    })
    expect(result.closedPeriod).toBe(12)
    // 6001 余额为 0，不会写入下年期初
    const next = db
      .prepare('SELECT COUNT(*) as c FROM init_balances WHERE year=2027 AND account_id=?')
      .get('revenue') as { c: number }
    expect(next.c).toBe(0)
  })

  it('FIX-003: 年结时旧的 year_close_auto 行被新值替换', () => {
    const db = createDb()
    closeMonths(db)
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id, source)
       VALUES ('ib2026', 'set-1', 'payable', 'credit', 2026, 1, 200, 0, 200, '', 'manual')`
    ).run()
    insertVoucher(db, { id: 'v1', period: 12 })
    insertEntry(db, {
      id: 'e1',
      voucherId: 'v1',
      accountId: 'payable',
      accountCode: '2202',
      accountName: '应付账款',
      direction: 'credit',
      amount: 80,
    })
    // 上次年结遗留的下年自动行（值过时）
    db.prepare(
      `INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id, source)
       VALUES ('stale_auto', 'set-1', 'payable', 'credit', 2027, 1, 100, 0, 100, '', 'year_close_auto')`
    ).run()

    closeAccountingPeriod({ db, accountSetId: 'set-1', year: 2026, period: 12 })

    const row = db
      .prepare('SELECT init_balance, source FROM init_balances WHERE year=2027 AND account_id=?')
      .get('payable') as { init_balance: number; source: string }
    expect(row.init_balance).toBe(280) // 旧的 100 被新计算的 280 替换
    expect(row.source).toBe('year_close_auto')
  })
})
