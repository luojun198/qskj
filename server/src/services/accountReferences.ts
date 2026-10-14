/**
 * 科目引用登记表：集中登记「设置类」里存放的科目编码，供三处共用：
 *   1. 父科目新增第一个子科目时，把设置自动改指该子科目（repointAccountReferences）；
 *   2. 全局检测 / 一键修复：设置指向了有下级的科目（auditNonLeafReferences / normalizeNonLeafReferences）；
 *   3. 删除科目前的引用检查（findAccountReferences）。
 *
 * 背景（FIX-336）：资产类别配置 1601，1601 后来有了下级，设置仍指向父科目，生成凭证记到父科目上，
 * 余额表按末级汇总而丢失这笔金额，试算不平。
 *
 * 不登记：历史快照（scm_ar_ap_log 等）、按编码前缀展开而对父科目安全的（报表公式、看板规则、静态现金流映射）。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

type Db = Database.Database

interface ColumnRef {
  label: string
  table: string
  column: string
  /** 追加的过滤条件（不带 AND） */
  where?: string
  /** 数据类引用（随分录迁移，不参与全局检测/自动修复，只在迁移父科目数据时同步） */
  data?: boolean
}

const COLUMN_REFS: ColumnRef[] = [
  { label: '资产类别：固定资产科目', table: 'fixed_asset_category', column: 'account_code' },
  { label: '资产类别：累计折旧科目', table: 'fixed_asset_category', column: 'depr_account_code' },
  { label: '资产类别：减值准备科目', table: 'fixed_asset_category', column: 'impairment_account_code' },
  { label: '资产类别：清理科目', table: 'fixed_asset_category', column: 'clearing_account_code' },
  { label: '资产用途：折旧费用科目', table: 'fixed_asset_purpose', column: 'expense_account' },
  { label: '物料：存货科目', table: 'scm_item', column: 'inv_account' },
  { label: '物料：销售收入科目', table: 'scm_item', column: 'sale_account' },
  { label: '往来单位：应收科目', table: 'scm_partner', column: 'ar_account' },
  { label: '往来单位：应付科目', table: 'scm_partner', column: 'ap_account' },
  { label: '自动转账：转入科目', table: 'transfer_items', column: 'to_code' },
  { label: '草稿单据：结算账户', table: 'scm_doc', column: 'settle_account', where: "status='draft'" },
  // 出纳数据：迁移父科目分录时同步，保证出纳与总账挂在同一科目上
  { label: '出纳日记账', table: 'cashier_journal', column: 'account_code', data: true },
  { label: '出纳期初', table: 'cashier_init_balance', column: 'account_code', data: true },
  { label: '银行对账单', table: 'bank_statement', column: 'account_code', data: true },
  { label: '出纳总账对账批次', table: 'cashier_gl_match', column: 'account_code', data: true },
  // 出纳独立账户：关联科目算引用；与科目同编码的账户编码随出纳流水一起迁移，保证账户与流水对得上
  { label: '出纳账户：关联科目', table: 'cashier_account', column: 'gl_account_code' },
  { label: '出纳账户编码', table: 'cashier_account', column: 'code', data: true },
]

const PARAM_REFS: Array<{ key: string; label: string }> = [
  { key: 'asset:inventory_surplus_account', label: '资产参数：盘盈科目' },
  { key: 'asset:inventory_deficit_account', label: '资产参数：盘亏科目' },
  { key: 'asset:disposal_bank_account', label: '资产参数：处置收款科目' },
  { key: 'asset:disposal_gain_account', label: '资产参数：处置收益科目' },
  { key: 'asset:disposal_loss_account', label: '资产参数：处置损失科目' },
  { key: 'asset:impairment_loss_account', label: '资产参数：减值损失科目' },
  { key: 'scm:acc_ap', label: '进销存参数：应付账款' },
  { key: 'scm:acc_ar', label: '进销存参数：应收账款' },
  { key: 'scm:acc_revenue', label: '进销存参数：主营业务收入' },
  { key: 'scm:acc_cost', label: '进销存参数：主营业务成本' },
  { key: 'scm:acc_other', label: '进销存参数：其他出入库对方科目' },
  { key: 'scm:acc_production', label: '进销存参数：生产成本' },
  { key: 'scm:acc_labor', label: '进销存参数：应付职工薪酬' },
  { key: 'scm:acc_overhead', label: '进销存参数：制造费用' },
  { key: 'scm:acc_process_income', label: '进销存参数：受托加工收入' },
  { key: 'scm:acc_tax_input', label: '进销存参数：进项税额' },
  { key: 'scm:acc_tax_output', label: '进销存参数：销项税额' },
  { key: 'auto_transfer:balance_account_code', label: '自动转账参数：结转余额科目' },
  { key: 'auto_transfer:surplus_account_code', label: '自动转账参数：本年利润科目' },
  { key: 'cashier:default_counter_account', label: '出纳参数：默认对方科目' },
  { key: 'exchange_gain_account_code', label: '外币参数：汇兑损益科目' },
]

