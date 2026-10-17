/**
 * 进销存档案批量操作（第六份反馈）：物料 / 往来单位的审核、停用，以及 Excel 导入。
 *
 * - 审核：audit_status draft / audited（迁移 168）。参数 scm:master_audit_required=1 时，
 *   未审核的物料 / 往来单位不能在单据中使用（选择器不列出、保存单据时拦截）；默认关闭。
 * - 停用：enabled=0，选择器不再列出，已有单据不受影响。
 * - 导入：前端把 Excel 解析成「列标签 → 值」的行传上来；先 dry_run 预检逐行报错，再正式导入（单事务）。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { assertLeafAccountCode } from './accountReferences.js'

export type MasterKind = 'item' | 'partner' | 'warehouse'
const TABLE: Record<MasterKind, string> = { item: 'scm_item', partner: 'scm_partner', warehouse: 'scm_warehouse' }
const LABEL: Record<MasterKind, string> = { item: '物料', partner: '往来单位', warehouse: '仓库' }

export const MASTER_AUDIT_REQUIRED_KEY = 'scm:master_audit_required'

export function masterAuditRequired(db: Database.Database, aid: string): boolean {
  try {
    const r = db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?').get(aid, MASTER_AUDIT_REQUIRED_KEY) as any
    return String(r?.param_value ?? '') === '1'
  } catch { return false }
}

/** 已审核档案不能改、不能删，须先反审核。停用 / 启用不走这条。 */
export function masterLockedError(
  kind: 'item' | 'partner',
  auditStatus: string | null | undefined,
  action: 'edit' | 'delete',
): string | null {
  if (auditStatus !== 'audited') return null
  const name = LABEL[kind]
  return action === 'delete' ? `已审核${name}不能删除，请先反审核` : `已审核${name}不能修改，请先反审核`
}

/** 批量审核 / 反审核（只处理物料、往来单位） */
export function setMasterAudit(db: Database.Database, aid: string, kind: 'item' | 'partner', ids: string[], audit: boolean, operator: string) {
  if (!ids.length) throw new Error(`请选择要${audit ? '审核' : '反审核'}的${LABEL[kind]}`)
  const t = TABLE[kind]
  const ph = ids.map(() => '?').join(',')
  const r = audit
    ? db.prepare(`UPDATE ${t} SET audit_status='audited', auditor=?, audited_at=datetime('now','localtime'), updated_at=datetime('now')
        WHERE account_set_id=? AND id IN (${ph}) AND audit_status<>'audited'`).run(operator, aid, ...ids)
    : db.prepare(`UPDATE ${t} SET audit_status='draft', auditor=NULL, audited_at=NULL, updated_at=datetime('now')
        WHERE account_set_id=? AND id IN (${ph}) AND audit_status='audited'`).run(aid, ...ids)
  return { changed: r.changes, skipped: ids.length - r.changes }
}

/** 物料批量改字段：白名单（字段 → 类型） */
export const ITEM_BATCH_FIELDS: Record<string, 'text' | 'number' | 'bool' | 'account' | 'warehouse' | 'partner'> = {
  spec: 'text', item_type: 'text', barcode: 'text', short_code: 'text', remark: 'text',
  purchase_price: 'number', sale_price: 'number', ref_cost: 'number', safety_stock: 'number',
  inv_account: 'account', sale_account: 'account',
  default_warehouse_code: 'warehouse', supplier_code: 'partner',
  batch_flag: 'bool',
}

