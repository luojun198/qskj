import type { Database } from 'better-sqlite3'
import { repairDatabaseReferentialIntegrity } from './databaseIntegrityRepair.js'

function tableExists(db: Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { name?: string } | undefined
  return !!row?.name
}

export interface CleanupStep {
  label: string
  run: () => void
}

export type CleanupProgress = (done: number, total: number, label: string) => void

/** 级联清理的全部步骤（显式清单 + 兜底扫描），同步版与异步版共用 */
function buildCleanupSteps(db: Database, accountSetId: string): CleanupStep[] {
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
    // 评审 P2：出纳↔总账对账匹配表（FIX-262）此前漏清，删账套后留孤儿行
    { sql: 'DELETE FROM cashier_gl_match WHERE account_set_id = ?', params: [accountSetId] },
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

  const steps: CleanupStep[] = []
  for (const { sql, params } of statements) {
    const tableMatch = sql.match(/^DELETE FROM\s+([a-zA-Z_][\w]*)/i)
    const updateMatch = sql.match(/^UPDATE\s+([a-zA-Z_][\w]*)/i)
    const table = tableMatch?.[1] || updateMatch?.[1]
    steps.push({
      label: table || '账套数据',
      run: () => {
        if (table && !tableExists(db, table)) return
        try {
          db.prepare(sql).run(...params)
        } catch (err) {
          // 部分环境可能尚未创建可选表（如 cash_flow_items）
          if (tableMatch && ['cash_flow_items', 'ai_config', 'ai_logs'].includes(tableMatch[1])) {
            return
          }
          throw err
        }
      },
    })
  }
  // 评审 P2 收尾：上面的显式清单按依赖顺序删，但新增模块（供应链 scm_*、币种 / 汇率等）常漏加，
  // 删账套后留下孤儿行（开发库实测 6 个已删账套残留约 510 行）。最后统一扫一遍所有带 account_set_id 列的表兜底。
  for (const table of listAccountSetScopedTables(db)) {
    steps.push({
      label: table,
      run: () => {
        db.prepare(`DELETE FROM "${table}" WHERE account_set_id = ?`).run(accountSetId)
      },
    })
  }
  return steps
}

/**
 * 级联删除账套及其全部关联数据（删除账套、导入回滚等统一入口）
 * 同步执行、单事务；onProgress 仅用于上报进度（同步执行期间无法被轮询到）
 */
export function cleanupAccountSetCascade(
  db: Database,
  accountSetId: string,
  onProgress?: CleanupProgress
) {
  const steps = buildCleanupSteps(db, accountSetId)
  db.pragma('foreign_keys = OFF')
  try {
    const cleanup = db.transaction(() => {
      steps.forEach((step, i) => {
        step.run()
        onProgress?.(i + 1, steps.length, step.label)
      })
    })
    cleanup()
    repairDatabaseReferentialIntegrity(db)
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve))

/**
 * 异步版：每清完一张表让出事件循环，使进度接口能被响应。
 * 手动事务保持原子性；调用方须在运行期间屏蔽其它请求（见 accountSetBusy 中间件），
 * 避免别的请求的写入混进这个未提交事务。
 */
export async function cleanupAccountSetCascadeAsync(
  db: Database,
  accountSetId: string,
  onProgress?: CleanupProgress
) {
  const steps = buildCleanupSteps(db, accountSetId)
  const total = steps.length + 1 // 最后一步：完整性校验
  db.pragma('foreign_keys = OFF')
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      for (let i = 0; i < steps.length; i++) {
        onProgress?.(i, total, steps[i].label)
        await yieldToEventLoop()
        steps[i].run()
      }
      db.exec('COMMIT')
    } catch (err) {
      if (db.inTransaction) db.exec('ROLLBACK')
      throw err
    }
    onProgress?.(steps.length, total, '校验数据完整性')
    await yieldToEventLoop()
    repairDatabaseReferentialIntegrity(db)
    onProgress?.(total, total, '完成')
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

/** 所有带 account_set_id 列的业务表（排除 account_sets 本身与 FTS 虚表的影子表） */
export function listAccountSetScopedTables(db: Database): string[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'")
    .all() as Array<{ name: string }>
  return tables
    .map(t => t.name)
    .filter(name => name !== 'account_sets' && !/_fts(_|$)/.test(name))
    .filter(name =>
      (db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).some(c => c.name === 'account_set_id')
    )
}
