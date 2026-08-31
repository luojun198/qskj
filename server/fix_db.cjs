const Database = require('better-sqlite3');
const db = new Database('D:/BDKF/cw0523/data/finance.db');

db.transaction(() => {
  db.prepare('DROP TABLE IF EXISTS rh_standard_report_cells').run();
  db.prepare('DROP TABLE IF EXISTS rh_standard_reports').run();
  
  db.prepare(`
    CREATE TABLE rh_standard_reports (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      source_file TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_set_id) REFERENCES account_sets(id) ON DELETE CASCADE,
      UNIQUE(account_set_id, code)
    )
  `).run();

  db.prepare(`
    CREATE TABLE rh_standard_report_cells (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      col_index INTEGER NOT NULL,
      text_value TEXT,
      formula_text TEXT,
      FOREIGN KEY (report_id) REFERENCES rh_standard_reports(id) ON DELETE CASCADE,
      UNIQUE(report_id, row_index, col_index)
    )
  `).run();
})();

console.log('Tables recreated with correct foreign keys!');
