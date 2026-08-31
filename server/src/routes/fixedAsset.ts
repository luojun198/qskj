import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import {
  previewDepreciation,
  executeDepreciation,
  generateDeprVoucher,
  buildDeprLinesFromHistory,
  reverseDepreciation,
} from '../services/fixedAssetDepreciation.js'
import { disposeAsset, cancelDisposal } from '../services/assetDisposal.js'
import { generatePurchaseVoucher } from '../services/assetAcquisition.js'
import { deleteVoucherRecords } from '../services/voucherEntry.js'
import { assertVoucherEntriesInScopeById } from '../services/accountAuthorization.js'
import {
  createInventory,
  listInventories,
  getInventoryItems,
  updateInventoryItem,
  batchMarkItems,
  completeInventory,
  deleteInventory,
} from '../services/assetInventory.js'
import {
  queryDeprSummary,
  queryDeprDetail,
  queryDeprAllocation,
  queryDeprAllocationDetail,
  queryCategorySummary,
  queryDeptSummary,
  queryAssetLedger,
  queryExpiryWarning,
  queryChangeSummary,
  queryChangeDetail,
  queryChanges,
  queryDeprForecast,
} from '../services/assetReportQuery.js'
import { ensureDefaultAssetDicts } from '../services/accountSetDefaults.js'
import { createPreReinitializeBackup } from '../services/systemReinitialize.js'

const router = Router()
router.use(authMiddleware)

// ── 固定资产模块权限守卫：按路径(+方法)映射所需权限（admin '*' 自动放行） ──────
const ASSET_PERMISSION_RULES: Array<{ re: RegExp; perm: string; methods?: string[] }> = [
  { re: /^\/asset\/reset/,                  perm: 'asset:param' },     // 资产初始化（清空）
  { re: /^\/asset\/params/,                 perm: 'asset:param' },
  { re: /^\/asset\/dict/,                   perm: 'asset:dict' },     // dicts / dict/:type / dict/init
  { re: /^\/asset\/depr/,                   perm: 'asset:depr' },
  { re: /^\/asset\/workload/,               perm: 'asset:depr' },
  { re: /^\/asset\/inventory/,              perm: 'asset:inventory' },
  { re: /^\/asset\/report/,                 perm: 'asset:report' },
  { re: /^\/asset\/cards\/[^/]+\/dispose/,  perm: 'asset:dispose' },
  { re: /^\/asset\/cards/,                  perm: 'asset:view', methods: ['GET'] }, // 读卡片/明细/台账/编号
  { re: /^\/asset\/cards/,                  perm: 'asset:edit' },     // 增删改卡片
]
router.use((req: AuthRequest, res, next) => {
  if (!req.path.startsWith('/asset/')) return next()
  if (req.permissions?.includes('*')) return next()
  const rule = ASSET_PERMISSION_RULES.find(
    r => r.re.test(req.path) && (!r.methods || r.methods.includes(req.method))
  )
  if (rule && !req.permissions?.includes(rule.perm)) {
    return res.status(403).json({ code: 403, message: '无此操作权限' })
  }
  next()
})

// ── 资产参数读写（折旧起始期间等，轻量、限定 key，无需 system:account 权限） ──
const ASSET_PARAM_KEYS = ['asset:depr_start_period', 'asset:depr_voucher_type_id', 'asset:purchase_voucher_type_id', 'asset:inventory_surplus_account', 'asset:inventory_deficit_account']

// GET /asset/params — 读取资产参数
router.get('/asset/params', (req: AuthRequest, res) => {
  const db = getDb()
  const rows = db.prepare(
    `SELECT param_key, param_value FROM system_params WHERE account_set_id=? AND param_key IN (${ASSET_PARAM_KEYS.map(() => '?').join(',')})`
  ).all(req.accountSetId, ...ASSET_PARAM_KEYS) as any[]
  res.json({ code: 0, data: rows })
})

// PUT /asset/params — 保存资产参数
router.put('/asset/params', operationLog('保存资产参数', '固定资产'), (req: AuthRequest, res) => {
  const { params } = req.body
  if (!Array.isArray(params)) return res.status(400).json({ code: 400, message: '参数格式错误' })
  const db = getDb()
  const upsert = db.prepare('INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)')
  for (const p of params) {
    if (!ASSET_PARAM_KEYS.includes(p.param_key)) continue
    const val = String(p.param_value ?? '')
    // 折旧起始期间格式校验：空（清除）或 YYYY-MM
    if (p.param_key === 'asset:depr_start_period' && val && !/^\d{4}-\d{2}$/.test(val)) {
      return res.status(400).json({ code: 400, message: '折旧起始期间格式应为 YYYY-MM' })
    }
    const existing = db.prepare('SELECT id FROM system_params WHERE account_set_id=? AND param_key=?').get(req.accountSetId, p.param_key) as any
    upsert.run(existing?.id || uuidv4(), req.accountSetId, p.param_key, val)
  }
  res.json({ code: 0, message: '保存成功' })
})

