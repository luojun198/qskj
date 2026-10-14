import { scmApi } from '@/api/scm'

/** 进销存单据打印版式（第五份反馈：打印模板切换） */
export type ScmPrintLayout = 'standard' | 'tax' | 'delivery'

export const SCM_PRINT_LAYOUTS: Array<{ value: ScmPrintLayout; label: string; desc: string }> = [
  { value: 'standard', label: '标准', desc: '不含税单价 / 金额 / 税额' },
  { value: 'tax', label: '含税价', desc: '含税单价 / 价税合计' },
  { value: 'delivery', label: '送货单', desc: '不显示价格，带收货签收栏' },
]

const PARAM_KEY = 'scm:print_layouts'

export function isScmPrintLayout(v: unknown): v is ScmPrintLayout {
  return v === 'standard' || v === 'tax' || v === 'delivery'
}

function parseLayouts(raw: string | undefined | null): Record<string, ScmPrintLayout> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, ScmPrintLayout> = {}
    for (const [k, v] of Object.entries(parsed)) if (isScmPrintLayout(v)) out[k] = v
    return out
  } catch {
    return {}
  }
}

/** 读取各单据类型的默认版式（账套级，存供应链参数 scm:print_layouts） */
export async function loadScmPrintLayouts(): Promise<Record<string, ScmPrintLayout>> {
  try {
    const r = await scmApi.getParams()
    if (r.code !== 0) return {}
    return parseLayouts(r.data.find(p => p.param_key === PARAM_KEY)?.param_value)
  } catch {
    return {}
  }
}

/**
 * 单据打印的默认选择：内置版式，或自定义模板 `tpl:<模板 id>`（第六份反馈：业务单据自定义打印模板）。
 * 批量打印只认内置版式（loadScmPrintLayouts 过滤掉 tpl:），默认是自定义模板的单据批量打印时按标准版式。
 */
export type ScmPrintChoice = ScmPrintLayout | `tpl:${string}`

export const isTemplateChoice = (v: unknown): v is `tpl:${string}` => typeof v === 'string' && v.startsWith('tpl:') && v.length > 4

export async function loadScmPrintChoices(): Promise<Record<string, ScmPrintChoice>> {
  try {
    const r = await scmApi.getParams()
    if (r.code !== 0) return {}
    const raw = r.data.find(p => p.param_key === PARAM_KEY)?.param_value
    const parsed = raw ? JSON.parse(raw) : {}
    const out: Record<string, ScmPrintChoice> = {}
    for (const [k, v] of Object.entries(parsed || {})) if (isScmPrintLayout(v) || isTemplateChoice(v)) out[k] = v as ScmPrintChoice
    return out
  } catch {
    return {}
  }
}

/** 把某单据类型的默认打印设为 choice（先读最新值再合并，避免覆盖别的类型） */
export async function saveScmPrintLayout(docType: string, choice: ScmPrintChoice) {
  const current = await loadScmPrintChoices()
  current[docType] = choice
  await scmApi.saveParams([{ param_key: PARAM_KEY, param_value: JSON.stringify(current) }])
}
