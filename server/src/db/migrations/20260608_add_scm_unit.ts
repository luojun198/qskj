import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

/**
 * 供应链：计量单位独立档案 + 物料-单位关联（主/副单位 + 转换系数）
 *
 * - scm_unit: 单位字典表
 * - scm_item_unit: 物料与单位的 N:N 关联（区分主/副单位，记录转换系数）
 * - 自动迁移现有 scm_item.unit 文本数据到新表
 */
export function up(db: Database.Database) {
  // ── 单位档案表 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_unit (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      code TEXT NOT NULL,                     -- 编号（自增 UN0001..UN9999）
      name TEXT NOT NULL,                     -- 名称（如 个/箱/公斤）
      enabled INTEGER NOT NULL DEFAULT 1,
      remark TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_unit_set ON scm_unit(account_set_id);
  `)

  // ── 物料-单位关联表 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS scm_item_unit (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
      item_code TEXT NOT NULL,                -- 物料编号
      unit_code TEXT NOT NULL,                -- 单位编号
      is_primary INTEGER NOT NULL DEFAULT 0,  -- 1=主单位，0=副单位
      conversion_rate REAL NOT NULL DEFAULT 1, -- 转换到主单位的系数（主单位=1）
      UNIQUE(account_set_id, item_code, unit_code)
    );
    CREATE INDEX IF NOT EXISTS idx_scm_item_unit_item ON scm_item_unit(account_set_id, item_code);
    CREATE INDEX IF NOT EXISTS idx_scm_item_unit_unit ON scm_item_unit(account_set_id, unit_code);
  `)

  // ── 数据迁移：现有 unit 文本 → scm_unit + scm_item_unit ──
  // 1. 收集所有去重单位名
  const rawUnits = db.prepare(`
    SELECT DISTINCT account_set_id, unit FROM scm_item WHERE unit IS NOT NULL AND trim(unit) != ''
  `).all() as { account_set_id: string; unit: string }[]

  if (rawUnits.length > 0) {
    // 2. 获取每个账套当前最大单位编号
    const maxCodeMap = new Map<string, number>()
    for (const u of rawUnits) {
      const key = u.account_set_id
      if (!maxCodeMap.has(key)) {
        const max = (db.prepare(
          "SELECT MAX(CAST(SUBSTR(code, 3) AS INTEGER)) m FROM scm_unit WHERE account_set_id=? AND code LIKE 'UN%'"
        ).get(key) as any)?.m || 0
        maxCodeMap.set(key, max)
      }
      const next = (maxCodeMap.get(key) || 0) + 1
      maxCodeMap.set(key, next)

      // 3. 创建单位记录
      const code = `UN${String(next).padStart(4, '0')}`
      db.prepare(`INSERT OR IGNORE INTO scm_unit (id, account_set_id, code, name) VALUES (?,?,?,?)`).run(
        uuidv4(), u.account_set_id, code, u.unit.trim()
      )
    }

    // 4. 将每个物料的主单位关联写入 scm_item_unit
    const items = db.prepare(
      "SELECT account_set_id, code, unit FROM scm_item WHERE unit IS NOT NULL AND trim(unit) != ''"
    ).all() as { account_set_id: string; code: string; unit: string }[]

    for (const item of items) {
      const unitRecord = db.prepare(
        'SELECT code FROM scm_unit WHERE account_set_id=? AND name=? ORDER BY code LIMIT 1'
      ).get(item.account_set_id, item.unit.trim()) as any

      if (unitRecord) {
        db.prepare(`INSERT OR IGNORE INTO scm_item_unit (id, account_set_id, item_code, unit_code, is_primary, conversion_rate)
          VALUES (?,?,?,?,1,1)`).run(uuidv4(), item.account_set_id, item.code, unitRecord.code)
      }
    }
  }
}

export function down(db: Database.Database) {
  db.exec(`DROP TABLE IF EXISTS scm_item_unit`)
  db.exec(`DROP TABLE IF EXISTS scm_unit`)
}
