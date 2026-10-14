import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  cleanupAccountSetCascade,
  cleanupAccountSetCascadeAsync,
} from '../services/accountSetCleanup.js'
import {
  startAccountSetDeleteJob,
  getAccountSetDeleteJob,
  isAccountSetDeleting,
  toProgressPayload,
  __resetAccountSetDeleteJob,
} from '../services/accountSetDeleteJob.js'
import { accountSetBusyMiddleware, DELETE_PROGRESS_PATH } from '../middleware/accountSetBusy.js'

function createSchema(db: Database.Database) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      account_set_id TEXT REFERENCES account_sets(id),
      username TEXT NOT NULL,
      password TEXT NOT NULL
    );
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      account_set_id TEXT REFERENCES account_sets(id),
      code TEXT NOT NULL,
      owner_user_id TEXT REFERENCES users(id)
    );
    CREATE TABLE user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id)
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'debit',
      level INTEGER DEFAULT 1
    );
    CREATE TABLE role_account_scopes (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      include_children INTEGER DEFAULT 1
    );
    CREATE TABLE aux_categories (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      default_item_id TEXT
    );
    CREATE TABLE aux_category_fields (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES aux_categories(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_type TEXT DEFAULT 'text'
    );
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id),
      type TEXT NOT NULL REFERENCES aux_categories(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL
    );
  `)
}

describe('cleanupAccountSetCascade', () => {
  let db: Database.Database
  const accountSetId = 'as-1'

  beforeEach(() => {
    db = new Database(':memory:')
    createSchema(db)
    db.prepare('INSERT INTO account_sets (id, name) VALUES (?, ?)').run(accountSetId, '测试账套')
    db.prepare(
      'INSERT INTO users (id, account_set_id, username, password) VALUES (?, ?, ?, ?)'
    ).run('u1', accountSetId, 'admin', 'hash')
    db.prepare('INSERT INTO roles (id, account_set_id, code, owner_user_id) VALUES (?, ?, ?, ?)').run(
      'r1',
      accountSetId,
      'admin',
      'u1'
    )
    db.prepare('INSERT INTO user_roles (id, user_id, role_id, account_set_id) VALUES (?, ?, ?, ?)').run(
      'ur1',
      'u1',
      'r1',
      accountSetId
    )
    db.prepare(
      'INSERT INTO accounts (id, account_set_id, code, name, direction) VALUES (?, ?, ?, ?, ?)'
    ).run('a1', accountSetId, '1001', '现金', 'debit')
    db.prepare(
      'INSERT INTO role_account_scopes (id, role_id, account_set_id, account_id) VALUES (?, ?, ?, ?)'
    ).run('ras1', 'r1', accountSetId, 'a1')
    db.prepare('INSERT INTO aux_categories (id, account_set_id, code, name) VALUES (?, ?, ?, ?)').run(
      'c1',
      accountSetId,
      'dept',
      '部门'
    )
    db.prepare(
      'INSERT INTO aux_category_fields (id, category_id, field_key, field_name) VALUES (?, ?, ?, ?)'
    ).run('cf1', 'c1', 'ext', '扩展')
    db.prepare('INSERT INTO aux_items (id, account_set_id, type, code, name) VALUES (?, ?, ?, ?, ?)').run(
      'i1',
      accountSetId,
      'c1',
      '01',
      '本部'
    )
  })

  it('应删除含 user_roles / role_account_scopes 的账套且不触发外键错误', () => {
    expect(() => cleanupAccountSetCascade(db, accountSetId)).not.toThrow()
    const left = db.prepare('SELECT id FROM account_sets WHERE id = ?').get(accountSetId)
    expect(left).toBeUndefined()
    expect((db.prepare('SELECT COUNT(*) as c FROM user_roles').get() as { c: number }).c).toBe(0)
  })

  it('评审 P2 收尾：清单外、带 account_set_id 的表（如供应链 / 汇率）也一并清掉，不留孤儿行', () => {
    db.exec(`CREATE TABLE scm_unit (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT);
             CREATE TABLE exchange_rates (id TEXT PRIMARY KEY, account_set_id TEXT, rate REAL);`)
    db.prepare("INSERT INTO scm_unit VALUES ('u1', ?, 'PCS'), ('u2', 'other-set', 'PCS')").run(accountSetId)
    db.prepare("INSERT INTO exchange_rates VALUES ('r1', ?, 7.1)").run(accountSetId)
    cleanupAccountSetCascade(db, accountSetId)
    expect(db.prepare('SELECT id FROM scm_unit').all()).toEqual([{ id: 'u2' }])
    expect((db.prepare('SELECT COUNT(*) c FROM exchange_rates').get() as { c: number }).c).toBe(0)
  })

  it('异步版：删除结果与同步版一致，且上报单调递增的进度并让出事件循环', async () => {
    const calls: Array<[number, number, string]> = []
    let yielded = false
    setImmediate(() => {
      yielded = true
    })
    await cleanupAccountSetCascadeAsync(db, accountSetId, (d, t, l) => calls.push([d, t, l]))
    expect(yielded).toBe(true)
    expect(db.prepare('SELECT id FROM account_sets WHERE id = ?').get(accountSetId)).toBeUndefined()
    expect(calls.length).toBeGreaterThan(2)
    const total = calls[0][1]
    expect(calls.every(c => c[1] === total)).toBe(true)
    expect(calls[calls.length - 1][0]).toBe(total)
    for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0])
    expect(db.inTransaction).toBe(false)
  })

  it('异步版：中途失败整体回滚并释放事务', async () => {
    db.exec(`CREATE TRIGGER boom BEFORE DELETE ON accounts BEGIN SELECT RAISE(ABORT, 'boom'); END;`)
    await expect(cleanupAccountSetCascadeAsync(db, accountSetId)).rejects.toThrow('boom')
    expect(db.inTransaction).toBe(false)
    expect(db.prepare('SELECT id FROM account_sets WHERE id = ?').get(accountSetId)).toBeTruthy()
    expect((db.prepare('SELECT COUNT(*) c FROM user_roles').get() as { c: number }).c).toBe(1)
  })

  it('删除任务：运行期间拒绝并发任务，结束后状态为 done', async () => {
    __resetAccountSetDeleteJob()
    const job = startAccountSetDeleteJob(db, accountSetId, '测试账套')
    expect(job).toBeTruthy()
    expect(isAccountSetDeleting()).toBe(true)
    expect(startAccountSetDeleteJob(db, 'other', 'x')).toBeNull()
    expect(toProgressPayload(getAccountSetDeleteJob()).active).toBe(true)
    await vi.waitFor(() => expect(getAccountSetDeleteJob()?.status).toBe('done'))
    expect(isAccountSetDeleting()).toBe(false)
    expect(toProgressPayload(getAccountSetDeleteJob())).toMatchObject({ status: 'done', percent: 100 })
    __resetAccountSetDeleteJob()
  })

  it('锁定中间件：删除期间返回 423，进度查询免登录放行', async () => {
    __resetAccountSetDeleteJob()
    startAccountSetDeleteJob(db, accountSetId, '测试账套')
    const mk = (method: string, path: string) => {
      const out: { status?: number; body?: any; nexted?: boolean } = {}
      const res: any = {
        status(c: number) {
          out.status = c
          return res
        },
        json(b: any) {
          out.body = b
          return res
        },
      }
      accountSetBusyMiddleware({ method, path } as any, res, () => {
        out.nexted = true
      })
      return out
    }
    expect(mk('POST', '/api/voucher').status).toBe(423)
    expect(mk('GET', DELETE_PROGRESS_PATH).body.data.active).toBe(true)
    await vi.waitFor(() => expect(isAccountSetDeleting()).toBe(false))
    expect(mk('POST', '/api/voucher').nexted).toBe(true)
    __resetAccountSetDeleteJob()
  })
})
