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

CREATE TABLE IF NOT EXISTS user_login_sessions (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  login_ip TEXT,
  user_agent TEXT,
  login_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'forced', 'logout', 'expired')),
  forced_logout_at TEXT,
  forced_by_ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_login_sessions_user_status ON user_login_sessions(user_id, account_set_id, status);
CREATE INDEX IF NOT EXISTS idx_user_login_sessions_active_ip ON user_login_sessions(user_id, account_set_id, login_ip, status);

-- 角色表
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  account_set_id TEXT REFERENCES account_sets(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  is_system INTEGER DEFAULT 0,
  permissions TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, code)
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

-- 软件授权激活表（单机单条记录）
CREATE TABLE IF NOT EXISTS license_activation (
  id TEXT PRIMARY KEY DEFAULT 'default',
  machine_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  license_token TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  require_cash_flow INTEGER NOT NULL DEFAULT 0,
  is_foreign INTEGER NOT NULL DEFAULT 0,
  currency_code TEXT,
  is_quantity INTEGER NOT NULL DEFAULT 0,
  quantity_unit TEXT,
  no_negative INTEGER DEFAULT 0,
  ledger_format TEXT DEFAULT 'three_column' CHECK(ledger_format IN ('three_column', 'multi_column', 'quantity_amount')),
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
  default_item_id TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, code)
);

-- 辅助核算类别字段配置表（每个类别可自定义多个扩展字段）
CREATE TABLE IF NOT EXISTS aux_category_fields (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES aux_categories(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK(field_type IN ('text', 'number', 'date', 'select')),
  options_json TEXT,
  show_in_voucher INTEGER DEFAULT 0,
  required_in_voucher INTEGER DEFAULT 0,
  required_in_archive INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category_id, field_key)
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
  field_values TEXT DEFAULT '{}',
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
  aux_item_id TEXT NOT NULL DEFAULT '',
  opening_debit REAL NOT NULL DEFAULT 0,
  opening_credit REAL NOT NULL DEFAULT 0,
  pre_book_debit REAL NOT NULL DEFAULT 0,
  pre_book_credit REAL NOT NULL DEFAULT 0,
  foreign_init_balance REAL NOT NULL DEFAULT 0,
  foreign_opening_debit REAL NOT NULL DEFAULT 0,
  foreign_opening_credit REAL NOT NULL DEFAULT 0,
  foreign_pre_book_debit REAL NOT NULL DEFAULT 0,
  foreign_pre_book_credit REAL NOT NULL DEFAULT 0,
  qty_init_balance REAL NOT NULL DEFAULT 0,
  qty_opening_debit REAL NOT NULL DEFAULT 0,
  qty_opening_credit REAL NOT NULL DEFAULT 0,
  qty_pre_book_debit REAL NOT NULL DEFAULT 0,
  qty_pre_book_credit REAL NOT NULL DEFAULT 0,
  init_balance_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, account_id, year, period, aux_item_id)
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
  UNIQUE(account_set_id, year, period, voucher_type_id, voucher_no)
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
  amount_cents INTEGER,
  quantity REAL DEFAULT 0,
  unit_price REAL DEFAULT 0,
  unit TEXT,
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
  cash_flow_code TEXT,
  cash_flow_name TEXT,
  currency_code TEXT,
  exchange_rate REAL,
  foreign_amount REAL,
  aux_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_voucher_entries_cash_flow ON voucher_entries(cash_flow_code);

-- 外币币种
CREATE TABLE IF NOT EXISTS currencies (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_base INTEGER NOT NULL DEFAULT 0,
  default_rate REAL NOT NULL DEFAULT 1,
  begin_rate REAL NOT NULL DEFAULT 1,
  end_rate REAL NOT NULL DEFAULT 1,
  rate_decimals INTEGER NOT NULL DEFAULT 4,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, code)
);

CREATE INDEX IF NOT EXISTS idx_currencies_account_set ON currencies(account_set_id);

