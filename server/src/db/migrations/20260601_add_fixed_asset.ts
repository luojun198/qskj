import type Database from 'better-sqlite3'

/**
 * 固定资产模块建表迁移
 *
 * 兼容润衡 .acd 备份：
 *   zc_gdzc(卡片主表) / zc_yzjb(月折旧) / zc_yzzj+zc_sbbd(变动)
 *   zc_sblb(类别) / zc_sbzt(状态) / zc_sbyt(用途) / zc_sydw(部门)
 * 字段映射详见 docs/2026-06-01-固定资产与出纳模块开发计划.md §2.2
 */
export function up(db: Database.Database) {
  // 固定资产卡片主表（对应 ACD zc_gdzc，保留全部关键字段 + acd_raw 兜底）
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixed_asset (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      asset_no TEXT NOT NULL,                -- bh 资产编号
      asset_name TEXT,                       -- mc 名称
      category_code TEXT,                    -- sblb 类别
      status_code TEXT,                      -- sbzt 状态
      dept_code TEXT,                        -- sydw 使用部门
      purpose_code TEXT,                     -- ytbh 用途(决定折旧费用科目)
      acquire_date TEXT,                     -- gzrq 购置日期
      start_depr_date TEXT,                  -- syrq 起折日期
      original_value REAL NOT NULL DEFAULT 0,-- yz 原值
      salvage_rate REAL NOT NULL DEFAULT 0,  -- czl 残值率
      salvage_value REAL NOT NULL DEFAULT 0, -- yzcz 预计净残值
      depr_method TEXT,                      -- zjff 折旧方法
      use_months INTEGER,                    -- synx 使用月数
      use_years INTEGER,                     -- synx_y 使用年数
      total_workload REAL,                   -- zgzl 工作量法-总工作量
      depr_months_done INTEGER NOT NULL DEFAULT 0, -- ljzjy 已提月数
      workload_done REAL NOT NULL DEFAULT 0, -- ljgzl 累计工作量
      accum_depr REAL NOT NULL DEFAULT 0,    -- ljzje 累计折旧
      net_value REAL NOT NULL DEFAULT 0,     -- zcjz 净值
      card_no TEXT,                          -- bjbh 卡片号
      qty INTEGER NOT NULL DEFAULT 1,        -- sl 数量
      unit TEXT,                             -- dw 计量单位
      user_name TEXT,                        -- syr 使用人
      keeper TEXT,                           -- bgr 保管人
      source TEXT,                           -- ly 来源
      install_place TEXT,                    -- azdd 安装地点
      is_foreign INTEGER NOT NULL DEFAULT 0, -- wbbz 外币标志
      foreign_value REAL,                    -- wbje 外币金额
      scrap_reason TEXT,                     -- zxyy 减少/注销原因
      scrap_date TEXT,                       -- zxrq 注销日期
      remark TEXT,                           -- bz 备注
      acd_raw TEXT,                          -- 原始整行 JSON，保证 100% 可逆还原
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, asset_no)
    );
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_set ON fixed_asset(account_set_id);
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_cat ON fixed_asset(account_set_id, category_code);
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_dept ON fixed_asset(account_set_id, dept_code);
  `)

  // 月折旧计提表（对应 ACD zc_yzjb，每月每卡一行）
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixed_asset_depr (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      asset_no TEXT NOT NULL,                -- bh
      year INTEGER NOT NULL,                 -- nf
      month INTEGER NOT NULL,                -- yf
      dept_code TEXT,                        -- sydw
      purpose_code TEXT,                     -- ytbh
      depr_method TEXT,                      -- zjff
      month_depr REAL NOT NULL DEFAULT 0,    -- yzje 当月折旧额
      accum_depr REAL NOT NULL DEFAULT 0,    -- ljzje 累计折旧
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, asset_no, year, month)
    );
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_depr_period ON fixed_asset_depr(account_set_id, year, month);
  `)

  // 资产变动流水（合并 ACD zc_yzzj 原值增减 + zc_sbbd 变动）
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixed_asset_change (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      asset_no TEXT NOT NULL,                -- bh
      change_date TEXT,                      -- rq
      change_item TEXT,                      -- bdxm 变动项目(原值/部门/状态等)
      old_value REAL,                        -- oldvalue
      new_value REAL,                        -- newvalue
      amount REAL,                           -- 增减金额
      remark TEXT,                           -- sm
      operator TEXT,                         -- czr 操作人
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_change ON fixed_asset_change(account_set_id, asset_no);
  `)

  // 字典：类别(zc_sblb) / 状态(zc_sbzt) / 用途(zc_sbyt) / 部门(zc_sydw)
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixed_asset_category (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                    -- sblb
      name TEXT,                             -- mc
      salvage_rate REAL,                     -- czl 默认残值率
      account_code TEXT,                     -- kmbm 资产科目
      UNIQUE(account_set_id, code)
    );
    CREATE TABLE IF NOT EXISTS fixed_asset_status (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                    -- sbzt
      name TEXT,                             -- sbzt_mc
      depreciable INTEGER NOT NULL DEFAULT 1,-- zjjt 是否计提折旧
      UNIQUE(account_set_id, code)
    );
    CREATE TABLE IF NOT EXISTS fixed_asset_purpose (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                    -- ytbh
      name TEXT,                             -- yt_mc
      expense_account TEXT,                  -- kmbm 折旧费用科目
      UNIQUE(account_set_id, code)
    );
    CREATE TABLE IF NOT EXISTS fixed_asset_dept (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                    -- sydw
      name TEXT,                             -- dw_mc
      UNIQUE(account_set_id, code)
    );
  `)

  console.log('✓ 固定资产模块表已创建: fixed_asset / fixed_asset_depr / fixed_asset_change / 4 个字典表')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP TABLE IF EXISTS fixed_asset_dept;
    DROP TABLE IF EXISTS fixed_asset_purpose;
    DROP TABLE IF EXISTS fixed_asset_status;
    DROP TABLE IF EXISTS fixed_asset_category;
    DROP TABLE IF EXISTS fixed_asset_change;
    DROP TABLE IF EXISTS fixed_asset_depr;
    DROP TABLE IF EXISTS fixed_asset;
  `)
  console.log('✓ 固定资产模块表已删除')
}
