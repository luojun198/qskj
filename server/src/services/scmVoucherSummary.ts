/**
 * 进销存凭证摘要模板
 *
 * 生成凭证时每条分录的摘要由「单据类型 × 科目角色」的模板渲染，替代原来写死的「单号 + 首行物料名」。
 * 优先级：账套自定义「单据类型 + 科目编码」> 自定义「单据类型 + 角色」> 内置默认「单据类型 + 角色」> 兜底。
 * 自定义只存与内置不同的项，保存在 system_params（scm:summary_templates），无需迁移。
 */
import type Database from 'better-sqlite3'

export type SummaryRole =
  | 'ar' | 'ap' | 'revenue' | 'cost' | 'inventory' | 'tax_in' | 'tax_out'
  | 'settle' | 'other' | 'production' | 'labor' | 'overhead'

export const SUMMARY_ROLES: Array<{ key: SummaryRole; label: string }> = [
  { key: 'ar', label: '应收账款' },
  { key: 'ap', label: '应付账款' },
  { key: 'revenue', label: '主营业务收入' },
  { key: 'cost', label: '主营业务成本' },
  { key: 'inventory', label: '存货科目' },
  { key: 'tax_in', label: '进项税额' },
  { key: 'tax_out', label: '销项税额' },
  { key: 'settle', label: '结算账户' },
  { key: 'other', label: '其他出入库对方' },
  { key: 'production', label: '生产成本' },
  { key: 'labor', label: '应付职工薪酬' },
  { key: 'overhead', label: '制造费用' },
]

export const SUMMARY_PLACEHOLDERS: Array<{ key: string; desc: string }> = [
  { key: '单号', desc: '单据编号' },
  { key: '日期', desc: '单据日期' },
  { key: '单据类型', desc: '如 采购入库' },
  { key: '往来单位', desc: '客户 / 供应商名称' },
  { key: '部门', desc: '单据部门' },
  { key: '业务员', desc: '单据业务员' },
  { key: '物料', desc: '首个物料名称' },
  { key: '物料汇总', desc: '物料名；多种时为「首个物料等N种」' },
  { key: '数量', desc: '单据物料数量合计' },
  { key: '仓库', desc: '单据仓库' },
  { key: '备注', desc: '单据备注' },
  { key: '出入库类别', desc: '其他出入库的类别（盘盈 / 领用…）' },
  { key: '科目', desc: '本分录科目名称' },
]