-- 外币汇率（按年/期）
CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  currency_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  period INTEGER NOT NULL,
  rate REAL NOT NULL DEFAULT 1,
  closing_rate REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, currency_code, year, period)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_account_set
  ON exchange_rates(account_set_id, currency_code, year, period);

-- 现金流量项目
CREATE TABLE IF NOT EXISTS cash_flow_items (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('inflow', 'outflow', 'neutral')),
  parent_code TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  is_leaf INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cash_flow_items_account_set ON cash_flow_items(account_set_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_items_code ON cash_flow_items(account_set_id, code);
CREATE INDEX IF NOT EXISTS idx_cash_flow_items_parent ON cash_flow_items(account_set_id, parent_code);

-- ===================== 快捷键配置 =====================
CREATE TABLE IF NOT EXISTS keyboard_shortcuts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  key VARCHAR(20) NOT NULL,
  ctrl BOOLEAN DEFAULT 0,
  alt BOOLEAN DEFAULT 0,
  shift BOOLEAN DEFAULT 0,
  meta BOOLEAN DEFAULT 0,
  description TEXT,
  component_path VARCHAR(200),
  is_enabled BOOLEAN DEFAULT 1,
  is_custom BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_keyboard_shortcuts_module ON keyboard_shortcuts(module);
CREATE INDEX IF NOT EXISTS idx_keyboard_shortcuts_enabled ON keyboard_shortcuts(is_enabled);

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
  current_debit_cents INTEGER,
  current_credit_cents INTEGER,
  end_balance REAL DEFAULT 0,
  end_debit REAL DEFAULT 0,
  end_credit REAL DEFAULT 0,
  foreign_init_balance REAL NOT NULL DEFAULT 0,
  foreign_current_debit REAL NOT NULL DEFAULT 0,
  foreign_current_credit REAL NOT NULL DEFAULT 0,
  foreign_end_balance REAL NOT NULL DEFAULT 0,
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

-- 自动结转执行记录
CREATE TABLE IF NOT EXISTS auto_transfer_runs (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  year INTEGER NOT NULL,
  period INTEGER NOT NULL,
  transfer_type TEXT NOT NULL,
  transfer_type_code TEXT,
  voucher_id TEXT NOT NULL REFERENCES vouchers(id),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, year, period, transfer_type_code)
);

-- 期末调汇生成记录（每期一张）
CREATE TABLE IF NOT EXISTS fx_revaluation_runs (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  year INTEGER NOT NULL,
  period INTEGER NOT NULL,
  voucher_id TEXT NOT NULL REFERENCES vouchers(id),
  created_by TEXT,
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

-- 预算盈余与预算结余差异明细（ACD ysda.txt）
CREATE TABLE IF NOT EXISTS budget_surplus_adjustments (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
  source_seq INTEGER,
  item_code TEXT NOT NULL,
  item_name TEXT,
  year INTEGER NOT NULL,
  period INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  account_code TEXT,
  alt_amount REAL NOT NULL DEFAULT 0,
  item_type TEXT,
  balance_direction TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, source_seq)
);

-- ===================== 索引 =====================

