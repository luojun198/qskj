import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import {
  clearVoucherData,
  createPreReinitializeBackup,
  previewReinitialize,
  reinitializeAccountSet,
  verifyAdminPassword,
} from '../services/systemReinitialize.js'
import { doBackup } from '../routes/backup.js'

vi.mock('../routes/backup.js', () => ({
  doBackup: vi.fn(async () => ({
    id: 'backup1',
    filename: '初始化前备份_20260526_120000.db',
    filepath: '/tmp/backup.db',
    size: 1024,
  })),
}))

vi.mock('../scripts/importAcdToCurrentAccountSet.js', () => ({
  importAcdTemplateToAccountSet: vi.fn(() => ({
    accounts: { inserted: 10, updated: 0 },
  })),
  parseAcdTables: vi.fn(() => ({ accounts: new Array(10) })),
}))

vi.mock('../services/standardTemplateScan.js', () => ({
  findStandardTemplateById: vi.fn((id: string) =>
    id === '政府模板'
      ? {
          id: '政府模板',
          name: '政府模板',
          description: 'test',
          acdFile: 'x.acd',
          excelFiles: [],
          inferredStandard: 'government',
        }
      : null
  ),
  readStandardTemplateAcdBuffer: vi.fn(() => Buffer.from('mock')),
}))

