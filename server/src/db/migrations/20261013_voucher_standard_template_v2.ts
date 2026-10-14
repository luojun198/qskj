import type Database from 'better-sqlite3'
import {
  buildDefaultVoucherHiprintPanel,
  VOUCHER_PAPER_HEIGHT_MM,
  VOUCHER_PAPER_WIDTH_MM,
  VOUCHER_STANDARD_LAYOUT_VERSION,
} from '../../services/printTemplateHiprintDefaults.js'
import { DEFAULT_BATCH_PRINT_TEMPLATE_NAME } from '../../services/printTemplateDefaults.js'

/**
 * v165：系统生成、用户没改过的「标准记账凭证」模板升级为新版式（参照传统财务软件凭证纸：
 * 标题下划线、单位名称、中文日期、字第几号、科目全称、合计大写、竖排品牌 / 附单据、五栏签章，220×140）。
 *
 * 「没改过」= updated_at 与 created_at 相同（设计器保存、设为默认都会刷新 updated_at）；
 * 面板已带 cwLayoutVersion ≥ 当前版本的跳过。升级后 updated_at 仍保持等于 created_at，
 * 以后再出新版式还能继续自动升级。用户自己设计 / 改过的模板一律不动。
 */
export function up(db: Database.Database) {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(print_templates)').all() as Array<{ name: string }>).map(c => c.name)
  )
  if (!cols.has('panel') || !cols.has('template_key') || !cols.has('created_at') || !cols.has('updated_at')) {
    return
  }
  const rows = db
    .prepare(
      `SELECT id, panel FROM print_templates
        WHERE template_type = 'voucher' AND template_key = 'voucher:standard' AND name = ?
          AND created_at IS NOT NULL AND updated_at = created_at`
    )
    .all(DEFAULT_BATCH_PRINT_TEMPLATE_NAME) as Array<{ id: string; panel: string | null }>

  const panelJson = JSON.stringify(buildDefaultVoucherHiprintPanel())
  const upd = db.prepare(
    `UPDATE print_templates
        SET panel = ?, paper_size = 'custom', paper_width = ?, paper_height = ?
      WHERE id = ?`
  )
  let changed = 0
  for (const row of rows) {
    let version = 0
    try {
      version = Number(JSON.parse(row.panel || '{}')?.panels?.[0]?.cwLayoutVersion) || 0
    } catch {
      version = 0
    }
    if (version >= VOUCHER_STANDARD_LAYOUT_VERSION) continue
    upd.run(panelJson, VOUCHER_PAPER_WIDTH_MM, VOUCHER_PAPER_HEIGHT_MM, row.id)
    changed++
  }
  console.log(`✓ 标准记账凭证模板升级新版式：${changed} 个（用户改过的模板未动）`)
}

export function down(_db: Database.Database) {}
