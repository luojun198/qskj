/**
 * 银行对账单导入映射方案：新建 / 同名覆盖 / 按 id 改名 / 重名拦截 / 校验 / 删除 / 账套隔离
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { listImportSchemes, saveImportScheme, deleteImportScheme } from '../services/bankImportScheme.js'

describe('bankImportScheme', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE system_params (
        id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT NOT NULL, param_value TEXT, description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_set_id, param_key)
      )
    `)
  })

  const base = {
    name: '工行流水', header_row: 2, data_start_row: 3, amount_mode: 'dc',
    mapping: { biz_date: 0, debit: 3, credit: 2, bogus: 5, summary: -1 },
    header_labels: ['交易日期', '摘要', '借方发生额', '贷方发生额'],
  }

  it('新建、清洗映射、同名覆盖不产生重复', () => {
    const s = saveImportScheme(db, 'A', base)
    expect(s.id).toBeTruthy()
    expect(s.mapping).toEqual({ biz_date: 0, debit: 3, credit: 2 })
    const again = saveImportScheme(db, 'A', { ...base, data_start_row: 4 })
    expect(again.id).toBe(s.id)
    expect(listImportSchemes(db, 'A')).toHaveLength(1)
    expect(listImportSchemes(db, 'A')[0].data_start_row).toBe(4)
    // 账套隔离
    expect(listImportSchemes(db, 'B')).toHaveLength(0)
  })

  it('按 id 改名；改成已有名称被拦截；校验必填', () => {
    const a = saveImportScheme(db, 'A', base)
    saveImportScheme(db, 'A', { ...base, name: '建行流水' })
    expect(saveImportScheme(db, 'A', { ...base, id: a.id, name: '工行-新版' }).name).toBe('工行-新版')
    expect(() => saveImportScheme(db, 'A', { ...base, id: a.id, name: '建行流水' })).toThrow('已有同名方案')
    expect(() => saveImportScheme(db, 'A', { ...base, name: ' ' })).toThrow('方案名称')
    expect(() => saveImportScheme(db, 'A', { ...base, name: 'x', mapping: { debit: 1 } })).toThrow()
    expect(() => saveImportScheme(db, 'A', { ...base, id: 'nope' })).toThrow('方案不存在')
  })

  it('删除', () => {
    const a = saveImportScheme(db, 'A', base)
    expect(deleteImportScheme(db, 'B', a.id)).toBe(false)
    expect(deleteImportScheme(db, 'A', a.id)).toBe(true)
    expect(listImportSchemes(db, 'A')).toHaveLength(0)
  })
})
