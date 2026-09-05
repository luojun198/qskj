import type Database from 'better-sqlite3'

/**
 * v110：扩展 fixed_asset_change，支撑「资产变动」业务（P1-1）
 *
 * 背景：fixed_asset_change 建表已久，但全系统只有 ACD 导入和 disposeAsset() 两个写入方，
 * 用户无法从界面登记任何一笔原值变动 / 部门调拨 / 状态变更 / 折旧要素调整。
 * 「增减变动表」「变动记录」两张报表因此永远读不到数据。
 *
 * 本迁移补齐承载这些业务所需的列：
 *  - change_kind      变动大类，报表与撤销逻辑据此分派
 *  - change_type_code 关联 fixed_asset_change_type（增减方式字典）
 *  - field_key        折旧要素调整时记录改的是哪个字段
 *  - old_text/new_text 非数值型变动的前后值（部门编码、状态编码、折旧方法…）
 *  - voucher_id       原值变动/减值/改良生成的凭证
 *  - year/period      归属会计期间，供期间校验与报表分组
 *  - created_by       操作人 id（原有 operator 只存姓名）
 */
const NEW_COLUMNS: Array<[string, string]> = [
  ['change_kind', 'TEXT'],
  ['change_type_code', 'TEXT'],
  ['field_key', 'TEXT'],
  ['old_text', 'TEXT'],
  ['new_text', 'TEXT'],
  ['voucher_id', 'TEXT'],
  ['year', 'INTEGER'],
  ['period', 'INTEGER'],
  ['created_by', 'TEXT'],
]

export function up(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(fixed_asset_change)').all() as any[]).map(
    (c: any) => c.name
  )
  for (const [name, type] of NEW_COLUMNS) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE fixed_asset_change ADD COLUMN ${name} ${type};`)
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_change_period
      ON fixed_asset_change(account_set_id, year, period);
    CREATE INDEX IF NOT EXISTS idx_fixed_asset_change_kind
      ON fixed_asset_change(account_set_id, change_kind);
  `)

  // 回填历史处置记录的 change_kind：撤销处置原先按 change_item LIKE '资产减少%' 删除，
  // 打上标记后可改为按 change_kind 精确匹配。
  const res = db
    .prepare(
      `UPDATE fixed_asset_change
          SET change_kind = 'dispose'
        WHERE change_kind IS NULL AND change_item LIKE '资产减少%'`
    )
    .run()

  // 其余历史记录（主要来自 ACD 导入）统一标记为 legacy，避免与新业务混淆
  db.prepare(
    `UPDATE fixed_asset_change SET change_kind = 'legacy' WHERE change_kind IS NULL`
  ).run()

  // 期间列回填：change_date 形如 YYYY-MM-DD
  db.prepare(
    `UPDATE fixed_asset_change
        SET year = CAST(SUBSTR(change_date, 1, 4) AS INTEGER),
            period = CAST(SUBSTR(change_date, 6, 2) AS INTEGER)
      WHERE year IS NULL AND change_date LIKE '____-__-%'`
  ).run()

  console.log(`✓ fixed_asset_change 扩展完成，回填处置记录 ${res.changes} 行`)
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，跳过
}
