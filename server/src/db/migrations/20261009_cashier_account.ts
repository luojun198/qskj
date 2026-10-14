import type Database from 'better-sqlite3'

/**
 * v159：出纳独立账户（客户反馈：出纳应有自己的账户管理，可自定义账户名称，再与总账科目关联生成凭证；
 * 不必先在总账建现金 / 银行科目）。
 *
 * - cashier_account：出纳账户档案（编码 / 名称 / 类型 / 币别 / 开户行 / 账号 / 关联总账科目，可空）
 * - v_cashier_account：出纳账户 + 关联科目的 id / 方向，供出纳查询、报表、授权过滤统一使用
 * - 迁移：现有现金 / 银行末级科目、以及出纳流水 / 期初里出现过的编码，各生成一个「同编码、关联原科目」的出纳账户，
 *   历史流水（cashier_journal.account_code）不动，口径完全不变
 */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cashier_account (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'bank',          -- cash 库存现金 / bank 银行存款 / other 其他货币资金
      currency_code TEXT,                          -- 空 = 本位币
      bank_name TEXT,
      bank_account_no TEXT,
      gl_account_code TEXT,                        -- 关联总账末级科目，可空（空则不能生成凭证）
      is_enabled INTEGER NOT NULL DEFAULT 1,
      remark TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(account_set_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_cashier_account_gl ON cashier_account(account_set_id, gl_account_code);
    DROP VIEW IF EXISTS v_cashier_account;
    CREATE VIEW v_cashier_account AS
      SELECT ca.id, ca.account_set_id, ca.code, ca.name, ca.kind,
             CASE WHEN ca.kind = 'cash' THEN 1 ELSE 0 END AS is_cash,
             CASE WHEN ca.kind = 'cash' THEN 0 ELSE 1 END AS is_bank,
             CASE WHEN COALESCE(ca.currency_code, '') <> '' THEN 1 ELSE 0 END AS is_foreign,
             NULLIF(ca.currency_code, '') AS currency_code,
             ca.bank_name, ca.bank_account_no, ca.gl_account_code, ca.is_enabled, ca.remark,
             a.id AS gl_account_id, a.name AS gl_account_name, a.direction AS gl_direction
      FROM cashier_account ca
      LEFT JOIN accounts a ON a.account_set_id = ca.account_set_id AND a.code = ca.gl_account_code;
  `)
  // 现金 / 银行末级科目 → 同编码出纳账户
  const seeded = db.prepare(`
    INSERT OR IGNORE INTO cashier_account (id, account_set_id, code, name, kind, currency_code, gl_account_code, is_enabled)
    SELECT lower(hex(randomblob(16))), a.account_set_id, a.code, a.name,
           CASE WHEN a.is_cash = 1 THEN 'cash' ELSE 'bank' END,
           CASE WHEN COALESCE(a.is_foreign, 0) = 1 AND COALESCE(a.currency_code, '') <> '' THEN a.currency_code ELSE NULL END,
           a.code, COALESCE(a.is_enabled, 1)
    FROM accounts a
    WHERE (a.is_cash = 1 OR a.is_bank = 1)
      AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id)
  `).run().changes
  // 流水 / 期初里出现过、但已不是现金银行末级的编码（停用、改过属性等）：也建账户，保证历史可查
  const extra = db.prepare(`
    INSERT OR IGNORE INTO cashier_account (id, account_set_id, code, name, kind, gl_account_code, is_enabled)
    SELECT lower(hex(randomblob(16))), x.account_set_id, x.account_code,
           COALESCE(a.name, x.account_code), CASE WHEN a.is_cash = 1 THEN 'cash' ELSE 'bank' END,
           CASE WHEN a.id IS NOT NULL THEN x.account_code ELSE NULL END, 0
    FROM (SELECT DISTINCT account_set_id, account_code FROM cashier_journal
          UNION SELECT DISTINCT account_set_id, account_code FROM cashier_init_balance) x
    LEFT JOIN accounts a ON a.account_set_id = x.account_set_id AND a.code = x.account_code
    WHERE x.account_code IS NOT NULL AND x.account_code <> ''
  `).run().changes
  // 上级科目名为「其他货币资金」的明细归为 other 类型（外埠存款 / 银行本票 / 信用卡…）
  db.exec(`UPDATE cashier_account SET kind = 'other'
    WHERE kind = 'bank' AND EXISTS (
      SELECT 1 FROM accounts a JOIN accounts p ON p.id = a.parent_id
      WHERE a.account_set_id = cashier_account.account_set_id AND a.code = cashier_account.gl_account_code AND p.name LIKE '%其他货币资金%')`)
  console.log(`✓ 出纳账户表已建：由现金 / 银行科目生成 ${seeded} 个，历史流水补建 ${extra} 个`)
}

export function down(db: Database.Database): void {
  db.exec('DROP VIEW IF EXISTS v_cashier_account; DROP TABLE IF EXISTS cashier_account;')
}