// ── 固定资产初始化：清空业务数据（business）或连同基础档案（all） ──────────
router.post('/asset/reset', operationLog('资产初始化', '固定资产'), async (req: AuthRequest, res) => {
  const mode = req.body?.mode === 'all' ? 'all' : 'business'
  const db = getDb(); const aid = req.accountSetId || ''
  // 强制：清空前先完整备份本账套，备份失败则中止
  let backupFile = ''
  try {
    const b = await createPreReinitializeBackup(aid, req.userId)
    backupFile = b.filename
  } catch (e: any) {
    return res.status(500).json({ code: 500, message: e?.message || '初始化前自动备份失败，已中止操作' })
  }
  const businessTables = [
    'fixed_asset_inventory_item', 'fixed_asset_inventory', 'fixed_asset_workload',
    'fixed_asset_change', 'fixed_asset_depr', 'fixed_asset',
  ]
  const masterTables = [
    'fixed_asset_category', 'fixed_asset_dept', 'fixed_asset_purpose',
    'fixed_asset_status', 'fixed_asset_change_type',
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

/** 读取单个资产参数值（空则返回 null） */
function getAssetParamValue(db: any, accountSetId: string, key: string): string | null {
  const row = db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?').get(accountSetId, key) as any
  const v = row?.param_value
  return v ? String(v) : null
}

// ── 字典通用工具 ──────────────────────────────────────────

type DictTable = 'fixed_asset_category' | 'fixed_asset_status' | 'fixed_asset_purpose' | 'fixed_asset_dept' | 'fixed_asset_change_type'

const DICT_TABLES: Record<string, DictTable> = {
  category: 'fixed_asset_category',
  status: 'fixed_asset_status',
  purpose: 'fixed_asset_purpose',
  dept: 'fixed_asset_dept',
  change_type: 'fixed_asset_change_type',
}

// POST /asset/dict/init/:type — 初始化默认值
router.post('/asset/dict/init/:type', operationLog('固定资产字典初始化', '固定资产'), (req: AuthRequest, res) => {
  const type = req.params.type
  if (!DICT_TABLES[type]) return res.status(400).json({ code: 400, message: '未知字典类型' })
  try {
    ensureDefaultAssetDicts(getDb(), req.accountSetId || '', type)
    res.json({ code: 0, data: { ok: true } })
  } catch (e: any) {
    res.status(500).json({ code: 500, message: e.message })
  }
})

// GET /asset/dicts — 一次获取全部字典
router.get('/asset/dicts', (req: AuthRequest, res) => {
  const db = getDb()
  const asid = req.accountSetId || ''
  const result: Record<string, any[]> = {}
  for (const [key, table] of Object.entries(DICT_TABLES)) {
    result[key] = db.prepare(`SELECT * FROM ${table} WHERE account_set_id = ? ORDER BY code`).all(asid)
  }
  res.json({ code: 0, data: result })
})

// GET  /asset/dict/:type
router.get('/asset/dict/:type', (req: AuthRequest, res) => {
  const table = DICT_TABLES[req.params.type]
  if (!table) return res.status(400).json({ code: 400, message: '未知字典类型' })
  const list = getDb().prepare(`SELECT * FROM ${table} WHERE account_set_id = ? ORDER BY code`).all(req.accountSetId || '')
  res.json({ code: 0, data: list })
})

// POST /asset/dict/:type
router.post('/asset/dict/:type', operationLog('固定资产字典新增', '固定资产'), (req: AuthRequest, res) => {
  const table = DICT_TABLES[req.params.type]
  if (!table) return res.status(400).json({ code: 400, message: '未知字典类型' })
  const { 
    code, name, salvage_rate, account_code, 
    depr_account_code, impairment_account_code, clearing_account_code,
    depreciable, expense_account, direction 
  } = req.body
  if (!code || !name) return res.status(400).json({ code: 400, message: '编码和名称不能为空' })
  const db = getDb()
  if (db.prepare(`SELECT id FROM ${table} WHERE account_set_id=? AND code=?`).get(req.accountSetId, code)) {
    return res.status(409).json({ code: 409, message: '编码已存在' })
  }
  const id = uuidv4()
  if (table === 'fixed_asset_category') {
    db.prepare(`INSERT INTO fixed_asset_category (id,account_set_id,code,name,salvage_rate,account_code,depr_account_code,impairment_account_code,clearing_account_code) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, req.accountSetId, code, name, salvage_rate ?? null, account_code ?? null, depr_account_code ?? null, impairment_account_code ?? null, clearing_account_code ?? null)
  } else if (table === 'fixed_asset_status') {
    db.prepare(`INSERT INTO fixed_asset_status (id,account_set_id,code,name,depreciable) VALUES (?,?,?,?,?)`)
      .run(id, req.accountSetId, code, name, depreciable ?? 1)
  } else if (table === 'fixed_asset_purpose') {
    db.prepare(`INSERT INTO fixed_asset_purpose (id,account_set_id,code,name,expense_account) VALUES (?,?,?,?,?)`)
      .run(id, req.accountSetId, code, name, expense_account ?? null)
  } else if (table === 'fixed_asset_change_type') {
    db.prepare(`INSERT INTO fixed_asset_change_type (id,account_set_id,code,name,direction) VALUES (?,?,?,?,?)`)
      .run(id, req.accountSetId, code, name, direction ?? 'increase')
  } else {
    db.prepare(`INSERT INTO fixed_asset_dept (id,account_set_id,code,name) VALUES (?,?,?,?)`)
      .run(id, req.accountSetId, code, name)
  }
  res.json({ code: 0, data: { id } })
})

// PUT /asset/dict/:type/:id
router.put('/asset/dict/:type/:id', operationLog('固定资产字典修改', '固定资产'), (req: AuthRequest, res) => {
  const table = DICT_TABLES[req.params.type]
  if (!table) return res.status(400).json({ code: 400, message: '未知字典类型' })
  const db = getDb()
  const row = db.prepare(`SELECT id FROM ${table} WHERE id=? AND account_set_id=?`).get(req.params.id, req.accountSetId)
  if (!row) return res.status(404).json({ code: 404, message: '记录不存在' })
  const { 
    name, salvage_rate, account_code, 
    depr_account_code, impairment_account_code, clearing_account_code,
    depreciable, expense_account, direction 
  } = req.body
  if (table === 'fixed_asset_category') {
    db.prepare(`UPDATE fixed_asset_category SET 
      name=COALESCE(?,name), 
      salvage_rate=COALESCE(?,salvage_rate), 
      account_code=COALESCE(?,account_code),
      depr_account_code=COALESCE(?,depr_account_code),
      impairment_account_code=COALESCE(?,impairment_account_code),
      clearing_account_code=COALESCE(?,clearing_account_code)
      WHERE id=?`)
      .run(name, salvage_rate, account_code, depr_account_code, impairment_account_code, clearing_account_code, req.params.id)
  } else if (table === 'fixed_asset_status') {
    db.prepare(`UPDATE fixed_asset_status SET name=COALESCE(?,name), depreciable=COALESCE(?,depreciable) WHERE id=?`)
      .run(name, depreciable, req.params.id)
  } else if (table === 'fixed_asset_purpose') {
    db.prepare(`UPDATE fixed_asset_purpose SET name=COALESCE(?,name), expense_account=COALESCE(?,expense_account) WHERE id=?`)
      .run(name, expense_account, req.params.id)
  } else if (table === 'fixed_asset_change_type') {
    db.prepare(`UPDATE fixed_asset_change_type SET name=COALESCE(?,name), direction=COALESCE(?,direction) WHERE id=?`)
      .run(name, direction, req.params.id)
  } else {
    db.prepare(`UPDATE fixed_asset_dept SET name=COALESCE(?,name) WHERE id=?`).run(name, req.params.id)
  }
  res.json({ code: 0, data: { ok: true } })
})

// DELETE /asset/dict/:type/:id
router.delete('/asset/dict/:type/:id', operationLog('固定资产字典删除', '固定资产'), (req: AuthRequest, res) => {
  const table = DICT_TABLES[req.params.type]
  if (!table) return res.status(400).json({ code: 400, message: '未知字典类型' })
  const db = getDb()
  const row = db.prepare(`SELECT id FROM ${table} WHERE id=? AND account_set_id=?`).get(req.params.id, req.accountSetId)
  if (!row) return res.status(404).json({ code: 404, message: '记录不存在' })
  db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id)
  res.json({ code: 0, data: { ok: true } })
})

// ── 固定资产卡片 ──────────────────────────────────────────

// GET /asset/cards — 列表（支持多条件筛选、分页）
router.get('/asset/cards', (req: AuthRequest, res) => {
  const db = getDb()
  const asid = req.accountSetId || ''
  const { keyword, category_code, status_code, dept_code, page = '1', page_size = '20' } = req.query as Record<string, string>

  const conds = ['account_set_id = ?']
  const params: any[] = [asid]
  if (keyword) {
    conds.push('(asset_no LIKE ? OR asset_name LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }
  if (category_code) { conds.push('category_code = ?'); params.push(category_code) }
  if (status_code) { conds.push('status_code = ?'); params.push(status_code) }
  if (dept_code) { conds.push('dept_code = ?'); params.push(dept_code) }

  const where = `WHERE ${conds.join(' AND ')}`
  const total = (db.prepare(`SELECT COUNT(*) c FROM fixed_asset ${where}`).get(...params) as any).c
  const offset = (parseInt(page) - 1) * parseInt(page_size)
  const rows = db.prepare(`SELECT * FROM fixed_asset ${where} ORDER BY asset_no LIMIT ? OFFSET ?`).all(...params, parseInt(page_size), offset)

  // 附加字典名称
  const catMap = new Map(db.prepare('SELECT code,name FROM fixed_asset_category WHERE account_set_id=?').all(asid).map((r: any) => [r.code, r.name]))
  const staMap = new Map(db.prepare('SELECT code,name FROM fixed_asset_status WHERE account_set_id=?').all(asid).map((r: any) => [r.code, r.name]))
  const deptMap = new Map(db.prepare('SELECT code,name FROM fixed_asset_dept WHERE account_set_id=?').all(asid).map((r: any) => [r.code, r.name]))
  const purpMap = new Map(db.prepare('SELECT code,name FROM fixed_asset_purpose WHERE account_set_id=?').all(asid).map((r: any) => [r.code, r.name]))

  const enriched = (rows as any[]).map(r => ({
    ...r,
    category_name: catMap.get(r.category_code) || r.category_code,
    status_name: staMap.get(r.status_code) || r.status_code,
    dept_name: deptMap.get(r.dept_code) || r.dept_code,
    purpose_name: purpMap.get(r.purpose_code) || r.purpose_code,
  }))

  res.json({ code: 0, data: { list: enriched, total, page: parseInt(page), page_size: parseInt(page_size) } })
})

// GET /asset/cards/next-no — 自动生成下一个资产编号
// 规则：解析「前缀(字母/-/_) + 数字」格式，取数字最大者的前缀与宽度 +1（如 ZC001→ZC002）；无可解析编号则 0001
router.get('/asset/cards/next-no', (req: AuthRequest, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT asset_no FROM fixed_asset WHERE account_set_id=?').all(req.accountSetId || '') as Array<{ asset_no: string }>
  let maxNum = -1
  let width = 4
  let prefix = ''
  for (const r of rows) {
    const m = String(r.asset_no || '').match(/^([A-Za-z\-_]*)(\d+)$/)
    if (m) {
      const n = parseInt(m[2], 10)
      if (n >= maxNum) {
        maxNum = n
        width = m[2].length
        prefix = m[1]
      }
    }
  }
  const nextNo = maxNum < 0 ? '0001' : prefix + String(maxNum + 1).padStart(width, '0')
  res.json({ code: 0, data: { next_no: nextNo } })
})

// GET /asset/cards/:id
router.get('/asset/cards/:id', (req: AuthRequest, res) => {
  const row = getDb().prepare('SELECT * FROM fixed_asset WHERE id=? AND account_set_id=?').get(req.params.id, req.accountSetId || '')
  if (!row) return res.status(404).json({ code: 404, message: '资产不存在' })
  res.json({ code: 0, data: row })
})

// POST /asset/cards
router.post('/asset/cards', operationLog('固定资产新增', '固定资产'), (req: AuthRequest, res) => {
  const { asset_no, asset_name } = req.body
  if (!asset_no || !asset_name) return res.status(400).json({ code: 400, message: '编号和名称不能为空' })
  const db = getDb()
  if (db.prepare('SELECT id FROM fixed_asset WHERE account_set_id=? AND asset_no=?').get(req.accountSetId, asset_no)) {
    return res.status(409).json({ code: 409, message: '资产编号已存在' })
  }
  const id = uuidv4()
  const {
    asset_name: nm, category_code, status_code, dept_code, purpose_code,
    acquire_date, start_depr_date, original_value = 0, salvage_rate = 0, salvage_value = 0,
    depr_method, use_months, use_years, total_workload, card_no, qty = 1, unit,
    user_name, keeper, source, install_place, remark,
    accum_depr = 0, depr_months_done = 0
  } = req.body
  // 计算净值：原值 - 累计折旧 (不扣除残值，残值是在提完折旧后剩余的金额)
  const net_value = Number(original_value) - Number(accum_depr)
  db.prepare(
    `INSERT INTO fixed_asset
      (id,account_set_id,asset_no,asset_name,category_code,status_code,dept_code,purpose_code,
       acquire_date,start_depr_date,original_value,salvage_rate,salvage_value,depr_method,
       use_months,use_years,total_workload,accum_depr,depr_months_done,net_value,card_no,qty,unit,user_name,keeper,source,install_place,remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, req.accountSetId, asset_no, nm ?? asset_name, category_code ?? null, status_code ?? null,
    dept_code ?? null, purpose_code ?? null, acquire_date ?? null, start_depr_date ?? null,
    Number(original_value), Number(salvage_rate), Number(salvage_value), depr_method ?? null,
    use_months ?? null, use_years ?? null, total_workload ?? null,
    Number(accum_depr), Number(depr_months_done), net_value,
    card_no ?? null, qty, unit ?? null, user_name ?? null, keeper ?? null,
    source ?? null, install_place ?? null, remark ?? null
  )

  // 可选：生成购置凭证（借固定资产/贷资金来源），按「购买资产凭证类型」参数
  let voucherResult: any = null
  let voucherWarning: string | null = null
  if (req.body.generate_voucher) {
    try {
      const assetRow = db.prepare('SELECT * FROM fixed_asset WHERE id=?').get(id) as any
      voucherResult = generatePurchaseVoucher({
        db,
        accountSetId: req.accountSetId || '',
        asset: assetRow,
        creditAccount: req.body.credit_account || '1001',
        voucherTypeId: getAssetParamValue(db, req.accountSetId || '', 'asset:purchase_voucher_type_id'),
        makerName: (req as any).userName || '系统',
      })
      // 科目授权：购置凭证分录科目须在授权范围内，否则撤销凭证（资产仍保留）
      const scopeErr = assertVoucherEntriesInScopeById(db, req.accountScope, voucherResult.voucherId, req.accountSetId || '')
      if (scopeErr) {
        deleteVoucherRecords(db, voucherResult.voucherId)
        voucherResult = null
        throw new Error(scopeErr)
      }
    } catch (e: any) {
      voucherWarning = e.message
    }
  }

  res.json({ code: 0, data: { id, voucher: voucherResult, voucherWarning } })
})

// PUT /asset/cards/:id
router.put('/asset/cards/:id', operationLog('固定资产修改', '固定资产'), (req: AuthRequest, res) => {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM fixed_asset WHERE id=? AND account_set_id=?').get(req.params.id, req.accountSetId)
  if (!existing) return res.status(404).json({ code: 404, message: '资产不存在' })
  const {
    asset_name, category_code, status_code, dept_code, purpose_code,
    acquire_date, start_depr_date, original_value, salvage_rate, salvage_value,
    depr_method, use_months, use_years, total_workload, card_no, qty, unit,
    user_name, keeper, source, install_place, remark, scrap_reason, scrap_date,
    accum_depr, depr_months_done
  } = req.body
  // 若修改了原值/累计折旧，重算净值
  const cur = db.prepare('SELECT original_value, salvage_value, accum_depr, depr_months_done FROM fixed_asset WHERE id=?').get(req.params.id) as any
  const ov = original_value !== undefined ? Number(original_value) : cur.original_value
  const ad = accum_depr !== undefined ? Number(accum_depr) : cur.accum_depr
  const net = ov - ad
  db.prepare(
    `UPDATE fixed_asset SET
      asset_name=COALESCE(?,asset_name), category_code=COALESCE(?,category_code),
      status_code=COALESCE(?,status_code), dept_code=COALESCE(?,dept_code),
      purpose_code=COALESCE(?,purpose_code), acquire_date=COALESCE(?,acquire_date),
      start_depr_date=COALESCE(?,start_depr_date), original_value=?,
      salvage_rate=COALESCE(?,salvage_rate), salvage_value=?,
      depr_method=COALESCE(?,depr_method), use_months=COALESCE(?,use_months),
      use_years=COALESCE(?,use_years), total_workload=COALESCE(?,total_workload),
      accum_depr=?, depr_months_done=COALESCE(?,depr_months_done),
      net_value=?, card_no=COALESCE(?,card_no), qty=COALESCE(?,qty),
      unit=COALESCE(?,unit), user_name=COALESCE(?,user_name), keeper=COALESCE(?,keeper),
      source=COALESCE(?,source), install_place=COALESCE(?,install_place),
      remark=COALESCE(?,remark), scrap_reason=COALESCE(?,scrap_reason),
      scrap_date=COALESCE(?,scrap_date), updated_at=datetime('now')
     WHERE id=?`
  ).run(
    asset_name, category_code, status_code, dept_code, purpose_code,
    acquire_date, start_depr_date, ov, salvage_rate, salvage_value,
    depr_method, use_months, use_years, total_workload,
    ad, depr_months_done, net,
    card_no, qty, unit, user_name, keeper, source, install_place, remark,
    scrap_reason, scrap_date, req.params.id
  )
  res.json({ code: 0, data: { ok: true } })
})

// DELETE /asset/cards/:id
router.delete('/asset/cards/:id', operationLog('固定资产删除', '固定资产'), (req: AuthRequest, res) => {
  const db = getDb()
  const row = db.prepare('SELECT id, asset_no FROM fixed_asset WHERE id=? AND account_set_id=?').get(req.params.id, req.accountSetId) as any
  if (!row) return res.status(404).json({ code: 404, message: '资产不存在' })

  // 该资产的购置凭证（asset_purchase，按 remark 中「（编号 X）」匹配）：连带删除；已记账则拦截
  const purchaseVouchers = db.prepare(
    "SELECT id, status FROM vouchers WHERE account_set_id=? AND source='asset_purchase' AND remark LIKE ?"
  ).all(req.accountSetId, `%（编号 ${row.asset_no}）%`) as Array<{ id: string; status: string }>
  if (purchaseVouchers.some(v => v.status === 'posted')) {
    return res.status(400).json({ code: 400, message: '该资产的购置凭证已记账，请先取消记账后再删除资产' })
  }

  let deletedVouchers = 0
  db.transaction(() => {
    for (const v of purchaseVouchers) {
      deleteVoucherRecords(db, v.id)
      deletedVouchers++
    }
    db.prepare('DELETE FROM fixed_asset_change WHERE account_set_id=? AND asset_no=?').run(req.accountSetId, row.asset_no)
    db.prepare('DELETE FROM fixed_asset_depr WHERE account_set_id=? AND asset_no=?').run(req.accountSetId, row.asset_no)
    db.prepare('DELETE FROM fixed_asset WHERE id=?').run(req.params.id)
  })()
  res.json({ code: 0, data: { ok: true, deletedPurchaseVouchers: deletedVouchers } })
})

// GET /asset/cards/:id/depr — 月折旧记录
router.get('/asset/cards/:id/depr', (req: AuthRequest, res) => {
  const db = getDb()
  const asset = db.prepare('SELECT asset_no FROM fixed_asset WHERE id=? AND account_set_id=?').get(req.params.id, req.accountSetId) as any
  if (!asset) return res.status(404).json({ code: 404, message: '资产不存在' })
  const rows = db.prepare('SELECT * FROM fixed_asset_depr WHERE account_set_id=? AND asset_no=? ORDER BY year,month').all(req.accountSetId, asset.asset_no)
  res.json({ code: 0, data: rows })
})

// GET /asset/cards/:id/changes — 变动流水
router.get('/asset/cards/:id/changes', (req: AuthRequest, res) => {
  const db = getDb()
  const asset = db.prepare('SELECT asset_no FROM fixed_asset WHERE id=? AND account_set_id=?').get(req.params.id, req.accountSetId) as any
  if (!asset) return res.status(404).json({ code: 404, message: '资产不存在' })
  const rows = db.prepare('SELECT * FROM fixed_asset_change WHERE account_set_id=? AND asset_no=? ORDER BY change_date DESC').all(req.accountSetId, asset.asset_no)
  res.json({ code: 0, data: rows })
})

// POST /asset/cards/:id/dispose — 资产处置
router.post(
  '/asset/cards/:id/dispose',
  operationLog('固定资产处置', '固定资产'),
  (req: AuthRequest, res) => {
    try {
      const result = disposeAsset({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        assetId: req.params.id,
        changeTypeCode: req.body.change_type_code ?? null,
        scrapDate: req.body.scrap_date,
        scrapReason: req.body.scrap_reason ?? null,
        disposalIncome: req.body.disposal_income ?? 0,
        disposalExpense: req.body.disposal_expense ?? 0,
        accumAccount: req.body.accum_account ?? '1602',
        clearingAccount: req.body.clearing_account ?? '1606',
        generateVoucher: req.body.generate_voucher ?? false,
        operatorName: (req as any).userName || '系统',
      })
      res.json({ code: 0, data: result })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message })
    }
  }
)

// POST /asset/cards/:id/dispose/cancel — 撤销处置（与反折旧对称）
router.post(
  '/asset/cards/:id/dispose/cancel',
  operationLog('固定资产撤销处置', '固定资产'),
  (req: AuthRequest, res) => {
    try {
      const result = cancelDisposal({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        assetId: req.params.id,
      })
      res.json({ code: 0, data: result })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message })
    }
  }
)

// ── 折旧计算 ──────────────────────────────────────────────

// GET /asset/workload?year=&month=  — 查询工作量
router.get('/asset/workload', (req: AuthRequest, res) => {
  const year = parseInt(req.query.year as string)
  const month = parseInt(req.query.month as string)
  if (!year || !month) return res.status(400).json({ code: 400, message: '请提供年份和月份' })
  const rows = getDb().prepare(
    'SELECT asset_no, workload FROM fixed_asset_workload WHERE account_set_id=? AND year=? AND month=?'
  ).all(req.accountSetId, year, month) as any[]
  const map: Record<string, number> = {}
  for (const r of rows) map[r.asset_no] = r.workload
  res.json({ code: 0, data: map })
})

// POST /asset/workload  — 保存工作量
router.post('/asset/workload', (req: AuthRequest, res) => {
  const { year, month, workloads } = req.body  // workloads: { asset_no: number, ... }
  if (!year || !month) return res.status(400).json({ code: 400, message: '请提供年份和月份' })
  const db = getDb()
  const asid = req.accountSetId || ''
  const upsert = db.prepare(`
    INSERT INTO fixed_asset_workload (id, account_set_id, asset_no, year, month, workload, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(account_set_id, asset_no, year, month) DO UPDATE SET
      workload=excluded.workload, updated_at=datetime('now')
  `)
  db.transaction(() => {
    for (const [assetNo, wl] of Object.entries(workloads as Record<string, number>)) {
      upsert.run(uuidv4(), asid, assetNo, year, month, wl)
    }
  })()
  res.json({ code: 0, data: { ok: true, count: Object.keys(workloads).length } })
})

// GET /asset/depr/preview?year=2026&month=6  — 预览（不写库，自动读取工作量）
router.get('/asset/depr/preview', (req: AuthRequest, res) => {
  const year = parseInt(req.query.year as string)
  const month = parseInt(req.query.month as string)
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ code: 400, message: '请提供有效的年份和月份' })
  }
  // 读取当月工作量
  const wRows = getDb().prepare(
    'SELECT asset_no, workload FROM fixed_asset_workload WHERE account_set_id=? AND year=? AND month=?'
  ).all(req.accountSetId || '', year, month) as any[]
  const workloadMap: Record<string, number> = {}
  for (const r of wRows) workloadMap[r.asset_no] = r.workload

  const lines = previewDepreciation({ db: getDb(), accountSetId: req.accountSetId || '', year, month, workloadMap })
  const totalDepr = lines.reduce((s, l) => s + l.month_depr, 0)
  const workloadAssets = lines.filter(l => l.depr_method === '2')
  res.json({ code: 0, data: { lines, totalDepr: Math.round(totalDepr * 100) / 100, workloadAssets: workloadAssets.map(l => l.asset_no) } })
})

