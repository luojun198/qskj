/** 进销存 ACD 导入：公共类型 */

export type IssueLevel = 'error' | 'warn' | 'info'

export interface ImportIssue {
  level: IssueLevel
  /** 分组：档案 / 单据 / 订单 / 库存 / 科目 … */
  category: string
  message: string
}

export type ConflictPolicy = 'skip' | 'overwrite'

export interface ScmAcdImportOptions {
  /** 档案编码已存在时：跳过（保留本系统现有档案）/ 覆盖（以 ACD 为准更新） */
  conflict: ConflictPolicy
}

export const DEFAULT_IMPORT_OPTIONS: ScmAcdImportOptions = { conflict: 'skip' }

/** locked：覆盖导入时因已审核而未覆盖的条数（计入 skipped） */
export interface ImportCounter { inserted: number; updated: number; skipped: number; locked?: number }

export const newCounter = (): ImportCounter => ({ inserted: 0, updated: 0, skipped: 0 })

export interface ImportContext {
  accountSetId: string
  batchId: string
  operator: string
  options: ScmAcdImportOptions
  issues: ImportIssue[]
}

export function pushIssue(ctx: { issues: ImportIssue[] }, level: IssueLevel, category: string, message: string) {
  ctx.issues.push({ level, category, message })
}

/** 润衡往来单位属性 khda.sx：1 供应商、2 客户、其它（0 / 空）客户兼供应商 */
export function partnerTypeFromAcd(sx: string | null | undefined): 'customer' | 'supplier' | 'both' {
  const v = String(sx ?? '').trim()
  if (v === '1') return 'supplier'
  if (v === '2') return 'customer'
  return 'both'
}
