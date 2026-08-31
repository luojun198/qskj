import type Database from 'better-sqlite3'

/**
 * 供应链单据「列显示方案」：
 * - scm_col_scheme：列方案（按 target=明细表/列表 + doc_type 单据类型 划分），
 *   hidden_cols 存"要隐藏的可选列 key"（隐藏语义→向后兼容，新增列默认显示）。
 * - scm_col_scheme_user：方案与用户的分配关系（一个用户在一个 target+doc_type 下只一个方案，应用层保证）。
 * 配合权限点 scm:colscheme：有权限者管理方案/自由调列，无权限者按分配方案锁定显示。
 */
export function up(db: Database.Database) {
  db.prepare(`CREATE TABLE IF NOT EXISTS scm_col_scheme (
    id TEXT PRIMARY KEY,
    account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
    target TEXT NOT NULL,              -- 'line'=明细表 / 'list'=单据列表
    doc_type TEXT NOT NULL,            -- 绑定单据类型 SQ/PI/SO/...
    name TEXT NOT NULL,
    hidden_cols TEXT NOT NULL DEFAULT '[]',  -- JSON 数组：隐藏的可选列 key
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run()
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_scm_col_scheme_set
    ON scm_col_scheme(account_set_id, target, doc_type)`).run()

  db.prepare(`CREATE TABLE IF NOT EXISTS scm_col_scheme_user (
    id TEXT PRIMARY KEY,
    account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
    scheme_id TEXT NOT NULL REFERENCES scm_col_scheme(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL
  )`).run()
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_scm_col_scheme_user_u
    ON scm_col_scheme_user(account_set_id, user_id)`).run()
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_scm_col_scheme_user_s
    ON scm_col_scheme_user(scheme_id)`).run()

  console.log('✓ 列方案：scm_col_scheme / scm_col_scheme_user 已就绪')
}

export function down(db: Database.Database) {
  db.prepare('DROP TABLE IF EXISTS scm_col_scheme_user').run()
  db.prepare('DROP TABLE IF EXISTS scm_col_scheme').run()
}