// POST /asset/depr/execute — 执行计提并可选生成凭证
router.post(
  '/asset/depr/execute',
  operationLog('固定资产计提折旧', '固定资产'),
  (req: AuthRequest, res) => {
    const { year, month, generate_voucher = false, accum_account = '1602' } = req.body
    if (!year || !month) return res.status(400).json({ code: 400, message: '年份和月份不能为空' })
    const db = getDb()
    const asid = req.accountSetId || ''

    // 顺序校验（参数驱动 + 逐月严格）：设置了折旧起始期间后，
    // 从起始期间起到本期之前的每个月都必须已生成折旧凭证，任一月缺凭证即拦截。
    const startParam = db.prepare(
      "SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='asset:depr_start_period'"
    ).get(asid) as any
    const startPeriod = startParam?.param_value as string | undefined
    if (startPeriod && /^\d{4}-\d{2}$/.test(startPeriod)) {
      const [startY, startM] = startPeriod.split('-').map(Number)
      const startYm = startY * 100 + startM
      const targetYm = year * 100 + month
      if (targetYm > startYm) {
        // 已生成折旧凭证的期间集合（起始期间 ≤ 期间 < 本期）
        const voucheredRows = db.prepare(
          "SELECT DISTINCT year, period FROM vouchers WHERE account_set_id=? AND source='asset_depr'"
        ).all(asid) as Array<{ year: number; period: number }>
        const voucheredSet = new Set(voucheredRows.map(r => r.year * 100 + r.period))
        // 从起始期间逐月迭代到本期前一月，找第一个未生成凭证的月份
        let py = startY, pm = startM
        while (py * 100 + pm < targetYm) {
          if (!voucheredSet.has(py * 100 + pm)) {
            return res.status(400).json({
              code: 400,
              message: `请先完成 ${py}年${pm}月 折旧并生成凭证后，再计提本期折旧`,
            })
          }
          pm++
          if (pm > 12) { pm = 1; py++ }
        }
      }
    }

    // 读取当月工作量用于计算
    const wRows = db.prepare(
      'SELECT asset_no, workload FROM fixed_asset_workload WHERE account_set_id=? AND year=? AND month=?'
    ).all(asid, year, month) as any[]
    const workloadMap: Record<string, number> = {}
    for (const r of wRows) workloadMap[r.asset_no] = r.workload

    const lines = previewDepreciation({ db, accountSetId: asid, year, month, workloadMap })
    if (lines.length === 0) {
      return res.json({ code: 0, data: { lines: [], totalDepr: 0, message: '本期无应计提资产' } })
    }

    let voucherResult = null
    let voucherWarning: string | null = null
    db.transaction(() => {
      executeDepreciation({ db, accountSetId: asid, year, month, lines })
      if (generate_voucher) {
        try {
          voucherResult = generateDeprVoucher({
            db, accountSetId: asid, year, month, lines,
            deprAccumAccount: accum_account,
            makerName: (req as any).userName || '系统',
            voucherTypeId: getAssetParamValue(db, asid, 'asset:depr_voucher_type_id'),
          })
          // 回写凭证关联：该期各折旧记录写入同一 voucher_id
          db.prepare('UPDATE fixed_asset_depr SET voucher_id=? WHERE account_set_id=? AND year=? AND month=?')
            .run(voucherResult.voucherId, asid, year, month)
        } catch (e: any) {
          voucherWarning = e.message
        }
      }
    })()

    res.json({
      code: 0,
      data: {
        lines,
        totalDepr: Math.round(lines.reduce((s, l) => s + l.month_depr, 0) * 100) / 100,
        assetCount: lines.length,
        voucher: voucherResult,
        voucherWarning,
      },
    })
  }
)

