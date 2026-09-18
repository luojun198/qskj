import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { createPreReinitializeBackup } from '../services/systemReinitialize.js'
import { listDocFieldDefs, listAllDocFieldDefs, upsertDocFieldDefs } from '../services/scmDocFields.js'
import { computeIssueSuggestion, r6 } from '../services/scmProduction.js'
import { SCM_OVERRUN_PARAM_KEYS, validateScmOverrunParam } from '../services/scmOverrunPolicy.js'
import { queryOutsourceExecution, type OutsourceExecutionFilters } from '../services/scmOutsourceExecutionReport.js'
import { queryProductionExecution, type ProductionExecutionFilters } from '../services/scmProductionExecutionReport.js'
import { resolveScmAccount, SCM_ACCOUNT_SPECS, suggestScmAccounts } from '../services/scmAccountResolver.js'
import { queryStockLedger, type StockLedgerFilters } from '../services/scmStockLedger.js'
import type { ExportColumnSpec } from '../services/styledExcelExport.js'
import { normalizePaging } from '../utils/paging.js'
import { listStockLayers, getCostingMethod } from '../services/scmCosting.js'
import { getScmBaseCurrency, isScmBaseCurrency, normalizeScmCurrency, resolveScmExchangeRate } from '../services/scmCurrency.js'

async function buildStyledXlsxBuffer(options: any) {
  const module = await import('../services/styledExcelExport.js')
  return module.buildStyledXlsxBuffer(options)
}

const router = Router()
router.use(authMiddleware)

// ── 供应链模块权限守卫（路径→权限，admin '*' 放行） ──────────────────────
const SCM_PERMISSION_RULES: Array<{ re: RegExp; perm: string }> = [
  { re: /^\/scm\/reset/,       perm: 'scm:param' },   // 供应链初始化（清空）
  { re: /^\/scm\/params/,      perm: 'scm:param' },
  { re: /^\/scm\/import/,      perm: 'scm:import' },
  { re: /^\/scm\/items/,       perm: 'scm:item' },
  { re: /^\/scm\/partners/,    perm: 'scm:partner' },
  { re: /^\/scm\/warehouses/,  perm: 'scm:warehouse' },
  { re: /^\/scm\/bins/,        perm: 'scm:warehouse' },
  { re: /^\/scm\/units/,       perm: 'scm:item' },    // 单位与物料共用权限
  { re: /^\/scm\/categories/,  perm: 'scm:category' },
  { re: /^\/scm\/stock/,       perm: 'scm:stock' },
  { re: /^\/scm\/batch-stock/, perm: 'scm:stock' },   // 批次库存查询
  { re: /^\/scm\/serials/,     perm: 'scm:stock' },   // 序列号查询
  { re: /^\/scm\/report/,      perm: 'scm:report' },  // 供应链报表
]
router.use((req: AuthRequest, res, next) => {
  if (!req.path.startsWith('/scm/')) return next()
  if (req.permissions?.includes('*')) return next()
  const rule = SCM_PERMISSION_RULES.find(r => r.re.test(req.path))
  if (rule && !req.permissions?.includes(rule.perm)) {
    return res.status(403).json({ code: 403, message: '无此操作权限' })
  }
  next()
})

const asid = (req: AuthRequest) => req.accountSetId || ''

// ── 供应链参数（计价方式等） ────────────────────────────────────────────
const SCM_PARAM_KEYS = [
  'scm:costing_method',
  'scm:acc_ap', 'scm:acc_ar', 'scm:acc_revenue', 'scm:acc_cost',
  'scm:acc_production', 'scm:acc_other', 'scm:acc_tax_input', 'scm:acc_tax_output',
  'scm:acc_labor', 'scm:acc_overhead',
  'scm:item_levels', 'scm:item_code_lengths', 'scm:item_types',
  'scm:negative_stock_warehouses',
  'scm:currencies', 'scm:io_categories', 'scm:transport_methods', 'scm:doc_no_rule',
  'scm:credit_control_enabled', 'scm:credit_control_mode',
  'scm:qc_required_for_finish', 'scm:qc_required_for_receipt',
  ...SCM_OVERRUN_PARAM_KEYS,
]
// ── 多币种（P2-14）：供单据表单取币种列表与记账汇率，任何已登录用户可读（不要求 base:currency 权限） ──
router.get('/scm/currencies', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const base = getScmBaseCurrency(db, aid)
  const hasTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='currencies'").get()
  const rows = hasTable
    ? db.prepare('SELECT code, name, is_base, default_rate FROM currencies WHERE account_set_id=? AND is_enabled=1 ORDER BY is_base DESC, sort_order, code').all(aid) as any[]
    : []
  const list = rows.length ? rows : [{ code: base, name: base === 'RMB' ? '人民币' : base, is_base: 1, default_rate: 1 }]
  res.json({ code: 0, data: { base, list } })
})
router.get('/scm/currency-rate', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const { currency, date } = req.query as any
  const base = getScmBaseCurrency(db, aid)
  const rate = resolveScmExchangeRate(db, aid, currency, date)
  res.json({ code: 0, data: { base, currency: isScmBaseCurrency(db, aid, currency) ? base : normalizeScmCurrency(currency), rate, is_base: isScmBaseCurrency(db, aid, currency) } })
})

router.get('/scm/params', (req: AuthRequest, res) => {
  const db = getDb()
  const rows = db.prepare(
    `SELECT param_key, param_value FROM system_params WHERE account_set_id=? AND param_key IN (${SCM_PARAM_KEYS.map(() => '?').join(',')})`
  ).all(asid(req), ...SCM_PARAM_KEYS)
  res.json({ code: 0, data: rows })
})
/**
 * 供应链对方科目的实际取值：没配参数时系统按「默认编码 → 科目名称」自动匹配，
 * 这里把匹配结果和候选科目一并给出来，参数页据此显示「未配置，当前自动匹配到 XXX」。
 */
router.get('/scm/params/resolved-accounts', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const data = SCM_ACCOUNT_SPECS.map(spec => {
    const resolved = resolveScmAccount(db, aid, spec.key)
    return {
      param_key: spec.key,
      label: spec.label,
      resolved_code: resolved?.code || '',
      resolved_name: resolved?.name || '',
      // param=用户已配置，code=命中默认编码，name=按科目名称自动匹配，空=账套里找不到
      source: resolved?.source || '',
      candidates: suggestScmAccounts(db, aid, spec.key),
    }
  })
  res.json({ code: 0, data })
})

router.put('/scm/params', operationLog('保存供应链参数', '供应链'), (req: AuthRequest, res) => {
  const { params } = req.body
  if (!Array.isArray(params)) return res.status(400).json({ code: 400, message: '参数格式错误' })
  const db = getDb()
  const upsert = db.prepare('INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)')
  const VALID_COSTING = ['moving_avg', 'month_avg', 'fifo', 'lifo', 'specified']
  for (const p of params) {
    if (!SCM_PARAM_KEYS.includes(p.param_key)) continue
    const val = String(p.param_value ?? '')
    if (p.param_key === 'scm:costing_method' && val && !VALID_COSTING.includes(val)) {
      return res.status(400).json({ code: 400, message: '计价方式无效' })
    }
    if (p.param_key === 'scm:negative_stock_warehouses') {
      try {
        const parsed = JSON.parse(val || '[]')
        if (!Array.isArray(parsed)) {
          return res.status(400).json({ code: 400, message: '允许负库存仓库参数无效' })
        }
      } catch {
        return res.status(400).json({ code: 400, message: '允许负库存仓库参数无效' })
      }
    }
    const overrunError = validateScmOverrunParam(p.param_key, val)
    if (overrunError) return res.status(400).json({ code: 400, message: overrunError })
    const ex = db.prepare('SELECT id FROM system_params WHERE account_set_id=? AND param_key=?').get(asid(req), p.param_key) as any
    upsert.run(ex?.id || uuidv4(), asid(req), p.param_key, val)
  }
  res.json({ code: 0, message: '保存成功' })
})

// ── 供应链初始化：清空业务数据（business）或连同基础档案（all） ──────────
// 始终保留 scm_doc_type（系统预置单据类型，清掉模块不可用）。
router.post('/scm/reset', operationLog('供应链初始化', '供应链'), async (req: AuthRequest, res) => {
  const mode = req.body?.mode === 'all' ? 'all' : 'business'
  const db = getDb(); const aid = asid(req)
  // 强制：清空前先完整备份本账套，备份失败则中止
  let backupFile = ''
  try {
    const b = await createPreReinitializeBackup(aid, req.userId)
    backupFile = b.filename
  } catch (e: any) {
    return res.status(500).json({ code: 500, message: e?.message || '初始化前自动备份失败，已中止操作' })
  }
  // P2-6：业务表补齐序列号/批次流水、核销、MRP 来源、工单成品与用料、质检、报工；主数据补齐工艺路线/工作中心/库位/字段配置。
  // 顺序：先明细后头表（无外键约束，但便于阅读与将来加约束）。
  const businessTables = [
    'scm_qc_line', 'scm_qc_doc', 'scm_work_report', 'scm_mrp_source',
    'scm_serial_move', 'scm_serial', 'scm_batch_move', 'scm_stock_batch',
    'scm_ar_ap_verify', 'scm_ar_ap_log',
    'scm_doc_line', 'scm_doc', 'scm_stock_layer_use', 'scm_stock_layer', 'scm_stock_move', 'scm_stock',
    'scm_production_plan_line', 'scm_production_plan_product', 'scm_production_plan',
  ]
  const masterTables = [
    'scm_routing_line', 'scm_routing', 'scm_work_center',
    'scm_bom_line', 'scm_bom', 'scm_item_unit', 'scm_item_field_defs', 'scm_doc_field_defs',
    'scm_item_category', 'scm_item', 'scm_partner', 'scm_bin', 'scm_warehouse', 'scm_unit',
  ]
  const tables = mode === 'all' ? [...businessTables, ...masterTables] : businessTables
  const existing = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r => r.name)
  )
  db.transaction(() => {
    for (const t of tables) {
      if (existing.has(t)) db.prepare(`DELETE FROM ${t} WHERE account_set_id=?`).run(aid)
    }
  })()
  res.json({ code: 0, data: { ok: true, mode, cleared: tables.filter(t => existing.has(t)), backup: backupFile } })
})

