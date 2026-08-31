import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  const accountSetRows = db
    .prepare('SELECT DISTINCT account_set_id AS account_set_id FROM report_definitions')
    .all() as Array<{ account_set_id: string }>

  const statsStmt = db.prepare(`
    SELECT
      COUNT(*) AS cnt,
      COUNT(DISTINCT sort_order) AS distinct_sort,
      SUM(CASE WHEN sort_order = 0 THEN 1 ELSE 0 END) AS zero_cnt
    FROM report_definitions
    WHERE account_set_id = ?
  `)
  const listStmt = db.prepare(`
    SELECT id
    FROM report_definitions
    WHERE account_set_id = ?
    ORDER BY code ASC
  `)
  const updateStmt = db.prepare(`
    UPDATE report_definitions
    SET sort_order = ?, updated_at = datetime('now')
    WHERE id = ?
  `)

  for (const { account_set_id } of accountSetRows) {
    const stats = statsStmt.get(account_set_id) as {
      cnt: number
      distinct_sort: number
      zero_cnt: number
    }
    const needsNormalize =
      stats.cnt > 1 &&
      (stats.distinct_sort < stats.cnt || stats.zero_cnt > 1 || stats.zero_cnt === stats.cnt)
    if (!needsNormalize) continue

    const rows = listStmt.all(account_set_id) as Array<{ id: string }>
    rows.forEach((row, index) => {
      updateStmt.run(index + 1, row.id)
    })
  }
}

export function down(_db: Database): void {
  // 一次性归一化，不回滚
}
