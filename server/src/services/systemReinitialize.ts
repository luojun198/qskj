import bcrypt from 'bcryptjs'
import { initCashFlowForAccountSetSafe } from './cashFlowAccountMap.js'
import type { Database } from 'better-sqlite3'
import {
  importAcdTemplateToAccountSet,
  parseAcdTables,
  type ImportTemplateOptions,
} from '../scripts/importAcdToCurrentAccountSet.js'
import { type AccountingStandardParam } from './accountingStandard.js'
import {
  isValidAccountSetStartDate,
  normalizeAccountCodeConfig,
  syncAccountSetStartDate,
} from './accountSetDefaults.js'
import { applyAccountingStandardPreset } from './standardTemplateAccountSet.js'
import type { StaticReportStandard } from './staticReportConfig.js'
import {
  findStandardTemplateById,
  readStandardTemplateAcdBuffer,
  type StandardTemplateInfo,
} from './standardTemplateScan.js'
import { checkpointDatabase } from '../db/index.js'
import { doBackup } from '../routes/backup.js'
import { createTask, updateTask } from './taskQueue.js'

export type ReinitMode = 'voucher_only' | 'full_reinit'

export type ReinitPreserveOptions = {
  preserve_aux: boolean
  preserve_voucher_types: boolean
  preserve_transfer: boolean
  preserve_dashboard_rules: boolean
  preserve_business_params: boolean
}

export type ReinitPayload = {
  mode: ReinitMode
  start_date: string
  accounting_standard?: AccountingStandardParam
  standard_template_id?: string
  preserve?: Partial<ReinitPreserveOptions>
  account_levels?: number
  account_code_lengths?: number[]
}

export type ReinitPreviewCounts = {
  vouchers: number
  voucher_entries: number
  init_balances: number
  accounts: number
  aux_items: number
  aux_categories: number
  period_closing: number
  account_balances: number
}

export type ReinitPreviewResult = {
  mode: ReinitMode
  counts: ReinitPreviewCounts
  willDelete: ReinitPreviewCounts
  template?: Pick<StandardTemplateInfo, 'id' | 'name' | 'description' | 'inferredStandard'>
  templateAccountCount?: number
  warnings: string[]
}

const FULL_REINIT_STANDARDS = new Set<AccountingStandardParam>([
  'government',
  'small_business',
  'enterprise',
])

const DEFAULT_PRESERVE: ReinitPreserveOptions = {
  preserve_aux: false,
  preserve_voucher_types: false,
  preserve_transfer: false,
  preserve_dashboard_rules: false,
  preserve_business_params: false,
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { name?: string } | undefined
  return !!row?.name
}