export interface AccountReferenceHit {
  label: string
  /** 设置位置：表.列 或 参数 key */
  where: string
  /** 当前引用的科目编码 */
  value: string
  count: number
}

export interface NonLeafReferenceIssue extends AccountReferenceHit {
  /** nonleaf=指向有下级的科目（可一键改指）；missing=指向本账套不存在的科目（需手工设置） */
  kind: 'nonleaf' | 'missing'
  /** 建议改指的末级科目（missing 时为空） */
  suggested: string
  suggestedName: string
}

export interface RepointResult {
  total: number
  items: Array<{ label: string; count: number }>
}

const tableCache = new WeakMap<Db, Map<string, boolean>>()

function hasColumn(db: Db, table: string, column: string): boolean {
  let m = tableCache.get(db)
  if (!m) { m = new Map(); tableCache.set(db, m) }
  const k = `${table}.${column}`
  const hit = m.get(k)
  if (hit !== undefined) return hit
  const ok = !!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name=?').get(table, column)
  m.set(k, ok)
  return ok
}

/** 科目是否有下级 */
function hasChild(db: Db, accountSetId: string, code: string): boolean {
  if (!hasColumn(db, 'accounts', 'parent_id')) return false
  return !!db.prepare(
    `SELECT 1 FROM accounts a WHERE a.account_set_id=? AND a.code=?
       AND EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id=a.id) LIMIT 1`
  ).get(accountSetId, code)
}

/**
 * 沿「第一个子科目」一路走到末级（与新增首个子科目时的继承口径一致）：
 * 优先取启用的，其次按编码顺序。没有下级则返回 null。
 */
export function firstLeafDescendant(db: Db, accountSetId: string, code: string): { code: string; name: string } | null {
  let cur = db.prepare('SELECT id, code, name FROM accounts WHERE account_set_id=? AND code=?').get(accountSetId, code) as any
  if (!cur) return null
  let moved = false
  for (let i = 0; i < 20; i++) {
    const kid = db.prepare(
      'SELECT id, code, name FROM accounts WHERE account_set_id=? AND parent_id=? ORDER BY is_enabled DESC, code LIMIT 1'
    ).get(accountSetId, cur.id) as any
    if (!kid) break
    cur = kid
    moved = true
  }
  return moved ? { code: cur.code, name: cur.name } : null
}

function columnRefs(db: Db, includeData: boolean): ColumnRef[] {
  return COLUMN_REFS.filter(r => (includeData || !r.data) && hasColumn(db, r.table, r.column) && hasColumn(db, r.table, 'account_set_id'))
}

function paramTableOk(db: Db): boolean {
  return hasColumn(db, 'system_params', 'param_key')
}

/** 某科目被哪些设置引用（删除科目前的检查；含出纳数据） */
export function findAccountReferences(db: Db, accountSetId: string, code: string): AccountReferenceHit[] {
  const hits: AccountReferenceHit[] = []
  for (const r of columnRefs(db, true)) {
    const n = (db.prepare(
      `SELECT COUNT(*) n FROM ${r.table} WHERE account_set_id=? AND ${r.column}=?${r.where ? ` AND ${r.where}` : ''}`
    ).get(accountSetId, code) as any).n
    if (n > 0) hits.push({ label: r.label, where: `${r.table}.${r.column}`, value: code, count: n })
  }
  if (paramTableOk(db)) {
    for (const p of PARAM_REFS) {
      const n = (db.prepare(
        'SELECT COUNT(*) n FROM system_params WHERE account_set_id=? AND param_key=? AND param_value=?'
      ).get(accountSetId, p.key, code) as any).n
      if (n > 0) hits.push({ label: p.label, where: p.key, value: code, count: n })
    }
  }
  const tplCount = countTemplateEntries(db, accountSetId, code)
  if (tplCount > 0) hits.push({ label: '凭证模板分录', where: 'voucher_templates.entries_data', value: code, count: tplCount })
  return hits
}

