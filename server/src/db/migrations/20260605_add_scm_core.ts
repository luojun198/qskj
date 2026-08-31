import type Database from 'better-sqlite3'

/**
 * 供应链（进销存）核心建表 — 第一期：基础档案 + 库存 + 单据骨架
 *
 * 兼容润衡 .acd：cpda(物料)→scm_item、khda(往来)→scm_partner、ckda(仓库)→scm_warehouse、
 * dlk/xlk/matetype(分类)→scm_item_category、kcb(库存)→scm_stock、pjnr1/2(单据)→scm_doc/scm_doc_line、
 * dj_lx(单据类型)→scm_doc_type。统一单据模型；计价方式由系统参数 scm:costing_method 控制。
 */
export function up(db: Database.Database) {
  // 物料/产品档案（← cpda）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_item (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                    -- cpbh 物料编号
      name TEXT,                             -- cpmc 名称
      spec TEXT,                             -- gg 规格
      barcode TEXT,                          -- txm 条码
      short_code TEXT,                       -- jm 简码
      unit TEXT,                             -- jldw 计量单位
      category_code TEXT,                    -- dlm 大类
      subcategory_code TEXT,                 -- xlm 小类
      item_type TEXT,                        -- sx 属性(0原料/6半成品/9成品)
      purchase_price REAL DEFAULT 0,         -- rkdj 进价
      sale_price REAL DEFAULT 0,             -- xsdj 售价
      ref_cost REAL DEFAULT 0,               -- ckdj 参考成本
      fixed_cost REAL DEFAULT 0,             -- 指定成本（计价方式=specified 时取用）
      inv_account TEXT,                      -- kmbm 存货科目
      sale_account TEXT,                     -- kmbm_xs 销售收入科目
      batch_flag INTEGER NOT NULL DEFAULT 0, -- ph_bz 批号管理
      is_asset INTEGER NOT NULL DEFAULT 0,   -- 采购入库时生成固定资产
      supplier_code TEXT,                    -- khbh 默认供应商
      remark TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      acd_raw TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_item_set ON scm_item(account_set_id);
    CREATE INDEX IF NOT EXISTS idx_scm_item_cat ON scm_item(account_set_id, category_code);
  `)

  // 往来单位（客户/供应商 ← khda）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_partner (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                    -- dwbh 编号
      name TEXT,                             -- dwmc 名称
      short_name TEXT,                       -- dw_jc 简称
      partner_type TEXT,                     -- 由 khda.sx 派生：customer/supplier/both
      partner_attr TEXT,                     -- khda.sx 原值
      ar_account TEXT,                       -- yskm 应收科目
      ap_account TEXT,                       -- yfkm 应付科目
      credit_limit REAL DEFAULT 0,           -- xyed 信用额度
      tax_rate REAL DEFAULT 0,               -- slv 税率
      region_code TEXT,                      -- dqbh 地区
      contact TEXT,                          -- lxr 联系人
      phone TEXT,                            -- lxdh 电话
      address TEXT,                          -- txdz 地址
      bank_name TEXT,                        -- khyh 开户行
      bank_account TEXT,                     -- yhzh 银行账号
      tax_no TEXT,                           -- nsh 税号
      salesman TEXT,                         -- ywy 业务员
      remark TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      acd_raw TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_partner_set ON scm_partner(account_set_id);
  `)

  // 仓库（← ckda）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_warehouse (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                    -- ckbh
      name TEXT,                             -- ckmc
      attr TEXT,                             -- sx
      keeper TEXT,                           -- lxr
      remark TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_wh_set ON scm_warehouse(account_set_id);
  `)

  // 物料分类（树 ← dlk/xlk/matetype）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_item_category (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT,
      parent_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_cat_set ON scm_item_category(account_set_id);
  `)

  // 即时库存（← kcb）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_stock (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      warehouse_code TEXT NOT NULL,
      item_code TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      avg_cost REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, warehouse_code, item_code)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_stock_set ON scm_stock(account_set_id);
  `)

  // 批次库存（← kcb01）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_stock_batch (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      warehouse_code TEXT NOT NULL,
      item_code TEXT NOT NULL,
      batch_no TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      expire_date TEXT,
      UNIQUE(account_set_id, warehouse_code, item_code, batch_no)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_batch_set ON scm_stock_batch(account_set_id);
  `)

  // 出入库流水（驱动计价与库存账）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_stock_move (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      move_date TEXT,
      doc_type TEXT,
      doc_no TEXT,
      line_seq INTEGER,
      warehouse_code TEXT NOT NULL,
      item_code TEXT NOT NULL,
      direction TEXT NOT NULL,               -- in / out
      qty REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      batch_no TEXT,
      balance_qty REAL,
      balance_amount REAL,
      balance_avg_cost REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scm_move_item ON scm_stock_move(account_set_id, warehouse_code, item_code, move_date);
  `)

  // 单据类型配置（← dj_lx，并扩展报价/订单/询价/发票）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_doc_type (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                    -- pjlb / 自定义类型码
      name TEXT,
      direction TEXT,                        -- in/out/none
      affects_stock INTEGER NOT NULL DEFAULT 0,
      affects_ar_ap INTEGER NOT NULL DEFAULT 0,
      category TEXT,                         -- sale/purchase/inventory/production/outsource
      remark TEXT,
      UNIQUE(account_set_id, code)
    );
  `)

  // 单据头（统一模型 ← pjnr1）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_doc (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      doc_no TEXT NOT NULL,
      doc_date TEXT,
      partner_code TEXT,
      dept_code TEXT,
      warehouse_code TEXT,
      operator TEXT,
      status TEXT NOT NULL DEFAULT 'draft',  -- draft/audited/...
      source_doc_id TEXT,                    -- 上游单据引用
      total_qty REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      total_tax REAL DEFAULT 0,
      voucher_id TEXT,                       -- 生成的记账凭证
      remark TEXT,
      acd_raw TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, doc_type, doc_no)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_doc_set ON scm_doc(account_set_id, doc_type, doc_date);
  `)

  // 单据明细（← pjnr2）
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_doc_line (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      doc_id TEXT NOT NULL REFERENCES scm_doc(id) ON DELETE CASCADE,
      seq INTEGER,
      item_code TEXT,
      warehouse_code TEXT,
      qty REAL DEFAULT 0,
      price REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      unit_cost REAL DEFAULT 0,
      batch_no TEXT,
      source_line_id TEXT,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_doc_line_doc ON scm_doc_line(doc_id);
  `)

  console.log('✓ 供应链核心表已创建: scm_item / scm_partner / scm_warehouse / scm_item_category / scm_stock(+batch+move) / scm_doc(+line+type)')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP TABLE IF EXISTS scm_doc_line;
    DROP TABLE IF EXISTS scm_doc;
    DROP TABLE IF EXISTS scm_doc_type;
    DROP TABLE IF EXISTS scm_stock_move;
    DROP TABLE IF EXISTS scm_stock_batch;
    DROP TABLE IF EXISTS scm_stock;
    DROP TABLE IF EXISTS scm_item_category;
    DROP TABLE IF EXISTS scm_warehouse;
    DROP TABLE IF EXISTS scm_partner;
    DROP TABLE IF EXISTS scm_item;
  `)
  console.log('✓ 供应链核心表已删除')
}