/** 批量把选中物料的某个字段改为同一个值；已审核的跳过（须先反审核） */
export function batchUpdateItemField(db: Database.Database, aid: string, ids: string[], field: string, value: unknown) {
  if (!ids.length) throw new Error('请选择要修改的物料')
  if (field.startsWith('field_')) return batchUpdateItemCustomField(db, aid, ids, field.slice(6), value)
  const kind = ITEM_BATCH_FIELDS[field]
  if (!kind) throw new Error('该字段不支持批量修改')
  let v: string | number | null
  const s = value === null || value === undefined ? '' : String(value).trim()
  if (kind === 'number') {
    const n = Number(s)
    if (s === '' || !Number.isFinite(n) || n < 0) throw new Error('请输入不小于 0 的数字')
    v = n
  } else if (kind === 'bool') {
    v = value === true || value === 1 || s === '1' || s === 'true' ? 1 : 0
  } else if (s === '') {
    v = null
  } else {
    v = s
    if (kind === 'account') assertLeafAccountCode(db as any, aid, s, field === 'inv_account' ? '存货科目' : '销售收入科目')
    if (kind === 'warehouse' && !db.prepare('SELECT 1 FROM scm_warehouse WHERE account_set_id=? AND code=?').get(aid, s)) throw new Error(`仓库「${s}」不存在`)
    if (kind === 'partner' && !db.prepare('SELECT 1 FROM scm_partner WHERE account_set_id=? AND code=?').get(aid, s)) throw new Error(`往来单位「${s}」不存在`)
  }
  const ph = ids.map(() => '?').join(',')
  // field 来自白名单，可安全拼接
  const r = db.prepare(`UPDATE scm_item SET ${field}=?, updated_at=datetime('now')
      WHERE account_set_id=? AND id IN (${ph}) AND COALESCE(audit_status,'draft')<>'audited'`).run(v, aid, ...ids)
  return { changed: r.changes, skipped: ids.length - r.changes }
}

/** 自定义字段（field_values JSON）批量改值；留空 = 清除该字段 */
function batchUpdateItemCustomField(db: Database.Database, aid: string, ids: string[], key: string, value: unknown) {
  const def = db.prepare('SELECT field_name, field_type FROM scm_item_field_defs WHERE account_set_id=? AND field_key=? AND is_enabled=1').get(aid, key) as any
  if (!def) throw new Error('该自定义字段不存在或已停用')
  const s = value === null || value === undefined ? '' : String(value).trim()
  let v: string | number | null = s === '' ? null : s
  if (v !== null && def.field_type === 'number') {
    const n = Number(s)
    if (!Number.isFinite(n)) throw new Error(`${def.field_name}须为数字`)
    v = n
  }
  const ph = ids.map(() => '?').join(',')
  const base = "COALESCE(NULLIF(field_values,''),'{}')"
  const path = `$."${key.replace(/"/g, '')}"`
  const expr = v === null ? `json_remove(${base}, ?)` : `json_set(${base}, ?, ?)`
  const args = v === null ? [path] : [path, v]
  const r = db.prepare(`UPDATE scm_item SET field_values=${expr}, updated_at=datetime('now')
      WHERE account_set_id=? AND id IN (${ph}) AND COALESCE(audit_status,'draft')<>'audited'`).run(...args, aid, ...ids)
  return { changed: r.changes, skipped: ids.length - r.changes }
}

/** 批量停用 / 启用 */
export function setMasterEnabled(db: Database.Database, aid: string, kind: MasterKind, ids: string[], enabled: boolean) {
  if (!ids.length) throw new Error(`请选择要${enabled ? '启用' : '停用'}的${LABEL[kind]}`)
  const ph = ids.map(() => '?').join(',')
  const hasUpdated = kind !== 'warehouse'
  const r = db.prepare(`UPDATE ${TABLE[kind]} SET enabled=?${hasUpdated ? ", updated_at=datetime('now')" : ''}
      WHERE account_set_id=? AND id IN (${ph}) AND COALESCE(enabled,1)<>?`).run(enabled ? 1 : 0, aid, ...ids, enabled ? 1 : 0)
  return { changed: r.changes, skipped: ids.length - r.changes }
}

/**
 * 单据保存前：参数开启时，引用的物料 / 往来单位必须已审核；停用的不允许新引用
 * （编辑旧单据时原有的引用不拦，只拦本次新出现的编码）。返回错误信息，合格返回 null。
 */
export function masterUsableError(
  db: Database.Database, aid: string,
  refs: { partner_code?: string | null; item_codes: string[] },
  previous?: { partner_code?: string | null; item_codes: string[] },
): string | null {
  try {
    return masterUsableErrorUnsafe(db, aid, refs, previous)
  } catch {
    return null   // 旧库 / 单测库没有 enabled、audit_status 列：不拦
  }
}

