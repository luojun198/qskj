import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { up } from '../db/migrations/20260714_add_scm_report_query_scheme.js'

describe('销售报表个人查询方案迁移', () => {
  it('按账套和用户隔离，并保证个人默认方案唯一', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE account_sets(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY);')
    db.exec("INSERT INTO account_sets VALUES ('a1'),('a2'); INSERT INTO users VALUES ('u1'),('u2');")
    up(db)
    const insert = db.prepare(`INSERT INTO scm_report_query_scheme
      (id, account_set_id, user_id, report_key, name, config_json, is_default)
      VALUES (?, ?, ?, 'sales', ?, '{}', ?)`)
    insert.run('s1', 'a1', 'u1', '我的汇总', 1)
    insert.run('s2', 'a1', 'u2', '我的汇总', 1)
    insert.run('s3', 'a2', 'u1', '我的汇总', 1)
    db.prepare(`INSERT INTO scm_report_query_scheme
      (id, account_set_id, user_id, report_key, name, config_json, is_default)
      VALUES ('p1', 'a1', 'u1', 'purchase', '采购默认', '{}', 1)`).run()
    const rows = db.prepare(`SELECT id FROM scm_report_query_scheme
      WHERE account_set_id=? AND user_id=? AND report_key='sales'`).all('a1', 'u1')
    expect(rows).toEqual([{ id: 's1' }])
    expect(db.prepare(`SELECT id FROM scm_report_query_scheme
      WHERE account_set_id='a1' AND user_id='u1' AND report_key='purchase' AND is_default=1`).get()).toEqual({ id: 'p1' })
    expect(() => insert.run('s4', 'a1', 'u1', '其他方案', 1)).toThrow()
    db.close()
  })
})
