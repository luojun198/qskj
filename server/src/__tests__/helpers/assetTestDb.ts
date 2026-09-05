import Database from 'better-sqlite3'

/**
 * 固定资产测试用最小内存库：只建资产模块与凭证落库实际触及的表。
 * 字段与 db/schema.sql、资产相关迁移保持一致（仅省略与被测逻辑无关的列）。
 */
export function createAssetTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE fixed_asset (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      asset_no TEXT NOT NULL,
      asset_name TEXT NOT NULL,
      category_code TEXT,
      status_code TEXT,
      dept_code TEXT,
      purpose_code TEXT,
      acquire_date TEXT,
      start_depr_date TEXT,
      original_value REAL DEFAULT 0,
      salvage_rate REAL DEFAULT 0,
      salvage_value REAL DEFAULT 0,
      depr_method TEXT,
      use_months INTEGER,
      total_workload REAL,
      depr_months_done INTEGER DEFAULT 0,
      workload_done REAL DEFAULT 0,
      accum_depr REAL DEFAULT 0,
      impairment_amount REAL DEFAULT 0,
      net_value REAL DEFAULT 0,
      use_years INTEGER,
      qty REAL DEFAULT 1,
      unit TEXT,
      source TEXT,
      install_place TEXT,
      user_name TEXT,
      keeper TEXT,
      scrap_date TEXT,
      scrap_reason TEXT,
      scrap_voucher_id TEXT,
      pre_scrap_status TEXT,
      purchase_voucher_id TEXT,
      remark TEXT,
      updated_at TEXT
    );
    CREATE TABLE fixed_asset_depr (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      asset_no TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      dept_code TEXT,
      purpose_code TEXT,
      depr_method TEXT,
      month_depr REAL,
      accum_depr REAL,
      voucher_id TEXT,
      UNIQUE(account_set_id, asset_no, year, month)
    );
    CREATE TABLE fixed_asset_change (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      asset_no TEXT NOT NULL,
      change_date TEXT,
      change_item TEXT,
      old_value REAL,
      new_value REAL,
      amount REAL,
      remark TEXT,
      operator TEXT,
      change_kind TEXT,
      change_type_code TEXT,
      field_key TEXT,
      old_text TEXT,
      new_text TEXT,
      voucher_id TEXT,
      year INTEGER,
      period INTEGER,
      created_by TEXT
    );
    CREATE TABLE fixed_asset_change_type (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      direction TEXT
    );
    CREATE TABLE fixed_asset_category (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT,
      salvage_rate REAL,
      account_code TEXT,
      depr_account_code TEXT,
      impairment_account_code TEXT,
      clearing_account_code TEXT
    );
    CREATE TABLE fixed_asset_status (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT,
      depreciable INTEGER DEFAULT 1
    );
    CREATE TABLE fixed_asset_purpose (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT,
      expense_account TEXT
    );
    CREATE TABLE fixed_asset_dept (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      direction TEXT,
      is_aux INTEGER DEFAULT 0,
      aux_types TEXT
    );
    CREATE TABLE voucher_types (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      name TEXT,
      code TEXT,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      voucher_no TEXT NOT NULL,
      voucher_type_id TEXT,
      voucher_date TEXT,
      year INTEGER,
      period INTEGER,
      total_amount REAL,
      maker_name TEXT,
      remark TEXT,
      source TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      voucher_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      account_id TEXT NOT NULL,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount REAL NOT NULL,
      amount_cents INTEGER,
      summary TEXT,
      dept_id TEXT, dept_name TEXT,
      project_id TEXT, project_name TEXT,
      supplier_id TEXT, supplier_name TEXT,
      person_id TEXT, person_name TEXT,
      func_class_id TEXT, func_class_name TEXT,
      aux_data TEXT,
      cash_flow_code TEXT, cash_flow_name TEXT
    );
    CREATE TABLE aux_categories (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE aux_category_fields (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      field_key TEXT,
      field_name TEXT,
      field_type TEXT,
      show_in_voucher INTEGER DEFAULT 0,
      is_enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE aux_items (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      type TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE cash_flow_items (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT,
      name TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE system_params (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      param_key TEXT NOT NULL,
      param_value TEXT
    );
    CREATE TABLE fixed_asset_inventory (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      name TEXT,
      inventory_date TEXT,
      status TEXT DEFAULT 'draft',
      total_count INTEGER DEFAULT 0,
      match_count INTEGER DEFAULT 0,
      surplus_count INTEGER DEFAULT 0,
      deficit_count INTEGER DEFAULT 0,
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE fixed_asset_inventory_item (
      id TEXT PRIMARY KEY,
      inventory_id TEXT NOT NULL,
      account_set_id TEXT NOT NULL,
      asset_no TEXT,
      asset_name TEXT,
      category_name TEXT,
      dept_name TEXT,
      book_qty REAL,
      book_original_value REAL,
      book_accum_depr REAL,
      book_net_value REAL,
      actual_qty REAL,
      actual_status TEXT,
      difference_qty REAL,
      difference_note TEXT,
      voucher_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE fixed_asset_requisition (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      asset_no TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('out','in')),
      action_date TEXT NOT NULL,
      user_name TEXT,
      user_aux_id TEXT,
      dept_code TEXT,
      keeper TEXT,
      install_place TEXT,
      expect_return_date TEXT,
      condition_note TEXT,
      remark TEXT,
      operator TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE fixed_asset_attachments (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(account_set_id, filename)
    );
    -- deleteVoucherRecords 会连带清理这两张表
    CREATE TABLE voucher_attachments (
      id TEXT PRIMARY KEY,
      voucher_id TEXT NOT NULL
    );
    CREATE TABLE auto_transfer_runs (
      id TEXT PRIMARY KEY,
      voucher_id TEXT NOT NULL
    );
    CREATE TABLE period_closing (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      period INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      closed_by TEXT,
      closed_at TEXT
    );
  `)
  return db
}

export const SET_ID = 'set-1'

/** 插入一张资产卡片，未指定的字段用可计提的合理默认值 */
export function insertAsset(
  db: Database.Database,
  asset: Partial<Record<string, unknown>> & { asset_no: string }
) {
  const row: Record<string, unknown> = {
    id: `fa-${asset.asset_no}`,
    account_set_id: SET_ID,
    asset_name: `资产${asset.asset_no}`,
    category_code: 'C1',
    status_code: '01',
    dept_code: 'D1',
    purpose_code: 'P1',
    start_depr_date: '2026-01-15',
    original_value: 0,
    salvage_value: 0,
    depr_method: '1',
    use_months: 12,
    total_workload: null,
    depr_months_done: 0,
    accum_depr: 0,
    net_value: 0,
    ...asset,
  }
  const cols = Object.keys(row)
  db.prepare(
    `INSERT INTO fixed_asset (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...cols.map(c => row[c]))
  return row
}

/** 建一批科目；codes 可传 [code, name] 或纯 code */
export function insertAccounts(
  db: Database.Database,
  codes: Array<string | [string, string]>
) {
  const stmt = db.prepare(
    'INSERT INTO accounts (id, account_set_id, code, name, direction) VALUES (?,?,?,?,?)'
  )
  for (const c of codes) {
    const [code, name] = Array.isArray(c) ? c : [c, `科目${c}`]
    stmt.run(`acc-${code}`, SET_ID, code, name, 'debit')
  }
}

/** 建基础字典：类别 C1、状态 01（可计提）、用途 P1、部门 D1 */
export function insertAssetDicts(
  db: Database.Database,
  opts: {
    categoryAccount?: string
    deprAccount?: string
    clearingAccount?: string
    expenseAccount?: string
  } = {}
) {
  db.prepare(
    'INSERT INTO fixed_asset_category (id, account_set_id, code, name, account_code, depr_account_code, clearing_account_code) VALUES (?,?,?,?,?,?,?)'
  ).run(
    'cat-1',
    SET_ID,
    'C1',
    '机器设备',
    opts.categoryAccount ?? '1601',
    opts.deprAccount ?? '1602',
    opts.clearingAccount ?? '1606'
  )
  db.prepare(
    'INSERT INTO fixed_asset_status (id, account_set_id, code, name, depreciable) VALUES (?,?,?,?,1)'
  ).run('st-1', SET_ID, '01', '在用')
  db.prepare(
    'INSERT INTO fixed_asset_status (id, account_set_id, code, name, depreciable) VALUES (?,?,?,?,0)'
  ).run('st-2', SET_ID, '02', '未使用')
  db.prepare(
    'INSERT INTO fixed_asset_purpose (id, account_set_id, code, name, expense_account) VALUES (?,?,?,?,?)'
  ).run('pu-1', SET_ID, 'P1', '生产用', opts.expenseAccount ?? '660201')
  db.prepare('INSERT INTO fixed_asset_dept (id, account_set_id, code, name) VALUES (?,?,?,?)').run(
    'dp-1',
    SET_ID,
    'D1',
    '生产部'
  )
}

/** 启用部门辅助核算：建 dept 类别 + 一个与资产部门 D1 对应的核算项，并给指定科目挂上 */
export function enableDeptAux(db: Database.Database, accountCodes: string[]) {
  db.prepare(
    'INSERT INTO aux_categories (id, account_set_id, code, name) VALUES (?,?,?,?)'
  ).run('auxcat-dept', SET_ID, 'dept', '部门')
  db.prepare(
    'INSERT INTO aux_items (id, account_set_id, type, code, name) VALUES (?,?,?,?,?)'
  ).run('auxitem-d1', SET_ID, 'auxcat-dept', 'D1', '生产部')
  const upd = db.prepare(
    'UPDATE accounts SET is_aux=1, aux_types=? WHERE account_set_id=? AND code=?'
  )
  for (const code of accountCodes) {
    upd.run(JSON.stringify({ 'auxcat-dept': '部门' }), SET_ID, code)
  }
}

/** 标记某期间已结账 */
export function closePeriod(db: Database.Database, year: number, period: number) {
  db.prepare(
    "INSERT INTO period_closing (id, account_set_id, year, period, status) VALUES (?,?,?,?,'closed')"
  ).run(`pc-${year}-${period}`, SET_ID, year, period)
}