/** 内置默认：单据类型 → 角色 → 模板。`差额` 类型对应有来源单据的发票差额调整凭证 */
export const DEFAULT_SUMMARY_TEMPLATES: Record<string, Partial<Record<SummaryRole, string>>> = {
  PI: {
    ap: '采购 {物料汇总}（{往来单位}）{单号}',
    inventory: '采购入库 {物料汇总} {单号}',
    tax_in: '采购进项税额 {单号}',
  },
  PR: {
    ap: '采购退货 {物料汇总}（{往来单位}）{单号}',
    inventory: '采购退货出库 {物料汇总} {单号}',
    tax_in: '采购退货冲进项税额 {单号}',
  },
  SO: {
    ar: '销售 {物料汇总}（{往来单位}）{单号}',
    revenue: '销售收入 {物料汇总} {单号}',
    tax_out: '销项税额 {单号}',
    cost: '结转销售成本 {物料汇总} {单号}',
    inventory: '销售出库 {物料汇总} {单号}',
  },
  SR: {
    ar: '销售退货 {物料汇总}（{往来单位}）{单号}',
    revenue: '冲销销售收入 {物料汇总} {单号}',
    tax_out: '冲销销项税额 {单号}',
    cost: '冲销销售成本 {物料汇总} {单号}',
    inventory: '销售退货入库 {物料汇总} {单号}',
  },
  RP: {
    ap: '采购发票（{往来单位}）{单号}',
    inventory: '采购发票 {物料汇总} {单号}',
    tax_in: '采购发票进项税额 {单号}',
  },
  RS: {
    ar: '销售发票（{往来单位}）{单号}',
    revenue: '销售收入 {物料汇总} {单号}',
    tax_out: '销项税额 {单号}',
  },
  RPD: {
    ap: '采购发票差额调整（{往来单位}）{单号}',
    inventory: '采购发票差额调整 {物料汇总} {单号}',
    tax_in: '采购发票差额调整进项税额 {单号}',
  },
  RSD: {
    ar: '销售发票差额调整（{往来单位}）{单号}',
    revenue: '销售发票差额调整 {物料汇总} {单号}',
    tax_out: '销售发票差额调整销项税额 {单号}',
  },
  RCV: {
    settle: '收{往来单位}款（{备注}）{单号}',
    ar: '收{往来单位}款（{备注}）{单号}',
  },
  PAY: {
    ap: '付{往来单位}款（{备注}）{单号}',
    settle: '付{往来单位}款（{备注}）{单号}',
  },
  OI: {
    inventory: '{出入库类别}入库 {物料汇总} {单号}',
    other: '{出入库类别}入库 {物料汇总} {单号}',
  },
  IS: {
    inventory: '期初入库 {物料汇总} {单号}',
    other: '期初入库 {物料汇总} {单号}',
  },
  OO: {
    inventory: '{出入库类别}出库 {物料汇总} {单号}',
    other: '{出入库类别}出库 {物料汇总} {单号}',
  },
  PL: { production: '生产领用 {物料汇总} {单号}', inventory: '生产领用 {物料汇总} {单号}' },
  PB: { production: '生产补料 {物料汇总} {单号}', inventory: '生产补料 {物料汇总} {单号}' },
  PJ: { production: '生产退料 {物料汇总} {单号}', inventory: '生产退料 {物料汇总} {单号}' },
  PF: {
    inventory: '完工入库 {物料汇总} {单号}',
    production: '完工结转生产成本 {物料汇总} {单号}',
    labor: '完工结转人工 {物料汇总} {单号}',
    overhead: '完工结转制造费用 {物料汇总} {单号}',
  },
  PS: {
    inventory: '不良品入库 {物料汇总} {单号}',
    production: '不良品入库结转生产成本 {单号}',
    labor: '不良品入库结转人工 {单号}',
    overhead: '不良品入库结转制造费用 {单号}',
  },
  CA: {
    inventory: '结案结转 {物料汇总} {单号}',
    production: '结案结转在制成本 {物料汇总} {单号}',
    labor: '结案结转人工 {单号}',
    overhead: '结案结转制造费用 {单号}',
  },
  AS: { inventory: '组装 {物料汇总} {单号}', production: '组装 {物料汇总} {单号}' },
  DS: { inventory: '拆卸 {物料汇总} {单号}', production: '拆卸 {物料汇总} {单号}' },
  WO: { production: '委外发料 {物料汇总}（{往来单位}）{单号}', inventory: '委外发料 {物料汇总}（{往来单位}）{单号}' },
  WI: {
    inventory: '委外入库 {物料汇总}（{往来单位}）{单号}',
    production: '委外入库结转材料 {物料汇总} {单号}',
    ap: '委外加工费（{往来单位}）{单号}',
    tax_in: '委外加工费进项税额 {单号}',
  },
  OP: {
    overhead: '工序委外加工费（{往来单位}）{单号}',
    tax_in: '工序委外加工费进项税额 {单号}',
    ap: '工序委外加工费（{往来单位}）{单号}',
  },
}

/** 兜底：任何单据类型 / 角色没有配置时 */
export const FALLBACK_SUMMARY_TEMPLATE = '{单号} {物料汇总}'