// GET /asset/depr/history?year=2026&month=6  — 已计提记录
router.get('/asset/depr/history', (req: AuthRequest, res) => {
  const { year, month } = req.query as Record<string, string>
  const db = getDb()
  const conds = ['fd.account_set_id = ?']
  const params: any[] = [req.accountSetId]
  if (year) { conds.push('fd.year = ?'); params.push(parseInt(year)) }
  if (month) { conds.push('fd.month = ?'); params.push(parseInt(month)) }
  const rows = db.prepare(`
    SELECT fd.*, fa.asset_name, fa.original_value,
      fp.name as purpose_name, fp.expense_account,
      fd2.name as dept_name,
      v.voucher_no as voucher_no
    FROM fixed_asset_depr fd
    LEFT JOIN fixed_asset fa ON fa.account_set_id=fd.account_set_id AND fa.asset_no=fd.asset_no
    LEFT JOIN fixed_asset_purpose fp ON fp.account_set_id=fd.account_set_id AND fp.code=fd.purpose_code
    LEFT JOIN fixed_asset_dept fd2 ON fd2.account_set_id=fd.account_set_id AND fd2.code=fd.dept_code
    LEFT JOIN vouchers v ON v.id=fd.voucher_id
    WHERE ${conds.join(' AND ')}
    ORDER BY fd.year, fd.month, fd.asset_no
  `).all(...params)
  res.json({ code: 0, data: rows })
})

