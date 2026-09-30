/**
 * SCM 单据 Excel 批量导入：解析后的行 → 按「分组号」合并为单据 → 匹配物料/往来单位/仓库 → 校验。
 * 纯逻辑，不落库；落库由路由复用 createDocHandler 完成。
 */

/** 支持导入的单据类型（物料明细型；收付款、生产、盘点等有专用流程的不在此列） */
export const IMPORT_DOC_TYPES = ['IS', 'OI', 'OO', 'PI', 'PR', 'PO', 'PQ', 'SO', 'SR', 'SOa', 'SQ'] as const

/** 必填往来单位及其角色 */
const PARTNER_ROLE: Record<string, 'supplier' | 'customer'> = {
  PI: 'supplier', PR: 'supplier', PO: 'supplier', PQ: 'supplier',
  SO: 'customer', SR: 'customer', SOa: 'customer', SQ: 'customer',
}

export interface ImportColumn { key: string; label: string; required?: boolean; note?: string }

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'group_no', label: '单据分组号', note: '相同分组号的行合成一张单据；留空则每行一张' },
  { key: 'doc_date', label: '单据日期', note: 'YYYY-MM-DD，留空为今天' },
  { key: 'partner', label: '往来单位', note: '编码或名称（进出库类必填）' },
  { key: 'warehouse', label: '仓库', note: '编码或名称；留空则审核时按物料默认仓库补齐' },
  { key: 'remark', label: '单据备注' },
  { key: 'item', label: '物料', required: true, note: '编码或名称' },
  { key: 'qty', label: '数量', required: true },
  { key: 'price', label: '单价' },
  { key: 'tax_rate', label: '税率(%)' },
  { key: 'batch_no', label: '批号' },
  { key: 'produce_date', label: '生产日期' },
  { key: 'expire_date', label: '有效期至' },
  { key: 'line_remark', label: '明细备注' },
]

export interface ImportIssue { row: number; group_no: string; message: string }

export interface ImportDoc {
  group_no: string
  doc_type: string
  doc_date: string
  partner_code: string | null
  partner_name: string
  warehouse_code: string | null
  remark: string
  rows: number[]
  lines: Array<Record<string, any>>
  total_qty: number
  total_amount: number
}

interface DbLike { prepare(sql: string): { all(...p: any[]): any[] } }

interface DictEntry { code: string; name: string; short_name?: string; partner_type?: string; unit?: string; spec?: string }

function buildLookup(rows: DictEntry[]) {
  const byCode = new Map<string, DictEntry>()
  const byName = new Map<string, DictEntry[]>()
  for (const r of rows) {
    byCode.set(r.code, r)
    for (const n of [r.name, r.short_name]) {
      const k = String(n || '').trim()
      if (!k) continue
      const arr = byName.get(k) || []
      if (!arr.includes(r)) arr.push(r)
      byName.set(k, arr)
    }
  }
  return {
    /** 先按编码精确匹配，再按名称；名称重名视为歧义 */
    find(text: string): { entry?: DictEntry; error?: string } {
      const k = text.trim()
      const c = byCode.get(k)
      if (c) return { entry: c }
      const list = byName.get(k) || []
      if (list.length === 1) return { entry: list[0] }
      if (list.length > 1) return { error: `「${k}」名称重复（${list.map(x => x.code).join('、')}），请改填编码` }
      return { error: `「${k}」不存在或已停用` }
    },
  }
}

