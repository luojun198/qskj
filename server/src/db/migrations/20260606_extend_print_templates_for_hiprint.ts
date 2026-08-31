import type { Database } from 'better-sqlite3'

type MigrationFn = (db: Database) => void

/**
 * 扩展 print_templates 表，支持 vue-plugin-hiprint 统一三类套打（凭证/账册/报表）。
 *
 * 新增列：
 * - template_type   : voucher | ledger | report（旧数据回填为 voucher）
 * - template_key    : 业务子类型，如 ledger:detail / report:balance_sheet / voucher:standard
 * - panel           : hiprint 原生模板 JSON（paperType/printElements 等）
 * - background_image: 套打底图 URL（已印好的凭证/账册/税票格式 PNG/JPG）
 *
 * 旧 elements 字段保留不动，老凭证模板继续走自研 TemplateDesigner 渲染。
 */
export const up: MigrationFn = (db: Database) => {
  const cols = db.prepare(`PRAGMA table_info(print_templates)`).all() as Array<{ name: string }>
  const has = (name: string) => cols.some(c => c.name === name)

  if (!has('template_type')) {
    db.exec(
      `ALTER TABLE print_templates ADD COLUMN template_type TEXT NOT NULL DEFAULT 'voucher'`
    )
  }
  if (!has('template_key')) {
    db.exec(`ALTER TABLE print_templates ADD COLUMN template_key TEXT`)
  }
  if (!has('panel')) {
    db.exec(`ALTER TABLE print_templates ADD COLUMN panel TEXT`)
  }
  if (!has('background_image')) {
    db.exec(`ALTER TABLE print_templates ADD COLUMN background_image TEXT`)
  }

  // 回填：存量模板均为凭证模板
  db.exec(
    `UPDATE print_templates SET template_type = 'voucher' WHERE template_type IS NULL OR template_type = ''`
  )
  db.exec(
    `UPDATE print_templates SET template_key = 'voucher:standard' WHERE template_key IS NULL OR template_key = ''`
  )

  // 按 (account_set_id, template_type) 查询的索引
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_print_templates_type ON print_templates(account_set_id, template_type, template_key)`
  )
}

export const down: MigrationFn = (db: Database) => {
  // SQLite 不支持 DROP COLUMN（旧版本），此处仅删除索引；列保留无害。
  db.exec(`DROP INDEX IF EXISTS idx_print_templates_type`)
}