/** 设置页展示用的单据类型顺序与名称（`RPD` / `RSD` 为有来源单据发票的差额调整凭证） */
export const SUMMARY_DOC_TYPES: Array<{ code: string; name: string }> = [
  { code: 'PI', name: '采购入库' }, { code: 'PR', name: '采购退货' },
  { code: 'SO', name: '销售出库' }, { code: 'SR', name: '销售退货' },
  { code: 'RP', name: '采购发票' }, { code: 'RS', name: '销售发票' },
  { code: 'RPD', name: '采购发票差额调整' }, { code: 'RSD', name: '销售发票差额调整' },
  { code: 'RCV', name: '收款单' }, { code: 'PAY', name: '付款单' },
  { code: 'OI', name: '其他入库' }, { code: 'OO', name: '其他出库' }, { code: 'IS', name: '期初入库' },
  { code: 'PL', name: '生产领用' }, { code: 'PB', name: '补料单' }, { code: 'PJ', name: '退料单' },
  { code: 'PF', name: '完工入库' }, { code: 'PS', name: '不良品入库' }, { code: 'CA', name: '结案结转' },
  { code: 'AS', name: '组装单' }, { code: 'DS', name: '拆卸单' },
  { code: 'WO', name: '委外发货' }, { code: 'WI', name: '委外入库' }, { code: 'OP', name: '工序委外单' },
]

export const SCM_SUMMARY_TEMPLATES_KEY = 'scm:summary_templates'

export interface SummaryAccountRule { doc_type: string; account: string; template: string }
export interface SummarySettings {
  /** 单据类型 → 角色 → 模板（只存与内置不同的） */
  roles: Record<string, Partial<Record<SummaryRole, string>>>
  /** 单据类型（空 = 所有类型）+ 科目编码 → 模板，优先级最高 */
  accounts: SummaryAccountRule[]
}

const ROLE_KEYS = new Set<string>(SUMMARY_ROLES.map(r => r.key))

export function normalizeSummarySettings(raw: unknown): SummarySettings {
  const out: SummarySettings = { roles: {}, accounts: [] }
  if (!raw || typeof raw !== 'object') return out
  const o = raw as any
  if (o.roles && typeof o.roles === 'object' && !Array.isArray(o.roles)) {
    for (const [docType, roles] of Object.entries(o.roles)) {
      if (!roles || typeof roles !== 'object') continue
      for (const [role, tpl] of Object.entries(roles as Record<string, unknown>)) {
        const t = String(tpl ?? '').trim()
        if (!ROLE_KEYS.has(role) || !t) continue
        ;(out.roles[docType] ||= {})[role as SummaryRole] = t.slice(0, 200)
      }
    }
  }
  if (Array.isArray(o.accounts)) {
    for (const r of o.accounts) {
      const account = String(r?.account ?? '').trim()
      const template = String(r?.template ?? '').trim()
      if (!account || !template) continue
      out.accounts.push({ doc_type: String(r?.doc_type ?? '').trim(), account, template: template.slice(0, 200) })
    }
  }
  return out
}

export function loadSummarySettings(db: Database.Database, accountSetId: string): SummarySettings {
  const row = db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(accountSetId, SCM_SUMMARY_TEMPLATES_KEY) as { param_value?: string } | undefined
  if (!row?.param_value) return { roles: {}, accounts: [] }
  try { return normalizeSummarySettings(JSON.parse(row.param_value)) } catch { return { roles: {}, accounts: [] } }
}

/** 模板解析：自定义（科目）> 自定义（角色）> 内置（角色）> 兜底 */
export function resolveSummaryTemplate(
  settings: SummarySettings, docType: string, role: SummaryRole | null, accountCode: string,
): string {
  const byAcc = settings.accounts.find(r => r.account === accountCode && r.doc_type === docType)
    || settings.accounts.find(r => r.account === accountCode && !r.doc_type)
  if (byAcc) return byAcc.template
  if (role) {
    const custom = settings.roles[docType]?.[role]
    if (custom) return custom
    const def = DEFAULT_SUMMARY_TEMPLATES[docType]?.[role]
    if (def) return def
  }
  return FALLBACK_SUMMARY_TEMPLATE
}

export interface SummaryContext {
  doc_no: string
  doc_date: string
  doc_type_name: string
  partner: string
  dept: string
  salesman: string
  warehouse: string
  remark: string
  io_category: string
  items: string[]          // 去重后的物料名称
  qty: number
}