export function normalizeImportDate(v: unknown): string | null {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel 序列日期（1900 系统）
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    if (isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (!m) return null
  const y = +m[1]; const mo = +m[2]; const d = +m[3]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function num(v: unknown): number | null {
  if (v == null || String(v).trim() === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : NaN
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * @param rows 前端按 IMPORT_COLUMNS 的 key 映射后的行，另带 _row（Excel 行号）
 */
export function buildImportDocs(
  db: DbLike,
  accountSetId: string,
  docType: string,
  rows: Array<Record<string, any>>,
): { docs: ImportDoc[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = []
  if (!(IMPORT_DOC_TYPES as readonly string[]).includes(docType)) {
    return { docs: [], issues: [{ row: 0, group_no: '', message: `单据类型 ${docType} 不支持导入` }] }
  }
  const items = buildLookup(db.prepare('SELECT code,name,unit,spec FROM scm_item WHERE account_set_id=? AND enabled=1').all(accountSetId))
  const partners = buildLookup(db.prepare('SELECT code,name,short_name,partner_type FROM scm_partner WHERE account_set_id=? AND enabled=1').all(accountSetId))
  const warehouses = buildLookup(db.prepare('SELECT code,name FROM scm_warehouse WHERE account_set_id=? AND enabled=1').all(accountSetId))
  const role = PARTNER_ROLE[docType]

  const groups = new Map<string, Array<Record<string, any>>>()
  for (const r of rows) {
    const g = String(r.group_no ?? '').trim() || `__row${r._row}`
    const arr = groups.get(g) || []
    arr.push(r)
    groups.set(g, arr)
  }

  const docs: ImportDoc[] = []
  for (const [g, list] of groups) {
    const groupNo = g.startsWith('__row') ? '' : g
    const err = (row: number, message: string) => issues.push({ row, group_no: groupNo, message })
    const first = list[0]
    const startIssues = issues.length

    // 表头：取首行；同组其它行填了不同值则报冲突
    const headerVal = (k: string) => String(first[k] ?? '').trim()
    for (const k of ['doc_date', 'partner', 'warehouse']) {
      const base = String(first[k] ?? '').trim()
      for (const r of list.slice(1)) {
        const v = String(r[k] ?? '').trim()
        if (v && base && v !== base) err(r._row, `同一分组号下「${IMPORT_COLUMNS.find(c => c.key === k)!.label}」不一致（第 ${first._row} 行为「${base}」）`)
      }
    }
    const pick = (k: string) => headerVal(k) || String(list.find(r => String(r[k] ?? '').trim())?.[k] ?? '').trim()

    let docDate = ''
    const dateText = list.find(r => r.doc_date != null && String(r.doc_date).trim() !== '')?.doc_date
    if (dateText != null) {
      const nd = normalizeImportDate(dateText)
      if (nd === null) err(first._row, `单据日期格式不正确：${dateText}`)
      else docDate = nd
    }

    let partnerCode: string | null = null; let partnerName = ''
    const partnerText = pick('partner')
    if (partnerText) {
      const f = partners.find(partnerText)
      if (f.error) err(first._row, `往来单位${f.error}`)
      else {
        partnerCode = f.entry!.code; partnerName = f.entry!.name
        const t = String(f.entry!.partner_type || '').trim().toLowerCase()
        const isBoth = !t || t === 'both' || t === '双向' || t === '3'
        if (role && !isBoth && t !== role && t !== (role === 'supplier' ? '供应商' : '客户')) {
          err(first._row, `往来单位「${partnerName}」不是${role === 'supplier' ? '供应商' : '客户'}`)
        }
      }
    } else if (role) {
      err(first._row, `${role === 'supplier' ? '供应商' : '客户'}不能为空`)
    }

    let warehouseCode: string | null = null
    const whText = pick('warehouse')
    if (whText) {
      const f = warehouses.find(whText)
      if (f.error) err(first._row, `仓库${f.error}`)
      else warehouseCode = f.entry!.code
    }

    const lines: Array<Record<string, any>> = []
    let totalQty = 0; let totalAmount = 0
    for (const r of list) {
      const itemText = String(r.item ?? '').trim()
      if (!itemText) { err(r._row, '物料不能为空'); continue }
      const fi = items.find(itemText)
      if (fi.error) { err(r._row, `物料${fi.error}`); continue }
      const qty = num(r.qty)
      if (qty === null || Number.isNaN(qty) || qty <= 0) { err(r._row, '数量必须为大于 0 的数字'); continue }
      const price = num(r.price) ?? 0
      if (Number.isNaN(price) || price < 0) { err(r._row, '单价必须为不小于 0 的数字'); continue }
      const tax = num(r.tax_rate)
      if (Number.isNaN(tax as number)) { err(r._row, '税率必须为数字'); continue }
      const produce = r.produce_date ? normalizeImportDate(r.produce_date) : ''
      const expire = r.expire_date ? normalizeImportDate(r.expire_date) : ''
      if (produce === null || expire === null) { err(r._row, '生产日期/有效期格式不正确'); continue }
      let lineWh: string | null = null
      const lineWhText = String(r.warehouse ?? '').trim()
      if (lineWhText && lineWhText !== whText) {
        const f = warehouses.find(lineWhText)
        if (f.error) { err(r._row, `仓库${f.error}`); continue }
        lineWh = f.entry!.code
      }
      lines.push({
        item_code: fi.entry!.code,
        spec: fi.entry!.spec || null,
        unit: fi.entry!.unit || null,
        warehouse_code: lineWh,
        qty, price,
        tax_rate: tax,
        batch_no: String(r.batch_no ?? '').trim() || null,
        produce_date: produce || null,
        expire_date: expire || null,
        remark: String(r.line_remark ?? '').trim() || null,
      })
      totalQty += qty
      totalAmount += qty * price
    }

    if (issues.length > startIssues) continue   // 本组有错误，整张不入选，避免只导入一半明细
    docs.push({
      group_no: groupNo, doc_type: docType,
      doc_date: docDate, partner_code: partnerCode, partner_name: partnerName,
      warehouse_code: warehouseCode, remark: pick('remark'),
      rows: list.map(r => r._row), lines,
      total_qty: r2(totalQty), total_amount: r2(totalAmount),
    })
  }
  return { docs, issues }
}