function masterUsableErrorUnsafe(
  db: Database.Database, aid: string,
  refs: { partner_code?: string | null; item_codes: string[] },
  previous?: { partner_code?: string | null; item_codes: string[] },
): string | null {
  const prevItems = new Set(previous?.item_codes || [])
  const newItems = [...new Set(refs.item_codes.filter(c => c && !prevItems.has(c)))]
  const newPartner = refs.partner_code && refs.partner_code !== previous?.partner_code ? refs.partner_code : null
  const requireAudit = masterAuditRequired(db, aid)
  if (newPartner) {
    const p = db.prepare('SELECT code, name, enabled, audit_status FROM scm_partner WHERE account_set_id=? AND code=?').get(aid, newPartner) as any
    if (p && Number(p.enabled) === 0) return `往来单位「${p.code} ${p.name || ''}」已停用，不能在单据中使用`
    if (p && requireAudit && p.audit_status !== 'audited') return `往来单位「${p.code} ${p.name || ''}」尚未审核，不能在单据中使用（系统参数：档案须审核后才能使用）`
  }
  if (newItems.length) {
    const rows = db.prepare(`SELECT code, name, enabled, audit_status FROM scm_item WHERE account_set_id=? AND code IN (${newItems.map(() => '?').join(',')})`)
      .all(aid, ...newItems) as any[]
    const off = rows.filter(r => Number(r.enabled) === 0)
    if (off.length) return `物料 ${off.slice(0, 5).map(r => `「${r.code} ${r.name || ''}」`).join('、')} 已停用，不能在单据中使用`
    if (requireAudit) {
      const draft = rows.filter(r => r.audit_status !== 'audited')
      if (draft.length) return `物料 ${draft.slice(0, 5).map(r => `「${r.code} ${r.name || ''}」`).join('、')}${draft.length > 5 ? ` 等 ${draft.length} 个` : ''}尚未审核，不能在单据中使用（系统参数：档案须审核后才能使用）`
    }
  }
  return null
}

// ════════════════════ Excel 导入 ════════════════════

export interface ImportColumnDef { key: string; label: string; required?: boolean; note?: string }

export const ITEM_IMPORT_COLUMNS: ImportColumnDef[] = [
  { key: 'code', label: '物料编码', required: true },
  { key: 'name', label: '物料名称', required: true },
  { key: 'spec', label: '规格型号' },
  { key: 'unit', label: '计量单位', note: '不存在的单位自动新建' },
  { key: 'item_type', label: '物料属性', note: '填名称，如 原辅材料 / 半成品 / 成品' },
  { key: 'parent_code', label: '上级物料编码', note: '留空为一级' },
  { key: 'barcode', label: '条形码' },
  { key: 'short_code', label: '简码' },
  { key: 'purchase_price', label: '进价' },
  { key: 'sale_price', label: '售价' },
  { key: 'ref_cost', label: '参考成本' },
  { key: 'inv_account', label: '存货科目', note: '末级科目编码' },
  { key: 'sale_account', label: '收入科目', note: '末级科目编码' },
  { key: 'default_warehouse_code', label: '默认仓库', note: '仓库编码或名称' },
  { key: 'supplier_code', label: '默认供应商', note: '往来单位编码' },
  { key: 'batch_flag', label: '批次管理', note: '是 / 否' },
  { key: 'safety_stock', label: '安全库存' },
  { key: 'remark', label: '备注' },
]