// POST /asset/depr/generate-voucher — 对已计提但未生成凭证的期间补生成凭证
router.post(
  '/asset/depr/generate-voucher',
  operationLog('固定资产折旧补生成凭证', '固定资产'),
  (req: AuthRequest, res) => {
    const { year, month, accum_account = '1602' } = req.body
    if (!year || !month) return res.status(400).json({ code: 400, message: '年份和月份不能为空' })
    const db = getDb()
    const asid = req.accountSetId || ''

    // 校验该期已计提
    const deprRows = db.prepare(
      'SELECT voucher_id FROM fixed_asset_depr WHERE account_set_id=? AND year=? AND month=?'
    ).all(asid, year, month) as Array<{ voucher_id: string | null }>
    if (deprRows.length === 0) {
      return res.status(400).json({ code: 400, message: '该期间没有折旧记录，请先计提折旧' })
    }
    // 校验未生成（voucher_id 非空且对应凭证仍存在 → 已生成）
    const existingVid = deprRows.find(r => r.voucher_id)?.voucher_id
    if (existingVid) {
      const v = db.prepare('SELECT id FROM vouchers WHERE id=?').get(existingVid) as any
      if (v) return res.status(400).json({ code: 400, message: '该期间已生成凭证，请勿重复生成' })
    }

    const lines = buildDeprLinesFromHistory({ db, accountSetId: asid, year, month })
    if (lines.length === 0) {
      return res.status(400).json({ code: 400, message: '该期间无可生成凭证的折旧明细' })
    }

    let voucherResult: any = null
    try {
      db.transaction(() => {
        voucherResult = generateDeprVoucher({
          db, accountSetId: asid, year, month, lines,
          deprAccumAccount: accum_account,
          makerName: (req as any).userName || '系统',
          voucherTypeId: getAssetParamValue(db, asid, 'asset:depr_voucher_type_id'),
        })
        db.prepare('UPDATE fixed_asset_depr SET voucher_id=? WHERE account_set_id=? AND year=? AND month=?')
          .run(voucherResult.voucherId, asid, year, month)
      })()
    } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message || '生成凭证失败' })
    }
    res.json({ code: 0, data: { voucher: voucherResult } })
  }
)

