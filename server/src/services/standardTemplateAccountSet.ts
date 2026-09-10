import { readFileSync, statSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import type { Database } from 'better-sqlite3'
import { ensureAccountSetSecurityBootstrap } from '../db/index.js'
import { ensureDynamicReportSchema } from '../db/ensureDynamicReportSchema.js'
import {
  importAcdTemplateToAccountSet,
  parseAcdTables,
  inferAccountCodeLengths,
  inferAccountLevelsFromAccounts,
  type ImportStats,
} from '../scripts/importAcdToCurrentAccountSet.js'
import { extractAccountCodeLengthsFromXt } from '../scripts/importAcdToCurrentAccountSet.js'
import {
  ACCOUNTING_STANDARD_PARAM_KEY,
  DASHBOARD_CATEGORY_RULES_PARAM_KEY,
  serializeDashboardRuleConfig,
  type AccountingStandardParam,
} from './accountingStandard.js'
import {
  allocateAccountSetCode,
  bootstrapNewAccountSetDefaults,
  readAccountSetStartDate,
  resolveAccountSetStartDate,
  upsertAccountSetSystemParam,
} from './accountSetDefaults.js'
import {
  buildPresetDashboardCategoryRules,
  buildPresetDashboardBudgetRules,
} from './dashboardCategoryConfig.js'
import type { StaticReportStandard } from './staticReportConfig.js'
import { cleanupAccountSetCascade } from './accountSetCleanup.js'
import { importAcdStandardReports } from './acdStandardReportImport.js'
import { syncAcdReportFormulasToAccountSet } from './acdReportFormulaSync.js'
import { importExcelReportsFromTemplate } from './standardTemplateImport.js'
import {
  findStandardTemplateById,
  scanStandardTemplates,
  type StandardTemplateInfo,
  type StandardTemplateSummary,
} from './standardTemplateScan.js'

const PRESET_STANDARDS = new Set<AccountingStandardParam>([
  'government',
  'small_business',
  'enterprise',
])

/**
 * 按准则写入账套的会计准则参数；三种有预设的准则同时重置主页取数规则，
 * 其余（auto）只记录准则值，由运行时按科目自动识别。
 */
export function applyAccountingStandardPreset(
  db: Database,
  accountSetId: string,
  standard: AccountingStandardParam
) {
  upsertAccountSetSystemParam(db, accountSetId, ACCOUNTING_STANDARD_PARAM_KEY, standard, '会计准则')
  if (!PRESET_STANDARDS.has(standard)) return
  const preset = standard as StaticReportStandard
  upsertAccountSetSystemParam(
    db,
    accountSetId,
    DASHBOARD_CATEGORY_RULES_PARAM_KEY,
    serializeDashboardRuleConfig({
      version: 2,
      customized: false,
      financial: buildPresetDashboardCategoryRules(db, accountSetId, preset),
      budget: buildPresetDashboardBudgetRules(db, accountSetId, preset),
    }),
    '主页取数规则'
  )
}

// ---------------------------------------------------------------------------
// 模板概况（科目数 / 报表数 / 级次），按 ACD 文件路径缓存
// ---------------------------------------------------------------------------

const summaryCache = new Map<string, StandardTemplateSummary>()

/** 缓存键带上 ACD 文件的修改时间与大小：替换同名 ACD 后概况会自动重算 */
function summaryCacheKey(acdFile: string): string {
  try {
    const stat = statSync(acdFile)
    return `${acdFile}:${stat.mtimeMs}:${stat.size}`
  } catch {
    return acdFile
  }
}

export function summarizeStandardTemplate(template: StandardTemplateInfo): StandardTemplateSummary | null {
  const cacheKey = summaryCacheKey(template.acdFile)
  const cached = summaryCache.get(cacheKey)
  if (cached) return cached
  try {
    const tables = parseAcdTables(readFileSync(template.acdFile))
    const codeLengths =
      extractAccountCodeLengthsFromXt(tables.xt) || inferAccountCodeLengths(tables.accounts)
    const levels = inferAccountLevelsFromAccounts(tables.accounts)
    const firstLen = codeLengths[0] || 4
    const summary: StandardTemplateSummary = {
      accounts: tables.accounts.length,
      topLevelAccounts: tables.accounts.filter(row => String(row[0] || '').length <= firstLen).length,
      reports: tables.reportCatalog.length,
      codeLengths: codeLengths.slice(0, Math.max(1, levels)),
      cashFlowItems: tables.auxCashFlows.length,
      transferTypes: tables.transferTypes.length,
    }
    summaryCache.set(cacheKey, summary)
    return summary
  } catch (error) {
    console.warn(
      `[标准模版] 模板概况解析失败「${template.id}」: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}

export function invalidateStandardTemplateSummaryCache() {
  summaryCache.clear()
}

/** 列表接口用：不返回服务器磁盘路径，附带概况与可读描述 */
export function listStandardTemplatesForClient() {
  return scanStandardTemplates().map(template => {
    const summary = summarizeStandardTemplate(template)
    const parts: string[] = []
    if (summary) {
      parts.push(`科目 ${summary.accounts} 个`)
      parts.push(`报表 ${summary.reports} 张`)
      if (summary.codeLengths.length) parts.push(`级次 ${summary.codeLengths.join('-')}`)
    }
    if (template.excelFiles.length) parts.push(`Excel 报表 ${template.excelFiles.length} 个`)
    return {
      id: template.id,
      name: template.name,
      group: template.group,
      code: template.code,
      retired: template.retired,
      order: template.order,
      inferredStandard: template.inferredStandard,
      description: parts.length ? parts.join(' · ') : template.description,
      excelFiles: template.excelFiles.map(file => ({ name: file.name })),
      summary,
    }
  })
}

// ---------------------------------------------------------------------------
// 从标准模板建账
// ---------------------------------------------------------------------------

export type CreateFromStandardTemplatePayload = {
  name: string
  code?: string | null
  credit_code?: string | null
  fiscal_year?: number | string | null
  start_date?: string | null
  unit_leader?: string | null
  chief_accountant?: string | null
  standard_template_id: string
}

export type CreateFromStandardTemplateResult = {
  id: string
  name: string
  code: string
  start_date: string | undefined
  template: { id: string; name: string; group: string }
  accounting_standard: AccountingStandardParam
  acdStats: {
    accounts: number
    transferTypes: number
    transferItems: number
    voucherTypes: number
    auxiliaryItems: number
    reportDefinitions: number
  }
  standardReports: number
  reportStats: any
  acdFormulaStats: any
  warnings: string[]
  rawStats: ImportStats
}

export class StandardTemplateCreateError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/**
 * 创建账套并按标准模板初始化：
 * 账套记录 → 默认参数/管理员 → ACD 模板（科目/凭证类型/结转/辅助/币种/报表定义）
 * → 会计准则与主页取数预设 → 标准报表（rh_standard_reports）→ Excel 动态报表 + 公式同步。
 * 任一致命步骤失败时级联清理已创建账套并抛错。
 */
export async function createAccountSetFromStandardTemplate(
  db: Database,
  payload: CreateFromStandardTemplatePayload
): Promise<CreateFromStandardTemplateResult> {
  const name = String(payload.name || '').trim()
  if (!name) throw new StandardTemplateCreateError('名称不能为空')
  const templateId = String(payload.standard_template_id || '').trim()
  if (!templateId) throw new StandardTemplateCreateError('请选择标准模板')

  const template = findStandardTemplateById(templateId)
  if (!template) throw new StandardTemplateCreateError('标准模板不存在', 404)

  const existingName = db.prepare('SELECT id FROM account_sets WHERE name = ?').get(name)
  if (existingName) throw new StandardTemplateCreateError('账套名称已存在')

  ensureDynamicReportSchema(db)

  const id = uuidv4()
  const finalCode = allocateAccountSetCode(db, payload.code)
  const fiscalYear = Number(payload.fiscal_year) || new Date().getFullYear()
  const normalizedStartDate = resolveAccountSetStartDate(payload.start_date || undefined, fiscalYear)
  const warnings: string[] = []

  try {
    db.prepare(
      `INSERT INTO account_sets (id, name, code, credit_code, fiscal_year, start_date, unit_leader, chief_accountant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name,
      finalCode,
      payload.credit_code || null,
      fiscalYear,
      normalizedStartDate,
      payload.unit_leader || null,
      payload.chief_accountant || null
    )

    bootstrapNewAccountSetDefaults(db, id, {
      start_date: normalizedStartDate,
      fiscal_year: fiscalYear,
      unit_name: name,
    })
    ensureAccountSetSecurityBootstrap(id)

    console.log(`[标准模版] 开始导入 ACD 模板「${template.name}」:`, template.acdFile)
    const acdBuffer = readFileSync(template.acdFile)
    const stats = importAcdTemplateToAccountSet(id, acdBuffer)
    warnings.push(...(stats.warnings || []))

    applyAccountingStandardPreset(db, id, template.inferredStandard)

    let standardReports = 0
    try {
      const result = importAcdStandardReports(db, id, acdBuffer)
      standardReports = result.reports.length
      warnings.push(...result.warnings)
      if (standardReports > 0) {
        // 配套报表已进入「标准报表」模块，旧版动态报表定义未匹配的提示对用户没有意义
        const legacyIndex = warnings.findIndex(item => item.includes('未匹配到可导入的报表模板文件'))
        if (legacyIndex >= 0) warnings.splice(legacyIndex, 1)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`标准报表导入失败: ${message}`)
      console.warn('[标准模版] 标准报表导入失败:', message)
    }

    let reportStats: any = { total: 0, success: 0, failed: 0, results: [] }
    let acdFormulaStats: any = null
    if (template.excelFiles.length) {
      try {
        reportStats = await importExcelReportsFromTemplate(db, id, template.excelFiles)
        acdFormulaStats = syncAcdReportFormulasToAccountSet(db as any, id, acdBuffer)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[标准模版] Excel 报表导入失败:', message)
        reportStats = {
          total: template.excelFiles.length,
          success: 0,
          failed: template.excelFiles.length,
          results: [],
          error: message,
        }
        warnings.push(`Excel 报表导入失败: ${message}`)
      }
    }

    return {
      id,
      name,
      code: finalCode,
      start_date: readAccountSetStartDate(db, id),
      template: { id: template.id, name: template.name, group: template.group },
      accounting_standard: template.inferredStandard,
      acdStats: {
        accounts: (stats.accounts?.inserted || 0) + (stats.accounts?.updated || 0),
        transferTypes: stats.transferTypes?.types || 0,
        transferItems: stats.transferTypes?.items || 0,
        voucherTypes: (stats.voucherTypes?.inserted || 0) + (stats.voucherTypes?.updated || 0),
        auxiliaryItems: stats.auxiliaryData?.totalItems || 0,
        reportDefinitions: stats.reportTemplates?.definitions || 0,
      },
      standardReports,
      reportStats,
      acdFormulaStats,
      warnings,
      rawStats: stats,
    }
  } catch (error) {
    try {
      cleanupAccountSetCascade(db, id)
    } catch (cleanupError) {
      console.error('[标准模版] 建账失败后清理账套出错:', cleanupError)
    }
    throw error
  }
}
