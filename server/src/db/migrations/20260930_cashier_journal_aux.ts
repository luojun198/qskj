import type Database from 'better-sqlite3'

/**
 * 出纳报表改造：辅助项目子表。
 *
 * cashier_journal.counter_aux_item_id 是 JSON（{ 类别id: 项目id }，描述流水「对方科目」的辅助核算），
 * 无法走索引做筛选 / 汇总。新增派生子表 cashier_journal_aux 每个（流水, 类别）一行，供报表按辅助项目
 * 筛选与分组；JSON 仍保留作为生成凭证的来源，写入流水时由 syncJournalAux 同步子表。
 *
 * 同时补两个报表筛选 / 分组用的索引，并回填历史流水（key 兼容「类别 id」与「类别 code」两种写法）。
 */
function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

export function up(db: Database.Database): void {
  if (!hasTable(db, 'cashier_journal')) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS cashier_journal_aux (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      journal_id TEXT NOT NULL REFERENCES cashier_journal(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL,
      category_code TEXT,
      item_id TEXT NOT NULL,
      UNIQUE(journal_id, category_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_aux_item ON cashier_journal_aux(account_set_id, category_id, item_id);
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_aux_journal ON cashier_journal_aux(journal_id);
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_counter ON cashier_journal(account_set_id, counter_account, biz_date);
    CREATE INDEX IF NOT EXISTS idx_cashier_journal_settle ON cashier_journal(account_set_id, settle_type, biz_date);
  `)

  if (!hasTable(db, 'aux_categories')) return
  // 回填历史：只处理合法 JSON 对象；匹配不到类别的 key 直接跳过
  const res = db.prepare(`
    INSERT OR IGNORE INTO cashier_journal_aux (id, account_set_id, journal_id, category_id, category_code, item_id)
    SELECT lower(hex(randomblob(16))), j.account_set_id, j.id, c.id, c.code, je.value
    FROM cashier_journal j,
         json_each(CASE WHEN json_valid(j.counter_aux_item_id) AND json_type(j.counter_aux_item_id) = 'object'
                        THEN j.counter_aux_item_id ELSE '{}' END) je
    JOIN aux_categories c ON c.account_set_id = j.account_set_id AND (c.id = je.key OR c.code = je.key)
    WHERE j.counter_aux_item_id IS NOT NULL AND je.value IS NOT NULL AND je.value <> ''
  `).run()
  console.log(`✓ cashier_journal_aux 已建立，回填历史辅助项目 ${res.changes} 条`)
}

export function down(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_cashier_journal_settle;
    DROP INDEX IF EXISTS idx_cashier_journal_counter;
    DROP TABLE IF EXISTS cashier_journal_aux;
  `)
}
