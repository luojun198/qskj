-- 行政事业单位财务记账系统 数据库Schema
-- SQLite

PRAGMA foreign_keys = ON;

-- ===================== 系统模块 =====================

-- 账套表
CREATE TABLE IF NOT EXISTS account_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  credit_code TEXT,
  fiscal_dept TEXT,
  fiscal_year INTEGER NOT NULL DEFAULT (strftime('%Y', 'now')),
  start_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'closed')),
  unit_leader TEXT,
  chief_accountant TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  account_set_id TEXT REFERENCES account_sets(id),
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  nickname TEXT,
  role_id TEXT,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'locked')),
  last_login_at TEXT,
  last_login_ip TEXT,
  failed_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  password_expire_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, username)
);

-- 角色表
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER DEFAULT 0,
  permissions TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY,
  account_set_id TEXT REFERENCES account_sets(id),
  user_id TEXT REFERENCES users(id),
  username TEXT,
  action TEXT NOT NULL,
  module TEXT,
  detail TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 系统参数表
CREATE TABLE IF NOT EXISTS system_params (
  id TEXT PRIMARY KEY,
  account_set_id TEXT REFERENCES account_sets(id),
  param_key TEXT NOT NULL,
  param_value TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, param_key)
);

-- ===================== 基础设置模块 =====================

-- 会计科目表
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
  level INTEGER NOT NULL DEFAULT 1,
  parent_id TEXT,
  is_aux INTEGER DEFAULT 0,
  aux_types TEXT,
  balance TEXT CHECK(balance IN ('initial', 'normal', 'temp')),
  is_cash INTEGER DEFAULT 0,
  is_bank INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  allow_delete INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, code)
);

-- 凭证类型表
CREATE TABLE IF NOT EXISTS voucher_types (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  prefix TEXT,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 辅助核算类别表（用户自定义核算维度）
CREATE TABLE IF NOT EXISTS aux_categories (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, code)
);

-- 核算项目表（统一表，通过type区分，type指向aux_categories.id）
CREATE TABLE IF NOT EXISTS aux_items (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  type TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed')),
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, type, code),
  FOREIGN KEY (type) REFERENCES aux_categories(id) ON DELETE RESTRICT
);

-- 期初余额表
CREATE TABLE IF NOT EXISTS init_balances (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
  year INTEGER NOT NULL,
  period INTEGER NOT NULL,
  init_balance REAL NOT NULL DEFAULT 0,
  init_debit REAL NOT NULL DEFAULT 0,
  init_credit REAL NOT NULL DEFAULT 0,
  aux_item_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== 凭证管理模块 =====================

-- 凭证主表
CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  voucher_no TEXT NOT NULL,
  voucher_type_id TEXT REFERENCES voucher_types(id),
  voucher_date TEXT NOT NULL,
  year INTEGER NOT NULL,
  period INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'audited', 'posted')),
  total_amount REAL NOT NULL DEFAULT 0,
  maker_id TEXT REFERENCES users(id),
  maker_name TEXT,
  auditor_id TEXT REFERENCES users(id),
  auditor_name TEXT,
  poster_id TEXT REFERENCES users(id),
  poster_name TEXT,
  posted_at TEXT,
  attachments INTEGER DEFAULT 0,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, year, voucher_no)
);

-- 凭证分录表
CREATE TABLE IF NOT EXISTS voucher_entries (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  voucher_id TEXT NOT NULL REFERENCES vouchers(id),
  seq INTEGER NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
  amount REAL NOT NULL,
  summary TEXT,
  dept_id TEXT,
  dept_name TEXT,
  project_id TEXT,
  project_name TEXT,
  supplier_id TEXT,
  supplier_name TEXT,
  person_id TEXT,
  person_name TEXT,
  func_class_id TEXT,
  func_class_name TEXT,
  aux_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== 账簿模块 =====================

-- 余额表（按月汇总）
CREATE TABLE IF NOT EXISTS account_balances (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  direction TEXT NOT NULL,
  year INTEGER NOT NULL,
  period INTEGER NOT NULL,
  init_balance REAL DEFAULT 0,
  init_debit REAL DEFAULT 0,
  init_credit REAL DEFAULT 0,
  current_debit REAL DEFAULT 0,
  current_credit REAL DEFAULT 0,
  end_balance REAL DEFAULT 0,
  end_debit REAL DEFAULT 0,
  end_credit REAL DEFAULT 0,
  aux_item_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, account_id, year, period, aux_item_id)
);

-- 月结状态
CREATE TABLE IF NOT EXISTS period_closing (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  year INTEGER NOT NULL,
  period INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  closed_by TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, year, period)
);

-- ===================== AI 模块 =====================

-- AI配置
CREATE TABLE IF NOT EXISTS ai_config (
  id TEXT PRIMARY KEY,
  account_set_id TEXT REFERENCES account_sets(id),
  provider TEXT NOT NULL DEFAULT 'openai',
  api_url TEXT,
  api_key TEXT,
  model TEXT DEFAULT 'gpt-3.5-turbo',
  enabled INTEGER DEFAULT 0,
  settings TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI调用日志
CREATE TABLE IF NOT EXISTS ai_logs (
  id TEXT PRIMARY KEY,
  account_set_id TEXT REFERENCES account_sets(id),
  user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('summary', 'check', 'anomaly')),
  input TEXT,
  output TEXT,
  tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== 备份记录 =====================

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  account_set_id TEXT REFERENCES account_sets(id),
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  size INTEGER,
  type TEXT DEFAULT 'manual' CHECK(type IN ('manual', 'auto')),
  status TEXT DEFAULT 'success' CHECK(status IN ('success', 'failed')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== 索引 =====================

CREATE INDEX IF NOT EXISTS idx_users_account_set ON users(account_set_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts(account_set_id, code);
CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(account_set_id, voucher_date);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(account_set_id, status);
CREATE INDEX IF NOT EXISTS idx_voucher_entries_voucher ON voucher_entries(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_entries_account ON voucher_entries(account_set_id, account_id);
CREATE INDEX IF NOT EXISTS idx_account_balances_period ON account_balances(account_set_id, year, period);
CREATE INDEX IF NOT EXISTS idx_aux_items_type ON aux_items(account_set_id, type);
CREATE INDEX IF NOT EXISTS idx_init_balances ON init_balances(account_set_id, year, period);
CREATE INDEX IF NOT EXISTS idx_operation_logs_user ON operation_logs(account_set_id, user_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_time ON operation_logs(account_set_id, created_at);