/**
 * 主数据删除引用校验（P2-1）：物料 / 往来单位 / 仓库被单据、库存、往来台账、BOM、工单引用时禁止硬删（应改停用）。
 * 返回可读的阻断原因；无引用返回 null。
 */
export function masterRefError(db: ReturnType<typeof getDb>, aid: string, kind: 'item' | 'partner' | 'warehouse', code: string): string | null {
  const count = (sql: string, ...ps: any[]) => Number((db.prepare(sql).get(...ps) as any)?.c) || 0
  const label = kind === 'item' ? '物料' : kind === 'partner' ? '往来单位' : '仓库'
  const reasons: string[] = []
  if (kind === 'item') {
    const stock = count('SELECT COUNT(*) c FROM scm_stock WHERE account_set_id=? AND item_code=? AND ABS(qty) > 0.000001', aid, code)
    if (stock) reasons.push(`存在库存结存（${stock} 个仓）`)
    const docs = count('SELECT COUNT(*) c FROM scm_doc_line WHERE account_set_id=? AND item_code=?', aid, code)
    if (docs) reasons.push(`被 ${docs} 行单据明细引用`)
    const boms = count('SELECT COUNT(*) c FROM scm_bom WHERE account_set_id=? AND item_code=?', aid, code)
      + count('SELECT COUNT(*) c FROM scm_bom_line WHERE account_set_id=? AND item_code=?', aid, code)
    if (boms) reasons.push(`被 ${boms} 处 BOM 引用`)
    const plans = count('SELECT COUNT(*) c FROM scm_production_plan_product WHERE account_set_id=? AND item_code=?', aid, code)
      + count('SELECT COUNT(*) c FROM scm_production_plan_line WHERE account_set_id=? AND item_code=?', aid, code)
    if (plans) reasons.push(`被 ${plans} 处工单引用`)
  } else if (kind === 'partner') {
    const open = count("SELECT COUNT(*) c FROM scm_ar_ap_log WHERE account_set_id=? AND partner_code=? AND ABS(amount - COALESCE(verified_amount,0)) > 0.005", aid, code)
    if (open) reasons.push(`存在 ${open} 笔未核销往来`)
    const docs = count('SELECT COUNT(*) c FROM scm_doc WHERE account_set_id=? AND partner_code=?', aid, code)
    if (docs) reasons.push(`被 ${docs} 张单据引用`)
    const plans = count('SELECT COUNT(*) c FROM scm_production_plan WHERE account_set_id=? AND supplier_code=?', aid, code)
    if (plans) reasons.push(`被 ${plans} 张委外工单引用`)
  } else {
    const stock = count('SELECT COUNT(*) c FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND ABS(qty) > 0.000001', aid, code)
    if (stock) reasons.push(`存在 ${stock} 个物料的库存结存`)
    const docs = count('SELECT COUNT(*) c FROM scm_doc WHERE account_set_id=? AND warehouse_code=?', aid, code)
      + count('SELECT COUNT(*) c FROM scm_doc_line WHERE account_set_id=? AND warehouse_code=?', aid, code)
    if (docs) reasons.push(`被 ${docs} 处单据引用`)
    const items = count('SELECT COUNT(*) c FROM scm_item WHERE account_set_id=? AND default_warehouse_code=?', aid, code)
    if (items) reasons.push(`是 ${items} 个物料的默认仓库`)
  }
  if (!reasons.length) return null
  return `${label}「${code}」${reasons.join('、')}，不能删除；如不再使用请改为停用`
}

// ── 通用：自动编号（前缀+数字，参照固定资产 next-no） ────────────────────
function nextCode(db: ReturnType<typeof getDb>, table: string, accountSetId: string, fallbackPrefix: string): string {
  const rows = db.prepare(`SELECT code FROM ${table} WHERE account_set_id=?`).all(accountSetId) as Array<{ code: string }>
  let maxNum = -1, width = 4, prefix = fallbackPrefix
  for (const r of rows) {
    const m = String(r.code || '').match(/^([A-Za-z\-_]*)(\d+)$/)
    if (m) {
      const n = parseInt(m[2], 10)
      if (n >= maxNum) { maxNum = n; width = m[2].length; prefix = m[1] }
    }
  }
  return maxNum < 0 ? `${fallbackPrefix}0001` : prefix + String(maxNum + 1).padStart(width, '0')
}

// ── 辅助：填充物料单位关联数据 ──────────────────────────────────────────
function appendItemUnits(db: ReturnType<typeof getDb>, aid: string, list: any[]) {
  if (!list.length) return
  const itemUnitQuery = db.prepare(
    `SELECT iu.item_code, iu.unit_code, iu.is_primary, iu.conversion_rate, u.name AS unit_name
     FROM scm_item_unit iu LEFT JOIN scm_unit u ON u.account_set_id=iu.account_set_id AND u.code=iu.unit_code
     WHERE iu.account_set_id=? AND iu.item_code IN (${list.map(() => '?').join(',')})`)
  const unitRows = itemUnitQuery.all(aid, ...list.map((i: any) => i.code)) as any[]
  for (const item of list) {
    const ur = unitRows.filter((r: any) => r.item_code === item.code)
    const prim = ur.find((r: any) => r.is_primary)
    if (prim) {
      item.primary_unit_code = prim.unit_code
      item.unit_name = prim.unit_name || item.unit
    }
    item.secondary_units = ur.filter((r: any) => !r.is_primary).map((r: any) => ({
      unit_code: r.unit_code, unit_name: r.unit_name, conversion_rate: r.conversion_rate,
    }))
  }
}

// ── 物料自定义字段定义 ────────────────────────────────────────────────────
router.get('/scm/item-fields', (req: AuthRequest, res) => {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM scm_item_field_defs WHERE account_set_id=? AND is_enabled=1 ORDER BY sort_order, created_at'
  ).all(asid(req))
  res.json({ code: 0, data: rows })
})

router.post('/scm/item-fields', operationLog('保存物料字段配置', '供应链'), (req: AuthRequest, res) => {
  const { fields } = req.body
  if (!Array.isArray(fields)) return res.status(400).json({ code: 400, message: 'fields 必须为数组' })
  const db = getDb()
  const aid = asid(req)

  const existing = db.prepare('SELECT id, field_key FROM scm_item_field_defs WHERE account_set_id=?').all(aid) as any[]
  const existingMap = new Map(existing.map((f: any) => [f.field_key, f.id]))
  const newKeys = new Set(fields.filter((f: any) => f.field_key).map((f: any) => f.field_key))

  db.transaction(() => {
    // 禁用不在新列表中的旧字段
    for (const ef of existing) {
      if (!newKeys.has(ef.field_key)) {
        db.prepare("UPDATE scm_item_field_defs SET is_enabled=0, updated_at=datetime('now') WHERE id=?").run(ef.id)
      }
    }
    // Upsert
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]
      if (!f.field_key || !f.field_name) continue
      const optJson = Array.isArray(f.options_json)
        ? JSON.stringify(f.options_json)
        : (f.options_json ?? null)
      if (existingMap.has(f.field_key)) {
        db.prepare(
          "UPDATE scm_item_field_defs SET field_name=?, field_type=?, options_json=?, sort_order=?, is_enabled=1, updated_at=datetime('now') WHERE id=?"
        ).run(f.field_name, f.field_type || 'text', optJson, f.sort_order ?? i, existingMap.get(f.field_key))
      } else {
        db.prepare(
          'INSERT INTO scm_item_field_defs (id, account_set_id, field_key, field_name, field_type, options_json, sort_order, is_enabled) VALUES (?,?,?,?,?,?,?,1)'
        ).run(uuidv4(), aid, f.field_key, f.field_name, f.field_type || 'text', optJson, f.sort_order ?? i)
      }
    }
  })()

  res.json({ code: 0, message: '保存成功' })
})

// ── 单据自定义字段定义（表头/表尾） ───────────────────────────────────────
// GET 任意已登录可读（录入/打印/列表都要用）；POST 为配置类操作，需 admin '*' 或 scm:param
// 汇总本账套全部已配置字段（配置页「已配置概览」）— 须在 /scm/doc-fields 之前注册以免被通配
router.get('/scm/doc-fields/all', (req: AuthRequest, res) => {
  res.json({ code: 0, data: listAllDocFieldDefs(getDb(), asid(req)) })
})
router.get('/scm/doc-fields', (req: AuthRequest, res) => {
  const docType = String(req.query.doc_type || '')
  if (!docType) return res.json({ code: 0, data: [] })
  res.json({ code: 0, data: listDocFieldDefs(getDb(), asid(req), docType) })
})

