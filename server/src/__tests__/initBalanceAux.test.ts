import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  buildSingleCategoryAuxItemId,
  parseAccountAuxCategoryIds,
} from '../utils/auxItemId.js'
import {
  calcInitBalanceFromAmounts,
  checkInitBalanceAuxCategoryConsistency,
  getInitBalanceAuxDetails,
  resolveAuxItemIdInCategory,
  saveInitBalanceAuxDetails,
  upsertInitBalanceAuxLine,
} from '../services/initBalanceAux.js'

function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, start_date TEXT);
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT,
      direction TEXT, parent_id TEXT, is_aux INTEGER, aux_types TEXT, is_enabled INTEGER
    );
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, sort_order INTEGER);
    CREATE TABLE aux_category_fields (
      id TEXT PRIMARY KEY, category_id TEXT, field_key TEXT, field_name TEXT,
      field_type TEXT DEFAULT 'text', is_enabled INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT,
      status TEXT DEFAULT 'active', remark TEXT, field_values TEXT DEFAULT '{}'
    );
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, direction TEXT,
      year INTEGER, period INTEGER,
      init_balance REAL, init_debit REAL, init_credit REAL,
      aux_item_id TEXT NOT NULL DEFAULT '',
      opening_debit REAL, opening_credit REAL, pre_book_debit REAL, pre_book_credit REAL
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_date TEXT, status TEXT
    );
    CREATE TABLE period_closing (
      id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT
    );
    INSERT INTO account_sets VALUES ('set1', '2026-04-01');
    INSERT INTO aux_categories VALUES ('cat-dept', 'set1', 'dept', '部门', 0);
    INSERT INTO aux_categories VALUES ('cat-proj', 'set1', 'proj', '项目', 1);
    INSERT INTO aux_items (id, account_set_id, type, code, name, status, remark, field_values)
      VALUES ('item-a', 'set1', 'cat-dept', 'D01', '行政部', 'active', '', '{}');
    INSERT INTO aux_items (id, account_set_id, type, code, name, status, remark, field_values)
      VALUES ('item-b', 'set1', 'cat-proj', 'P01', '项目A', 'active', '', '{}');
    INSERT INTO accounts VALUES (
      'acc1', 'set1', '5001', '经费支出', 'debit', NULL, 1,
      '{"cat-dept":null,"cat-proj":null}', 1
    );
  `)
  return db
}

describe('initBalanceAux', () => {
  it('buildSingleCategoryAuxItemId', () => {
    const codeById = new Map([
      ['cat-dept', 'dept'],
      ['cat-proj', 'proj'],
    ])
    expect(buildSingleCategoryAuxItemId(codeById, 'cat-dept', 'item-a')).toBe('dept:item-a')
  })

  it('parseAccountAuxCategoryIds 解析科目辅助类目', () => {
    expect(parseAccountAuxCategoryIds('{"cat-dept":null,"cat-proj":"item-b"}')).toEqual([
      'cat-dept',
      'cat-proj',
    ])
    expect(parseAccountAuxCategoryIds('project,customer')).toEqual(['project', 'customer'])
  })

  it('calcInitBalanceFromAmounts 借方科目', () => {
    const r = calcInitBalanceFromAmounts('debit', 100, 0, 50, 0)
    expect(r.initDebit).toBe(150)
    expect(r.initBalance).toBe(150)
  })

  describe('分类目录入', () => {
    let db: Database.Database

    beforeEach(() => {
      db = createTestDb()
    })

    it('单行 upsert（仅部门）后科目汇总为该类目合计', () => {
      const summary = upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 1000,
        opening_credit: 0,
      })
      expect(summary.opening_debit).toBe(1000)
      const details = getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026)
      expect(details.lines).toHaveLength(1)
      expect(details.lines[0].aux_item_id).toBe('dept:item-a')
    })

    it('部门与项目分别录入相同合计时科目汇总不翻倍', () => {
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 5000,
        opening_credit: 0,
      })
      const summary = upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-proj',
        selection: { 'cat-proj': 'item-b' },
        opening_debit: 5000,
        opening_credit: 0,
      })
      expect(summary.opening_debit).toBe(5000)
      const rows = db
        .prepare(
          `SELECT aux_item_id, opening_debit FROM init_balances
           WHERE account_id='acc1' AND aux_item_id != ''`
        )
        .all() as Array<{ aux_item_id: string; opening_debit: number }>
      expect(rows).toHaveLength(2)
    })

    it('逐行保存时录入未完成不校验各类目合计', () => {
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 3000,
        opening_credit: 0,
      })
      expect(() =>
        upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
          active_category_id: 'cat-proj',
          selection: { 'cat-proj': 'item-b' },
          opening_debit: 8000,
          opening_credit: 0,
        })
      ).not.toThrow()
    })

    it('保存全部时各类目合计不一致则拒绝', () => {
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 3000,
        opening_credit: 0,
      })
      expect(() =>
        saveInitBalanceAuxDetails(db, 'set1', 'acc1', 2026, [
          {
            active_category_id: 'cat-dept',
            selection: { 'cat-dept': 'item-a' },
            opening_debit: 3000,
            opening_credit: 0,
          },
          {
            active_category_id: 'cat-proj',
            selection: { 'cat-proj': 'item-b' },
            opening_debit: 8000,
            opening_credit: 0,
          },
        ])
      ).toThrow(/5001 经费支出.*部门.*项目/)
    })

    it('拒绝年初借方与年初贷方同时填写', () => {
      expect(() =>
        saveInitBalanceAuxDetails(db, 'set1', 'acc1', 2026, [
          {
            active_category_id: 'cat-dept',
            selection: { 'cat-dept': 'item-a' },
            opening_debit: 100,
            opening_credit: 50,
          },
        ])
      ).toThrow(/不能同时填写/)
    })

    it('拒绝同一类目重复项目', () => {
      expect(() =>
        saveInitBalanceAuxDetails(db, 'set1', 'acc1', 2026, [
          {
            active_category_id: 'cat-dept',
            selection: { 'cat-dept': 'item-a' },
            opening_debit: 100,
            opening_credit: 0,
          },
          {
            active_category_id: 'cat-dept',
            selection: { 'cat-dept': 'item-a' },
            opening_debit: 200,
            opening_credit: 0,
          },
        ])
      ).toThrow(/重复/)
    })

    it('拒绝一行选择多个类目', () => {
      expect(() =>
        saveInitBalanceAuxDetails(db, 'set1', 'acc1', 2026, [
          {
            selection: { 'cat-dept': 'item-a', 'cat-proj': 'item-b' },
            opening_debit: 100,
            opening_credit: 0,
          },
        ])
      ).toThrow(/只能填写一个辅助类目/)
    })

    it('checkInitBalanceAuxCategoryConsistency 各类目一致时通过', () => {
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 5000,
        opening_credit: 0,
      })
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-proj',
        selection: { 'cat-proj': 'item-b' },
        opening_debit: 5000,
        opening_credit: 0,
      })
      const result = checkInitBalanceAuxCategoryConsistency(db, 'set1', 2026)
      expect(result.consistent).toBe(true)
      expect(result.mismatches).toHaveLength(0)
    })

    it('checkInitBalanceAuxCategoryConsistency 各类目不一致时返回明细', () => {
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 3000,
        opening_credit: 0,
      })
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-proj',
        selection: { 'cat-proj': 'item-b' },
        opening_debit: 8000,
        opening_credit: 0,
      })
      const result = checkInitBalanceAuxCategoryConsistency(db, 'set1', 2026)
      expect(result.consistent).toBe(false)
      expect(result.mismatches).toHaveLength(1)
      expect(result.mismatches[0].account_code).toBe('5001')
      expect(result.mismatches[0].categories).toHaveLength(2)
      expect(result.mismatches[0].categories.map(c => c.init_balance)).toEqual([3000, 8000])
      expect(result.mismatches[0].message).toContain('部门')
      expect(result.mismatches[0].message).toContain('项目')
    })

    it('checkInitBalanceAuxCategoryConsistency 仅一类目录入时视为不一致', () => {
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 91,
        opening_credit: 0,
      })
      const result = checkInitBalanceAuxCategoryConsistency(db, 'set1', 2026)
      expect(result.consistent).toBe(false)
      expect(result.mismatches).toHaveLength(1)
      expect(result.mismatches[0].categories).toHaveLength(2)
      expect(result.mismatches[0].categories.map(c => c.init_balance)).toEqual([91, 0])
      expect(result.mismatches[0].message).toMatch(/91.*0|0.*91/)
    })

    // 用户报告的核心场景：4 个分项独立校验
    // 净余额（init_balance）相同，但 opening_debit / pre_book_debit 分配不同 → 应该报"不一致"
    it('checkInitBalanceAuxCategoryConsistency 净余额相同但 opening/pre_book 分配不同视为不一致', () => {
      // 类目 dept: opening_debit=100, pre_book_debit=0, pre_book_credit=30
      //   init_debit = 100, init_credit = 30, init_balance = 70 (debit 方向)
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 100,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 30,
      })
      // 类目 proj: opening_debit=70, pre_book_debit=30, pre_book_credit=30
      //   init_debit = 100, init_credit = 30, init_balance = 70 (同净余额)
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-proj',
        selection: { 'cat-proj': 'item-b' },
        opening_debit: 70,
        opening_credit: 0,
        pre_book_debit: 30,
        pre_book_credit: 30,
      })

      const result = checkInitBalanceAuxCategoryConsistency(db, 'set1', 2026)
      expect(result.consistent).toBe(false)
      expect(result.mismatches).toHaveLength(1)

      // 净余额相同
      const balances = result.mismatches[0].categories.map(c => c.init_balance)
      expect(balances[0]).toBeCloseTo(70)
      expect(balances[1]).toBeCloseTo(70)

      // 必须报告 opening_debit / pre_book_debit 不一致
      const mismatchedKeys = result.mismatches[0].mismatched_fields.map(f => f.key)
      expect(mismatchedKeys).toContain('opening_debit')
      expect(mismatchedKeys).toContain('pre_book_debit')

      // 错误消息应该包含分项标签
      expect(result.mismatches[0].message).toContain('期初借方')
      expect(result.mismatches[0].message).toContain('账前借方发生额')
    })

    // 4 个分项独立校验：opening_credit 不一致（即使其它分项相同）
    it('checkInitBalanceAuxCategoryConsistency opening_credit 不一致即拒绝', () => {
      // 借方科目录入贷方期初是反向：opening_credit。
      // 这里用相同 init_balance 但 opening_credit 一个有值一个没有的场景。
      // 类目 dept: opening_credit=50 → init_balance = -50 (debit 方向)
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 0,
        opening_credit: 50,
      })
      // 类目 proj: opening_credit=0, pre_book_credit=50 → init_balance = -50 (同净余额)
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-proj',
        selection: { 'cat-proj': 'item-b' },
        opening_debit: 0,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 50,
      })

      const result = checkInitBalanceAuxCategoryConsistency(db, 'set1', 2026)
      expect(result.consistent).toBe(false)
      const mismatchedKeys = result.mismatches[0].mismatched_fields.map(f => f.key)
      expect(mismatchedKeys).toContain('opening_credit')
      expect(mismatchedKeys).toContain('pre_book_credit')
    })

    // 4 个分项都相同 → 视为一致（即使 opening 和 pre_book 都有值）
    it('checkInitBalanceAuxCategoryConsistency 4 个分项完全相同时视为一致', () => {
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 200,
        opening_credit: 0,
        pre_book_debit: 50,
        pre_book_credit: 20,
      })
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-proj',
        selection: { 'cat-proj': 'item-b' },
        opening_debit: 200,
        opening_credit: 0,
        pre_book_debit: 50,
        pre_book_credit: 20,
      })

      const result = checkInitBalanceAuxCategoryConsistency(db, 'set1', 2026)
      expect(result.consistent).toBe(true)
      expect(result.mismatches).toHaveLength(0)
    })

    it('resolveAuxItemIdInCategory 支持编码录入', () => {
      const items = [
        { id: 'item-a', code: 'D01', name: '行政部', remark: '', field_values: {} },
      ]
      expect(resolveAuxItemIdInCategory(items, 'item-a')).toBe('item-a')
      expect(resolveAuxItemIdInCategory(items, 'D01')).toBe('item-a')
      expect(resolveAuxItemIdInCategory(items, 'missing')).toBeNull()
    })

    it('upsertInitBalanceAuxLine 可按项目编码保存', () => {
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'D01' },
        opening_debit: 500,
        opening_credit: 0,
      })
      const details = getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026)
      expect(details.lines.some(l => l.aux_item_id === 'dept:item-a')).toBe(true)
    })

    it('科目仅启用部门时，不加载历史组合行中的项目类目', () => {
      db.prepare(
        `INSERT INTO init_balances
         (id, account_set_id, account_id, direction, year, period,
          init_balance, init_debit, init_credit, aux_item_id,
          opening_debit, opening_credit, pre_book_debit, pre_book_credit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'ib-combo',
        'set1',
        'acc1',
        'debit',
        2026,
        1,
        100,
        100,
        0,
        'dept:item-a|proj:item-b',
        100,
        0,
        0,
        0
      )
      db.prepare(`UPDATE accounts SET aux_types=? WHERE id=?`).run(
        '{"cat-dept":null}',
        'acc1'
      )

      const details = getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026)
      expect(details.categories).toHaveLength(1)
      expect(details.categories[0].id).toBe('cat-dept')
      expect(details.items['cat-proj']).toBeUndefined()
      expect(details.lines).toHaveLength(1)
      expect(details.lines[0].selection).toEqual({ 'cat-dept': 'item-a' })
      expect(details.lines[0].selection['cat-proj']).toBeUndefined()
    })

    it('不同科目 aux_types 互不影响', () => {
      db.prepare(
        `INSERT INTO accounts VALUES (
          'acc2', 'set1', '5002', '其他支出', 'debit', NULL, 1,
          '{"cat-proj":null}', 1
        )`
      ).run()
      upsertInitBalanceAuxLine(db, 'set1', 'acc1', 2026, {
        active_category_id: 'cat-dept',
        selection: { 'cat-dept': 'item-a' },
        opening_debit: 300,
        opening_credit: 0,
      })
      upsertInitBalanceAuxLine(db, 'set1', 'acc2', 2026, {
        active_category_id: 'cat-proj',
        selection: { 'cat-proj': 'item-b' },
        opening_debit: 700,
        opening_credit: 0,
      })

      const d1 = getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026)
      const d2 = getInitBalanceAuxDetails(db, 'set1', 'acc2', 2026)

      expect(d1.account.id).toBe('acc1')
      expect(d1.categories.map(c => c.id)).toEqual(['cat-dept', 'cat-proj'])
      expect(d1.items['cat-dept']?.some(i => i.id === 'item-a')).toBe(true)
      expect(d1.lines).toHaveLength(1)
      expect(d1.lines[0].selection).toEqual({ 'cat-dept': 'item-a' })

      expect(d2.account.id).toBe('acc2')
      expect(d2.categories.map(c => c.id)).toEqual(['cat-proj'])
      expect(d2.items['cat-dept']).toBeUndefined()
      expect(d2.items['cat-proj']?.some(i => i.id === 'item-b')).toBe(true)
      expect(d2.lines).toHaveLength(1)
      expect(d2.lines[0].selection).toEqual({ 'cat-proj': 'item-b' })
    })

    it('无效 aux_item_id 不返回明细行', () => {
      db.prepare(
        `INSERT INTO init_balances
         (id, account_set_id, account_id, direction, year, period,
          init_balance, init_debit, init_credit, aux_item_id,
          opening_debit, opening_credit, pre_book_debit, pre_book_credit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'ib-bad',
        'set1',
        'acc1',
        'debit',
        2026,
        1,
        50,
        50,
        0,
        'dept:missing-item',
        50,
        0,
        0,
        0
      )

      const details = getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026)
      expect(details.lines).toHaveLength(0)
    })

    it('无期初记录时仍通过分页返回已启用的辅助项目', () => {
      const meta = getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026, 1, {
        linesMode: 'none',
      })
      expect(meta.lines_paginated).toBe(true)
      expect(meta.lines).toHaveLength(0)

      const page = getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026, 1, {
        linesMode: 'page',
        categoryId: 'cat-proj',
        offset: 0,
        limit: 50,
      })
      expect(page.total).toBe(1)
      expect(page.lines).toHaveLength(1)
      expect(page.lines[0].selection).toEqual({ 'cat-proj': 'item-b' })
      expect(page.lines[0].display_code).toBe('P01')
      expect(page.lines[0].display_name).toBe('项目A')
    })
  })
})

describe('initBalanceAux 大数据分页', () => {
  it('16万核算项目只返回当前页，搜索和深分页不生成全量明细数组', () => {
    // 全量测试会与几十个数据库用例并行争用 CPU；专项性能验收使用 PERF_STRICT=1。
    const performanceLimitMs = process.env.PERF_STRICT === '1' ? 500 : 1000
    const db = createTestDb()
    const insertItem = db.prepare(
      `INSERT INTO aux_items (id, account_set_id, type, code, name, status, remark, field_values)
       VALUES (?, 'set1', 'cat-dept', ?, ?, 'active', '', '{}')`
    )
    const insertBalance = db.prepare(
      `INSERT INTO init_balances
       (id, account_set_id, account_id, direction, year, period,
        init_balance, init_debit, init_credit, aux_item_id,
        opening_debit, opening_credit, pre_book_debit, pre_book_credit)
       VALUES (?, 'set1', 'acc1', 'debit', 2026, 1, 1, 1, 0, ?, 1, 0, 0, 0)`
    )
    const insertMany = db.transaction(() => {
      for (let i = 0; i < 160000; i++) {
        const suffix = String(i).padStart(6, '0')
        insertItem.run(`bulk-${suffix}`, `B${suffix}`, `批量项目${suffix}`)
        insertBalance.run(`ib-bulk-${suffix}`, `dept:bulk-${suffix}`)
      }
    })
    insertMany()

    const firstStartedAt = performance.now()
    const first = getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026, 1, {
      linesMode: 'page',
      categoryId: 'cat-dept',
      offset: 0,
      limit: 50,
      sort: 'code',
      order: 'asc',
    })
    expect(first.total).toBe(160001)
    expect(first.lines).toHaveLength(50)
    expect(performance.now() - firstStartedAt).toBeLessThan(performanceLimitMs)
    expect(first.has_more).toBe(true)
    expect(first.lines.every(line => Object.keys(line.selection).length === 1)).toBe(true)

    const deepStartedAt = performance.now()
    const deep = getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026, 1, {
      linesMode: 'page',
      categoryId: 'cat-dept',
      offset: 120000,
      limit: 50,
    })
    expect(deep.lines).toHaveLength(50)
    expect(deep.total).toBe(160001)
    expect(performance.now() - deepStartedAt).toBeLessThan(performanceLimitMs)

    const searchStartedAt = performance.now()
    const searched = getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026, 1, {
      linesMode: 'page',
      categoryId: 'cat-dept',
      keyword: '批量项目159999',
      limit: 50,
    })
    expect(searched.total).toBe(1)
    expect(searched.lines).toHaveLength(1)
    expect(searched.lines[0].display_code).toBe('B159999')
    expect(performance.now() - searchStartedAt).toBeLessThan(performanceLimitMs)

    expect(() => getInitBalanceAuxDetails(db, 'set1', 'acc1', 2026)).toThrowError(
      /超过.*5000 行/
    )
    db.close()
  }, 30000)
})