function countByAccountSet(db: Database, table: string, accountSetId: string): number {
  if (!tableExists(db, table)) return 0
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE account_set_id = ?`)
    .get(accountSetId) as { cnt?: number } | undefined
  return Number(row?.cnt || 0)
}

function normalizePreserve(input?: Partial<ReinitPreserveOptions>): ReinitPreserveOptions {
  return {
    preserve_aux: !!input?.preserve_aux,
    preserve_voucher_types: !!input?.preserve_voucher_types,
    preserve_transfer: !!input?.preserve_transfer,
    preserve_dashboard_rules: !!input?.preserve_dashboard_rules,
    preserve_business_params: !!input?.preserve_business_params,
  }
}

function validateStartDate(startDate?: string): string {
  const normalized = String(startDate || '').trim()
  if (!isValidAccountSetStartDate(normalized)) {
    throw new Error('请选择有效的建账日期')
  }
  return normalized
}

function applyReinitStartDate(db: Database, accountSetId: string, startDate: string): string {
  const normalized = syncAccountSetStartDate(db, accountSetId, startDate)
  const fiscalYear = parseInt(normalized.substring(0, 4), 10)
  if (Number.isFinite(fiscalYear)) {
    const cols = db.prepare(`PRAGMA table_info(account_sets)`).all() as Array<{ name: string }>
    if (cols.some(col => col.name === 'fiscal_year')) {
      db.prepare('UPDATE account_sets SET fiscal_year = ? WHERE id = ?').run(fiscalYear, accountSetId)
    }
  }
  return normalized
}

export function verifyAdminPassword(
  db: Database,
  accountSetId: string,
  password: string
): boolean {
  const adminUser = db
    .prepare("SELECT password FROM users WHERE username = 'admin' AND account_set_id = ?")
    .get(accountSetId) as { password?: string } | undefined
  if (!adminUser?.password) return false
  return bcrypt.compareSync(String(password || ''), adminUser.password)
}

function validatePayload(payload: ReinitPayload): {
  startDate: string
  preserve: ReinitPreserveOptions
  standard?: AccountingStandardParam
  template?: StandardTemplateInfo
  accountCodeConfig?: ReturnType<typeof normalizeAccountCodeConfig>
} {
  const startDate = validateStartDate(payload.start_date)
  const preserve = normalizePreserve(payload.preserve)

  if (payload.mode === 'voucher_only') {
    return { startDate, preserve: DEFAULT_PRESERVE }
  }

  const standard = payload.accounting_standard
  if (!standard || !FULL_REINIT_STANDARDS.has(standard)) {
    throw new Error('重新初始化须选择有效的会计准则（政府/小企业/企业）')
  }

  const templateId = String(payload.standard_template_id || '').trim()
  if (!templateId) {
    throw new Error('请选择标准模板')
  }

  const template = findStandardTemplateById(templateId)
  if (!template) {
    throw new Error('标准模板不存在，请检查「标准模版」目录')
  }

  if (!payload.account_levels || !payload.account_code_lengths?.length) {
    throw new Error('重新初始化须设置科目级数与各级科目长度')
  }

  const accountCodeConfig = normalizeAccountCodeConfig(
    payload.account_levels,
    payload.account_code_lengths
  )

  return { startDate, preserve, standard, template, accountCodeConfig }
}

function buildPreviewCounts(db: Database, accountSetId: string): ReinitPreviewCounts {
  return {
    vouchers: countByAccountSet(db, 'vouchers', accountSetId),
    voucher_entries: countByAccountSet(db, 'voucher_entries', accountSetId),
    init_balances: countByAccountSet(db, 'init_balances', accountSetId),
    accounts: countByAccountSet(db, 'accounts', accountSetId),
    aux_items: countByAccountSet(db, 'aux_items', accountSetId),
    aux_categories: countByAccountSet(db, 'aux_categories', accountSetId),
    period_closing: countByAccountSet(db, 'period_closing', accountSetId),
    account_balances: countByAccountSet(db, 'account_balances', accountSetId),
  }
}

function buildWillDelete(
  mode: ReinitMode,
  counts: ReinitPreviewCounts,
  preserve: ReinitPreserveOptions
): ReinitPreviewCounts {
  return {
    vouchers: counts.vouchers,
    voucher_entries: counts.voucher_entries,
    init_balances: mode === 'full_reinit' ? counts.init_balances : 0,
    accounts: mode === 'full_reinit' ? counts.accounts : 0,
    aux_items: mode === 'full_reinit' && !preserve.preserve_aux ? counts.aux_items : 0,
    aux_categories: mode === 'full_reinit' && !preserve.preserve_aux ? counts.aux_categories : 0,
    period_closing: counts.period_closing,
    account_balances: counts.account_balances,
  }
}

export function previewReinitialize(
  db: Database,
  accountSetId: string,
  payload: ReinitPayload
): ReinitPreviewResult {
  const { startDate, preserve, standard, template, accountCodeConfig } = validatePayload(payload)
  const counts = buildPreviewCounts(db, accountSetId)
  const warnings: string[] = []

  warnings.push('初始化将强制删除全部凭证（含已记账凭证），不可恢复')
  warnings.push(`建账日期将更新为 ${startDate}`)
  if (payload.mode === 'full_reinit') {
    warnings.push('重新初始化将清空全部期初余额（科目 ID 会变化）')
    if (accountCodeConfig) {
      warnings.push(
        `科目级数将设为 ${accountCodeConfig.accountLevels} 级（${accountCodeConfig.accountCodeLengths.slice(0, accountCodeConfig.accountLevels).join('-')}）`
      )
    }
    if (preserve.preserve_aux) {
      warnings.push('已勾选保留辅助核算：模板中的辅助主数据不会导入，请确认与现有辅助类别兼容')
    }
    if (!preserve.preserve_dashboard_rules && standard) {
      warnings.push(`主页取数规则将重置为「${standard}」准则预设`)
    }
    warnings.push('凭证模版、动态报表公式可能因科目编码变化而失效，请初始化后检查')
  }

  let templateAccountCount: number | undefined
  if (template) {
    try {
      const buffer = readStandardTemplateAcdBuffer(template.id)
      const tables = parseAcdTables(buffer)
      templateAccountCount = tables.accounts.length
    } catch {
      warnings.push('无法预读模板科目数量，执行时将尝试导入')
    }
  }

  return {
    mode: payload.mode,
    counts,
    willDelete: buildWillDelete(payload.mode, counts, preserve),
    template: template
      ? {
          id: template.id,
          name: template.name,
          description: template.description,
          inferredStandard: template.inferredStandard,
        }
      : undefined,
    templateAccountCount,
    warnings,
  }
}

function deleteIfExists(db: Database, sql: string, accountSetId: string) {
  const tableMatch = sql.match(/^DELETE FROM\s+([a-zA-Z_][\w]*)/i)
  if (tableMatch && !tableExists(db, tableMatch[1])) return
  db.prepare(sql).run(accountSetId)
}

export function clearVoucherData(db: Database, accountSetId: string) {
  deleteIfExists(db, 'DELETE FROM voucher_attachments WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM auto_transfer_runs WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM voucher_entries WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM vouchers WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM account_balances WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM period_closing WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM budget_surplus_adjustments WHERE account_set_id = ?', accountSetId)
}

function clearMasterDataForReinit(
  db: Database,
  accountSetId: string,
  preserve: ReinitPreserveOptions
) {
  deleteIfExists(db, 'DELETE FROM init_balances WHERE account_set_id = ?', accountSetId)

  if (!preserve.preserve_aux) {
    deleteIfExists(db, 'DELETE FROM cash_flow_items WHERE account_set_id = ?', accountSetId)
    deleteIfExists(db, 'DELETE FROM aux_items WHERE account_set_id = ?', accountSetId)
    deleteIfExists(db, 'DELETE FROM aux_categories WHERE account_set_id = ?', accountSetId)
  }

  if (!preserve.preserve_voucher_types) {
    deleteIfExists(db, 'DELETE FROM voucher_types WHERE account_set_id = ?', accountSetId)
  }

  if (!preserve.preserve_transfer) {
    deleteIfExists(db, 'DELETE FROM transfer_items WHERE account_set_id = ?', accountSetId)
    deleteIfExists(db, 'DELETE FROM transfer_types WHERE account_set_id = ?', accountSetId)
  }

  // 出纳与固定资产业务数据（依赖表先删）
  deleteIfExists(db, 'DELETE FROM cashier_attachments WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM cashier_gl_match WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM cashier_journal WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM cashier_init_balance WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM bank_statement WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM cashier_period_closing WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM settle_type WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_attachments WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_inventory_item WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_inventory WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_requisition WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_workload WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_change WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_depr WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_change_type WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_category WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_status WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_purpose WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM fixed_asset_dept WHERE account_set_id = ?', accountSetId)

  deleteIfExists(db, 'DELETE FROM account_cash_flow_map WHERE account_set_id = ?', accountSetId)
  deleteIfExists(db, 'DELETE FROM accounts WHERE account_set_id = ?', accountSetId)
}

function toImportTemplateOptions(
  preserve: ReinitPreserveOptions,
  accountCodeConfig?: ReturnType<typeof normalizeAccountCodeConfig>
): ImportTemplateOptions {
  return {
    preserveStartDate: true,
    preserveAux: preserve.preserve_aux,
    preserveVoucherTypes: preserve.preserve_voucher_types,
    preserveTransfer: preserve.preserve_transfer,
    preserveBusinessParams: preserve.preserve_business_params,
    accountLevels: accountCodeConfig?.accountLevels,
    accountCodeLengths: accountCodeConfig?.accountCodeLengths,
  }
}

function applyDashboardStandard(
  db: Database,
  accountSetId: string,
  standard: StaticReportStandard
) {
  applyAccountingStandardPreset(db, accountSetId, standard)
}

export function reinitializeAccountSet(
  db: Database,
  accountSetId: string,
  payload: ReinitPayload
) {
  const { startDate, preserve, standard, template, accountCodeConfig } = validatePayload(payload)

  db.pragma('foreign_keys = OFF')
  try {
    const run = db.transaction(() => {
      clearVoucherData(db, accountSetId)

      if (payload.mode === 'voucher_only') {
        applyReinitStartDate(db, accountSetId, startDate)
      // 科目已重建（映射已清空）：按准则重新预设科目现金流量项目
      initCashFlowForAccountSetSafe(db, accountSetId)
        return {
          mode: payload.mode,
          message: `已清理全部凭证及相关余额、结账记录，建账日期已更新为 ${startDate}`,
          start_date: startDate,
        }
      }

      if (!template || !standard) {
        throw new Error('重新初始化参数不完整')
      }

      clearMasterDataForReinit(db, accountSetId, preserve)

      const acdBuffer = readStandardTemplateAcdBuffer(template.id)
      const stats = importAcdTemplateToAccountSet(
        accountSetId,
        acdBuffer,
        toImportTemplateOptions(preserve, accountCodeConfig)
      )

      if (!preserve.preserve_dashboard_rules) {
        applyDashboardStandard(db, accountSetId, standard as StaticReportStandard)
      }

      applyReinitStartDate(db, accountSetId, startDate)

      const accountTotal = stats.accounts.inserted + stats.accounts.updated
      return {
        mode: payload.mode,
        message: `重新初始化完成：导入科目 ${accountTotal} 个，建账日期已更新为 ${startDate}`,
        stats,
        template: { id: template.id, name: template.name },
        accounting_standard: standard,
        start_date: startDate,
      }
    })
    const result = run()
    checkpointDatabase(db)
    return result
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function runProgressTask(
  accountSetId: string,
  runner: (
    taskId: string,
    report: (processed: number, total: number, success: number, failed: number) => void
  ) => Promise<{ message: string; result?: unknown }>
): string {
  const task = createTask('system-reinitialize', accountSetId)

  setImmediate(async () => {
    try {
      updateTask(task.id, { status: 'processing' })
      const report = (processed: number, total: number, success: number, failed: number) => {
        const progress = total > 0 ? Math.floor((processed / total) * 100) : 0
        updateTask(task.id, { processed, total, success, failed, progress })
      }
      report(0, 1, 0, 0)
      const outcome = await runner(task.id, report)
      report(1, 1, 1, 0)
      updateTask(task.id, {
        status: 'completed',
        progress: 100,
        message: outcome.message,
        result: outcome.result,
      })
    } catch (error: any) {
      updateTask(task.id, {
        status: 'failed',
        message: error.message || '系统初始化失败',
      })
    }
  })

  return task.id
}

export async function createPreReinitializeBackup(
  accountSetId: string,
  userId?: string
): Promise<{ id: string; filename: string }> {
  const preBackup = await doBackup(accountSetId, 'manual', userId, undefined, {
    filenamePrefix: '初始化前备份',
  })
  if (!preBackup?.id || preBackup.error) {
    throw new Error(preBackup?.error || '初始化前自动备份失败，已中止操作')
  }
  return { id: preBackup.id, filename: preBackup.filename }
}

export function runReinitializeAsync(
  db: Database,
  accountSetId: string,
  payload: ReinitPayload,
  userId?: string
) {
  return runProgressTask(accountSetId, async () => {
    const preBackup = await createPreReinitializeBackup(accountSetId, userId)
    const result = reinitializeAccountSet(db, accountSetId, payload)
    const accountTotal =
      result.stats?.accounts != null
        ? result.stats.accounts.inserted + result.stats.accounts.updated
        : undefined
    return {
      message: `${result.message}（已自动备份：${preBackup.filename}）`,
      result: {
        mode: result.mode,
        start_date: result.start_date,
        accounting_standard: result.accounting_standard,
        template: result.template,
        preBackupFilename: preBackup.filename,
        accountTotal,
      },
    }
  })
}