router.post('/scm/doc-fields', operationLog('保存单据字段配置', '供应链'), (req: AuthRequest, res) => {
  const perms = req.permissions || []
  if (!perms.includes('*') && !perms.includes('scm:param')) {
    return res.status(403).json({ code: 403, message: '无单据字段配置权限' })
  }
  const { doc_type, fields } = req.body
  if (!doc_type) return res.status(400).json({ code: 400, message: 'doc_type 不能为空' })
  if (!Array.isArray(fields)) return res.status(400).json({ code: 400, message: 'fields 必须为数组' })
  upsertDocFieldDefs(getDb(), asid(req), doc_type, fields)
  res.json({ code: 0, message: '保存成功' })
})

// ── 物料档案 ────────────────────────────────────────────────────────────
router.get('/scm/items/next-no', (req: AuthRequest, res) => {
  res.json({ code: 0, data: { next_no: nextCode(getDb(), 'scm_item', asid(req), 'WL') } })
})
router.get('/scm/items', (req: AuthRequest, res) => {
  const db = getDb()
  const { keyword, category_code, item_type, parent_id, is_leaf, all, page = '1', page_size = '50' } = req.query as any
  const conds = ['i.account_set_id=?']; const params: any[] = [asid(req)]
  if (keyword) { conds.push('(i.code LIKE ? OR i.name LIKE ? OR i.spec LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`) }
  if (category_code) { conds.push('i.category_code=?'); params.push(category_code) }
  if (item_type) { conds.push('i.item_type=?'); params.push(item_type) }
  if (is_leaf !== undefined && is_leaf !== '') { conds.push('i.is_leaf=?'); params.push(parseInt(is_leaf)) }
  if (parent_id !== undefined) {
    if (parent_id === '' || parent_id === 'null') { conds.push('i.parent_id IS NULL') }
    else { conds.push('i.parent_id=?'); params.push(parent_id) }
  }
  const where = conds.join(' AND ')

  // hasChildren 子查询
  const selectCols = `i.*, (SELECT COUNT(*) FROM scm_item c WHERE c.parent_id=i.id AND c.account_set_id=i.account_set_id) > 0 AS hasChildren`

  // field_values 字符串转对象
  function parseFieldValues(list: any[]) {
    for (const item of list) {
      if (typeof item.field_values === 'string') {
        try { item.field_values = JSON.parse(item.field_values) } catch { item.field_values = {} }
      }
      item.field_values = item.field_values || {}
    }
  }

  // all=1 返回全量（树形模式，不分页）
  if (all === '1') {
    const list = db.prepare(`SELECT ${selectCols} FROM scm_item i WHERE ${where} ORDER BY i.code`).all(...params) as any[]
    appendItemUnits(db, asid(req), list)
    parseFieldValues(list)
    return res.json({ code: 0, data: { list, total: list.length } })
  }

  const total = (db.prepare(`SELECT COUNT(*) c FROM scm_item i WHERE ${where}`).get(...params) as any).c
  const paging = normalizePaging(page, page_size)
  const list = db.prepare(`SELECT ${selectCols} FROM scm_item i WHERE ${where} ORDER BY i.code LIMIT ? OFFSET ?`).all(...params, paging.pageSize, paging.offset) as any[]
  appendItemUnits(db, asid(req), list)
  parseFieldValues(list)

  res.json({ code: 0, data: { list, total, page: paging.page, page_size: paging.pageSize } })
})
// ── 辅助：同步物料-单位关联 ────────────────────────────────────────────
function syncItemUnits(db: ReturnType<typeof getDb>, aid: string, itemCode: string, primaryUnitCode?: string, secondaryUnits?: Array<{ unit_code: string; conversion_rate: number }>) {
  db.prepare('DELETE FROM scm_item_unit WHERE account_set_id=? AND item_code=?').run(aid, itemCode)
  if (primaryUnitCode) {
    db.prepare('INSERT INTO scm_item_unit (id,account_set_id,item_code,unit_code,is_primary,conversion_rate) VALUES (?,?,?,?,1,1)').run(
      uuidv4(), aid, itemCode, primaryUnitCode
    )
  }
  if (Array.isArray(secondaryUnits)) {
    for (const su of secondaryUnits) {
      if (!su.unit_code || su.unit_code === primaryUnitCode) continue
      db.prepare('INSERT INTO scm_item_unit (id,account_set_id,item_code,unit_code,is_primary,conversion_rate) VALUES (?,?,?,?,0,?)').run(
        uuidv4(), aid, itemCode, su.unit_code, Number(su.conversion_rate) || 1
      )
    }
  }
}

router.post('/scm/items', operationLog('物料新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!b.code || !b.name) return res.status(400).json({ code: 400, message: '编号和名称不能为空' })
  if (db.prepare('SELECT id FROM scm_item WHERE account_set_id=? AND code=?').get(asid(req), b.code)) {
    return res.status(409).json({ code: 409, message: '物料编号已存在' })
  }
  const aid = asid(req)
  // 向后兼容：若无 primary_unit_code 但传了旧 unit 文本，自动创建/匹配单位
  let primaryUnitCode = b.primary_unit_code
  if (!primaryUnitCode && b.unit) {
    const uname = String(b.unit).trim()
    if (uname) {
      let u = db.prepare('SELECT code FROM scm_unit WHERE account_set_id=? AND name=?').get(aid, uname) as any
      if (!u) {
        const uCode = nextCode(db, 'scm_unit', aid, 'UN')
        db.prepare('INSERT INTO scm_unit (id,account_set_id,code,name) VALUES (?,?,?,?)').run(uuidv4(), aid, uCode, uname)
        u = { code: uCode }
      }
      primaryUnitCode = u.code
    }
  }
  const unitName = primaryUnitCode
    ? (db.prepare('SELECT name FROM scm_unit WHERE account_set_id=? AND code=?').get(aid, primaryUnitCode) as any)?.name || b.unit || null
    : b.unit || null

  // 自动计算级次
  let level = 1
  let parentId = b.parent_id || null
  if (parentId) {
    const parent = db.prepare('SELECT id, level FROM scm_item WHERE id=? AND account_set_id=?').get(parentId, aid) as any
    if (!parent) return res.status(400).json({ code: 400, message: '上级物料不存在' })
    level = (parent.level || 0) + 1
  }

  const id = uuidv4()
  const fieldValuesJson = JSON.stringify(b.field_values && typeof b.field_values === 'object' ? b.field_values : {})
  db.prepare(`INSERT INTO scm_item
    (id,account_set_id,code,name,spec,barcode,short_code,unit,category_code,subcategory_code,item_type,
     purchase_price,sale_price,ref_cost,fixed_cost,inv_account,sale_account,batch_flag,is_asset,supplier_code,remark,enabled,parent_id,level,is_leaf,field_values,
     volume,min_order_qty,lead_time_days,shelf_life_days,buyer,work_station,transfer_price,sale_price2,sale_price3,safety_stock,source_type,batch_out_mode,serial_flag,default_warehouse_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?, ?,?,?,?)`).run(
    id, aid, b.code, b.name, b.spec ?? null, b.barcode ?? null, b.short_code ?? null, unitName,
    b.category_code ?? null, b.subcategory_code ?? null, b.item_type ?? null,
    Number(b.purchase_price) || 0, Number(b.sale_price) || 0, Number(b.ref_cost) || 0, Number(b.fixed_cost) || 0,
    b.inv_account ?? null, b.sale_account ?? null, b.batch_flag ? 1 : 0, b.is_asset ? 1 : 0,
    b.supplier_code ?? null, b.remark ?? null, b.enabled === 0 ? 0 : 1, parentId, level,
    b.is_leaf !== undefined ? (b.is_leaf ? 1 : 0) : 1, fieldValuesJson,
    Number(b.volume) || 0, Number(b.min_order_qty) || 0, Number(b.lead_time_days) || 0, Number(b.shelf_life_days) || 0,
    b.buyer ?? null, b.work_station ?? null, Number(b.transfer_price) || 0, Number(b.sale_price2) || 0, Number(b.sale_price3) || 0, Number(b.safety_stock) || 0,
    b.source_type || 'purchase', b.batch_out_mode === 'manual' ? 'manual' : 'fifo', b.serial_flag ? 1 : 0, b.default_warehouse_code || null
  )
  // 同步主/副单位关联
  if (primaryUnitCode) syncItemUnits(db, aid, b.code, primaryUnitCode, b.secondary_units)
  res.json({ code: 0, data: { id } })
})
router.put('/scm/items/:id', operationLog('物料修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body; const aid = asid(req)
  const ex = db.prepare('SELECT id, code FROM scm_item WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!ex) return res.status(404).json({ code: 404, message: '物料不存在' })

  let primaryUnitCode = b.primary_unit_code
  if (!primaryUnitCode && b.unit) {
    const uname = String(b.unit).trim()
    if (uname) {
      let u = db.prepare('SELECT code FROM scm_unit WHERE account_set_id=? AND name=?').get(aid, uname) as any
      if (!u) {
        const uCode = nextCode(db, 'scm_unit', aid, 'UN')
        db.prepare('INSERT INTO scm_unit (id,account_set_id,code,name) VALUES (?,?,?,?)').run(uuidv4(), aid, uCode, uname)
        u = { code: uCode }
      }
      primaryUnitCode = u.code
    }
  }
  const unitName = primaryUnitCode
    ? (db.prepare('SELECT name FROM scm_unit WHERE account_set_id=? AND code=?').get(aid, primaryUnitCode) as any)?.name || b.unit || null
    : b.unit || null

  // 级次重算
  let level = 1
  let parentId = b.parent_id !== undefined ? (b.parent_id || null) : undefined
  if (parentId) {
    if (parentId === ex.id) return res.status(400).json({ code: 400, message: '上级不能选择自身' })
    const parent = db.prepare('SELECT id, level FROM scm_item WHERE id=? AND account_set_id=?').get(parentId, aid) as any
    if (!parent) return res.status(400).json({ code: 400, message: '上级物料不存在' })
    level = (parent.level || 0) + 1
  } else if (parentId === null) {
    level = 1
  }

  const fieldValuesJson = JSON.stringify(b.field_values && typeof b.field_values === 'object' ? b.field_values : {})
  const fields = `name=?,spec=?,barcode=?,short_code=?,unit=?,category_code=?,subcategory_code=?,item_type=?,
    purchase_price=?,sale_price=?,ref_cost=?,fixed_cost=?,inv_account=?,sale_account=?,batch_flag=?,is_asset=?,supplier_code=?,remark=?,enabled=?,is_leaf=?,field_values=?,
    volume=?,min_order_qty=?,lead_time_days=?,shelf_life_days=?,buyer=?,work_station=?,transfer_price=?,sale_price2=?,sale_price3=?,safety_stock=?,source_type=?,batch_out_mode=?,serial_flag=?,default_warehouse_code=?,updated_at=datetime('now')`
  const vals: any[] = [b.name, b.spec ?? null, b.barcode ?? null, b.short_code ?? null, unitName, b.category_code ?? null, b.subcategory_code ?? null, b.item_type ?? null,
    Number(b.purchase_price) || 0, Number(b.sale_price) || 0, Number(b.ref_cost) || 0, Number(b.fixed_cost) || 0,
    b.inv_account ?? null, b.sale_account ?? null, b.batch_flag ? 1 : 0, b.is_asset ? 1 : 0, b.supplier_code ?? null, b.remark ?? null,
    b.enabled === 0 ? 0 : 1, b.is_leaf !== undefined ? (b.is_leaf ? 1 : 0) : 1, fieldValuesJson,
    Number(b.volume) || 0, Number(b.min_order_qty) || 0, Number(b.lead_time_days) || 0, Number(b.shelf_life_days) || 0,
    b.buyer ?? null, b.work_station ?? null, Number(b.transfer_price) || 0, Number(b.sale_price2) || 0, Number(b.sale_price3) || 0, Number(b.safety_stock) || 0,
    b.source_type || 'purchase', b.batch_out_mode === 'manual' ? 'manual' : 'fifo', b.serial_flag ? 1 : 0, b.default_warehouse_code || null]

  if (parentId !== undefined) {
    db.prepare(`UPDATE scm_item SET ${fields}, parent_id=?, level=? WHERE id=?`).run(...vals, parentId, level, req.params.id)
  } else {
    db.prepare(`UPDATE scm_item SET ${fields} WHERE id=?`).run(...vals, req.params.id)
  }
  if (primaryUnitCode) syncItemUnits(db, aid, ex.code, primaryUnitCode, b.secondary_units)
  res.json({ code: 0, data: { ok: true } })
})
router.delete('/scm/items/:id', operationLog('物料删除', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const ex = db.prepare('SELECT id, code FROM scm_item WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!ex) return res.status(404).json({ code: 404, message: '物料不存在' })
  const children = db.prepare('SELECT COUNT(*) c FROM scm_item WHERE parent_id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (children?.c > 0) return res.status(409).json({ code: 409, message: `该物料下有 ${children.c} 个子物料，请先删除子物料` })
  const refErr = masterRefError(db, aid, 'item', ex.code)
  if (refErr) return res.status(409).json({ code: 409, message: refErr })
  db.prepare('DELETE FROM scm_item WHERE id=? AND account_set_id=?').run(req.params.id, aid)
  res.json({ code: 0, data: { ok: true } })
})

// ── 往来单位档案 ────────────────────────────────────────────────────────
router.get('/scm/partners/next-no', (req: AuthRequest, res) => {
  const { partner_type } = req.query as any
  const prefix = partner_type === 'supplier' ? 'GYS' : partner_type === 'customer' ? 'KH' : 'WL'
  const rows = getDb().prepare("SELECT code FROM scm_partner WHERE account_set_id=? AND code LIKE ?").all(asid(req), `${prefix}%`) as Array<{ code: string }>
  let maxNum = -1; let width = 4
  for (const r of rows) {
    const m = String(r.code || '').match(new RegExp(`^${prefix}(\\d+)$`))
    if (m) { const n = parseInt(m[1], 10); if (n >= maxNum) { maxNum = n; width = m[1].length } }
  }
  const nextNo = maxNum < 0 ? `${prefix}0001` : prefix + String(maxNum + 1).padStart(width, '0')
  res.json({ code: 0, data: { next_no: nextNo } })
})
router.get('/scm/partners', (req: AuthRequest, res) => {
  const db = getDb()
  const { keyword, partner_type } = req.query as any
  const conds = ['account_set_id=?']; const params: any[] = [asid(req)]
  if (keyword) { conds.push('(code LIKE ? OR name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  if (partner_type) { conds.push('(partner_type=? OR partner_type=?)'); params.push(partner_type, 'both') }
  const list = db.prepare(`SELECT * FROM scm_partner WHERE ${conds.join(' AND ')} ORDER BY code`).all(...params)
  res.json({ code: 0, data: list })
})
router.post('/scm/partners', operationLog('往来单位新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!b.code || !b.name) return res.status(400).json({ code: 400, message: '编号和名称不能为空' })
  if (db.prepare('SELECT id FROM scm_partner WHERE account_set_id=? AND code=?').get(asid(req), b.code)) {
    return res.status(409).json({ code: 409, message: '往来单位编号已存在' })
  }
  const id = uuidv4()
  db.prepare(`INSERT INTO scm_partner
    (id,account_set_id,code,name,short_name,partner_type,ar_account,ap_account,credit_limit,tax_rate,region_code,
     contact,phone,address,bank_name,bank_account,tax_no,salesman,remark,enabled,
     ship_address,ship_phone,ship_contact,province,city,county,country,payment_type,credit_days,qq,email,wechat,is_outsource,price_level)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?,?,?, ?,?)`).run(
    id, asid(req), b.code, b.name, b.short_name ?? null, b.partner_type || 'both', b.ar_account ?? null, b.ap_account ?? null,
    Number(b.credit_limit) || 0, Number(b.tax_rate) || 0, b.region_code ?? null,
    b.contact ?? null, b.phone ?? null, b.address ?? null, b.bank_name ?? null, b.bank_account ?? null,
    b.tax_no ?? null, b.salesman ?? null, b.remark ?? null, b.enabled === 0 ? 0 : 1,
    b.ship_address ?? null, b.ship_phone ?? null, b.ship_contact ?? null, b.province ?? null, b.city ?? null, b.county ?? null,
    b.country ?? null, b.payment_type ?? null, Number(b.credit_days) || 0, b.qq ?? null, b.email ?? null, b.wechat ?? null,
    b.is_outsource ? 1 : 0, [1, 2, 3].includes(Number(b.price_level)) ? Number(b.price_level) : 1
  )
  res.json({ code: 0, data: { id } })
})
router.put('/scm/partners/:id', operationLog('往来单位修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  const ex = db.prepare('SELECT id FROM scm_partner WHERE id=? AND account_set_id=?').get(req.params.id, asid(req))
  if (!ex) return res.status(404).json({ code: 404, message: '往来单位不存在' })
  db.prepare(`UPDATE scm_partner SET name=?,short_name=?,partner_type=?,ar_account=?,ap_account=?,credit_limit=?,tax_rate=?,region_code=?,
    contact=?,phone=?,address=?,bank_name=?,bank_account=?,tax_no=?,salesman=?,remark=?,enabled=?,
    ship_address=?,ship_phone=?,ship_contact=?,province=?,city=?,county=?,country=?,payment_type=?,credit_days=?,qq=?,email=?,wechat=?,is_outsource=?,price_level=?,updated_at=datetime('now') WHERE id=?`).run(
    b.name, b.short_name ?? null, b.partner_type || 'both', b.ar_account ?? null, b.ap_account ?? null,
    Number(b.credit_limit) || 0, Number(b.tax_rate) || 0, b.region_code ?? null,
    b.contact ?? null, b.phone ?? null, b.address ?? null, b.bank_name ?? null, b.bank_account ?? null,
    b.tax_no ?? null, b.salesman ?? null, b.remark ?? null, b.enabled === 0 ? 0 : 1,
    b.ship_address ?? null, b.ship_phone ?? null, b.ship_contact ?? null, b.province ?? null, b.city ?? null, b.county ?? null,
    b.country ?? null, b.payment_type ?? null, Number(b.credit_days) || 0, b.qq ?? null, b.email ?? null, b.wechat ?? null,
    b.is_outsource ? 1 : 0, [1, 2, 3].includes(Number(b.price_level)) ? Number(b.price_level) : 1, req.params.id
  )
  res.json({ code: 0, data: { ok: true } })
})
router.delete('/scm/partners/:id', operationLog('往来单位删除', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const ex = db.prepare('SELECT id, code FROM scm_partner WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!ex) return res.status(404).json({ code: 404, message: '往来单位不存在' })
  const refErr = masterRefError(db, aid, 'partner', ex.code)
  if (refErr) return res.status(409).json({ code: 409, message: refErr })
  db.prepare('DELETE FROM scm_partner WHERE id=? AND account_set_id=?').run(req.params.id, aid)
  res.json({ code: 0, data: { ok: true } })
})

// ── 仓库档案 ────────────────────────────────────────────────────────────
router.get('/scm/warehouses/next-no', (req: AuthRequest, res) => {
  res.json({ code: 0, data: { next_no: nextCode(getDb(), 'scm_warehouse', asid(req), 'WH') } })
})
router.get('/scm/warehouses', (req: AuthRequest, res) => {
  const list = getDb().prepare('SELECT * FROM scm_warehouse WHERE account_set_id=? ORDER BY code').all(asid(req))
  res.json({ code: 0, data: list })
})
router.post('/scm/warehouses', operationLog('仓库新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!b.code || !b.name) return res.status(400).json({ code: 400, message: '编号和名称不能为空' })
  if (db.prepare('SELECT id FROM scm_warehouse WHERE account_set_id=? AND code=?').get(asid(req), b.code)) {
    return res.status(409).json({ code: 409, message: '仓库编号已存在' })
  }
  const id = uuidv4()
  db.prepare('INSERT INTO scm_warehouse (id,account_set_id,code,name,attr,keeper,remark,enabled,address,phone,partner_code) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    id, asid(req), b.code, b.name, b.attr ?? null, b.keeper ?? null, b.remark ?? null, b.enabled === 0 ? 0 : 1,
    b.address ?? null, b.phone ?? null, b.partner_code ?? null
  )
  res.json({ code: 0, data: { id } })
})
router.put('/scm/warehouses/:id', operationLog('仓库修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!db.prepare('SELECT id FROM scm_warehouse WHERE id=? AND account_set_id=?').get(req.params.id, asid(req))) {
    return res.status(404).json({ code: 404, message: '仓库不存在' })
  }
  db.prepare('UPDATE scm_warehouse SET name=?,attr=?,keeper=?,remark=?,enabled=?,address=?,phone=?,partner_code=? WHERE id=?').run(
    b.name, b.attr ?? null, b.keeper ?? null, b.remark ?? null, b.enabled === 0 ? 0 : 1,
    b.address ?? null, b.phone ?? null, b.partner_code ?? null, req.params.id
  )
  res.json({ code: 0, data: { ok: true } })
})
router.delete('/scm/warehouses/:id', operationLog('仓库删除', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const ex = db.prepare('SELECT id, code FROM scm_warehouse WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!ex) return res.status(404).json({ code: 404, message: '仓库不存在' })
  const refErr = masterRefError(db, aid, 'warehouse', ex.code)
  if (refErr) return res.status(409).json({ code: 409, message: refErr })
  db.prepare('DELETE FROM scm_warehouse WHERE id=? AND account_set_id=?').run(req.params.id, aid)
  res.json({ code: 0, data: { ok: true } })
})

// ── 计量单位档案 ────────────────────────────────────────────────────────
router.get('/scm/units/next-no', (req: AuthRequest, res) => {
  res.json({ code: 0, data: { next_no: nextCode(getDb(), 'scm_unit', asid(req), 'UN') } })
})
router.get('/scm/units', (req: AuthRequest, res) => {
  const list = getDb().prepare('SELECT * FROM scm_unit WHERE account_set_id=? ORDER BY code').all(asid(req))
  res.json({ code: 0, data: list })
})
router.post('/scm/units', operationLog('单位新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!b.code || !b.name) return res.status(400).json({ code: 400, message: '编号和名称不能为空' })
  if (db.prepare('SELECT id FROM scm_unit WHERE account_set_id=? AND code=?').get(asid(req), b.code)) {
    return res.status(409).json({ code: 409, message: '单位编号已存在' })
  }
  const id = uuidv4()
  db.prepare('INSERT INTO scm_unit (id,account_set_id,code,name,remark,enabled) VALUES (?,?,?,?,?,?)').run(
    id, asid(req), b.code, b.name, b.remark ?? null, b.enabled === 0 ? 0 : 1
  )
  res.json({ code: 0, data: { id } })
})
router.put('/scm/units/:id', operationLog('单位修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!db.prepare('SELECT id FROM scm_unit WHERE id=? AND account_set_id=?').get(req.params.id, asid(req))) {
    return res.status(404).json({ code: 404, message: '单位不存在' })
  }
  db.prepare('UPDATE scm_unit SET name=?,remark=?,enabled=?,updated_at=datetime(\'now\') WHERE id=?').run(
    b.name, b.remark ?? null, b.enabled === 0 ? 0 : 1, req.params.id
  )
  res.json({ code: 0, data: { ok: true } })
})
router.delete('/scm/units/:id', operationLog('单位删除', '供应链'), (req: AuthRequest, res) => {
  const db = getDb()
  const unit = db.prepare('SELECT code FROM scm_unit WHERE id=? AND account_set_id=?').get(req.params.id, asid(req)) as any
  if (!unit) return res.status(404).json({ code: 404, message: '单位不存在' })
  const refs = db.prepare('SELECT COUNT(*) c FROM scm_item_unit WHERE account_set_id=? AND unit_code=?').get(asid(req), unit.code) as any
  if (refs?.c > 0) return res.status(409).json({ code: 409, message: `该单位被 ${refs.c} 个物料引用，无法删除` })
  db.prepare('DELETE FROM scm_unit WHERE id=?').run(req.params.id)
  res.json({ code: 0, data: { ok: true } })
})

// ── 库位档案（隶属仓库，参考用，不参与库存结存） ──────────────────────────
router.get('/scm/bins', (req: AuthRequest, res) => {
  const { warehouse_code } = req.query as any
  const conds = ['b.account_set_id=?']; const params: any[] = [asid(req)]
  if (warehouse_code) { conds.push('b.warehouse_code=?'); params.push(warehouse_code) }
  const list = getDb().prepare(`
    SELECT b.*, w.name AS warehouse_name FROM scm_bin b
    LEFT JOIN scm_warehouse w ON w.account_set_id=b.account_set_id AND w.code=b.warehouse_code
    WHERE ${conds.join(' AND ')} ORDER BY b.warehouse_code, b.code`).all(...params)
  res.json({ code: 0, data: list })
})
router.post('/scm/bins', operationLog('库位新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!b.warehouse_code || !b.code || !b.name) return res.status(400).json({ code: 400, message: '仓库、编码、名称不能为空' })
  if (db.prepare('SELECT id FROM scm_bin WHERE account_set_id=? AND warehouse_code=? AND code=?').get(asid(req), b.warehouse_code, b.code)) {
    return res.status(409).json({ code: 409, message: '该仓库下库位编码已存在' })
  }
  db.prepare('INSERT INTO scm_bin (id,account_set_id,warehouse_code,code,name,remark,enabled) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), asid(req), b.warehouse_code, b.code, b.name, b.remark ?? null, b.enabled === 0 ? 0 : 1)
  res.json({ code: 0, data: { ok: true } })
})
router.put('/scm/bins/:id', operationLog('库位修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  const ex = db.prepare('SELECT id FROM scm_bin WHERE id=? AND account_set_id=?').get(req.params.id, asid(req))
  if (!ex) return res.status(404).json({ code: 404, message: '库位不存在' })
  db.prepare('UPDATE scm_bin SET name=?, remark=?, enabled=? WHERE id=? AND account_set_id=?')
    .run(b.name, b.remark ?? null, b.enabled === 0 ? 0 : 1, req.params.id, asid(req))
  res.json({ code: 0, data: { ok: true } })
})
router.delete('/scm/bins/:id', operationLog('库位删除', '供应链'), (req: AuthRequest, res) => {
  getDb().prepare('DELETE FROM scm_bin WHERE id=? AND account_set_id=?').run(req.params.id, asid(req))
  res.json({ code: 0, data: { ok: true } })
})

// ── 物料分类 ────────────────────────────────────────────────────────────
router.get('/scm/categories', (req: AuthRequest, res) => {
  const list = getDb().prepare('SELECT * FROM scm_item_category WHERE account_set_id=? ORDER BY code').all(asid(req))
  res.json({ code: 0, data: list })
})
router.post('/scm/categories', operationLog('物料分类新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!b.code || !b.name) return res.status(400).json({ code: 400, message: '编码和名称不能为空' })
  if (db.prepare('SELECT id FROM scm_item_category WHERE account_set_id=? AND code=?').get(asid(req), b.code)) {
    return res.status(409).json({ code: 409, message: '分类编码已存在' })
  }
  db.prepare('INSERT INTO scm_item_category (id,account_set_id,code,name,parent_code) VALUES (?,?,?,?,?)')
    .run(uuidv4(), asid(req), b.code, b.name, b.parent_code ?? null)
  res.json({ code: 0, data: { ok: true } })
})
router.put('/scm/categories/:id', operationLog('物料分类修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  const ex = db.prepare('SELECT id FROM scm_item_category WHERE id=? AND account_set_id=?').get(req.params.id, asid(req))
  if (!ex) return res.status(404).json({ code: 404, message: '分类不存在' })
  db.prepare('UPDATE scm_item_category SET name=?, parent_code=? WHERE id=? AND account_set_id=?')
    .run(b.name, b.parent_code ?? null, req.params.id, asid(req))
  res.json({ code: 0, data: { ok: true } })
})
router.delete('/scm/categories/:id', operationLog('物料分类删除', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const cat = db.prepare('SELECT code FROM scm_item_category WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!cat) return res.status(404).json({ code: 404, message: '分类不存在' })
  const used = db.prepare('SELECT COUNT(*) c FROM scm_item WHERE account_set_id=? AND (category_code=? OR subcategory_code=?)').get(aid, cat.code, cat.code) as any
  if (used && used.c > 0) return res.status(400).json({ code: 400, message: `该分类已被 ${used.c} 个物料引用，无法删除` })
  const child = db.prepare('SELECT COUNT(*) c FROM scm_item_category WHERE account_set_id=? AND parent_code=?').get(aid, cat.code) as any
  if (child && child.c > 0) return res.status(400).json({ code: 400, message: '存在子分类，请先删除子分类' })
  db.prepare('DELETE FROM scm_item_category WHERE id=? AND account_set_id=?').run(req.params.id, aid)
  res.json({ code: 0, data: { ok: true } })
})

// ── 库存报表 ────────────────────────────────────────────────────────────
// 库存成本层（FIFO/LIFO）：按仓库/物料列出各入库层的剩余数量与单价；only_left=0 时含已耗尽层
router.get('/scm/stock/layers', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const { warehouse_code, item_code, only_left } = req.query as any
  const rows = listStockLayers(db, aid, { warehouse_code, item_code, only_left: only_left !== '0' })
  res.json({ code: 0, data: rows, costing_method: getCostingMethod(db, aid) })
})

// 收发存汇总（按仓库+物料，含期初/本期入/本期出/期末）
router.get('/scm/stock/summary', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const { start_date, end_date, warehouse_code } = req.query as any
  const sd = start_date || '2000-01-01'; const ed = end_date || '2099-12-31'

  // 期初 = 当前库存 - 期间净变动（start_date 前库存）
  const currentStock = db.prepare(
    'SELECT warehouse_code, item_code, qty, amount FROM scm_stock WHERE account_set_id=?'
  ).all(aid) as any[]
  // 起始日之后的全部流水：期间内的累计本期收发，期间之后的用于从当前库存倒推（否则 end_date 早于今天时期初/期末会错）
  const moves = db.prepare(
    `SELECT m.warehouse_code, m.item_code, m.direction, m.qty, m.amount, m.move_date,
      i.name AS item_name, i.spec, i.unit, w.name AS warehouse_name
     FROM scm_stock_move m
     LEFT JOIN scm_item i ON i.account_set_id=m.account_set_id AND i.code=m.item_code
     LEFT JOIN scm_warehouse w ON w.account_set_id=m.account_set_id AND w.code=m.warehouse_code
     WHERE m.account_set_id=? AND m.move_date >= ?`
  ).all(aid, sd) as any[]

  const map = new Map<string, any>()
  const rowOf = (whCode: string, itemCode: string) => {
    const k = `${whCode}|${itemCode}`
    if (!map.has(k)) map.set(k, { in_qty: 0, in_amt: 0, out_qty: 0, out_amt: 0, after_qty: 0, after_amt: 0, item_name: '', spec: '', unit: '', warehouse_name: '', warehouse_code: whCode, item_code: itemCode })
    return map.get(k)!
  }
  for (const m of moves) {
    const r = rowOf(m.warehouse_code, m.item_code)
    const sign = m.direction === 'in' ? 1 : -1
    if (String(m.move_date) <= ed) {
      if (sign > 0) { r.in_qty += m.qty; r.in_amt += m.amount } else { r.out_qty += m.qty; r.out_amt += m.amount }
    } else {
      r.after_qty += sign * m.qty; r.after_amt += sign * m.amount
    }
    r.item_name = m.item_name; r.spec = m.spec; r.unit = m.unit; r.warehouse_name = m.warehouse_name
  }
  // 期初 = 当前库存 − 期间净变动 − 期间之后的净变动
  for (const s of currentStock) {
    const r = rowOf(s.warehouse_code, s.item_code)
    r.opening_qty = Math.round((s.qty - (r.in_qty - r.out_qty) - r.after_qty) * 10000) / 10000
    r.opening_amt = Math.round((s.amount - (r.in_amt - r.out_amt) - r.after_amt) * 100) / 100
  }
  // 名称补齐（期间无流水的行没有 JOIN 到名称）
  const itemNames = new Map((db.prepare('SELECT code, name, spec, unit FROM scm_item WHERE account_set_id=?').all(aid) as any[]).map(i => [i.code, i]))
  const whNames = new Map((db.prepare('SELECT code, name FROM scm_warehouse WHERE account_set_id=?').all(aid) as any[]).map(w => [w.code, w.name]))
  for (const r of map.values()) {
    if (!r.item_name) { const i = itemNames.get(r.item_code); if (i) { r.item_name = i.name; r.spec = i.spec; r.unit = i.unit } }
    if (!r.warehouse_name) r.warehouse_name = whNames.get(r.warehouse_code) || ''
  }
  // P2-11：仓库参数改为过滤结果，不再直接返回空
  const summary = [...map.values()].filter(r => r.opening_qty !== undefined).filter(r => !warehouse_code || r.warehouse_code === warehouse_code).map(r => ({
    warehouse_code: r.warehouse_code, warehouse_name: r.warehouse_name,
    item_code: r.item_code, item_name: r.item_name, spec: r.spec, unit: r.unit,
    opening_qty: r.opening_qty || 0, opening_amt: r.opening_amt || 0,
    in_qty: r.in_qty || 0, in_amt: r.in_amt || 0,
    out_qty: r.out_qty || 0, out_amt: r.out_amt || 0,
    closing_qty: Math.round(((r.opening_qty || 0) + (r.in_qty || 0) - (r.out_qty || 0)) * 10000) / 10000,
    closing_amt: Math.round(((r.opening_amt || 0) + (r.in_amt || 0) - (r.out_amt || 0)) * 100) / 100,
  }))
  res.json({ code: 0, data: { summary } })
})

// 库存查询 ────────────────────────────────────────────────────────────
// 即时库存（join 物料名/仓库名）
router.get('/scm/stock', (req: AuthRequest, res) => {
  const db = getDb()
  const { keyword, warehouse_code } = req.query as any
  const account_set_id = asid(req)
  // params 顺序 = CTE 5 个分支(库存/SOa/PO/计划完工/计划材料) + 外层 WHERE 共 6 个 account_set_id，其后接仓库/关键字
  const conds = ['a.account_set_id=?']
  const params: any[] = [account_set_id, account_set_id, account_set_id, account_set_id, account_set_id, account_set_id]
  if (warehouse_code) { conds.push('a.warehouse_code=?'); params.push(warehouse_code) }
  if (keyword) { conds.push('(a.item_code LIKE ? OR i.name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  const list = db.prepare(`
    WITH AllItems AS (
      SELECT account_set_id, item_code, IFNULL(warehouse_code, '') AS warehouse_code FROM scm_stock WHERE account_set_id=?
      UNION
      -- 销售未出货：已审核销售订单(SOa)未下推发货的行
      SELECT d.account_set_id, l.item_code, IFNULL(l.warehouse_code, '') AS warehouse_code
      FROM scm_doc_line l JOIN scm_doc d ON d.id = l.doc_id
      WHERE d.account_set_id=? AND d.doc_type='SOa' AND d.status='audited'
        AND l.qty > (SELECT COALESCE(SUM(l2.qty), 0) FROM scm_doc_line l2 WHERE l2.source_line_id = l.id)
      UNION
      -- 采购未入库：已审核采购订单(PO)未下推入库的行
      SELECT d.account_set_id, l.item_code, IFNULL(l.warehouse_code, '') AS warehouse_code
      FROM scm_doc_line l JOIN scm_doc d ON d.id = l.doc_id
      WHERE d.account_set_id=? AND d.doc_type='PO' AND d.status='audited'
        AND l.qty > (SELECT COALESCE(SUM(l2.qty), 0) FROM scm_doc_line l2 WHERE l2.source_line_id = l.id)
      UNION
      -- 计划未入库：已下达计划成品（成品仓）
      SELECT p.account_set_id, p.item_code, IFNULL(p.fp_warehouse, '') AS warehouse_code
      FROM scm_production_plan p
      WHERE p.account_set_id=? AND p.status='released' AND p.plan_qty > COALESCE(p.finished_qty, 0)
      UNION
      -- 计划未领用：已下达计划的「实际执行 BOM」材料（行仓库优先、原料仓兜底）
      SELECT p.account_set_id, bl.item_code, IFNULL(NULLIF(bl.warehouse_code, ''), IFNULL(p.yl_warehouse, '')) AS warehouse_code
      FROM scm_production_plan p JOIN scm_production_plan_line bl ON bl.plan_id = p.id
      WHERE p.account_set_id=? AND p.status='released'
    )
    SELECT a.item_code, a.warehouse_code, i.name AS item_name, i.spec, i.unit, w.name AS warehouse_name,
      COALESCE(s.qty, 0) AS qty, COALESCE(s.amount, 0) AS amount, COALESCE(s.avg_cost, 0) AS avg_cost,
      (
        SELECT COALESCE(SUM(l.qty - (SELECT COALESCE(SUM(l2.qty), 0) FROM scm_doc_line l2 WHERE l2.source_line_id = l.id)), 0)
        FROM scm_doc_line l JOIN scm_doc d ON d.id = l.doc_id
        WHERE d.account_set_id = a.account_set_id AND d.doc_type = 'SOa' AND d.status = 'audited'
          AND l.item_code = a.item_code AND IFNULL(l.warehouse_code, '') = a.warehouse_code
      ) AS unshipped_sales_qty,
      (
        SELECT COALESCE(SUM(l.qty - (SELECT COALESCE(SUM(l2.qty), 0) FROM scm_doc_line l2 WHERE l2.source_line_id = l.id)), 0)
        FROM scm_doc_line l JOIN scm_doc d ON d.id = l.doc_id
        WHERE d.account_set_id = a.account_set_id AND d.doc_type = 'PO' AND d.status = 'audited'
          AND l.item_code = a.item_code AND IFNULL(l.warehouse_code, '') = a.warehouse_code
      ) AS unreceived_purchase_qty,
      (
        SELECT COALESCE(SUM(p.plan_qty - COALESCE(p.finished_qty, 0)), 0)
        FROM scm_production_plan p
        WHERE p.account_set_id = a.account_set_id AND p.status = 'released'
          AND p.plan_qty > COALESCE(p.finished_qty, 0)
          AND p.item_code = a.item_code AND IFNULL(p.fp_warehouse, '') = a.warehouse_code
      ) AS unfinished_plan_qty
    FROM AllItems a
    LEFT JOIN scm_stock s ON s.account_set_id=a.account_set_id AND s.item_code=a.item_code AND IFNULL(s.warehouse_code, '')=a.warehouse_code
    LEFT JOIN scm_item i ON i.account_set_id=a.account_set_id AND i.code=a.item_code
    LEFT JOIN scm_warehouse w ON w.account_set_id=a.account_set_id AND w.code=a.warehouse_code
    WHERE ${conds.join(' AND ')}
    ORDER BY a.warehouse_code, a.item_code
  `).all(...params) as any[]

  // 计划未领用（含 BOM 展开，需 JS）：已下达计划按 BOM 应领 − 已领（PL/PB/WO 出 − PJ 入），按(材料,原料仓)汇总
  const plans = db.prepare(
    "SELECT * FROM scm_production_plan WHERE account_set_id=? AND status='released'"
  ).all(account_set_id) as any[]
  const unissuedMap = new Map<string, number>()
  for (const plan of plans) {
    for (const m of computeIssueSuggestion(db, account_set_id, plan, ['PL', 'PB', 'WO', 'PJ'])) {
      if (m.suggest > 0) {
        // 按(材料, 行仓库优先/原料仓兜底)归集，与上方 CTE 仓库口径一致
        const k = `${m.item_code}|${m.warehouse_code || ''}`
        unissuedMap.set(k, r6((unissuedMap.get(k) || 0) + m.suggest))
      }
    }
  }
  for (const row of list) {
    row.unissued_plan_qty = unissuedMap.get(`${row.item_code}|${row.warehouse_code}`) || 0
  }
  // 去掉「库存与四项指标全为 0」的空行（计划材料 union 可能带入已领齐/无库存的材料）
  const data = list.filter(r =>
    Number(r.qty) || Number(r.amount) || Number(r.unshipped_sales_qty) ||
    Number(r.unreceived_purchase_qty) || Number(r.unfinished_plan_qty) || Number(r.unissued_plan_qty)
  )
  res.json({ code: 0, data })
})

// 出入库流水（库存明细账）
router.get('/scm/stock/ledger', (req: AuthRequest, res) => {
  try {
    res.json({ code: 0, data: queryStockLedger(getDb(), asid(req), req.query as unknown as StockLedgerFilters) })
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error?.message || '库存明细账查询失败' })
  }
})

router.post('/scm/stock/ledger/export', async (req: AuthRequest, res) => {
  try {
    const result = queryStockLedger(getDb(), asid(req), (req.body || {}) as StockLedgerFilters, true)
    const defs: Array<[string, string, 'text' | 'number']> = [
      ['move_date', '日期', 'text'], ['doc_type_name', '单据类型', 'text'], ['doc_no', '单据号', 'text'],
      ['item_code', '物料编码', 'text'], ['item_name', '物料名称', 'text'], ['spec', '规格', 'text'], ['unit', '单位', 'text'],
      ['warehouse_name', '仓库', 'text'], ['partner_name', '往来单位', 'text'], ['batch_no', '批次', 'text'],
      ['in_qty', '收入数量', 'number'], ['in_amount', '收入金额', 'number'], ['out_qty', '发出数量', 'number'],
      ['out_amount', '发出金额', 'number'], ['unit_cost', '单位成本', 'number'], ['running_qty', '结存数量', 'number'],
      ['running_amount', '结存金额', 'number'],
    ]
    const columns: ExportColumnSpec[] = defs.map(([, label, type]) => ({ label, width: type === 'text' ? 16 : 13, align: type === 'number' ? 'right' : 'left', type }))
    const rows = result.rows.map(row => defs.map(([key]) => row[key] ?? null))
    const summaryValues = defs.map(([key], index) => index === 0 ? '合计' : (result.summary as any)[key] ?? null)
    const buffer = await buildStyledXlsxBuffer({ sheetName: '物料收发明细账', title: '物料收发明细账',
      subtitle: '按已审核库存移动计算期初、本期收发和逐笔结存', columns, rows, summaryValues, stripe: true })
    const fileName = `物料收发明细账_${new Date().toISOString().slice(0, 10)}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.send(buffer)
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error?.message || '库存明细账导出失败' })
  }
})

// 委外执行及结存表：按委外计划成品追踪发料、完工、理论结存、加工费与应付。
router.get('/scm/report/outsource/execution', (req: AuthRequest, res) => {
  try {
    const data = queryOutsourceExecution(getDb(), asid(req), req.query as unknown as OutsourceExecutionFilters)
    res.json({ code: 0, data })
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error?.message || '委外执行表查询失败' })
  }
})

router.post('/scm/report/outsource/execution/export', async (req: AuthRequest, res) => {
  try {
    const result = queryOutsourceExecution(getDb(), asid(req), (req.body || {}) as OutsourceExecutionFilters, true)
    const defs: Array<[string, string, 'text' | 'number']> = [
      ['plan_code', '委外计划号', 'text'], ['start_date', '开始日期', 'text'], ['supplier_name', '委外厂', 'text'],
      ['item_code', '成品编码', 'text'], ['item_name', '成品名称', 'text'], ['spec', '规格', 'text'],
      ['plan_qty', '计划数量', 'number'], ['finished_qty', '已入库', 'number'], ['remaining_qty', '未完成', 'number'],
      ['completion_rate', '完成率%', 'number'], ['outsource_issue_qty', '委外发料数量', 'number'],
      ['outsource_return_qty', '委外退料数量', 'number'], ['issued_material_qty', '净发料数量', 'number'],
      ['issued_material_cost', '材料成本', 'number'], ['theoretical_balance', '委外厂理论结存', 'text'],
      ['fee_ex_tax', '税前加工费', 'number'], ['fee_tax', '税额', 'number'], ['fee_gross', '含税加工费', 'number'],
      ['payable_amount', '应付', 'number'], ['paid_amount', '已付', 'number'], ['outstanding_amount', '未付', 'number'],
      ['execution_status', '执行状态', 'text'],
    ]
    const columns: ExportColumnSpec[] = defs.map(([, label, type]) => ({ label, width: type === 'text' ? 18 : 14, align: type === 'number' ? 'right' : 'left', type }))
    const rows = result.rows.map(row => defs.map(([key]) => row[key] ?? null))
    const buffer = await buildStyledXlsxBuffer({ sheetName: '委外执行及结存', title: '委外执行及结存表',
      subtitle: '理论结存=已审核委外发料−退料−已完工标准耗用；加工费应付按价税合计', columns, rows, stripe: true })
    const fileName = `委外执行及结存表_${new Date().toISOString().slice(0, 10)}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.send(buffer)
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error?.message || '委外执行表导出失败' })
  }
})

// ── 报表：生产执行及在制结存表（自制工单；委外见 /scm/report/outsource/execution） ──
router.get('/scm/report/production/execution', (req: AuthRequest, res) => {
  try {
    const data = queryProductionExecution(getDb(), asid(req), req.query as unknown as ProductionExecutionFilters)
    res.json({ code: 0, data })
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error?.message || '生产执行表查询失败' })
  }
})

router.post('/scm/report/production/execution/export', async (req: AuthRequest, res) => {
  try {
    const result = queryProductionExecution(getDb(), asid(req), (req.body || {}) as ProductionExecutionFilters, true)
    const defs: Array<[string, string, 'text' | 'number']> = [
      ['plan_code', '工单号', 'text'], ['start_date', '开工日期', 'text'],
      ['item_code', '成品编码', 'text'], ['item_name', '成品名称', 'text'], ['spec', '规格', 'text'],
      ['plan_qty', '计划数量', 'number'], ['finished_qty', '已完工', 'number'], ['scrap_qty', '已报废', 'number'],
      ['remaining_qty', '未完工', 'number'], ['completion_rate', '完成率%', 'number'], ['scrap_rate', '报废率%', 'number'],
      ['issued_material_qty', '净领料数量', 'number'], ['issued_material_cost', '已领料成本', 'number'],
      ['mat_unit_cost', '每件料成本', 'number'], ['consumed_cost', '已消耗料成本', 'number'],
      ['material_wip', '料在制', 'number'],
      ['reported_good_qty', '报工合格数', 'number'], ['reported_scrap_qty', '报工报废数', 'number'],
      ['labor_total', '报工人工', 'number'], ['overhead_total', '报工制费', 'number'],
      ['labor_absorbed', '已吸收人工', 'number'], ['overhead_absorbed', '已吸收制费', 'number'],
      ['labor_wip', '人工制费在制', 'number'], ['total_wip', '在制合计', 'number'],
      ['execution_status', '执行状态', 'text'],
    ]
    const columns: ExportColumnSpec[] = defs.map(([, label, type]) => ({ label, width: type === 'text' ? 18 : 14, align: type === 'number' ? 'right' : 'left', type }))
    const rows = result.rows.map((row: any) => defs.map(([key]) => row[key] ?? null))
    const buffer = await buildStyledXlsxBuffer({ sheetName: '生产执行及在制结存', title: '生产执行及在制结存表',
      subtitle: '料在制=已领料成本−Σ(完工+报废)×每件料成本；人工制费在制=已审核报工累计−已吸收；在制为工单级口径', columns, rows, stripe: true })
    const fileName = `生产执行及在制结存表_${new Date().toISOString().slice(0, 10)}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.send(buffer)
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error?.message || '生产执行表导出失败' })
  }
})

// ── 报表：库存预警（现存 < 安全库存） ──────────────────────────────
router.get('/scm/report/stock-alert', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const rows = db.prepare(`
    SELECT i.code AS item_code, i.name AS item_name, i.spec, i.unit, i.safety_stock, i.supplier_code, i.lead_time_days,
           COALESCE((SELECT SUM(s.qty) FROM scm_stock s WHERE s.account_set_id=i.account_set_id AND s.item_code=i.code),0) AS on_hand,
           pp.name AS supplier_name
    FROM scm_item i
    LEFT JOIN scm_partner pp ON pp.account_set_id=i.account_set_id AND pp.code=i.supplier_code
    WHERE i.account_set_id=? AND i.enabled<>0 AND COALESCE(i.safety_stock,0) > 0
  `).all(aid) as any[]
  const data = rows
    .map(r => ({ ...r, on_hand: Number(r.on_hand) || 0, safety_stock: Number(r.safety_stock) || 0, shortage: Math.round(((Number(r.safety_stock) || 0) - (Number(r.on_hand) || 0)) * 1000000) / 1000000 }))
    .filter(r => r.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage)
  res.json({ code: 0, data })
})

// ── 报表：购销明细（按单据类型/日期，已审核）────────────────────────
function buyOrSellReport(req: AuthRequest, res: any, docType: string) {
  const db = getDb(); const aid = asid(req)
  const { start_date, end_date, item_code, partner_code } = req.query as any
  const conds = ['d.account_set_id=?', "d.doc_type=?", "d.status='audited'"]; const ps: any[] = [aid, docType]
  if (start_date) { conds.push('d.doc_date>=?'); ps.push(start_date) }
  if (end_date) { conds.push('d.doc_date<=?'); ps.push(end_date) }
  if (item_code) { conds.push('l.item_code=?'); ps.push(item_code) }
  if (partner_code) { conds.push('d.partner_code=?'); ps.push(partner_code) }
  const rows = db.prepare(`
    SELECT d.doc_no, d.doc_date, d.partner_code, p.name AS partner_name,
           l.item_code, i.name AS item_name, i.spec, l.qty, l.price,
           l.amount AS amount, ROUND(COALESCE(l.unit_cost,0)*l.qty, 2) AS cost
    FROM scm_doc_line l
    JOIN scm_doc d ON d.id=l.doc_id
    LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
    WHERE ${conds.join(' AND ')}
    ORDER BY d.doc_date, d.doc_no, l.seq
  `).all(...ps) as any[]
  res.json({ code: 0, data: rows.map(r => ({ ...r, profit: Math.round(((Number(r.amount) || 0) - (Number(r.cost) || 0)) * 100) / 100 })) })
}
// 销售报表（销售出库 SO，含成本/毛利）
router.get('/scm/report/sales', (req: AuthRequest, res) => buyOrSellReport(req, res, 'SO'))
// 采购报表（采购入库 PI）
router.get('/scm/report/purchase', (req: AuthRequest, res) => buyOrSellReport(req, res, 'PI'))

// ── 报表：采购建议（建议量 = 安全库存 − 现存 − 在途PO；在途=已审核PO未入库余量）──
router.get('/scm/report/purchase-advice', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  // 在途：已审核采购订单(PO)行数量 − 其已下推采购入库(行级 source_line_id 引用)数量
  const onway = db.prepare(`
    SELECT l.item_code AS item_code,
      COALESCE(SUM(l.qty - (SELECT COALESCE(SUM(c.qty),0) FROM scm_doc_line c WHERE c.source_line_id=l.id)),0) AS qty
    FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
    WHERE d.account_set_id=? AND d.doc_type='PO' AND d.status='audited'
    GROUP BY l.item_code
  `).all(aid) as any[]
  const onwayMap = new Map<string, number>(onway.map(r => [r.item_code, Number(r.qty) || 0]))
  const rows = db.prepare(`
    SELECT i.code AS item_code, i.name AS item_name, i.spec, i.unit, i.safety_stock, i.min_order_qty,
           i.lead_time_days, i.supplier_code, pp.name AS supplier_name,
           COALESCE((SELECT SUM(s.qty) FROM scm_stock s WHERE s.account_set_id=i.account_set_id AND s.item_code=i.code),0) AS on_hand
    FROM scm_item i
    LEFT JOIN scm_partner pp ON pp.account_set_id=i.account_set_id AND pp.code=i.supplier_code
    WHERE i.account_set_id=? AND i.enabled<>0 AND COALESCE(i.safety_stock,0) > 0
  `).all(aid) as any[]
  const data = rows.map(r => {
    const onHand = Number(r.on_hand) || 0
    const onWay = onwayMap.get(r.item_code) || 0
    const safety = Number(r.safety_stock) || 0
    const moq = Number(r.min_order_qty) || 0
    const gap = safety - onHand - onWay
    let advice = gap > 0 ? gap : 0
    if (advice > 0 && moq > 0 && advice < moq) advice = moq  // 不足起订量则按起订量
    return { ...r, on_hand: onHand, on_way: Math.round(onWay * 1000000) / 1000000, safety_stock: safety, advice_qty: Math.round(advice * 1000000) / 1000000 }
  }).filter(r => r.advice_qty > 0).sort((a, b) => b.advice_qty - a.advice_qty)
  res.json({ code: 0, data })
})