export const PARTNER_IMPORT_COLUMNS: ImportColumnDef[] = [
  { key: 'code', label: '单位编码', required: true },
  { key: 'name', label: '单位名称', required: true },
  { key: 'short_name', label: '简称' },
  { key: 'partner_type', label: '类型', note: '客户 / 供应商 / 客户兼供应商；留空按导入入口' },
  { key: 'contact', label: '联系人' },
  { key: 'phone', label: '电话' },
  { key: 'address', label: '地址' },
  { key: 'tax_no', label: '税号' },
  { key: 'bank_name', label: '开户行' },
  { key: 'bank_account', label: '银行账号' },
  { key: 'tax_rate', label: '税率(%)' },
  { key: 'credit_days', label: '账期(天)' },
  { key: 'credit_limit', label: '信用额度' },
  { key: 'ar_account', label: '应收科目', note: '末级科目编码' },
  { key: 'ap_account', label: '应付科目', note: '末级科目编码' },
  { key: 'salesman', label: '业务员' },
  { key: 'email', label: '邮箱' },
  { key: 'remark', label: '备注' },
]

export interface ImportIssue { row: number; code: string; message: string }
export interface ImportResult { total: number; inserted: number; updated: number; skipped: number; issues: ImportIssue[] }

const str = (v: unknown) => { const s = String(v ?? '').trim(); return s || null }
const num = (v: unknown) => { const s = String(v ?? '').replace(/[,，\s]/g, ''); if (!s) return 0; const n = Number(s); return Number.isFinite(n) ? n : NaN }

/** 行对象：按列标签或 key 取值（前端按表头原样传来） */
function pick(row: Record<string, unknown>, col: ImportColumnDef) {
  if (col.label in row) return row[col.label]
  if (col.key in row) return row[col.key]
  // 表头带「*」必填标记
  const star = `${col.label}*`
  return star in row ? row[star] : undefined
}

function accountChecker(db: Database.Database, aid: string) {
  const cache = new Map<string, string | null>()
  return (code: string | null, label: string): string | null => {
    if (!code) return null
    if (!cache.has(code)) {
      try { assertLeafAccountCode(db as any, aid, code, label); cache.set(code, null) } catch (e: any) { cache.set(code, e.message) }
    }
    return cache.get(code) || null
  }
}

function itemTypeLookup(db: Database.Database, aid: string) {
  const map = new Map<string, string>([['原辅材料', '0'], ['原材料', '0'], ['半成品', '6'], ['成品', '9']])
  try {
    const r = db.prepare("SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='scm:item_types'").get(aid) as any
    const custom = r?.param_value ? JSON.parse(r.param_value) : {}
    for (const [k, v] of Object.entries(custom)) map.set(String(v), k)
  } catch { /* 用内置 */ }
  return (v: string | null) => {
    if (!v) return { code: null as string | null }
    if (map.has(v)) return { code: map.get(v)! }
    if ([...map.values()].includes(v)) return { code: v }
    return { error: `物料属性「${v}」不存在，请先在「物料类型」中维护` }
  }
}

