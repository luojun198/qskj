import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountService } from '../services/accountService.js'

describe('AccountService', () => {
  let db: Database.Database
  let service: AccountService

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE system_params (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        param_key TEXT NOT NULL,
        param_value TEXT NOT NULL
      );

      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        account_set_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        direction TEXT NOT NULL,
        level INTEGER NOT NULL,
        parent_id TEXT,
        is_aux INTEGER DEFAULT 0,
        aux_types TEXT,
        is_enabled INTEGER DEFAULT 1,
        is_cash INTEGER DEFAULT 0,
        is_bank INTEGER DEFAULT 0,
        allow_delete INTEGER DEFAULT 1,
        no_negative INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE init_balances (
        id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
        year INTEGER, period INTEGER, init_balance REAL, init_debit REAL, init_credit REAL,
        aux_item_id TEXT DEFAULT '', opening_debit REAL DEFAULT 0, opening_credit REAL DEFAULT 0,
        pre_book_debit REAL DEFAULT 0, pre_book_credit REAL DEFAULT 0
      );
      CREATE TABLE voucher_entries (
        id TEXT PRIMARY KEY, account_id TEXT, account_code TEXT, account_name TEXT
      );
      CREATE TABLE account_balances (
        id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER
      );
    `)

    service = new AccountService(db as any)
  })

  afterEach(() => {
    db.close()
  })

  it('新增科目时优先使用当前账套科目长度，而不是全局默认长度', () => {
    db.prepare(`
      INSERT INTO system_params (id, account_set_id, param_key, param_value)
      VALUES
        ('global-levels', NULL, 'account_levels', '6'),
        ('global-lengths', NULL, 'account_code_lengths', '[4,2,2,2,2,2]'),
        ('set-levels', 'set-1', 'account_levels', '3'),
        ('set-lengths', 'set-1', 'account_code_lengths', '[4,3,3]')
    `).run()

    db.prepare(`
      INSERT INTO accounts (id, account_set_id, code, name, direction, level, parent_id)
      VALUES ('parent-1012', 'set-1', '1012', '其他货币资金', 'debit', 1, NULL)
    `).run()

    const id = service.createAccount({
      account_set_id: 'set-1',
      code: '1012007',
      name: '测试二级科目',
      direction: 'debit',
      parent_id: 'parent-1012',
    })

    const created = db.prepare('SELECT code, level, parent_id FROM accounts WHERE id = ?').get(id)
    expect(created).toMatchObject({
      code: '1012007',
      level: 2,
      parent_id: 'parent-1012',
    })
  })

  it('repairAccountHierarchy 应修复缺失 parent_id 的非顶级科目', () => {
    db.prepare(`
      INSERT INTO system_params (id, account_set_id, param_key, param_value)
      VALUES
        ('set-levels', 'set-1', 'account_levels', '4'),
        ('set-lengths', 'set-1', 'account_code_lengths', '[4,2,2,2,2,2,2,2,2,2]')
    `).run()

    db.prepare(`
      INSERT INTO accounts (id, account_set_id, code, name, direction, level, parent_id)
      VALUES
        ('a-1301', 'set-1', '1301', '在途物品', 'debit', 1, NULL),
        ('a-130101', 'set-1', '130101', '明细', 'debit', 2, 'a-1301'),
        ('a-13010101', 'set-1', '13010101', '子明细', 'debit', 3, NULL)
    `).run()

    const result = service.repairAccountHierarchy('set-1')
    expect(result.updated).toBe(1)

    const fixed = db
      .prepare('SELECT code, level, parent_id FROM accounts WHERE id = ?')
      .get('a-13010101')
    expect(fixed).toMatchObject({
      code: '13010101',
      level: 3,
      parent_id: 'a-130101',
    })
  })

  describe('新增第一个子科目时继承父科目', () => {
    function createDataTables() {
      db.prepare(`
        INSERT INTO system_params (id, account_set_id, param_key, param_value)
        VALUES
          ('set-levels', 'set-1', 'account_levels', '4'),
          ('set-lengths', 'set-1', 'account_code_lengths', '[4,2,2,2,2,2,2,2,2,2]')
      `).run()
    }

    function seedAuxParent() {
      db.prepare(`
        INSERT INTO accounts (id, account_set_id, code, name, direction, level, parent_id, is_aux, aux_types, is_cash, is_bank, no_negative)
        VALUES ('p-2901', 'set-1', '2901', '受托代理负债', 'credit', 1, NULL, 1, '{"cat1":""}', 0, 1, 1)
      `).run()
      db.prepare(`
        INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id, opening_credit)
        VALUES
          ('ib-aux1', 'set-1', 'p-2901', 'credit', 2026, 1, 100, 0, 100, 'cat1:item1', 100),
          ('ib-aux2', 'set-1', 'p-2901', 'credit', 2026, 1, 50, 0, 50, 'cat1:item2', 50),
          ('ib-sum', 'set-1', 'p-2901', 'credit', 2026, 1, 150, 0, 150, '', 150)
      `).run()
      db.prepare(
        `INSERT INTO voucher_entries (id, account_id, account_code, account_name) VALUES ('ve1', 'p-2901', '2901', '受托代理负债')`
      ).run()
      db.prepare(
        `INSERT INTO account_balances (id, account_set_id, account_id, year, period) VALUES ('ab1', 'set-1', 'p-2901', 2026, 1)`
      ).run()
    }

    it('第一个子科目继承会计属性并迁移凭证/科目余额/年初与辅助年初', () => {
      createDataTables()
      seedAuxParent()

      const childId = service.createAccount({
        account_set_id: 'set-1',
        code: '290101',
        name: '案款',
        direction: 'debit', // 故意填错方向，应被父科目方向覆盖
        parent_id: 'p-2901',
      })

      const child = db.prepare('SELECT * FROM accounts WHERE id = ?').get(childId) as any
      expect(child.is_aux).toBe(1)
      expect(child.aux_types).toBe('{"cat1":""}')
      expect(child.direction).toBe('credit')
      expect(child.is_bank).toBe(1)
      expect(child.no_negative).toBe(1)

      // 所有 init_balances（含 aux 与汇总行）迁移到子科目
      const parentInit = db
        .prepare(`SELECT COUNT(*) c FROM init_balances WHERE account_id = 'p-2901'`)
        .get() as any
      const childInit = db
        .prepare(`SELECT COUNT(*) c FROM init_balances WHERE account_id = ?`)
        .get(childId) as any
      expect(parentInit.c).toBe(0)
      expect(childInit.c).toBe(3)

      // 凭证分录迁移并改 code/name
      const ve = db.prepare(`SELECT account_id, account_code, account_name FROM voucher_entries WHERE id = 've1'`).get() as any
      expect(ve.account_id).toBe(childId)
      expect(ve.account_code).toBe('290101')

      // 科目余额迁移
      const ab = db.prepare(`SELECT account_id FROM account_balances WHERE id = 'ab1'`).get() as any
      expect(ab.account_id).toBe(childId)
    })

    it('第二个子科目不再重复迁移', () => {
      createDataTables()
      seedAuxParent()
      service.createAccount({
        account_set_id: 'set-1',
        code: '290101',
        name: '案款',
        direction: 'credit',
        parent_id: 'p-2901',
      })

      // 此时数据已在第一个子科目；新增第二个子科目不应继承/迁移
      const child2 = service.createAccount({
        account_set_id: 'set-1',
        code: '290102',
        name: '其他',
        direction: 'credit',
        parent_id: 'p-2901',
      })
      const c2 = db.prepare('SELECT is_aux, aux_types FROM accounts WHERE id = ?').get(child2) as any
      expect(c2.is_aux).toBe(0)
      expect(c2.aux_types).toBeNull()
      const c2Init = db
        .prepare(`SELECT COUNT(*) c FROM init_balances WHERE account_id = ?`)
        .get(child2) as any
      expect(c2Init.c).toBe(0)
    })

    it('关闭辅助核算但仍存在辅助期初明细时应阻断', () => {
      createDataTables()
      db.prepare(`
        INSERT INTO accounts (id, account_set_id, code, name, direction, level, is_aux, aux_types)
        VALUES ('leaf-1', 'set-1', '1001', '库存现金', 'debit', 1, 1, '{"cat1":""}')
      `).run()
      db.prepare(`
        INSERT INTO init_balances (id, account_set_id, account_id, direction, year, period, init_balance, init_debit, init_credit, aux_item_id)
        VALUES ('ibx', 'set-1', 'leaf-1', 'debit', 2026, 1, 100, 100, 0, 'cat1:item1')
      `).run()

      expect(() =>
        service.updateAccount('leaf-1', {
          name: '库存现金',
          direction: 'debit',
          is_aux: false,
          aux_types: null,
        })
      ).toThrow(/辅助期初/)
    })
  })
})
