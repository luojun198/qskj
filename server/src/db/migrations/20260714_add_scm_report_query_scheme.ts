import type Database from 'better-sqlite3'

/** 销售自定义报表个人查询方案。 */
export function up(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_report_query_scheme (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      report_key TEXT NOT NULL,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_set_id) REFERENCES account_sets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (account_set_id, user_id, report_key, name)
    );

    CREATE INDEX IF NOT EXISTS idx_scm_report_query_scheme_owner
      ON scm_report_query_scheme(account_set_id, user_id, report_key, updated_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_scm_report_query_scheme_default
      ON scm_report_query_scheme(account_set_id, user_id, report_key)
      WHERE is_default = 1;
  `)
}

export function down(db: Database.Database) {
  db.exec('DROP TABLE IF EXISTS scm_report_query_scheme')
}
