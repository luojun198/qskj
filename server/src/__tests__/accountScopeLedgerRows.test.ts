import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  assertAccountCodePrefixInScope,
  filterLedgerRowsByScope,
  type AccountScopeContext,
} from '../services/accountAuthorization.js'

/** FIX-154：受限用户账簿——补出的父科目行保留；编码前缀判权按「任一已授权」 */
const ctx: AccountScopeContext = { bypass: false, restricted: true, allowedAccountIds: new Set(['leaf-1002001']) }

describe('FIX-154 账簿行科目授权过滤', () => {
  it('JS 补出的父科目行（is_supplemented_parent）不被整行丢弃', () => {
    const rows = [
      { account_id: 'acc-1002', account_code: '1002', is_supplemented_parent: true },
      { account_id: 'acc-1002', account_code: '1002' }, // 来自 SQL 的真实父行（未授权）→ 剔除
      { account_id: 'leaf-1002001', account_code: '1002001' },
      { account_id: 'leaf-1002002', account_code: '1002002' },
      { account_code: '1' }, // 无 account_id 且非补行 → 剔除
    ]
    const kept = filterLedgerRowsByScope(ctx, rows).map(r => `${r.account_code}${r.is_supplemented_parent ? '*' : ''}`)
    expect(kept).toEqual(['1002*', '1002001'])
  })

  it('编码前缀判权：前缀下任一科目已授权即放行，不再 LIMIT 1 任取首行', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, is_enabled INTEGER DEFAULT 1)`)
    const ins = db.prepare('INSERT INTO accounts VALUES (?, ?, ?, 1)')
    ins.run('acc-1002', 's', '1002')
    ins.run('leaf-1002001', 's', '1002001')
    ins.run('leaf-1002002', 's', '1002002')
    expect(assertAccountCodePrefixInScope(db, ctx, 's', '1002')).toBeNull()
    expect(assertAccountCodePrefixInScope(db, ctx, 's', '1002002')).toContain('无权')
    expect(assertAccountCodePrefixInScope(db, ctx, 's', '9999')).toBeNull()
  })
})