export function importItems(
  db: Database.Database, aid: string, rows: Array<Record<string, unknown>>,
  opts: { conflict: 'skip' | 'overwrite'; dryRun: boolean; partial?: boolean },
): ImportResult {
  const result: ImportResult = { total: rows.length, inserted: 0, updated: 0, skipped: 0, issues: [] }
  const checkAccount = accountChecker(db, aid)
  const typeOf = itemTypeLookup(db, aid)
  const existing = new Map((db.prepare('SELECT id, code, level, audit_status FROM scm_item WHERE account_set_id=?').all(aid) as any[]).map(r => [r.code, r]))
  const warehouses = db.prepare('SELECT code, name FROM scm_warehouse WHERE account_set_id=?').all(aid) as any[]
  const partners = new Set((db.prepare('SELECT code FROM scm_partner WHERE account_set_id=?').all(aid) as any[]).map(r => r.code))
  const seen = new Map<string, number>()
  type Prepared = { rowNo: number; code: string; v: Record<string, any>; parent: string | null; unit: string | null }
  const ok: Prepared[] = []

  rows.forEach((raw, idx) => {
    const rowNo = Number(raw._row) || idx + 2   // Excel 行号（第 1 行是表头；前端跳过空行时带 _row）
    const get = (key: string) => pick(raw, ITEM_IMPORT_COLUMNS.find(c => c.key === key)!)
    const code = str(get('code')) || ''
    const errs: string[] = []
    if (!code) errs.push('物料编码不能为空')
    const name = str(get('name'))
    if (!name) errs.push('物料名称不能为空')
    if (code && seen.has(code)) errs.push(`编码与第 ${seen.get(code)} 行重复`)
    if (code) seen.set(code, rowNo)
    const t = typeOf(str(get('item_type')))
    if ('error' in t && t.error) errs.push(t.error)
    const nums: Record<string, number> = {}
    for (const k of ['purchase_price', 'sale_price', 'ref_cost', 'safety_stock']) {
      const n = num(get(k)); if (Number.isNaN(n)) errs.push(`${ITEM_IMPORT_COLUMNS.find(c => c.key === k)!.label}不是数字`); nums[k] = Number.isNaN(n) ? 0 : n
    }
    const inv = str(get('inv_account')); const sale = str(get('sale_account'))
    for (const [c, l] of [[inv, '存货科目'], [sale, '收入科目']] as const) { const e = checkAccount(c, l); if (e) errs.push(e) }
    const whText = str(get('default_warehouse_code'))
    const wh = whText ? warehouses.find(w => w.code === whText || w.name === whText) : null
    if (whText && !wh) errs.push(`仓库「${whText}」不存在`)
    const sup = str(get('supplier_code'))
    if (sup && !partners.has(sup)) errs.push(`默认供应商「${sup}」不存在`)
    const parent = str(get('parent_code'))
    if (parent && parent === code) errs.push('上级物料不能是自己')
    if (parent && !existing.has(parent) && !rows.some(r => str(pick(r, ITEM_IMPORT_COLUMNS[0])) === parent)) errs.push(`上级物料「${parent}」不存在`)
    const batch = str(get('batch_flag'))
    if (existing.get(code)?.audit_status === 'audited' && opts.conflict !== 'skip') errs.push('已审核物料不能覆盖导入，请先反审核')
    if (errs.length) { result.issues.push({ row: rowNo, code, message: errs.join('；') }); return }
    if (existing.has(code) && opts.conflict === 'skip') { result.skipped++; return }
    ok.push({
      rowNo, code, parent, unit: str(get('unit')),
      v: {
        name, spec: str(get('spec')), item_type: (t as any).code ?? null, barcode: str(get('barcode')), short_code: str(get('short_code')),
        purchase_price: nums.purchase_price, sale_price: nums.sale_price, ref_cost: nums.ref_cost, safety_stock: nums.safety_stock,
        inv_account: inv, sale_account: sale, default_warehouse_code: wh?.code ?? null, supplier_code: sup,
        batch_flag: batch && /^(是|y|yes|1|true|启用)$/i.test(batch) ? 1 : 0, remark: str(get('remark')),
      },
    })
  })
  // 预检返回将新增 / 覆盖的数量；正式导入有错误行时默认整批不落库；partial=true 时只导入通过校验的行，错误行列入 issues
  if (opts.dryRun || (result.issues.length && !opts.partial)) {
    if (opts.dryRun) {
      result.inserted = ok.filter(p => !existing.has(p.code)).length
      result.updated = ok.filter(p => existing.has(p.code)).length
    }
    return result
  }

  const unitByName = db.prepare('SELECT code FROM scm_unit WHERE account_set_id=? AND name=?')
  const unitCodes = db.prepare('SELECT code FROM scm_unit WHERE account_set_id=?')
  const insUnit = db.prepare('INSERT INTO scm_unit (id, account_set_id, code, name) VALUES (?,?,?,?)')
  const delItemUnit = db.prepare('DELETE FROM scm_item_unit WHERE account_set_id=? AND item_code=?')
  const insItemUnit = db.prepare('INSERT INTO scm_item_unit (id, account_set_id, item_code, unit_code, is_primary, conversion_rate) VALUES (?,?,?,?,1,1)')
  const ins = db.prepare(`INSERT INTO scm_item (id, account_set_id, code, name, spec, unit, item_type, barcode, short_code,
      purchase_price, sale_price, ref_cost, safety_stock, inv_account, sale_account, default_warehouse_code, supplier_code,
      batch_flag, remark, enabled, parent_id, level, is_leaf, field_values, audit_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,1,'{}','draft')`)
  const upd = db.prepare(`UPDATE scm_item SET name=?, spec=?, unit=?, item_type=?, barcode=?, short_code=?,
      purchase_price=?, sale_price=?, ref_cost=?, safety_stock=?, inv_account=?, sale_account=?, default_warehouse_code=?, supplier_code=?,
      batch_flag=?, remark=?, parent_id=?, level=?, updated_at=datetime('now') WHERE id=?`)
  const getItem = db.prepare('SELECT id, level FROM scm_item WHERE account_set_id=? AND code=?')
  const markParent = db.prepare('UPDATE scm_item SET is_leaf=0 WHERE id=?')
  db.transaction(() => {
    let seq = 0
    for (const r of unitCodes.all(aid) as any[]) { const m = String(r.code).match(/^UN(\d+)$/); if (m) seq = Math.max(seq, Number(m[1])) }
    const ensureUnit = (name: string | null) => {
      if (!name) return null
      const ex = unitByName.get(aid, name) as any
      if (ex) return ex.code as string
      seq++; const code = `UN${String(seq).padStart(4, '0')}`
      insUnit.run(uuidv4(), aid, code, name)
      return code
    }
    // 先上级后下级：上级在同一文件里时按出现顺序多轮处理
    const pending = [...ok]
    for (let round = 0; pending.length && round < 10; round++) {
      for (let i = 0; i < pending.length;) {
        const p = pending[i]
        const parentRow = p.parent ? getItem.get(aid, p.parent) as any : null
        if (p.parent && !parentRow) { i++; continue }
        const level = parentRow ? (Number(parentRow.level) || 1) + 1 : 1
        const unitCode = ensureUnit(p.unit)
        const v = p.v
        const cur = getItem.get(aid, p.code) as any
        if (cur) {
          upd.run(v.name, v.spec, p.unit, v.item_type, v.barcode, v.short_code, v.purchase_price, v.sale_price, v.ref_cost, v.safety_stock,
            v.inv_account, v.sale_account, v.default_warehouse_code, v.supplier_code, v.batch_flag, v.remark, parentRow?.id ?? null, level, cur.id)
          result.updated++
        } else {
          ins.run(uuidv4(), aid, p.code, v.name, v.spec, p.unit, v.item_type, v.barcode, v.short_code, v.purchase_price, v.sale_price, v.ref_cost,
            v.safety_stock, v.inv_account, v.sale_account, v.default_warehouse_code, v.supplier_code, v.batch_flag, v.remark, parentRow?.id ?? null, level)
          result.inserted++
        }
        if (parentRow) markParent.run(parentRow.id)
        if (unitCode) { delItemUnit.run(aid, p.code); insItemUnit.run(uuidv4(), aid, p.code, unitCode) }
        pending.splice(i, 1)
      }
    }
    for (const p of pending) result.issues.push({ row: p.rowNo, code: p.code, message: `上级物料「${p.parent}」未能导入` })
    if (pending.length && !opts.partial) throw new Error('存在无法确定上级的物料，已整体回滚')
  })()
  return result
}

