import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { validateVoucherEntriesLeafAccount } from '../services/voucherEntry.js'

describe('validateVoucherEntriesLeafAccount', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE accounts (id TEXT, account_set_id TEXT, code TEXT, name TEXT, parent_id TEXT);
    INSERT INTO accounts VALUES ('p','s','1601','固定资产',NULL),('c','s','1601004','一般设备','p'),('x','s','1002','银行存款',NULL);`)
  it('父科目被拒绝，末级与无下级科目放行', () => {
    expect(validateVoucherEntriesLeafAccount(db as any, 's', [{ account_id: 'p' }])).toContain('1601 固定资产')
    expect(validateVoucherEntriesLeafAccount(db as any, 's', [{ account_id: 'c' }, { account_id: 'x' }])).toBeNull()
  })
})