function readTemplates(db: Db, accountSetId: string): Array<{ id: string; entries: any[] }> {
  if (!hasColumn(db, 'voucher_templates', 'entries_data')) return []
  const rows = db.prepare('SELECT id, entries_data FROM voucher_templates WHERE account_set_id=?').all(accountSetId) as any[]
  const out: Array<{ id: string; entries: any[] }> = []
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.entries_data || '[]')
      if (Array.isArray(arr)) out.push({ id: r.id, entries: arr })
    } catch { /* 损坏的模板不处理 */ }
  }
  return out
}

function countTemplateEntries(db: Db, accountSetId: string, code: string): number {
  let n = 0
  for (const t of readTemplates(db, accountSetId)) n += t.entries.filter(e => e && e.account_code === code).length
  return n
}

/**
 * 把登记表内所有指向 fromCode 的设置改指 toCode。
 * @param opts.includeData 同步出纳等数据类引用（父科目分录随之迁移时传 true）
 */
export function repointAccountReferences(
  db: Db,
  accountSetId: string,
  fromCode: string,
  toCode: string,
  opts: { includeData?: boolean } = {}
): RepointResult {
  const items: RepointResult['items'] = []
  const to = db.prepare('SELECT id, code, name FROM accounts WHERE account_set_id=? AND code=?').get(accountSetId, toCode) as any
  if (!to) throw new Error(`改指目标科目不存在：${toCode}`)

  for (const r of columnRefs(db, !!opts.includeData)) {
    const res = db.prepare(
      `UPDATE ${r.table} SET ${r.column}=? WHERE account_set_id=? AND ${r.column}=?${r.where ? ` AND ${r.where}` : ''}`
    ).run(toCode, accountSetId, fromCode)
    if (res.changes > 0) items.push({ label: r.label, count: res.changes })
  }
  if (paramTableOk(db)) {
    for (const p of PARAM_REFS) {
      const res = db.prepare(
        'UPDATE system_params SET param_value=? WHERE account_set_id=? AND param_key=? AND param_value=?'
      ).run(toCode, accountSetId, p.key, fromCode)
      if (res.changes > 0) items.push({ label: p.label, count: res.changes })
    }
  }
  // 凭证模板：分录 JSON 里同时存 id/code/name，三者一起改
  let tplChanged = 0
  for (const t of readTemplates(db, accountSetId)) {
    let touched = 0
    for (const e of t.entries) {
      if (e && e.account_code === fromCode) { e.account_id = to.id; e.account_code = to.code; e.account_name = to.name; touched++ }
    }
    if (touched) {
      db.prepare('UPDATE voucher_templates SET entries_data=? WHERE id=?').run(JSON.stringify(t.entries), t.id)
      tplChanged += touched
    }
  }
  if (tplChanged) items.push({ label: '凭证模板分录', count: tplChanged })

  return { total: items.reduce((s, i) => s + i.count, 0), items }
}

/** 科目授权：父科目以「不含下级」授权的，新子科目补授权，避免被授权人突然看不到原科目的数据 */
export function inheritAccountScopes(db: Db, accountSetId: string, parentId: string, childId: string): number {
  let n = 0
  for (const [table, owner] of [['role_account_scopes', 'role_id'], ['user_account_scopes', 'user_id']] as const) {
    if (!hasColumn(db, table, owner)) continue
    const rows = db.prepare(
      `SELECT ${owner} AS owner FROM ${table} WHERE account_set_id=? AND account_id=? AND include_children=0`
    ).all(accountSetId, parentId) as any[]
    for (const r of rows) {
      const exists = db.prepare(`SELECT 1 FROM ${table} WHERE account_set_id=? AND ${owner}=? AND account_id=?`).get(accountSetId, r.owner, childId)
      if (exists) continue
      db.prepare(
        `INSERT INTO ${table} (id, ${owner}, account_set_id, account_id, include_children) VALUES (?,?,?,?,0)`
      ).run(uuidv4(), r.owner, accountSetId, childId)
      n++
    }
  }
  return n
}