// 批次库存查询：各仓库/物料/批次的现存数量与到期日（权限 scm:stock）
router.get('/scm/batch-stock', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const { keyword, warehouse_code, batch_no } = req.query as any
  const conds = ['b.account_set_id=?', 'b.qty > 0.000001']; const params: any[] = [aid]
  if (warehouse_code) { conds.push('b.warehouse_code=?'); params.push(warehouse_code) }
  if (batch_no) { conds.push('b.batch_no LIKE ?'); params.push(`%${batch_no}%`) }
  if (keyword) { conds.push('(b.item_code LIKE ? OR i.name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  const list = db.prepare(`
    SELECT b.warehouse_code, w.name AS warehouse_name, b.item_code, i.name AS item_name, i.spec, i.unit,
           b.batch_no, b.qty, b.amount, b.produce_date, b.expire_date,
           CAST(julianday(b.expire_date) - julianday('now') AS INTEGER) AS days_to_expire
    FROM scm_stock_batch b
    LEFT JOIN scm_item i ON i.account_set_id=b.account_set_id AND i.code=b.item_code
    LEFT JOIN scm_warehouse w ON w.account_set_id=b.account_set_id AND w.code=b.warehouse_code
    WHERE ${conds.join(' AND ')}
    ORDER BY (b.expire_date IS NULL), b.expire_date ASC, b.warehouse_code, b.item_code, b.batch_no
  `).all(...params)
  res.json({ code: 0, data: list })
})

// 临期/过期预警：有到期日且现存>0 的批次，默认提前 30 天（权限 scm:report）
router.get('/scm/report/batch-alert', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const days = Math.max(0, Number((req.query as any).days) || 30)
  const list = db.prepare(`
    SELECT b.warehouse_code, w.name AS warehouse_name, b.item_code, i.name AS item_name, i.spec, i.unit,
           b.batch_no, b.qty, b.produce_date, b.expire_date,
           CAST(julianday(b.expire_date) - julianday('now') AS INTEGER) AS days_to_expire
    FROM scm_stock_batch b
    LEFT JOIN scm_item i ON i.account_set_id=b.account_set_id AND i.code=b.item_code
    LEFT JOIN scm_warehouse w ON w.account_set_id=b.account_set_id AND w.code=b.warehouse_code
    WHERE b.account_set_id=? AND b.qty > 0.000001 AND b.expire_date IS NOT NULL
      AND julianday(b.expire_date) - julianday('now') <= ?
    ORDER BY b.expire_date ASC
  `).all(aid, days) as any[]
  const data = list.map(r => ({ ...r, expired: Number(r.days_to_expire) < 0 }))
  res.json({ code: 0, data })
})

// 序列号查询：在库/已出库序列号及其所在仓与出入单据（权限 scm:stock）
router.get('/scm/serials', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const { keyword, serial_no, status, warehouse_code } = req.query as any
  const conds = ['s.account_set_id=?']; const params: any[] = [aid]
  if (status === 'in_stock' || status === 'out') { conds.push('s.status=?'); params.push(status) }
  if (warehouse_code) { conds.push('s.warehouse_code=?'); params.push(warehouse_code) }
  if (serial_no) { conds.push('s.serial_no LIKE ?'); params.push(`%${serial_no}%`) }
  if (keyword) { conds.push('(s.item_code LIKE ? OR i.name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  const list = db.prepare(`
    SELECT s.item_code, i.name AS item_name, i.spec, s.serial_no, s.warehouse_code, w.name AS warehouse_name,
           s.status, s.in_doc_no, s.out_doc_no, s.updated_at
    FROM scm_serial s
    LEFT JOIN scm_item i ON i.account_set_id=s.account_set_id AND i.code=s.item_code
    LEFT JOIN scm_warehouse w ON w.account_set_id=s.account_set_id AND w.code=s.warehouse_code
    WHERE ${conds.join(' AND ')}
    ORDER BY s.item_code, s.serial_no
    LIMIT 500
  `).all(...params)
  res.json({ code: 0, data: list })
})

export default router
