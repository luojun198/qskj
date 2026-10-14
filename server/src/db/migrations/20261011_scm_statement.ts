import type Database from 'better-sqlite3'

/**
 * v161：对账单单据化（第四份反馈 Q2）。
 *
 * 原「对账单」只是往来台账查询，没有单据、也没有已对账标记。改为单据：
 *  - 生成时按往来单位勾选入库 / 出库 / 退货 / 发票明细行与收付款台账行；
 *  - 一行只能进一张对账单（唯一索引，草稿也占用）；未勾的行下次生成时继续带出；
 *  - 对账单审核后，被引用的源单不能反审核（也就不能修改、删除）；
 *  - 明细快照保存当时的数量、金额，源单之后不能改，快照与源单一致。
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_statement (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      stmt_no TEXT NOT NULL,
      stmt_date TEXT NOT NULL,
      direction TEXT NOT NULL,              -- ar 应收（客户）/ ap 应付（供应商）
      partner_code TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT NOT NULL,
      doc_amount REAL NOT NULL DEFAULT 0,      -- 业务单据价税合计（退货为负）
      payment_amount REAL NOT NULL DEFAULT 0,  -- 收付款合计（正数，冲减）
      net_amount REAL NOT NULL DEFAULT 0,      -- 本次对账金额 = doc_amount - payment_amount
      ledger_balance REAL,                     -- 截止日往来余额（参考）
      status TEXT NOT NULL DEFAULT 'draft',
      remark TEXT,
      maker TEXT,
      auditor TEXT,
      audited_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(account_set_id, stmt_no)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_statement_partner ON scm_statement(account_set_id, direction, partner_code, end_date);

    CREATE TABLE IF NOT EXISTS scm_statement_line (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      statement_id TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      src_kind TEXT NOT NULL,          -- line 单据明细行 / log 收付款台账行
      src_doc_id TEXT NOT NULL,
      src_doc_type TEXT NOT NULL,
      src_doc_no TEXT NOT NULL,
      src_doc_date TEXT,
      src_line_id TEXT,
      src_log_id TEXT,
      item_code TEXT,
      item_name TEXT,
      spec TEXT,
      unit TEXT,
      qty REAL,
      price REAL,
      amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      amount_with_tax REAL NOT NULL DEFAULT 0,
      sign INTEGER NOT NULL DEFAULT 1,
      remark TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scm_statement_line_stmt ON scm_statement_line(statement_id, seq);
    CREATE INDEX IF NOT EXISTS idx_scm_statement_line_doc ON scm_statement_line(account_set_id, src_doc_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_scm_statement_line_src_line ON scm_statement_line(account_set_id, src_line_id) WHERE src_line_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_scm_statement_line_src_log ON scm_statement_line(account_set_id, src_log_id) WHERE src_log_id IS NOT NULL;
  `)
  console.log('✓ 对账单表已建')
}

export function down(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS scm_statement_line; DROP TABLE IF EXISTS scm_statement')
}