// POST /asset/depr/reverse — 整期反折旧（删折旧记录 + 回退资产 + 删该期凭证）
router.post(
  '/asset/depr/reverse',
  operationLog('固定资产反折旧', '固定资产'),
  (req: AuthRequest, res) => {
    const { year, month } = req.body
    if (!year || !month) return res.status(400).json({ code: 400, message: '年份和月份不能为空' })
    const db = getDb()
    try {
      const result = reverseDepreciation({ db, accountSetId: req.accountSetId || '', year, month })
      res.json({ code: 0, data: result })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message || '反折旧失败' })
    }
  }
)

// ── 固定资产报表 ──────────────────────────────────────────

// GET /asset/report/depr-summary?year=&month=&group_by=category|dept
router.get('/asset/report/depr-summary', (req: AuthRequest, res) => {
  const year = parseInt(req.query.year as string)
  const month = parseInt(req.query.month as string)
  const groupBy = (req.query.group_by as string) || 'category'
  if (!year || !month) return res.status(400).json({ code: 400, message: '请提供年份和月份' })
  if (!['category', 'dept'].includes(groupBy)) return res.status(400).json({ code: 400, message: 'group_by 仅支持 category 或 dept' })
  const rows = queryDeprSummary({ db: getDb(), accountSetId: req.accountSetId || '', year, month, groupBy: groupBy as 'category' | 'dept' })
  const totalMonthDepr = rows.reduce((s: number, r: any) => s + r.month_depr, 0)
  res.json({ code: 0, data: { rows, totalMonthDepr: Math.round(totalMonthDepr * 100) / 100 } })
})

