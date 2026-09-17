import type { Database } from 'better-sqlite3'
import { repairDatabaseReferentialIntegrity } from './databaseIntegrityRepair.js'

function tableExists(db: Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { name?: string } | undefined
  return !!row?.name
}

/**
 * 级联删除账套及其全部关联数据（删除账套、导入回滚等统一入口）
 */
export function cleanupAccountSetCascade(db: Database, accountSetId: string) {
  const statements: Array<{ sql: string; params: unknown[] }> = [
    { sql: 'DELETE FROM user_login_sessions WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM user_roles WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM role_account_scopes WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM user_account_scopes WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM voucher_attachments WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM voucher_entries WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM auto_transfer_runs WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM vouchers WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM voucher_templates WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM print_templates WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM account_balances WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM period_closing WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM init_balances WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM budget_surplus_adjustments WHERE account_set_id = ?', params: [accountSetId] },
    {
      sql: `DELETE FROM rh_standard_report_cells WHERE report_id IN (
        SELECT id FROM rh_standard_reports WHERE account_set_id = ?
      )`,
      params: [accountSetId],
    },
    { sql: 'DELETE FROM rh_standard_reports WHERE account_set_id = ?', params: [accountSetId] },
    {
      sql: 'DELETE FROM report_template_items WHERE template_id IN (SELECT id FROM report_templates WHERE account_set_id = ?)',
      params: [accountSetId],
    },
    {
      sql: `DELETE FROM report_cells WHERE report_sheet_id IN (
        SELECT id FROM report_sheets WHERE report_definition_id IN (
          SELECT id FROM report_definitions WHERE account_set_id = ?
        )
      )`,
      params: [accountSetId],
    },
    {
      sql: `DELETE FROM report_template_sources WHERE report_definition_id IN (
        SELECT id FROM report_definitions WHERE account_set_id = ?
      )`,
      params: [accountSetId],
    },
    {
      sql: `DELETE FROM report_sheets WHERE report_definition_id IN (
        SELECT id FROM report_definitions WHERE account_set_id = ?
      )`,
      params: [accountSetId],
    },
    { sql: 'DELETE FROM report_definitions WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM report_templates WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM report_formula_functions WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM transfer_items WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM transfer_types WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM cash_flow_items WHERE account_set_id = ?', params: [accountSetId] },
    {
      sql: `DELETE FROM aux_category_fields WHERE category_id IN (
        SELECT id FROM aux_categories WHERE account_set_id = ?
      )`,
      params: [accountSetId],
    },
    { sql: 'UPDATE aux_categories SET default_item_id = NULL WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM aux_items WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM aux_categories WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM voucher_types WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM operation_logs WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM ai_logs WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM ai_config WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM backups WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM system_params WHERE account_set_id = ?', params: [accountSetId] },
    // 出纳模块
    { sql: 'DELETE FROM cashier_attachments WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM cashier_journal WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM cashier_init_balance WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM bank_statement WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM cashier_period_closing WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM settle_type WHERE account_set_id = ?', params: [accountSetId] },
    // 固定资产模块（依赖表先删）
    { sql: 'DELETE FROM fixed_asset_attachments WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_inventory_item WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_inventory WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_requisition WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_workload WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_change WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_depr WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_change_type WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_category WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_status WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_purpose WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM fixed_asset_dept WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM accounts WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'UPDATE roles SET owner_user_id = NULL WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM users WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM roles WHERE account_set_id = ?', params: [accountSetId] },
    { sql: 'DELETE FROM account_sets WHERE id = ?', params: [accountSetId] },
  ]

  db.pragma('foreign_keys = OFF')
  try {
    const cleanup = db.transaction(() => {
      for (const { sql, params } of statements) {
        const tableMatch = sql.match(/^DELETE FROM\s+([a-zA-Z_][\w]*)/i)
        const updateMatch = sql.match(/^UPDATE\s+([a-zA-Z_][\w]*)/i)
        const table = tableMatch?.[1] || updateMatch?.[1]
        if (table && !tableExists(db, table)) continue
        try {
          db.prepare(sql).run(...params)
        } catch (err) {
          // 部分环境可能尚未创建可选表（如 cash_flow_items）
          if (tableMatch && ['cash_flow_items', 'ai_config', 'ai_logs'].includes(tableMatch[1])) {
            continue
          }
          throw err
        }
      }
    })
    cleanup()
    repairDatabaseReferentialIntegrity(db)
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