CREATE INDEX IF NOT EXISTS idx_users_account_set ON users(account_set_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts(account_set_id, code);
-- ===================== 结转类型配置 =====================

-- 结转类型表
CREATE TABLE IF NOT EXISTS transfer_types (
  id TEXT PRIMARY KEY,
  account_set_id TEXT REFERENCES account_sets(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  voucher_type TEXT DEFAULT '结转',
  period_type TEXT DEFAULT 'monthly',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, code)
);

-- 结转配置项表
CREATE TABLE IF NOT EXISTS transfer_items (
  id TEXT PRIMARY KEY,
  account_set_id TEXT REFERENCES account_sets(id),
  type_code TEXT NOT NULL,
  summary TEXT,
  from_code TEXT,
  from_name TEXT,
  to_code TEXT,
  to_name TEXT,
  transfer_type TEXT DEFAULT 'all' CHECK(transfer_type IN ('all', 'partial')),
  ratio REAL DEFAULT 100,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transfer_types_account_set ON transfer_types(account_set_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_type ON transfer_items(account_set_id, type_code);

-- ===================== 索引 =====================

CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(account_set_id, voucher_date);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(account_set_id, status);
CREATE INDEX IF NOT EXISTS idx_voucher_entries_voucher ON voucher_entries(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_entries_account ON voucher_entries(account_set_id, account_id);
CREATE INDEX IF NOT EXISTS idx_account_balances_period ON account_balances(account_set_id, year, period);
CREATE INDEX IF NOT EXISTS idx_auto_transfer_runs_period ON auto_transfer_runs(account_set_id, year, period, transfer_type);
CREATE INDEX IF NOT EXISTS idx_aux_items_list ON aux_items(account_set_id, type, status, code);
CREATE INDEX IF NOT EXISTS idx_aux_items_type_name ON aux_items(account_set_id, type, name);
CREATE INDEX IF NOT EXISTS idx_aux_category_fields_category ON aux_category_fields(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_init_balances ON init_balances(account_set_id, year, period);
CREATE INDEX IF NOT EXISTS idx_init_balances_aux_item ON init_balances(account_set_id, aux_item_id) WHERE aux_item_id != '';
CREATE INDEX IF NOT EXISTS idx_account_balances_account_cum ON account_balances(account_set_id, year, account_id, period);
CREATE INDEX IF NOT EXISTS idx_account_balances_aux ON account_balances(account_set_id, account_id, aux_item_id, year, period);
CREATE INDEX IF NOT EXISTS idx_voucher_entries_dept ON voucher_entries(account_set_id, dept_id) WHERE dept_id IS NOT NULL AND dept_id != '';
CREATE INDEX IF NOT EXISTS idx_voucher_entries_project ON voucher_entries(account_set_id, project_id) WHERE project_id IS NOT NULL AND project_id != '';
CREATE INDEX IF NOT EXISTS idx_voucher_entries_supplier ON voucher_entries(account_set_id, supplier_id) WHERE supplier_id IS NOT NULL AND supplier_id != '';
CREATE INDEX IF NOT EXISTS idx_voucher_entries_person ON voucher_entries(account_set_id, person_id) WHERE person_id IS NOT NULL AND person_id != '';
CREATE INDEX IF NOT EXISTS idx_voucher_entries_func_class ON voucher_entries(account_set_id, func_class_id) WHERE func_class_id IS NOT NULL AND func_class_id != '';
CREATE INDEX IF NOT EXISTS idx_operation_logs_user ON operation_logs(account_set_id, user_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_time ON operation_logs(account_set_id, created_at);
CREATE INDEX IF NOT EXISTS idx_budget_surplus_adjustments_period
  ON budget_surplus_adjustments(account_set_id, year, period, item_code);

-- 凭证附件表
CREATE TABLE IF NOT EXISTS voucher_attachments (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  voucher_id TEXT NOT NULL REFERENCES vouchers(id),
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_voucher_attachments_voucher ON voucher_attachments(account_set_id, voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_attachments_created ON voucher_attachments(account_set_id, created_at);

-- ===================== 凭证模板 =====================
CREATE TABLE IF NOT EXISTS voucher_templates (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  template_no TEXT NOT NULL,
  template_name TEXT NOT NULL,
  voucher_type_id TEXT REFERENCES voucher_types(id),
  total_amount REAL NOT NULL DEFAULT 0,
  remark TEXT,
  entries_data TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, template_no)
);

CREATE INDEX IF NOT EXISTS idx_voucher_templates_account_set ON voucher_templates(account_set_id);
CREATE INDEX IF NOT EXISTS idx_voucher_templates_type ON voucher_templates(voucher_type_id);

-- ===================== 打印模板 =====================
CREATE TABLE IF NOT EXISTS print_templates (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  name TEXT NOT NULL,
  paper_size TEXT NOT NULL DEFAULT 'custom' CHECK(paper_size IN ('custom', 'A4', 'A5')),
  paper_width REAL NOT NULL DEFAULT 220,
  paper_height REAL NOT NULL DEFAULT 140,
  margin_top REAL NOT NULL DEFAULT 15,
  margin_bottom REAL NOT NULL DEFAULT 15,
  margin_left REAL NOT NULL DEFAULT 10,
  margin_right REAL NOT NULL DEFAULT 10,
  elements TEXT NOT NULL DEFAULT '[]',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_print_templates_account_set ON print_templates(account_set_id);
CREATE INDEX IF NOT EXISTS idx_print_templates_default ON print_templates(account_set_id, is_default);

-- ===================== 报表模板 =====================

-- 简化报表模板表（现有固定报表/手工维护项）
CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,
  account_set_id TEXT REFERENCES account_sets(id),
  name TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK(report_type IN ('balance_sheet', 'income_statement', 'cashflow')),
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 简化报表模板行项目表
CREATE TABLE IF NOT EXISTS report_template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'detail' CHECK(item_type IN ('group', 'detail', 'formula', 'text')),
  indent INTEGER DEFAULT 0,
  side TEXT DEFAULT 'left' CHECK(side IN ('left', 'right')),
  formula_end TEXT,
  formula_begin TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_report_templates_account_set ON report_templates(account_set_id);
CREATE INDEX IF NOT EXISTS idx_report_template_items_template ON report_template_items(template_id);

-- ACD 动态报表定义表
CREATE TABLE IF NOT EXISTS report_definitions (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'acd' CHECK(source IN ('acd', 'manual', 'xls')),
  source_file TEXT,
  sort_order INTEGER DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, code)
);

-- ACD 动态报表 sheet 表
CREATE TABLE IF NOT EXISTS report_sheets (
  id TEXT PRIMARY KEY,
  report_definition_id TEXT NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
  sheet_key TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  sheet_index INTEGER NOT NULL DEFAULT 0,
  default_col_width INTEGER DEFAULT 160,
  default_row_height INTEGER DEFAULT 34,
  col_widths TEXT,
  row_heights TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(report_definition_id, sheet_key)
);

-- ACD 报表来源表，保留原始模板与解析元数据
CREATE TABLE IF NOT EXISTS report_template_sources (
  id TEXT PRIMARY KEY,
  report_definition_id TEXT NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'vts' CHECK(source_type IN ('vts', 'txt', 'xls')),
  raw_content TEXT,
  content_encoding TEXT DEFAULT 'gb18030',
  parse_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(report_definition_id, source_file)
);

-- ACD 动态报表单元格表
CREATE TABLE IF NOT EXISTS report_cells (
  id TEXT PRIMARY KEY,
  report_sheet_id TEXT NOT NULL REFERENCES report_sheets(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  col_index INTEGER NOT NULL,
  cell_type TEXT NOT NULL DEFAULT 'text' CHECK(cell_type IN ('text', 'formula', 'number', 'empty', 'merged')),
  text_value TEXT,
  formula_text TEXT,
  format_text TEXT,
  style_key TEXT,
  side TEXT CHECK(side IN ('left', 'right')),
  col_width TEXT,
  row_height TEXT,
  merge_info TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(report_sheet_id, row_index, col_index)
);

-- ACD 公式函数映射表
CREATE TABLE IF NOT EXISTS report_formula_functions (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  function_name TEXT NOT NULL,
  handler_key TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_set_id, function_name)
);

CREATE INDEX IF NOT EXISTS idx_report_definitions_account_set ON report_definitions(account_set_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_report_sheets_definition ON report_sheets(report_definition_id, sheet_index);
CREATE INDEX IF NOT EXISTS idx_report_template_sources_definition ON report_template_sources(report_definition_id);
CREATE INDEX IF NOT EXISTS idx_report_cells_sheet ON report_cells(report_sheet_id, row_index, col_index);
CREATE INDEX IF NOT EXISTS idx_report_formula_functions_account_set ON report_formula_functions(account_set_id, function_name);
