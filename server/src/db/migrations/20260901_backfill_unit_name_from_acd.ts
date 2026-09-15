import type { Database } from 'better-sqlite3'
import type { Migration } from '../migrations.js'
import { v4 as uuidv4 } from 'uuid'

/**
 * 用 ACD 导入时解析出的单位名称补齐系统参数 `unit_name`。
 *
 * 导入 ACD 时单位名称只写进了 `import_acd:unit_name`，而这个 key 全库没有任何地方读；
 * 系统真正使用的 `unit_name` 则一直是空的，报表抬头（%U）只能退回账套名，
 * 打出来是「zw06广州东汇食品有限公司20260827」这种带前缀和备份日期的串。
 *
 * 这里只补空缺：已经填过 unit_name 的账套不动；ACD 里是模板占位名
 * （xx公司 / xx行政事业单位）的也不补，避免把假名字写进去。
 */

const PLACEHOLDER_UNIT_NAMES = new Set(['xx公司', 'xx行政事业单位', 'XX公司', 'XX行政事业单位'])

export const up: Migration['up'] = (db: Database) => {
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get('system_params')
  if (!tableExists) return

  const rows = db
    .prepare(
      `SELECT account_set_id, param_value
       FROM system_params
       WHERE param_key = 'import_acd:unit_name' AND account_set_id IS NOT NULL`
    )
    .all() as Array<{ account_set_id: string; param_value: string | null }>

  const existingStmt = db.prepare(
    `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = 'unit_name' LIMIT 1`
  )
  const upsert = db.prepare(`
    INSERT INTO system_params (id, account_set_id, param_key, param_value, description, created_at, updated_at)
    VALUES (?, ?, 'unit_name', ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(account_set_id, param_key)
    DO UPDATE SET param_value = excluded.param_value, updated_at = datetime('now')
  `)

  for (const row of rows) {
    const name = (row.param_value || '').trim()
    if (!name || PLACEHOLDER_UNIT_NAMES.has(name)) continue

    const existing = existingStmt.get(row.account_set_id) as
      | { param_value: string | null }
      | undefined
    if (existing?.param_value?.trim()) continue

    upsert.run(uuidv4(), row.account_set_id, name, '使用单位（由 ACD 导入结果补齐）')
  }
}

export const down: Migration['down'] = (db: Database) => {
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get('system_params')
  if (!tableExists) return
  // 只回收本次补齐的记录，用户自己填的不动
  db.prepare(
    `DELETE FROM system_params WHERE param_key = 'unit_name' AND description = '使用单位（由 ACD 导入结果补齐）'`
  ).run()
}
