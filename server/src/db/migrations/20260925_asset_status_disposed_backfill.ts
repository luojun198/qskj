import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

/**
 * 评审 P2：ACD 导入的账套资产状态字典只有 ACD 自带的几项（如 1 在用 / 2 未用），没有「04 已处置」。
 * 处置、盘亏会把卡片置为 04，这些账套里状态列只能显示编码「04」，按状态筛选 / 批量停启用也选不到。
 * 为已有资产状态字典、却缺 04 的账套补一项「04 已处置」（不计提折旧）。幂等。
 * 只补仍存在的账套（已删账套残留的孤儿字典行会触发外键约束）。
 */
function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

export function up(db: Database.Database): void {
  if (!hasTable(db, 'fixed_asset_status')) return
  const sets = db
    .prepare(
      `SELECT DISTINCT s.account_set_id FROM fixed_asset_status s
        WHERE NOT EXISTS (SELECT 1 FROM fixed_asset_status t WHERE t.account_set_id = s.account_set_id AND t.code = '04')
          ${hasTable(db, 'account_sets') ? 'AND EXISTS (SELECT 1 FROM account_sets a WHERE a.id = s.account_set_id)' : ''}`
    )
    .all() as Array<{ account_set_id: string }>
  const ins = db.prepare(
    "INSERT INTO fixed_asset_status (id, account_set_id, code, name, depreciable) VALUES (?, ?, '04', '已处置', 0)"
  )
  for (const s of sets) ins.run(`fas-04-${uuidv4()}`, s.account_set_id)
}

export function down(db: Database.Database): void {
  if (!hasTable(db, 'fixed_asset_status')) return
  db.prepare("DELETE FROM fixed_asset_status WHERE code='04' AND id LIKE 'fas-04-%'").run()
}
