import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  getBalance,
  getBatchBalances,
  getBatchPeriodSums,
  getPeriodSum,
} from '../services/reportBalance.js'

/**
 * 建一个最小的内存库：accounts / init_balances / account_balances。
 * 注意：getBatchBalances 现在会把 top_code 展开为子树叶子科目；
 * 测试里每个 top_code 都直接以叶子身份插入（无子科目），等价于以前的"按 code 聚合"行为。
 */
function seed(db: Database.Database, accountSetId: string) {
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      code TEXT,
      name TEXT,
      direction TEXT,
      parent_id TEXT,
      is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      account_id TEXT,
      year INTEGER,
      period INTEGER,
      init_balance REAL,
      init_debit REAL,
      init_credit REAL,
      aux_item_id TEXT DEFAULT ''
    );
    CREATE TABLE account_balances (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      account_id TEXT,
      year INTEGER,
      period INTEGER,
      current_debit REAL,
      current_credit REAL
    );
  `)

  const insertAccount = db.prepare(
    'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id, is_enabled) VALUES (?, ?, ?, ?, ?, ?, 1)'
  )
  const insertInit = db.prepare(
    'INSERT INTO init_balances (id, account_set_id, account_id, year, period, init_balance, init_debit, init_credit, aux_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const insertBal = db.prepare(
    'INSERT INTO account_balances VALUES (?, ?, ?, ?, ?, ?, ?)'
  )

  // 三个顶级叶子科目
  insertAccount.run('a1001', accountSetId, '1001', '现金', 'debit', null)
  insertAccount.run('a1002', accountSetId, '1002', '银行存款', 'debit', null)
  insertAccount.run('a2001', accountSetId, '2001', '短期借款', 'credit', null)

  insertInit.run(uuidv4(), accountSetId, 'a1001', 2026, 1, 10000, 10000, 0, '')
  insertInit.run(uuidv4(), accountSetId, 'a1002', 2026, 1, 5000, 5000, 0, '')
  insertInit.run(uuidv4(), accountSetId, 'a2001', 2026, 1, 3000, 0, 3000, '')

  // period <= 12 累计
  insertBal.run(uuidv4(), accountSetId, 'a1001', 2026, 12, 2000, 500)
  insertBal.run(uuidv4(), accountSetId, 'a1002', 2026, 12, 1000, 200)
  insertBal.run(uuidv4(), accountSetId, 'a2001', 2026, 12, 100, 1500)
}

describe('reportBalance', () => {
  describe('getBatchBalances', () => {
    it('应该批量查询多个科目的余额（按子树叶子汇总，方向沿用 top_code）', () => {
      const db = new Database(':memory:')
      const accountSetId = 'set-1'
      seed(db, accountSetId)

      const result = getBatchBalances(db, accountSetId, ['1001', '1002', '2001'], 2026, 12)
      expect(result.size).toBe(3)
      expect(result.get('1001')).toBe(10000 + 2000 - 500) // 借方：11500
      expect(result.get('1002')).toBe(5000 + 1000 - 200) // 借方：5800
      expect(result.get('2001')).toBe(3000 + 1500 - 100) // 贷方：4400
    })

    it('应该处理空科目列表', () => {
      const db = new Database(':memory:')
      const result = getBatchBalances(db, 'set-1', [], 2026, 12)
      expect(result.size).toBe(0)
    })

    it('应该为不存在的科目返回 0', () => {
      const db = new Database(':memory:')
      const accountSetId = 'set-1'
      seed(db, accountSetId)

      const result = getBatchBalances(db, accountSetId, ['1001', '9999'], 2026, 12)
      expect(result.get('1001')).toBe(11500)
      expect(result.get('9999')).toBe(0)
    })

    it('应该把 top_code 的子科目余额汇总到 top_code（叶子级，不重复父子期初）', () => {
      const db = new Database(':memory:')
      const accountSetId = 'set-1'

      db.exec(`
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
          direction TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1
        );
        CREATE TABLE init_balances (
          id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
          year INTEGER, period INTEGER, init_balance REAL,
          init_debit REAL, init_credit REAL, aux_item_id TEXT DEFAULT ''
        );
        CREATE TABLE account_balances (
          id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
          year INTEGER, period INTEGER, current_debit REAL, current_credit REAL
        );
      `)

      // 1001 父 -> 100101、100102 两个子叶子
      db.prepare(
        'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('p1001', accountSetId, '1001', '现金', 'debit', null)
      db.prepare(
        'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('c100101', accountSetId, '100101', '人民币现金', 'debit', 'p1001')
      db.prepare(
        'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('c100102', accountSetId, '100102', '外币现金', 'debit', 'p1001')

      // 期初/期间只录在叶子上（更接近实际数据）
      db.prepare(
        'INSERT INTO init_balances (id, account_set_id, account_id, year, period, init_balance, init_debit, init_credit, aux_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), accountSetId, 'c100101', 2026, 1, 6000, 6000, 0, '')
      db.prepare(
        'INSERT INTO init_balances (id, account_set_id, account_id, year, period, init_balance, init_debit, init_credit, aux_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), accountSetId, 'c100102', 2026, 1, 4000, 4000, 0, '')
      db.prepare('INSERT INTO account_balances VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        uuidv4(), accountSetId, 'c100101', 2026, 12, 1500, 300
      )
      db.prepare('INSERT INTO account_balances VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        uuidv4(), accountSetId, 'c100102', 2026, 12, 500, 200
      )

      const result = getBatchBalances(db, accountSetId, ['1001'], 2026, 12)
      // 借方：(6000+4000) + (1500+500) - (300+200) = 11500
      expect(result.get('1001')).toBe(11500)
    })

    it('期初只录入在父科目、下级叶子无数据时应取父科目汇总行', () => {
      const db = new Database(':memory:')
      const accountSetId = 'set-1'

      db.exec(`
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
          direction TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1
        );
        CREATE TABLE init_balances (
          id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
          year INTEGER, period INTEGER, init_balance REAL,
          init_debit REAL, init_credit REAL, aux_item_id TEXT DEFAULT ''
        );
        CREATE TABLE account_balances (
          id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
          year INTEGER, period INTEGER, current_debit REAL, current_credit REAL
        );
        CREATE TABLE voucher_entries (id TEXT, voucher_id TEXT, account_id TEXT, direction TEXT, amount REAL);
        CREATE TABLE vouchers (id TEXT, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT);
      `)

      db.prepare(
        'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('p1001', accountSetId, '1001', '库存现金', 'debit', null)
      db.prepare(
        'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('c100101', accountSetId, '100101', '现金', 'debit', 'p1001')
      db.prepare(
        'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('c100102', accountSetId, '100102', '受托代理资产', 'debit', 'p1001')

      // 期初只录在 1001 父科目（科目期初页常见），叶子无数据
      db.prepare(
        'INSERT INTO init_balances (id, account_set_id, account_id, year, period, init_balance, init_debit, init_credit, aux_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), accountSetId, 'p1001', 2026, 1, 15000, 15000, 0, '')

      const result = getBatchBalances(db, accountSetId, ['1001'], 2026, 5)
      expect(result.get('1001')).toBe(15000)
      expect(getBalance(db, accountSetId, '1001', 2026, 0)).toBe(15000)
    })
  })

  describe('getBatchPeriodSums', () => {
    it('应该批量查询多个科目的期间发生额', () => {
      const db = new Database(':memory:')
      const accountSetId = 'set-1'
      seed(db, accountSetId)

      const result = getBatchPeriodSums(db, accountSetId, ['1001', '1002', '2001'], 2026, 12)
      expect(result.size).toBe(3)
      expect(result.get('1001')).toEqual({ debit: 2000, credit: 500 })
      expect(result.get('1002')).toEqual({ debit: 1000, credit: 200 })
      expect(result.get('2001')).toEqual({ debit: 100, credit: 1500 })
    })

    it('应该处理空科目列表', () => {
      const db = new Database(':memory:')
      const result = getBatchPeriodSums(db, 'set-1', [], 2026, 12)
      expect(result.size).toBe(0)
    })

    it('应该为没有发生额的科目返回 0', () => {
      const db = new Database(':memory:')
      const accountSetId = 'set-1'
      seed(db, accountSetId)

      const result = getBatchPeriodSums(db, accountSetId, ['1001', '9999'], 2026, 12)
      expect(result.get('1001')).toEqual({ debit: 2000, credit: 500 })
      expect(result.get('9999')).toEqual({ debit: 0, credit: 0 })
    })
  })

  describe('getBalance / getPeriodSum', () => {
    it('getBalance 应与 getBatchBalances 一致且避免父子科目重复累加', () => {
      const db = new Database(':memory:')
      const accountSetId = 'set-1'

      db.exec(`
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
          direction TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1
        );
        CREATE TABLE init_balances (
          id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
          year INTEGER, period INTEGER, init_balance REAL,
          init_debit REAL, init_credit REAL, aux_item_id TEXT DEFAULT ''
        );
        CREATE TABLE account_balances (
          id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
          year INTEGER, period INTEGER, current_debit REAL, current_credit REAL
        );
      `)

      db.prepare(
        'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('p4104', accountSetId, '4104', '利润分配', 'credit', null)
      db.prepare(
        'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('c4104015', accountSetId, '4104015', '未分配利润', 'credit', 'p4104')

      db.prepare(
        'INSERT INTO init_balances (id, account_set_id, account_id, year, period, init_balance, init_debit, init_credit, aux_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), accountSetId, 'c4104015', 2026, 1, 91, 0, 0, '')

      expect(getBalance(db, accountSetId, '4104', 2026, 5)).toBe(91)
      expect(getBatchBalances(db, accountSetId, ['4104'], 2026, 5).get('4104')).toBe(91)
    })

    it('有辅助期初时优先科目汇总行，避免多辅助类别重复累加', () => {
      const db = new Database(':memory:')
      const accountSetId = 'set-1'

      db.exec(`
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
          direction TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1
        );
        CREATE TABLE init_balances (
          id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
          year INTEGER, period INTEGER, init_balance REAL,
          init_debit REAL, init_credit REAL, aux_item_id TEXT DEFAULT ''
        );
        CREATE TABLE account_balances (
          id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
          year INTEGER, period INTEGER, current_debit REAL, current_credit REAL
        );
      `)

      db.prepare(
        'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('a1001', accountSetId, '1001', '库存现金', 'debit', null)

      const insertInit = db.prepare(
        'INSERT INTO init_balances (id, account_set_id, account_id, year, period, init_balance, init_debit, init_credit, aux_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      insertInit.run('s0', accountSetId, 'a1001', 2026, 1, 91, 91, 0, '')
      insertInit.run('s1', accountSetId, 'a1001', 2026, 1, 21, 21, 0, 'dept:1')
      insertInit.run('s2', accountSetId, 'a1001', 2026, 1, 30, 30, 0, 'dept:2')
      insertInit.run('s3', accountSetId, 'a1001', 2026, 1, 40, 40, 0, 'dept:3')
      insertInit.run('s4', accountSetId, 'a1001', 2026, 1, 91, 91, 0, 'person:1')

      expect(getBalance(db, accountSetId, '1001', 2026, 0)).toBe(91)
      expect(getBatchBalances(db, accountSetId, ['1001'], 2026, 0).get('1001')).toBe(91)
    })

    it('getPeriodSum 应只统计指定期间发生额', () => {
      const db = new Database(':memory:')
      const accountSetId = 'set-1'

      db.exec(`
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
          direction TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1
        );
        CREATE TABLE init_balances (
          id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
          year INTEGER, period INTEGER, init_balance REAL,
          init_debit REAL, init_credit REAL, aux_item_id TEXT DEFAULT ''
        );
        CREATE TABLE account_balances (
          id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT,
          year INTEGER, period INTEGER, current_debit REAL, current_credit REAL
        );
      `)

      db.prepare(
        'INSERT INTO accounts (id, account_set_id, code, name, direction, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('a6001', accountSetId, '6001', '费用', 'debit', null)
      db.prepare('INSERT INTO account_balances VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        uuidv4(), accountSetId, 'a6001', 2026, 4, 100, 0
      )
      db.prepare('INSERT INTO account_balances VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        uuidv4(), accountSetId, 'a6001', 2026, 5, 20, 0
      )

      expect(getPeriodSum(db, accountSetId, '6001', 2026, 5)).toEqual({ debit: 20, credit: 0 })
    })
  })
})