function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, name TEXT, start_date TEXT, fiscal_year INTEGER);
    CREATE TABLE users (id TEXT PRIMARY KEY, account_set_id TEXT, username TEXT, password TEXT);
    CREATE TABLE accounts (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT);
    CREATE TABLE aux_categories (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE aux_items (id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT);
    CREATE TABLE init_balances (
      id TEXT PRIMARY KEY, account_set_id TEXT, account_id TEXT, year INTEGER, period INTEGER,
      aux_item_id TEXT DEFAULT '', opening_debit REAL DEFAULT 0, opening_credit REAL DEFAULT 0
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, status TEXT,
      voucher_date TEXT, year INTEGER, period INTEGER
    );
    CREATE TABLE voucher_entries (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, account_id TEXT);
    CREATE TABLE voucher_attachments (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT);
    CREATE TABLE auto_transfer_runs (id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT);
    CREATE TABLE account_balances (id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER);
    CREATE TABLE period_closing (id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT);
    CREATE TABLE system_params (
      id TEXT PRIMARY KEY, account_set_id TEXT, param_key TEXT, param_value TEXT,
      UNIQUE(account_set_id, param_key)
    );
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE transfer_types (id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE transfer_items (id TEXT PRIMARY KEY, account_set_id TEXT, type_id TEXT);

    INSERT INTO account_sets VALUES ('set1', '测试账套', '2026-01-01', 2026);
    INSERT INTO users VALUES ('u1', 'set1', 'admin', '${bcrypt.hashSync('admin123', 10)}');
    INSERT INTO accounts VALUES ('acc1', 'set1', '1001', '库存现金', 'debit');
    INSERT INTO aux_categories VALUES ('cat1', 'set1', 'dept', '部门');
    INSERT INTO aux_items VALUES ('item1', 'set1', 'cat1', '001', '部门A');
    INSERT INTO init_balances VALUES ('ib1', 'set1', 'acc1', 2026, 1, '', 100, 0);
    INSERT INTO vouchers VALUES ('v1', 'set1', '记-1', 'posted', '2026-05-01', 2026, 5);
    INSERT INTO voucher_entries VALUES ('ve1', 'set1', 'v1', 'acc1');
    INSERT INTO account_balances VALUES ('ab1', 'set1', 2026, 5);
    INSERT INTO period_closing VALUES ('pc1', 'set1', 2026, 1, 'closed');
  `)
  return db
}

describe('systemReinitialize', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('verifyAdminPassword 正确密码通过', () => {
    expect(verifyAdminPassword(db, 'set1', 'admin123')).toBe(true)
    expect(verifyAdminPassword(db, 'set1', 'wrong')).toBe(false)
  })

  it('previewReinitialize voucher_only 返回凭证计数', () => {
    const preview = previewReinitialize(db, 'set1', { mode: 'voucher_only', start_date: '2026-04-01' })
    expect(preview.counts.vouchers).toBe(1)
    expect(preview.willDelete.init_balances).toBe(0)
    expect(preview.warnings.some(w => w.includes('2026-04-01'))).toBe(true)
  })

  it('voucher_only 清理 posted 凭证并保留科目期初，更新建账日期', () => {
    const result = reinitializeAccountSet(db, 'set1', {
      mode: 'voucher_only',
      start_date: '2026-04-01',
    })
    expect(result.message).toContain('已清理全部凭证')
    expect(result.message).toContain('2026-04-01')

    const vouchers = db.prepare('SELECT COUNT(*) as cnt FROM vouchers WHERE account_set_id=?').get('set1') as any
    expect(vouchers.cnt).toBe(0)

    const initCount = db.prepare('SELECT COUNT(*) as cnt FROM init_balances WHERE account_set_id=?').get('set1') as any
    expect(initCount.cnt).toBe(1)

    const accountCount = db.prepare('SELECT COUNT(*) as cnt FROM accounts WHERE account_set_id=?').get('set1') as any
    expect(accountCount.cnt).toBe(1)

    const accountSet = db.prepare('SELECT start_date, fiscal_year FROM account_sets WHERE id=?').get('set1') as any
    expect(accountSet.start_date).toBe('2026-04-01')
    expect(accountSet.fiscal_year).toBe(2026)
  })

  it('full_reinit 缺少科目级数时报错', () => {
    expect(() =>
      reinitializeAccountSet(db, 'set1', {
        mode: 'full_reinit',
        start_date: '2026-05-01',
        accounting_standard: 'government',
        standard_template_id: '政府模板',
      })
    ).toThrow('重新初始化须设置科目级数与各级科目长度')
  })

  it('full_reinit 缺少模板时报错', () => {
    expect(() =>
      reinitializeAccountSet(db, 'set1', {
        mode: 'full_reinit',
        start_date: '2026-05-01',
        accounting_standard: 'government',
        standard_template_id: '',
      })
    ).toThrow('请选择标准模板')
  })

  it('full_reinit 清空期初并导入科目', async () => {
    const { importAcdTemplateToAccountSet } = await import('../scripts/importAcdToCurrentAccountSet.js')

    const result = reinitializeAccountSet(db, 'set1', {
      mode: 'full_reinit',
      start_date: '2026-05-01',
      accounting_standard: 'government',
      standard_template_id: '政府模板',
      account_levels: 4,
      account_code_lengths: [4, 3, 3, 2],
      preserve: { preserve_aux: true, preserve_dashboard_rules: true },
    })

    expect(importAcdTemplateToAccountSet).toHaveBeenCalledWith(
      'set1',
      expect.any(Buffer),
      expect.objectContaining({
        accountLevels: 4,
        accountCodeLengths: expect.arrayContaining([4, 3, 3, 2]),
      })
    )
    expect(result.message).toContain('重新初始化完成')
    expect(result.message).toContain('2026-05-01')

    const initCount = db.prepare('SELECT COUNT(*) as cnt FROM init_balances WHERE account_set_id=?').get('set1') as any
    expect(initCount.cnt).toBe(0)

    const auxCount = db.prepare('SELECT COUNT(*) as cnt FROM aux_items WHERE account_set_id=?').get('set1') as any
    expect(auxCount.cnt).toBe(1)

    const accountSet = db.prepare('SELECT start_date FROM account_sets WHERE id=?').get('set1') as any
    expect(accountSet.start_date).toBe('2026-05-01')
  })

  it('缺少建账日期时报错', () => {
    expect(() => previewReinitialize(db, 'set1', { mode: 'voucher_only', start_date: '' })).toThrow(
      '请选择有效的建账日期'
    )
  })

  it('clearVoucherData 删除全部凭证相关数据', () => {
    clearVoucherData(db, 'set1')
    const vouchers = db.prepare('SELECT COUNT(*) as cnt FROM vouchers WHERE account_set_id=?').get('set1') as any
    expect(vouchers.cnt).toBe(0)
    const closing = db.prepare('SELECT COUNT(*) as cnt FROM period_closing WHERE account_set_id=?').get('set1') as any
    expect(closing.cnt).toBe(0)
  })

  it('createPreReinitializeBackup 调用完整备份并在失败时中止', async () => {
    const backup = await createPreReinitializeBackup('set1', 'u1')
    expect(backup.filename).toContain('初始化前备份')
    expect(doBackup).toHaveBeenCalledWith('set1', 'manual', 'u1', undefined, {
      filenamePrefix: '初始化前备份',
    })

    vi.mocked(doBackup).mockResolvedValueOnce({
      id: '',
      filename: '',
      filepath: '',
      size: 0,
      error: '磁盘空间不足',
    })
    await expect(createPreReinitializeBackup('set1', 'u1')).rejects.toThrow('磁盘空间不足')
  })
})