/** 全局检测：登记表里所有值为「有下级科目」的设置（不含数据类引用） */
export function auditNonLeafReferences(db: Db, accountSetId: string): NonLeafReferenceIssue[] {
  const issues: NonLeafReferenceIssue[] = []
  const suggest = (value: string) => {
    if (!hasChild(db, accountSetId, value)) return null
    return firstLeafDescendant(db, accountSetId, value)
  }
  const exists = db.prepare('SELECT 1 FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
  const push = (base: AccountReferenceHit) => {
    if (!exists.get(accountSetId, base.value)) {
      issues.push({ ...base, kind: 'missing', suggested: '', suggestedName: '' })
      return
    }
    const s = suggest(base.value)
    if (s) issues.push({ ...base, kind: 'nonleaf', suggested: s.code, suggestedName: s.name })
  }
  for (const r of columnRefs(db, false)) {
    const rows = db.prepare(
      `SELECT ${r.column} v, COUNT(*) n FROM ${r.table}
        WHERE account_set_id=? AND ${r.column} IS NOT NULL AND ${r.column}<>''${r.where ? ` AND ${r.where}` : ''}
        GROUP BY ${r.column}`
    ).all(accountSetId) as any[]
    for (const row of rows) push({ label: r.label, where: `${r.table}.${r.column}`, value: String(row.v), count: row.n })
  }
  if (paramTableOk(db)) {
    for (const p of PARAM_REFS) {
      const row = db.prepare(
        "SELECT param_value v FROM system_params WHERE account_set_id=? AND param_key=? AND param_value<>''"
      ).get(accountSetId, p.key) as any
      if (row?.v) push({ label: p.label, where: p.key, value: String(row.v), count: 1 })
    }
  }
  const tplValues = new Map<string, number>()
  for (const t of readTemplates(db, accountSetId)) {
    for (const e of t.entries) if (e?.account_code) tplValues.set(e.account_code, (tplValues.get(e.account_code) || 0) + 1)
  }
  for (const [value, count] of tplValues) push({ label: '凭证模板分录', where: 'voucher_templates.entries_data', value, count })
  return issues
}

/** 一键修复：每个有下级的引用值，统一改指其第一个末级子科目（幂等） */
export function normalizeNonLeafReferences(db: Db, accountSetId: string): RepointResult {
  const values = new Map<string, string>()
  for (const i of auditNonLeafReferences(db, accountSetId)) if (i.kind === 'nonleaf') values.set(i.value, i.suggested)
  const merged = new Map<string, number>()
  for (const [from, to] of values) {
    for (const it of repointAccountReferences(db, accountSetId, from, to).items) {
      merged.set(it.label, (merged.get(it.label) || 0) + it.count)
    }
  }
  const items = [...merged].map(([label, count]) => ({ label, count }))
  return { total: items.reduce((s, i) => s + i.count, 0), items }
}

/** 保存设置时的统一校验：科目存在且为末级；空值放行 */
export function assertLeafAccountCode(db: Db, accountSetId: string, code: string | null | undefined, label: string): void {
  const c = String(code ?? '').trim()
  if (!c) return
  const row = db.prepare('SELECT code, name FROM accounts WHERE account_set_id=? AND code=?').get(accountSetId, c) as any
  if (!row) throw new Error(`${label}：科目 ${c} 不存在`)
  if (hasChild(db, accountSetId, c)) throw new Error(`${label}：科目【${c} ${row.name}】有下级科目，请选择末级科目`)
}

/** 批量校验：返回第一个不合格设置的提示，全部合格返回 null（路由里直接 400） */
export function firstNonLeafError(
  db: Db,
  accountSetId: string,
  pairs: Array<[code: string | null | undefined, label: string]>
): string | null {
  for (const [code, label] of pairs) {
    try { assertLeafAccountCode(db, accountSetId, code, label) } catch (e: any) { return e.message }
  }
  return null
}
