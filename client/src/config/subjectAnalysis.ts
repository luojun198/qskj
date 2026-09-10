/**
 * 财务分析（科目分析）预置科目。
 * 六个入口共用同一页面，仅默认科目不同；按「科目名称优先、编码兜底」解析，
 * 以兼容企业 / 小企业 / 政府三套科目体系。
 */

export type SubjectAnalysisPreset = 'admin' | 'sales' | 'finance' | 'ar' | 'ap' | 'custom'

export interface SubjectAnalysisPresetDef {
  key: SubjectAnalysisPreset
  /** 侧栏显示名 */
  title: string
  /** 条件弹窗标题 */
  dialogTitle: string
  /** 名称候选（精确匹配一级科目名），按顺序优先 */
  names: string[]
  /** 编码兜底，按顺序优先 */
  codes: string[]
}

export const SUBJECT_ANALYSIS_PRESETS: Record<SubjectAnalysisPreset, SubjectAnalysisPresetDef> = {
  admin: {
    key: 'admin',
    title: '管理费用',
    dialogTitle: '管理费用分析',
    names: ['管理费用', '单位管理费用'],
    codes: ['6602', '5602', '5101'],
  },
  sales: {
    key: 'sales',
    title: '销售费用',
    dialogTitle: '销售费用分析',
    names: ['销售费用', '经营费用'],
    codes: ['6601', '5601', '5201'],
  },
  finance: {
    key: 'finance',
    title: '财务费用',
    dialogTitle: '财务费用分析',
    names: ['财务费用', '利息费用'],
    codes: ['6603', '5603', '5701'],
  },
  ar: {
    key: 'ar',
    title: '应收账款',
    dialogTitle: '应收账款分析',
    names: ['应收账款'],
    codes: ['1122'],
  },
  ap: {
    key: 'ap',
    title: '应付账款',
    dialogTitle: '应付账款分析',
    names: ['应付账款'],
    codes: ['2202'],
  },
  custom: {
    key: 'custom',
    title: '其它科目分析',
    dialogTitle: '其它科目分析',
    names: [],
    codes: [],
  },
}

export function normalizeSubjectAnalysisPreset(value: unknown): SubjectAnalysisPreset {
  const key = String(value || '')
  return key in SUBJECT_ANALYSIS_PRESETS ? (key as SubjectAnalysisPreset) : 'custom'
}

export function getSubjectAnalysisPath(preset: SubjectAnalysisPreset): string {
  return `/ledger/subject-analysis?preset=${preset}`
}

/**
 * 在科目表里解析预置科目。先按名称找一级科目，再按编码精确匹配；都找不到返回 null。
 */
export function resolvePresetAccount<T extends { code: string; name: string; level?: number }>(
  preset: SubjectAnalysisPreset,
  accounts: T[]
): T | null {
  const def = SUBJECT_ANALYSIS_PRESETS[preset]
  for (const name of def.names) {
    const hit = accounts.find(a => a.name === name && (a.level === undefined || a.level === 1))
    if (hit) return hit
  }
  for (const code of def.codes) {
    const hit = accounts.find(a => a.code === code)
    if (hit) return hit
  }
  return null
}