const PARTNER_TYPE_TEXT: Record<string, 'customer' | 'supplier' | 'both'> = {
  客户: 'customer', customer: 'customer', 供应商: 'supplier', supplier: 'supplier',
  客户兼供应商: 'both', 双向: 'both', both: 'both', 客户及供应商: 'both',
}

export function importPartners(
  db: Database.Database, aid: string, rows: Array<Record<string, unknown>>,
  opts: { conflict: 'skip' | 'overwrite'; dryRun: boolean; partial?: boolean; defaultType?: 'customer' | 'supplier' | 'both' },
): ImportResult {
  const result: ImportResult = { total: rows.length, inserted: 0, updated: 0, skipped: 0, issues: [] }
  const checkAccount = accountChecker(db, aid)
  const existing = new Map((db.prepare('SELECT id, code FROM scm_partner WHERE account_set_id=?').all(aid) as any[]).map(r => [r.code, r.id]))
  const audited = new Set((db.prepare("SELECT code FROM scm_partner WHERE account_set_id=? AND audit_status='audited'").all(aid) as any[]).map(r => r.code))
  const seen = new Map<string, number>()
  const ok: Array<{ code: string; v: Record<string, any> }> = []
  rows.forEach((raw, idx) => {
    const rowNo = Number(raw._row) || idx + 2
    const get = (key: string) => pick(raw, PARTNER_IMPORT_COLUMNS.find(c => c.key === key)!)
    const code = str(get('code')) || ''
    const errs: string[] = []
    if (!code) errs.push('单位编码不能为空')
    const name = str(get('name'))
    if (!name) errs.push('单位名称不能为空')
    if (code && seen.has(code)) errs.push(`编码与第 ${seen.get(code)} 行重复`)
    if (code) seen.set(code, rowNo)
    const typeText = str(get('partner_type'))
    const ptype = typeText ? PARTNER_TYPE_TEXT[typeText] : (opts.defaultType || 'both')
    if (!ptype) errs.push(`类型「${typeText}」无效，请填 客户 / 供应商 / 客户兼供应商`)
    const nums: Record<string, number> = {}
    for (const k of ['tax_rate', 'credit_days', 'credit_limit']) {
      const n = num(get(k)); if (Number.isNaN(n)) errs.push(`${PARTNER_IMPORT_COLUMNS.find(c => c.key === k)!.label}不是数字`); nums[k] = Number.isNaN(n) ? 0 : n
    }
    const ar = str(get('ar_account')); const ap = str(get('ap_account'))
    for (const [c, l] of [[ar, '应收科目'], [ap, '应付科目']] as const) { const e = checkAccount(c, l); if (e) errs.push(e) }
    if (audited.has(code) && opts.conflict !== 'skip') errs.push('已审核往来单位不能覆盖导入，请先反审核')
    if (errs.length) { result.issues.push({ row: rowNo, code, message: errs.join('；') }); return }
    if (existing.has(code) && opts.conflict === 'skip') { result.skipped++; return }
    ok.push({
      code,
      v: {
        name, short_name: str(get('short_name')), partner_type: ptype, contact: str(get('contact')), phone: str(get('phone')),
        address: str(get('address')), tax_no: str(get('tax_no')), bank_name: str(get('bank_name')), bank_account: str(get('bank_account')),
        tax_rate: nums.tax_rate, credit_days: Math.trunc(nums.credit_days), credit_limit: nums.credit_limit,
        ar_account: ar, ap_account: ap, salesman: str(get('salesman')), email: str(get('email')), remark: str(get('remark')),
      },
    })
  })
  // 预检返回将新增 / 覆盖的数量；正式导入有错误行时默认整批不落库；partial=true 时只导入通过校验的行，错误行列入 issues
  if (opts.dryRun || (result.issues.length && !opts.partial)) {
    if (opts.dryRun) {
      result.inserted = ok.filter(p => !existing.has(p.code)).length
      result.updated = ok.filter(p => existing.has(p.code)).length
    }
    return result
  }
  const cols = ['name', 'short_name', 'partner_type', 'contact', 'phone', 'address', 'tax_no', 'bank_name', 'bank_account',
    'tax_rate', 'credit_days', 'credit_limit', 'ar_account', 'ap_account', 'salesman', 'email', 'remark']
  const ins = db.prepare(`INSERT INTO scm_partner (id, account_set_id, code, ${cols.join(', ')}, enabled, audit_status)
    VALUES (?,?,?,${cols.map(() => '?').join(',')},1,'draft')`)
  const upd = db.prepare(`UPDATE scm_partner SET ${cols.map(c => `${c}=?`).join(', ')}, updated_at=datetime('now') WHERE id=?`)
  db.transaction(() => {
    for (const p of ok) {
      const vals = cols.map(c => p.v[c])
      const id = existing.get(p.code)
      if (id) { upd.run(...vals, id); result.updated++ }
      else { ins.run(uuidv4(), aid, p.code, ...vals); result.inserted++ }
    }
  })()
  return result
}
