import type Database from 'better-sqlite3'

/**
 * 出纳管理模块建表迁移
 *
 * 兼容润衡 .acd 备份：cn_mx(日记账明细) / cn_nc(期初) / yhdzd(银行对账单) / jslb(结算方式)
 * 字段映射详见 docs/2026-06-01-固定资产与出纳模块开发计划.md §2.1
 */
export function up(db: Database.Database) {
  // 出纳日记账（现金/银行日记账核心表，对应 ACD cn_mx）
  db.exec(`
    CREATE TABLE IF NOT EXISTS cashier_journal (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      account_code TEXT NOT NULL,            -- kmbm 现金/银行科目
      currency TEXT NOT NULL DEFAULT 'RMB',  -- bz 币别
      biz_date TEXT NOT NULL,                -- rq 业务日期
      seq INTEGER NOT NULL DEFAULT 0,        -- xh 当日序号
      summary TEXT,                          -- zy 摘要
      debit REAL NOT NULL DEFAULT 0,         -- jf 借方(收入)
      credit REAL NOT NULL DEFAULT 0,        -- df 贷方(支出)
      settle_type TEXT,                      -- 结算方式 jslb
      bill_no TEXT,                          -- 票据号
      counter_unit TEXT,                     -- g_qymc 对方单位
      counter_account TEXT,                  -- dfkm 对方科目
      bank_name TEXT,                        -- khyh 开户行
      bank_account TEXT,                     -- yhzh 银行账号
      unit_code TEXT,                        -- dwbm 单位编码
      reconciled INTEGER NOT NULL DEFAULT 0, -- gzm 勾对/对账标志
      voucher_year INTEGER,                  -- p_nf 关联凭证年
      voucher_month INTEGER,                 -- p_yf 关联凭证月
      voucher_type INTEGER,                  -- p_pzlx 关联凭证类型
      voucher_no INTEGER,                    -- p_pzbh 关联凭证号
      acd_raw TEXT,                          -- 原始整行 JSON，保证可逆还原
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_set ON cashier_journal(account_set_id);
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_account ON cashier_journal(account_set_id, account_code, biz_date);
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_voucher ON cashier_journal(account_set_id, voucher_year, voucher_month, voucher_type, voucher_no);
  `)

  // 出纳期初余额（对应 ACD cn_nc）
  db.exec(`
    CREATE TABLE IF NOT EXISTS cashier_init_balance (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      account_code TEXT NOT NULL,            -- kmbm
      currency TEXT NOT NULL DEFAULT 'RMB',  -- bz
      balance REAL NOT NULL DEFAULT 0,       -- ye 期初余额
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, account_code, currency)
    );
  `)

  // 银行对账单（对应 ACD yhdzd）
  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_statement (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      account_code TEXT NOT NULL,            -- kmbm 银行科目
      biz_date TEXT,                         -- rq
      debit REAL NOT NULL DEFAULT 0,         -- jf
      credit REAL NOT NULL DEFAULT 0,        -- df
      settle_type TEXT,                      -- jslb 结算方式
      bill_no TEXT,                          -- pz_ph 票据号
      matched INTEGER NOT NULL DEFAULT 0,    -- dzbz 对账标志
      match_batch INTEGER,                   -- dzbh 对账批号
      source TEXT NOT NULL DEFAULT 'import', -- import/manual
      acd_raw TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bank_statement_set ON bank_statement(account_set_id, account_code, biz_date);
  `)

  // 结算方式字典（对应 ACD jslb）
  db.exec(`
    CREATE TABLE IF NOT EXISTS settle_type (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                    -- jslb
      name TEXT,                             -- jslb_mc
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
  `)

  console.log('✓ 出纳模块表已创建: cashier_journal / cashier_init_balance / bank_statement / settle_type')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP TABLE IF EXISTS settle_type;
    DROP TABLE IF EXISTS bank_statement;
    DROP TABLE IF EXISTS cashier_init_balance;
    DROP TABLE IF EXISTS cashier_journal;
  `)
  console.log('✓ 出纳模块表已删除')
}
