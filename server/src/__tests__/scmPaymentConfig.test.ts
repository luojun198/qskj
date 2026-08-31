import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { up } from '../db/migrations/20260713_fix_payment_doc_config.js'
import { up as addPaymentSourceLog } from '../db/migrations/20260713_add_payment_source_log.js'

describe('PAY/RCV 单据字段配置迁移', () => {
  it('修正所有账套且可重复执行', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE scm_doc_type (
      account_set_id TEXT, code TEXT, header_fields TEXT, line_fields TEXT, required_fields TEXT
    )`)
    const insert = db.prepare('INSERT INTO scm_doc_type VALUES (?,?,?,?,?)')
    insert.run('A1', 'PAY', '["partner"]', '["item"]', '[]')
    insert.run('A2', 'RCV', '["partner"]', '["item"]', '[]')
    insert.run('A1', 'PI', '["partner"]', '["item"]', '[]')

    up(db)
    up(db)

    const paymentRows = db.prepare(`SELECT code, header_fields, line_fields, required_fields
      FROM scm_doc_type WHERE code IN ('PAY','RCV') ORDER BY code`).all() as any[]
    expect(paymentRows).toEqual([
      {
        code: 'PAY',
        header_fields: '["partner","payment","settle_account","currency","remark"]',
        line_fields: '["remark","amount"]',
        required_fields: '["partner","settle_account"]',
      },
      {
        code: 'RCV',
        header_fields: '["partner","payment","settle_account","currency","remark"]',
        line_fields: '["remark","amount"]',
        required_fields: '["partner","settle_account"]',
      },
    ])
    expect(db.prepare("SELECT line_fields FROM scm_doc_type WHERE code='PI'").get()).toEqual({ line_fields: '["item"]' })
  })
})

describe('PAY/RCV 源单关联迁移', () => {
  it('增加源日志字段、索引并更新明细语义', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_doc_type (account_set_id TEXT, code TEXT, header_fields TEXT, line_fields TEXT, required_fields TEXT);
      CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT);
    `)
    db.prepare('INSERT INTO scm_doc_type VALUES (?,?,?,?,?)').run('A1', 'RCV', '[]', '["remark","amount"]', '[]')
    addPaymentSourceLog(db)
    addPaymentSourceLog(db)

    const cols = db.prepare("PRAGMA table_info('scm_doc_line')").all() as any[]
    expect(cols.some(c => c.name === 'arap_source_log_id')).toBe(true)
    expect(db.prepare("SELECT line_fields FROM scm_doc_type WHERE code='RCV'").get()).toEqual({
      line_fields: '["source_doc","amount","remark"]',
    })
  })
})