// GET /asset/report/depr-summary/detail?year=&month=&group_by=&group_code=
router.get('/asset/report/depr-summary/detail', (req: AuthRequest, res) => {
  const year = parseInt(req.query.year as string)
  const month = parseInt(req.query.month as string)
  const groupBy = (req.query.group_by as string) || 'category'
  const groupCode = req.query.group_code as string
  if (!year || !month || !groupCode) return res.status(400).json({ code: 400, message: '参数不完整' })
  const rows = queryDeprDetail({ db: getDb(), accountSetId: req.accountSetId || '', year, month, groupBy: groupBy as 'category' | 'dept', groupCode })
  res.json({ code: 0, data: rows })
})

// GET /asset/report/depr-allocation?year=&month=
router.get('/asset/report/depr-allocation', (req: AuthRequest, res) => {
  const year = parseInt(req.query.year as string)
  const month = parseInt(req.query.month as string)
  if (!year || !month) return res.status(400).json({ code: 400, message: '请提供年份和月份' })
  const rows = queryDeprAllocation({ db: getDb(), accountSetId: req.accountSetId || '', year, month })
  const totalDepr = rows.reduce((s: number, r: any) => s + r.total_depr, 0)
  res.json({ code: 0, data: { rows, totalDepr: Math.round(totalDepr * 100) / 100 } })
})

// GET /asset/report/depr-allocation/detail?year=&month=&expense_account=
router.get('/asset/report/depr-allocation/detail', (req: AuthRequest, res) => {
  const year = parseInt(req.query.year as string)
  const month = parseInt(req.query.month as string)
  const expenseAccount = req.query.expense_account as string
  if (!year || !month || !expenseAccount) return res.status(400).json({ code: 400, message: '参数不完整' })
  const rows = queryDeprAllocationDetail({ db: getDb(), accountSetId: req.accountSetId || '', year, month, expenseAccount })
  res.json({ code: 0, data: rows })
})

// GET /asset/report/category-summary
router.get('/asset/report/category-summary', (req: AuthRequest, res) => {
  const statusCode = req.query.status_code as string | undefined
  const rows = queryCategorySummary({ db: getDb(), accountSetId: req.accountSetId || '', statusCode })
  const totals = { asset_count: 0, total_original: 0, total_accum_depr: 0, total_net_value: 0 }
  for (const r of rows) {
    totals.asset_count += r.asset_count
    totals.total_original += r.total_original
    totals.total_accum_depr += r.total_accum_depr
    totals.total_net_value += r.total_net_value
  }
  res.json({ code: 0, data: { rows, totals } })
})

// GET /asset/report/dept-summary
router.get('/asset/report/dept-summary', (req: AuthRequest, res) => {
  const statusCode = req.query.status_code as string | undefined
  const rows = queryDeptSummary({ db: getDb(), accountSetId: req.accountSetId || '', statusCode })
  const totals = { asset_count: 0, total_original: 0, total_accum_depr: 0, total_net_value: 0 }
  for (const r of rows) {
    totals.asset_count += r.asset_count
    totals.total_original += r.total_original
    totals.total_accum_depr += r.total_accum_depr
    totals.total_net_value += r.total_net_value
  }
  res.json({ code: 0, data: { rows, totals } })
})

// GET /asset/report/expiry-warning?within_months=3
router.get('/asset/report/expiry-warning', (req: AuthRequest, res) => {
  const withinMonths = parseInt(req.query.within_months as string) || 3
  const rows = queryExpiryWarning({ db: getDb(), accountSetId: req.accountSetId || '', withinMonths })
  res.json({ code: 0, data: rows })
})

