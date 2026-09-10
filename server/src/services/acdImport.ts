import { v4 as uuidv4 } from 'uuid'
import { getDb, ensureAccountSetSecurityBootstrap, assertDatabaseIntegrity, checkpointDatabase } from '../db/index.js'
import { importAcdToAccountSet, type ImportStats } from '../scripts/importAcdToCurrentAccountSet.js'
import { cleanupAccountSetCascade } from './accountSetCleanup.js'
import { syncAccountSetUserRoleLinks } from './userRoleLinks.js'
import { importAcdStandardReports } from './acdStandardReportImport.js'

export interface AcdImportParams {
  acdBuffer: Buffer
  name: string
  code: string
  fiscalYear: number
  startDate: string
}

export interface AcdImportResult {
  accountSetId: string
  name: string
  code: string
  /** 实际落库的会计年度（完整导入以 ACD xt_kzrq 为准，可能与调用方传入值不同） */
  fiscalYear: number
  /** 实际落库的建账日期（YYYY-MM-DD） */
  startDate: string
  stats: ImportStats
  standardReports: number
}

export async function acdImportService(params: AcdImportParams): Promise<AcdImportResult> {
  const db = getDb()
  assertDatabaseIntegrity(db)

  // Check code uniqueness
  const existing = db.prepare('SELECT id FROM account_sets WHERE code = ?').get(params.code)
  if (existing) {
    throw new Error('账套编码已存在: ' + params.code)
  }

  const accountSetId = uuidv4()

  try {
    db.prepare(`
      INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `).run(accountSetId, params.name, params.code, params.fiscalYear, params.startDate)

    ensureAccountSetSecurityBootstrap(accountSetId)

    const stats = await importAcdToAccountSet(accountSetId, params.acdBuffer)
    let standardReports = 0
    try {
      const standardReportResult = importAcdStandardReports(
        db,
        accountSetId,
        params.acdBuffer
      )
      standardReports = standardReportResult.reports.length
      stats.warnings.push(...standardReportResult.warnings)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      stats.warnings.push(`标准报表导入失败，账套其他数据已正常导入: ${message}`)
      console.error('[ACD Import] 标准报表导入失败:', error)
    }
    syncAccountSetUserRoleLinks(accountSetId, db)
    checkpointDatabase(db)

    const persisted = db
      .prepare('SELECT fiscal_year, start_date FROM account_sets WHERE id = ?')
      .get(accountSetId) as { fiscal_year?: number; start_date?: string } | undefined

    return {
      accountSetId,
      name: params.name,
      code: params.code,
      fiscalYear: Number(persisted?.fiscal_year) || params.fiscalYear,
      startDate: persisted?.start_date || params.startDate,
      stats,
      standardReports,
    }
  } catch (error) {
    try {
      cleanupAccountSetCascade(db, accountSetId)
    } catch (cleanupError) {
      console.error('[ACD Import] 导入失败后清理账套出错:', cleanupError)
    }
    throw error
  }
}