/** 占位符取值；缺值返回空串（渲染时连同相邻括号 / 空格清掉） */
function placeholderValue(key: string, ctx: SummaryContext, accountName: string): string {
  switch (key) {
    case '单号': return ctx.doc_no
    case '日期': return ctx.doc_date
    case '单据类型': return ctx.doc_type_name
    case '往来单位': return ctx.partner
    case '部门': return ctx.dept
    case '业务员': return ctx.salesman
    case '物料': return ctx.items[0] || ''
    case '物料汇总': return ctx.items.length > 1 ? `${ctx.items[0]}等${ctx.items.length}种` : (ctx.items[0] || '')
    case '数量': return ctx.qty ? String(ctx.qty) : ''
    case '仓库': return ctx.warehouse
    case '备注': return ctx.remark
    case '出入库类别': return ctx.io_category
    case '科目': return accountName
    default: return ''
  }
}

/** 渲染：替换 `{占位符}`；空值清掉后，去掉空括号、多余空格；未知占位符原样去掉 */
export function renderSummary(template: string, ctx: SummaryContext, accountName = ''): string {
  let s = template.replace(/\{([^{}]+)\}/g, (_m, k: string) => placeholderValue(k.trim(), ctx, accountName))
  s = s.replace(/[（(]\s*[）)]/g, '')          // 空括号
  s = s.replace(/\s{2,}/g, ' ').trim()
  return s.slice(0, 120)
}

/** 示例上下文：设置页预览没有真实单据时使用 */
export const SAMPLE_SUMMARY_CONTEXT: SummaryContext = {
  doc_no: '202610-SO-001', doc_date: '2026-10-08', doc_type_name: '销售出库',
  partner: '深圳市恒通网络科技有限公司', dept: '销售部', salesman: '张三', warehouse: '配件仓',
  remark: '货款', io_category: '盘盈', items: ['金士顿 16G DDR4 3200', '三星 980 1TB NVMe'], qty: 12,
}

/** 由单据构建上下文（往来单位 / 部门 / 物料名称等按账套档案取名） */
export function buildSummaryContext(
  db: Database.Database, accountSetId: string, doc: any, lines: any[], docTypeName: string,
): SummaryContext {
  // 取名失败（档案表缺失等）只影响摘要措辞，不能拦住制证
  const nameOf = (sql: string, ...p: unknown[]) => {
    try { return ((db.prepare(sql).get(...p) as { name?: string } | undefined)?.name) || '' } catch { return '' }
  }
  const partner = doc.partner_code
    ? nameOf('SELECT name FROM scm_partner WHERE account_set_id=? AND code=?', accountSetId, doc.partner_code) || String(doc.partner_code)
    : ''
  const dept = doc.dept_code
    ? nameOf(
      `SELECT ai.name FROM aux_items ai JOIN aux_categories ac ON ac.id=ai.type
       WHERE ai.account_set_id=? AND ac.code='dept' AND ai.code=? LIMIT 1`, accountSetId, doc.dept_code,
    ) || String(doc.dept_code)
    : ''
  const warehouse = doc.warehouse_code
    ? nameOf('SELECT name FROM scm_warehouse WHERE account_set_id=? AND code=?', accountSetId, doc.warehouse_code) || String(doc.warehouse_code)
    : ''
  const names: string[] = []
  let qty = 0
  for (const l of lines) {
    if (!l.item_code) continue
    const n = nameOf('SELECT name FROM scm_item WHERE account_set_id=? AND code=?', accountSetId, l.item_code) || String(l.item_code)
    if (!names.includes(n)) names.push(n)
    qty += Number(l.qty) || 0
  }
  const finance = doc.doc_type === 'RCV' || doc.doc_type === 'PAY'
  const lineRemark = lines.find(l => l.remark)?.remark
  return {
    doc_no: String(doc.doc_no || ''),
    doc_date: String(doc.doc_date || ''),
    doc_type_name: docTypeName,
    partner,
    dept,
    salesman: String(doc.biz_person || ''),
    warehouse,
    remark: String(lineRemark || doc.remark || (finance ? (doc.doc_type === 'RCV' ? '收款' : '付款') : '')),
    io_category: String(doc.io_category || '其他'),
    items: names,
    qty: Math.round(qty * 10000) / 10000,
  }
}