// GET /asset/cards/:id/ledger — 资产明细账（完整生命周期）
router.get('/asset/cards/:id/ledger', (req: AuthRequest, res) => {
  const result = queryAssetLedger({ db: getDb(), accountSetId: req.accountSetId || '', assetId: req.params.id })
  if (!result) return res.status(404).json({ code: 404, message: '资产不存在' })
  res.json({ code: 0, data: result })
})

// ── 增减变动报表 ──────────────────────────────────────────

// GET /asset/report/change-summary?year=&month=
router.get('/asset/report/change-summary', (req: AuthRequest, res) => {
  const year = parseInt(req.query.year as string)
  const month = parseInt(req.query.month as string)
  if (!year || !month) return res.status(400).json({ code: 400, message: '请提供年份和月份' })
  const rows = queryChangeSummary({ db: getDb(), accountSetId: req.accountSetId || '', year, month })
  const totals = { opening_original: 0, increase_amount: 0, decrease_amount: 0, closing_original: 0 }
  for (const r of rows) {
    totals.opening_original += r.opening_original
    totals.increase_amount += r.increase_amount
    totals.decrease_amount += r.decrease_amount
    totals.closing_original += r.closing_original
  }
  res.json({ code: 0, data: { rows, totals } })
})

// GET /asset/report/change-detail?year=&month=&type=increase|decrease&category_code=
router.get('/asset/report/change-detail', (req: AuthRequest, res) => {
  const year = parseInt(req.query.year as string)
  const month = parseInt(req.query.month as string)
  const changeType = (req.query.type as string) || 'increase'
  const categoryCode = req.query.category_code as string | undefined
  if (!year || !month) return res.status(400).json({ code: 400, message: '请提供年份和月份' })
  const rows = queryChangeDetail({ db: getDb(), accountSetId: req.accountSetId || '', year, month, changeType: changeType as 'increase' | 'decrease', categoryCode })
  res.json({ code: 0, data: rows })
})

// GET /asset/report/changes?year=&month=&asset_no=&page=&page_size=
router.get('/asset/report/changes', (req: AuthRequest, res) => {
  const { year, month, asset_no, page = '1', page_size = '20' } = req.query as Record<string, string>
  const result = queryChanges({
    db: getDb(),
    accountSetId: req.accountSetId || '',
    year: year ? parseInt(year) : undefined,
    month: month ? parseInt(month) : undefined,
    assetNo: asset_no,
    page: parseInt(page),
    pageSize: parseInt(page_size),
  })
  res.json({ code: 0, data: result })
})

// GET /asset/report/depr-forecast?months=12
router.get('/asset/report/depr-forecast', (req: AuthRequest, res) => {
  const months = parseInt(req.query.months as string) || 12
  const rows = queryDeprForecast({ db: getDb(), accountSetId: req.accountSetId || '', months: Math.min(months, 60) })
  res.json({ code: 0, data: rows })
})

// ── 资产盘点 ──────────────────────────────────────────────

// GET /asset/inventory — 盘点列表
router.get('/asset/inventory', (req: AuthRequest, res) => {
  const rows = listInventories({ db: getDb(), accountSetId: req.accountSetId || '' })
  res.json({ code: 0, data: rows })
})

// POST /asset/inventory — 创建盘点
router.post('/asset/inventory', operationLog('固定资产盘点创建', '固定资产'), (req: AuthRequest, res) => {
  const { name, inventory_date, remark } = req.body
  if (!name || !inventory_date) return res.status(400).json({ code: 400, message: '请填写盘点名称和日期' })
  const id = createInventory({ db: getDb(), accountSetId: req.accountSetId || '', name, inventoryDate: inventory_date, remark })
  res.json({ code: 0, data: { id } })
})

// GET /asset/inventory/:id — 盘点明细
router.get('/asset/inventory/:id', (req: AuthRequest, res) => {
  const result = getInventoryItems({ db: getDb(), accountSetId: req.accountSetId || '', inventoryId: req.params.id })
  if (!result.inventory) return res.status(404).json({ code: 404, message: '盘点不存在' })
  res.json({ code: 0, data: result })
})

// PUT /asset/inventory/item/:itemId — 更新盘点明细
router.put('/asset/inventory/item/:itemId', operationLog('固定资产盘点结果录入', '固定资产'), (req: AuthRequest, res) => {
  try {
    updateInventoryItem({
      db: getDb(), accountSetId: req.accountSetId || '', itemId: req.params.itemId,
      actualQty: req.body.actual_qty ?? 1,
      actualStatus: req.body.actual_status ?? 'normal',
      differenceNote: req.body.difference_note,
    })
    res.json({ code: 0, data: { ok: true } })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e.message })
  }
})

// POST /asset/inventory/:id/batch — 批量标记
router.post('/asset/inventory/:id/batch', operationLog('固定资产盘点批量标记', '固定资产'), (req: AuthRequest, res) => {
  batchMarkItems({
    db: getDb(), accountSetId: req.accountSetId || '',
    inventoryId: req.params.id,
    itemIds: req.body.item_ids || [],
    actualStatus: req.body.actual_status || 'normal',
  })
  res.json({ code: 0, data: { ok: true } })
})

// POST /asset/inventory/:id/complete — 完成盘点
router.post('/asset/inventory/:id/complete', operationLog('固定资产盘点完成', '固定资产'), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const asid = req.accountSetId || ''
    const result = completeInventory({
      db, accountSetId: asid,
      inventoryId: req.params.id,
      generateVoucher: req.body.generate_voucher ?? false,
      accumAccount: req.body.accum_account ?? '1602',
      surplusAccount: getAssetParamValue(db, asid, 'asset:inventory_surplus_account') || '6901',
      deficitAccount: getAssetParamValue(db, asid, 'asset:inventory_deficit_account') || '6901',
      operatorName: (req as any).userName || '系统',
    })
    res.json({ code: 0, data: result })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e.message })
  }
})

// DELETE /asset/inventory/:id — 删除盘点
router.delete('/asset/inventory/:id', operationLog('固定资产盘点删除', '固定资产'), (req: AuthRequest, res) => {
  try {
    deleteInventory({ db: getDb(), accountSetId: req.accountSetId || '', inventoryId: req.params.id })
    res.json({ code: 0, data: { ok: true } })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e.message })
  }
})

export default router
