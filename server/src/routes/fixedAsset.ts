import { Router } from 'express'
import { firstNonLeafError } from '../services/accountReferences.js'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import {
  previewDepreciation,
  executeDepreciation,
  generateDeprVoucher,
  reverseDepreciation,
} from '../services/fixedAssetDepreciation.js'
import {
  listAssetVouchers,
  deleteAssetVoucherOnly,
  regenerateAssetVoucher,
  generateDeprVoucherForPeriod,
  isAssetVoucherKind,
  type AssetVoucherKind,
} from '../services/assetVoucherManage.js'
import { disposeAsset, cancelDisposal } from '../services/assetDisposal.js'
import { generatePurchaseVoucher } from '../services/assetAcquisition.js'
import { deleteVoucherRecords, normalizeRequestedVoucherTypeId } from '../services/voucherEntry.js'
import { queryDeprRecords } from '../services/assetDeprQuery.js'
import { assertPeriodOpen, latestWritablePeriodKey, assetCardAuxWarnings, normalizeSalvageRate } from '../services/assetVoucherBuilder.js'
import { deleteVoucherWithRefs } from '../services/voucherDelete.js'
import { getVoucherImmutableReason, assertPeriodNotBeforeGlStart } from '../services/voucherMutationGuard.js'
import { getDictDeleteBlockReason, buildAssetCardUpdate, getCardValueLockReason } from '../services/assetCard.js'
import {
  applyAssetChange,
  revokeAssetChange,
  listAssetChanges,
  getAssetChange,
  ASSET_CHANGE_KIND_LABELS,
  DEPR_FACTOR_FIELDS,
} from '../services/assetChange.js'
import {
  createRequisition,
  deleteRequisition,
  listRequisitions,
  getAssetRequisitions,
} from '../services/assetRequisition.js'
import { batchApplyAssetChange, BATCH_CHANGE_KINDS } from '../services/assetChange.js'
import {
  batchImportAssets,
  loadImportDicts,
  validateImportRow,
  ASSET_IMPORT_COLUMNS,
  normalizeDate,
} from '../services/assetBatchImport.js'
import fsp from 'fs/promises'
import path from 'path'
import multer from 'multer'
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
import { getUploadsDir, resolveUploadFile } from '../utils/runtimePaths.js'

// ── 资产卡片附件上传配置（与出纳附件同口径：30MB / 10 个 / 图片·PDF·Office）──
const ALLOWED_ASSET_ATTACHMENT_MIMES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

const assetAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_ASSET_ATTACHMENT_MIMES.includes(file.mimetype)) {
      return cb(new Error(`不支持的文件类型: ${file.mimetype}，仅允许图片、PDF 和 Office 文档`))
    }
    cb(null, true)
  },
})

/** 部分浏览器把 UTF-8 文件名按 latin1 发过来，这里还原（与出纳附件一致） */
function fixAssetGarbledFilename(str: string): string {
  if (!str || typeof str !== 'string') return str
  const latin1Buf = Buffer.from(str, 'latin1')
  const fixed = new TextDecoder('utf-8', { fatal: false }).decode(latin1Buf)
  if (fixed && fixed !== str) {
    const reencoded = Buffer.from(fixed, 'utf-8')
    if (reencoded.equals(latin1Buf)) return fixed
  }
  return str
}

const router = Router()
router.use(authMiddleware)

// ── 固定资产模块权限守卫：按路径(+方法)映射所需权限（admin '*' 自动放行） ──────
const ASSET_PERMISSION_RULES: Array<{ re: RegExp; perm: string | string[]; methods?: string[] }> = [
  { re: /^\/asset\/reset/,                  perm: 'asset:param' },     // 资产初始化（清空）
  { re: /^\/asset\/params/,                 perm: 'asset:param' },
  { re: /^\/asset\/dict/,                   perm: 'asset:dict' },     // dicts / dict/:type / dict/init
  { re: /^\/asset\/depr/,                   perm: 'asset:depr' },
  // 凭证管理：读列表 asset:view；删除 / 重新生成按凭证类型在路由内细分（assetVoucherWriteDenied）
  { re: /^\/asset\/vouchers/,               perm: 'asset:view', methods: ['GET'] },
  { re: /^\/asset\/workload/,               perm: 'asset:depr' },
  { re: /^\/asset\/inventory/,              perm: 'asset:inventory' },
  { re: /^\/asset\/report/,                 perm: 'asset:report' },
  { re: /^\/asset\/cards\/[^/]+\/dispose/,  perm: 'asset:dispose' },
  // 变动/拆分规则须排在下方 /asset/cards 通配规则之前（数组按序匹配）
  // 评审 P2：asset:impair（资产减值改良）此前被这条规则挡在门外、单独授予永远无效；
  // 放行后由路由按变动类型细分（减值 / 大修改良 → change 或 impair，其余 → change）
  { re: /^\/asset\/cards\/[^/]+\/change/, perm: ['asset:change', 'asset:impair'] },
  { re: /^\/asset\/cards\/[^/]+\/split/, perm: 'asset:change' },
  { re: /^\/asset\/cards\/[^/]+\/requisitions/, perm: 'asset:view', methods: ['GET'] },
  { re: /^\/asset\/cards\/[^/]+\/attachments/, perm: 'asset:view', methods: ['GET'] },
  { re: /^\/asset\/cards\/[^/]+\/attachments/, perm: 'asset:edit' },
  { re: /^\/asset\/changes\/[^/]+\/revoke/, perm: ['asset:change', 'asset:impair'] },
  { re: /^\/asset\/import\/columns/,        perm: 'asset:view', methods: ['GET'] },
  { re: /^\/asset\/changes\/batch-kinds/,  perm: 'asset:view', methods: ['GET'] },
  { re: /^\/asset\/changes\/batch/,        perm: 'asset:change' },
  { re: /^\/asset\/change-kinds/,           perm: 'asset:view', methods: ['GET'] },
  { re: /^\/asset\/changes/,                perm: 'asset:view', methods: ['GET'] },
  { re: /^\/asset\/changes/,                perm: 'asset:change' },
  { re: /^\/asset\/requisition/,            perm: 'asset:view', methods: ['GET'] },
  { re: /^\/asset\/requisition/,            perm: 'asset:requisition' },
  { re: /^\/asset\/cards/,                  perm: 'asset:view', methods: ['GET'] }, // 读卡片/明细/台账/编号
  { re: /^\/asset\/cards/,                  perm: 'asset:edit' },     // 增删改卡片
]
/** 按变动类型细分权限：减值 / 大修改良 → asset:change 或 asset:impair；其余 → asset:change */
function assetChangePermissionError(req: AuthRequest, kind: unknown): string | null {
  if (req.permissions?.includes('*') || req.permissions?.includes('asset:change')) return null
  if ((kind === 'impairment' || kind === 'improvement') && req.permissions?.includes('asset:impair')) return null
  return kind === 'impairment' || kind === 'improvement'
    ? '无此操作权限（需要「资产减值改良」或「资产变动」权限）'
    : '无此操作权限（需要「资产变动」权限）'
}

router.use((req: AuthRequest, res, next) => {
  if (!req.path.startsWith('/asset/')) return next()
  if (req.permissions?.includes('*')) return next()
  const rule = ASSET_PERMISSION_RULES.find(
    r => r.re.test(req.path) && (!r.methods || r.methods.includes(req.method))
  )
  if (rule && !(Array.isArray(rule.perm) ? rule.perm : [rule.perm]).some(p => req.permissions?.includes(p))) {
    return res.status(403).json({ code: 403, message: '无此操作权限' })
  }
  next()
})

// ── 资产参数读写（折旧起始期间等，轻量、限定 key，无需 system:account 权限） ──
const ASSET_PARAM_KEYS = [
  'asset:depr_start_period',
  'asset:depr_voucher_type_id',
  'asset:purchase_voucher_type_id',
  'asset:inventory_surplus_account',
  'asset:inventory_deficit_account',
  // P0-2：处置凭证科目改为可配置（原硬编码 1001/6301/6711）
  'asset:disposal_voucher_type_id',
  'asset:disposal_bank_account',
  'asset:disposal_gain_account',
  'asset:disposal_loss_account',
  // P0-1：资产部门/使用人对应的辅助核算类别编码
  'asset:aux_dept_category_code',
  'asset:aux_person_category_code',
  // P1：资产变动（原值变动/减值/改良）凭证类型
  'asset:change_voucher_type_id',
  'asset:impairment_loss_account',
]

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
    if (/^asset:.*_account$/.test(p.param_key)) {
      const leafErr = firstNonLeafError(db, req.accountSetId || '', [[val, '资产科目参数']])
      if (leafErr) return res.status(400).json({ code: 400, message: leafErr })
    }
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
    'fixed_asset_change', 'fixed_asset_depr', 'fixed_asset_requisition',
    'fixed_asset_attachments', 'fixed_asset',
  ]
  const masterTables = [
    'fixed_asset_category', 'fixed_asset_dept', 'fixed_asset_purpose',
    'fixed_asset_status', 'fixed_asset_change_type',
  ]
  const tables = mode === 'all' ? [...businessTables, ...masterTables] : businessTables
  const existing = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r => r.name)
  )

  // AS-P0-4：清空资产业务数据时，资产模块产生的凭证必须一并清理，
  // 否则卡片清空后这些 asset_* 来源凭证既无对端记录、又被删除守卫拦截，永远无法删除。
  // 已记账凭证先拦截，保证总账与 account_balances 不被破坏。
  const assetVouchers = existing.has('vouchers')
    ? (db.prepare(
        "SELECT id, voucher_no, status, source FROM vouchers WHERE account_set_id=? AND source LIKE 'asset_%'"
      ).all(aid) as Array<{ id: string; voucher_no: string; status: string; source: string | null }>)
    : []
  const postedVoucher = assetVouchers.find(v => v.status === 'posted')
  if (postedVoucher) {
    return res.status(400).json({
      code: 400,
      message: `资产凭证存在已记账凭证（${postedVoucher.voucher_no}），请先取消记账后再清空资产数据`,
    })
  }

  db.transaction(() => {
    for (const v of assetVouchers) deleteVoucherWithRefs(db, aid, v)
    for (const t of tables) {
      if (existing.has(t)) db.prepare(`DELETE FROM ${t} WHERE account_set_id=?`).run(aid)
    }
  })()
  res.json({ code: 0, data: { ok: true, mode, cleared: tables.filter(t => existing.has(t)), deletedVouchers: assetVouchers.length, backup: backupFile } })
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
    const result = ensureDefaultAssetDicts(getDb(), req.accountSetId || '', type)
    // unresolved：本账套里找不到的科目，已留空，前端提示用户手工设置
    res.json({ code: 0, data: { ok: true, unresolved: result.unresolved } })
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
  // 评审 P2：类别残值率与卡片同口径归一（5 → 0.05），非法值 400，不再落到 DB 触发器抛 500
  const categoryRate = parseCategorySalvageRate(salvage_rate)
  if (table === 'fixed_asset_category' && categoryRate === false) {
    return res.status(400).json({ code: 400, message: '残值率必须是大于等于 0 且小于 1 的小数（如 0.05 表示 5%）' })
  }
  const leafErr = firstNonLeafError(db, req.accountSetId || '', table === 'fixed_asset_category'
    ? [[account_code, '固定资产科目'], [depr_account_code, '累计折旧科目'], [impairment_account_code, '减值准备科目'], [clearing_account_code, '清理科目']]
    : table === 'fixed_asset_purpose' ? [[expense_account, '折旧费用科目']] : [])
  if (leafErr) return res.status(400).json({ code: 400, message: leafErr })
  if (table === 'fixed_asset_category') {
    db.prepare(`INSERT INTO fixed_asset_category (id,account_set_id,code,name,salvage_rate,account_code,depr_account_code,impairment_account_code,clearing_account_code) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, req.accountSetId, code, name, categoryRate === false ? null : categoryRate, account_code ?? null, depr_account_code ?? null, impairment_account_code ?? null, clearing_account_code ?? null)
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

/** 类别残值率：未填 → null（不改 / 不设）；合法 → 归一后的小数；非法 → false */
function parseCategorySalvageRate(raw: unknown): number | null | false {
  if (raw === undefined || raw === null || raw === '') return null
  const n = normalizeSalvageRate(raw)
  return n === null ? false : n
}

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
  const leafErr = firstNonLeafError(db, req.accountSetId || '', table === 'fixed_asset_category'
    ? [[account_code, '固定资产科目'], [depr_account_code, '累计折旧科目'], [impairment_account_code, '减值准备科目'], [clearing_account_code, '清理科目']]
    : table === 'fixed_asset_purpose' ? [[expense_account, '折旧费用科目']] : [])
  if (leafErr) return res.status(400).json({ code: 400, message: leafErr })
  if (table === 'fixed_asset_category') {
    const categoryRate = parseCategorySalvageRate(salvage_rate)
    if (categoryRate === false) {
      return res.status(400).json({ code: 400, message: '残值率必须是大于等于 0 且小于 1 的小数（如 0.05 表示 5%）' })
    }
    db.prepare(`UPDATE fixed_asset_category SET 
      name=COALESCE(?,name), 
      salvage_rate=COALESCE(?,salvage_rate), 
      account_code=COALESCE(?,account_code),
      depr_account_code=COALESCE(?,depr_account_code),
      impairment_account_code=COALESCE(?,impairment_account_code),
      clearing_account_code=COALESCE(?,clearing_account_code)
      WHERE id=?`)
      .run(name, categoryRate, account_code, depr_account_code, impairment_account_code, clearing_account_code, req.params.id)
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
  const type = req.params.type
  const table = DICT_TABLES[type]
  if (!table) return res.status(400).json({ code: 400, message: '未知字典类型' })
  const db = getDb()
  const row = db.prepare(`SELECT id, code, name FROM ${table} WHERE id=? AND account_set_id=?`)
    .get(req.params.id, req.accountSetId) as any
  if (!row) return res.status(404).json({ code: 404, message: '记录不存在' })

  const blockReason = getDictDeleteBlockReason({
    db,
    accountSetId: req.accountSetId || '',
    type,
    row,
  })
  if (blockReason) return res.status(400).json({ code: 400, message: blockReason })

  db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id)
  res.json({ code: 0, data: { ok: true } })
})

// ── 固定资产卡片 ──────────────────────────────────────────

// GET /asset/cards — 列表（支持多条件筛选、分页）
router.get('/asset/cards', (req: AuthRequest, res) => {
  const db = getDb()
  const asid = req.accountSetId || ''
  const {
    keyword, category_code, status_code, dept_code, purpose_code, depr_method, disposed,
    acquire_from, acquire_to, start_depr_from, start_depr_to, page = '1', page_size = '20',
  } = req.query as Record<string, string>

  const conds = ['fa.account_set_id = ?']
  const params: any[] = [asid]
  if (keyword) {
    // 第七份反馈：关键字同时查规格型号 / 参考编号 / 卡片号 / 使用人 / 保管人 / 存放地点 / 制造厂家
    const kwCols = ['asset_no', 'asset_name', 'spec', 'ref_no', 'card_no', 'user_name', 'keeper', 'install_place', 'manufacturer']
    conds.push(`(${kwCols.map(c => `fa.${c} LIKE ?`).join(' OR ')})`)
    params.push(...kwCols.map(() => `%${keyword}%`))
  }
  if (category_code) { conds.push('fa.category_code = ?'); params.push(category_code) }
  if (status_code) { conds.push('fa.status_code = ?'); params.push(status_code) }
  if (dept_code) { conds.push('fa.dept_code = ?'); params.push(dept_code) }
  if (purpose_code) { conds.push('fa.purpose_code = ?'); params.push(purpose_code) }
  if (depr_method) { conds.push('fa.depr_method = ?'); params.push(depr_method) }
  if (disposed === '0') conds.push("COALESCE(fa.scrap_date,'') = ''")
  if (disposed === '1') conds.push("COALESCE(fa.scrap_date,'') <> ''")
  if (acquire_from) { conds.push('fa.acquire_date >= ?'); params.push(acquire_from) }
  if (acquire_to) { conds.push('fa.acquire_date <= ?'); params.push(acquire_to) }
  if (start_depr_from) { conds.push('fa.start_depr_date >= ?'); params.push(start_depr_from) }
  if (start_depr_to) { conds.push('fa.start_depr_date <= ?'); params.push(start_depr_to) }

  const where = `WHERE ${conds.join(' AND ')}`
  const total = (db.prepare(`SELECT COUNT(*) c FROM fixed_asset fa ${where}`).get(...params) as any).c
  const offset = (parseInt(page) - 1) * parseInt(page_size)
  // 最近一次计提的月折旧额与期间（列表「月折旧额」列）
  const rows = db.prepare(`SELECT fa.*,
      (SELECT d.month_depr FROM fixed_asset_depr d WHERE d.account_set_id=fa.account_set_id AND d.asset_no=fa.asset_no ORDER BY d.year DESC, d.month DESC LIMIT 1) AS last_month_depr,
      (SELECT d.year * 100 + d.month FROM fixed_asset_depr d WHERE d.account_set_id=fa.account_set_id AND d.asset_no=fa.asset_no ORDER BY d.year DESC, d.month DESC LIMIT 1) AS last_depr_ym
    FROM fixed_asset fa ${where} ORDER BY fa.asset_no LIMIT ? OFFSET ?`).all(...params, parseInt(page_size), offset)

  // 附加字典名称
  const catMap = new Map(db.prepare('SELECT code,name FROM fixed_asset_category WHERE account_set_id=?').all(asid).map((r: any) => [r.code, r.name]))
  const staMap = new Map(db.prepare('SELECT code,name FROM fixed_asset_status WHERE account_set_id=?').all(asid).map((r: any) => [r.code, r.name]))
  const deptMap = new Map(db.prepare('SELECT code,name FROM fixed_asset_dept WHERE account_set_id=?').all(asid).map((r: any) => [r.code, r.name]))
  const purpMap = new Map(db.prepare('SELECT code,name FROM fixed_asset_purpose WHERE account_set_id=?').all(asid).map((r: any) => [r.code, r.name]))

  // 新增资产（购置）凭证：卡片列表直接显示凭证号（参照金蝶卡片「新增资产凭证」列）
  const voucherIds = [...new Set((rows as any[]).map(r => r.purchase_voucher_id).filter(Boolean))]
  const voucherMap = new Map<string, any>()
  if (voucherIds.length) {
    const vs = db.prepare(`SELECT v.id, v.voucher_no, v.year, v.period, v.status, vt.name AS voucher_type_name
      FROM vouchers v LEFT JOIN voucher_types vt ON vt.id=v.voucher_type_id
      WHERE v.account_set_id=? AND v.id IN (${voucherIds.map(() => '?').join(',')})`).all(asid, ...voucherIds) as any[]
    for (const v of vs) voucherMap.set(v.id, v)
  }
  const enriched = (rows as any[]).map(r => ({
    ...r,
    category_name: catMap.get(r.category_code) || r.category_code,
    status_name: staMap.get(r.status_code) || r.status_code,
    dept_name: deptMap.get(r.dept_code) || r.dept_code,
    purpose_name: purpMap.get(r.purpose_code) || r.purpose_code,
    purchase_voucher: r.purchase_voucher_id ? (voucherMap.get(r.purchase_voucher_id) || null) : null,
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
  const db = getDb()
  const asid = req.accountSetId || ''
  const row = db.prepare('SELECT * FROM fixed_asset WHERE id=? AND account_set_id=?').get(req.params.id, asid) as any
  if (!row) return res.status(404).json({ code: 404, message: '资产不存在' })
  // 附加字典名称（与列表口径一致；变动页信息栏读 category_name / dept_name / status_name）
  const dictName = (table: string, code: string | null) =>
    code
      ? ((db.prepare(`SELECT name FROM ${table} WHERE account_set_id=? AND code=?`).get(asid, code) as any)?.name ?? code)
      : null
  res.json({
    code: 0,
    data: {
      ...row,
      value_lock_reason: getCardValueLockReason(db, asid, row),
      category_name: dictName('fixed_asset_category', row.category_code),
      status_name: dictName('fixed_asset_status', row.status_code),
      dept_name: dictName('fixed_asset_dept', row.dept_code),
      purpose_name: dictName('fixed_asset_purpose', row.purpose_code),
    },
  })
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
    acquire_date, start_depr_date, original_value = 0, salvage_rate = 0, salvage_value: rawSalvageValue,
    depr_method, use_months, use_years, total_workload, card_no, qty = 1, unit,
    user_name, keeper, source, install_place, remark,
    accum_depr = 0, depr_months_done = 0
  } = req.body

  // AS-P0-1：残值率统一为小数口径（>1 视为百分数 ÷100）
  const normalizedSalvageRate = normalizeSalvageRate(salvage_rate)
  if (salvage_rate !== undefined && salvage_rate !== null && salvage_rate !== '' && normalizedSalvageRate === null) {
    return res.status(400).json({ code: 400, message: '残值率必须是大于等于 0 且小于 1 的小数（如 0.05 表示 5%）' })
  }

  // 数值与方法要素校验（AS-P1-11/P2：原先 NaN 会直接落库成 NULL、方法与要素不匹配会静默漏提）
  const originalNum = Number(original_value)
  const accumNum = Number(accum_depr)
  if (!Number.isFinite(originalNum) || originalNum < 0) {
    return res.status(400).json({ code: 400, message: '原值必须是大于等于 0 的数字' })
  }
  if (!Number.isFinite(accumNum) || accumNum < 0) {
    return res.status(400).json({ code: 400, message: '累计折旧必须是大于等于 0 的数字' })
  }
  if (accumNum > originalNum) {
    return res.status(400).json({ code: 400, message: '累计折旧不能大于原值' })
  }
  for (const dateField of ['acquire_date', 'start_depr_date', 'manufacture_date'] as const) {
    const v = (req.body as any)[dateField]
    // normalizeDate 同时校验格式与真实日期（拒绝 2026-13-01 这类）
    if (v && normalizeDate(String(v)) !== String(v)) {
      const label = dateField === 'acquire_date' ? '取得日期' : dateField === 'start_depr_date' ? '起折日期' : '制造日期'
      return res.status(400).json({ code: 400, message: `${label}必须为 YYYY-MM-DD 格式的有效日期` })
    }
  }
  if (qty !== undefined && qty !== null && (!Number.isFinite(Number(qty)) || Number(qty) < 0)) {
    return res.status(400).json({ code: 400, message: '数量必须是大于等于 0 的数字' })
  }
  const monthsNum = use_months === undefined || use_months === null || use_months === '' ? null : Number(use_months)
  if (monthsNum !== null && (!Number.isInteger(monthsNum) || monthsNum <= 0)) {
    return res.status(400).json({ code: 400, message: '使用月数必须是正整数' })
  }
  if (depr_method === '2') {
    const workloadNum = Number(total_workload)
    if (!Number.isFinite(workloadNum) || workloadNum <= 0) {
      return res.status(400).json({ code: 400, message: '工作量法必须填写大于 0 的总工作量' })
    }
  } else if (monthsNum === null) {
    // 非工作量法必须填使用月数，否则该资产永远进不了折旧预览（静默漏提）
    return res.status(400).json({ code: 400, message: '请填写大于 0 的使用月数' })
  }

  // 计算净值：原值 - 累计折旧 (不扣除残值，残值是在提完折旧后剩余的金额)
  const net_value = Number(original_value) - Number(accum_depr)
  // 未传预计净残值时按 原值 × 残值率 推算（界面总会带上；直接调接口时缺省为 0 会让折旧提到 0）
  const salvage_value =
    rawSalvageValue === undefined || rawSalvageValue === null || rawSalvageValue === ''
      ? Math.round(Number(original_value) * (normalizedSalvageRate ?? 0) * 100) / 100
      : Number(rawSalvageValue)
  db.prepare(
    `INSERT INTO fixed_asset
      (id,account_set_id,asset_no,asset_name,category_code,status_code,dept_code,purpose_code,
       acquire_date,start_depr_date,original_value,salvage_rate,salvage_value,depr_method,
       use_months,use_years,total_workload,accum_depr,depr_months_done,net_value,card_no,qty,unit,user_name,keeper,source,install_place,remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, req.accountSetId, asset_no, nm ?? asset_name, category_code ?? null, status_code ?? null,
    dept_code ?? null, purpose_code ?? null, acquire_date ?? null, start_depr_date ?? null,
    Number(original_value), normalizedSalvageRate ?? 0, salvage_value, depr_method ?? null,
    use_months ?? null, use_years ?? null, total_workload ?? null,
    Number(accum_depr), Number(depr_months_done), net_value,
    card_no ?? null, qty, unit ?? null, user_name ?? null, keeper ?? null,
    source ?? null, install_place ?? null, remark ?? null
  )
  // v169 补充字段（规格型号 / 参考编号 / 制造厂家 / 制造日期）
  const extra = (k: string) => { const v = (req.body as any)[k]; return v === undefined || v === '' ? null : String(v) }
  db.prepare('UPDATE fixed_asset SET spec=?, ref_no=?, manufacturer=?, manufacture_date=? WHERE id=?').run(
    extra('spec'), extra('ref_no'), extra('manufacturer'), extra('manufacture_date'), id
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
      // P0-3：外键关联购置凭证，删除资产时据此精确定位（替代 remark LIKE 反查）
      db.prepare('UPDATE fixed_asset SET purchase_voucher_id=? WHERE id=?').run(
        voucherResult.voucherId,
        id
      )
    } catch (e: any) {
      voucherWarning = e.message
    }
  }

  // 折旧等凭证科目挂了部门 / 人员辅助而卡片未填或对不上：只提醒，不拦截保存（生成凭证时拦截）
  const auxWarnings = assetCardAuxWarnings(db, req.accountSetId || '', db.prepare('SELECT * FROM fixed_asset WHERE id=?').get(id) as any)
  res.json({ code: 0, data: { id, voucher: voucherResult, voucherWarning, auxWarnings } })
})

// PUT /asset/cards/:id
router.put('/asset/cards/:id', operationLog('固定资产修改', '固定资产'), (req: AuthRequest, res) => {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM fixed_asset WHERE id=? AND account_set_id=?').get(req.params.id, req.accountSetId)
  if (!existing) return res.status(404).json({ code: 404, message: '资产不存在' })
  const cur = db.prepare(
    'SELECT asset_no, purchase_voucher_id, original_value, salvage_rate, salvage_value, accum_depr, impairment_amount, scrap_date, depr_months_done, use_months FROM fixed_asset WHERE id=?'
  ).get(req.params.id) as any

  // AS-P1-11：卡片直改不得绕过业务流程
  if (cur?.scrap_date) {
    return res.status(400).json({ code: 400, message: '该资产已处置，请先撤销处置再编辑' })
  }
  if ((req.body ?? {}).status_code === '04') {
    return res.status(400).json({ code: 400, message: '报废状态请通过处置流程办理，不能直接修改卡片状态' })
  }
  if (
    (req.body ?? {}).use_months !== undefined &&
    cur?.use_months != null &&
    Number((req.body as any).use_months) <= Number(cur.depr_months_done || 0)
  ) {
    return res.status(400).json({ code: 400, message: '调整后的使用月数不能小于等于已计提月数' })
  }

  // 评审 P1-2：有财务痕迹的卡片不得直改原值 / 累计折旧
  const body = (req.body ?? {}) as Record<string, unknown>
  const changedValue = (key: 'original_value' | 'accum_depr') =>
    body[key] !== undefined && body[key] !== '' && Math.abs(Number(body[key]) - Number(cur[key] || 0)) >= 0.005
  if (changedValue('original_value') || changedValue('accum_depr')) {
    const lockReason = getCardValueLockReason(db, req.accountSetId || '', cur)
    if (lockReason) {
      return res.status(400).json({
        code: 400,
        message: `该资产${lockReason}，原值请通过「资产变动 → 原值变动」调整，累计折旧请通过计提 / 反折旧调整，不能在卡片上直接修改`,
      })
    }
  }

  let fields: Record<string, unknown>
  try {
    fields = buildAssetCardUpdate(req.body ?? {}, cur)
  } catch (e: any) {
    return res.status(400).json({ code: 400, message: e.message })
  }
  const cols = Object.keys(fields)
  const sets = cols.map(c => `${c}=?`).concat("updated_at=datetime('now')")

  db.prepare(`UPDATE fixed_asset SET ${sets.join(', ')} WHERE id=?`).run(
    ...cols.map(c => fields[c]),
    req.params.id
  )
  // 折旧等凭证科目挂了部门 / 人员辅助而卡片未填或对不上：只提醒，不拦截保存（生成凭证时拦截）
  const auxWarnings = assetCardAuxWarnings(db, req.accountSetId || '', db.prepare('SELECT * FROM fixed_asset WHERE id=?').get(req.params.id) as any)
  res.json({ code: 0, data: { ok: true, auxWarnings } })
})

// DELETE /asset/cards/:id
router.delete('/asset/cards/:id', operationLog('固定资产删除', '固定资产'), (req: AuthRequest, res) => {
  const db = getDb()
  const row = db.prepare(
    'SELECT id, asset_no, purchase_voucher_id, scrap_voucher_id FROM fixed_asset WHERE id=? AND account_set_id=?'
  ).get(req.params.id, req.accountSetId) as any
  if (!row) return res.status(404).json({ code: 404, message: '资产不存在' })

  // 已计提过折旧的资产不允许删除：折旧凭证是整期合并的（一张凭证含多项资产），
  // 删卡只能删掉本卡的折旧记录、删不掉合并凭证里本卡那部分金额，总账累计折旧会与资产账对不上。
  const deprCnt = db.prepare(
    'SELECT COUNT(*) AS c FROM fixed_asset_depr WHERE account_set_id=? AND asset_no=?'
  ).get(req.accountSetId, row.asset_no) as { c: number }
  if (deprCnt.c > 0) {
    return res.status(400).json({
      code: 400,
      message: `该资产已计提 ${deprCnt.c} 期折旧，不能删除；请先「取消折旧」到无折旧记录，或改用「处置」做资产减少`,
    })
  }

  // AS-P0-3：删除资产时把该资产产生的**全部**凭证一并删除。
  // 此前只删购置凭证，原值变动/减值/处置生成的凭证成为孤儿——资产与撤销变动入口都没了，
  // 而凭证删除守卫（voucherDelete.ts）又拦截 asset_* 来源，这些凭证永远无法删除。
  const voucherIds = new Set<string>()
  if (row.purchase_voucher_id) voucherIds.add(row.purchase_voucher_id)
  if (row.scrap_voucher_id) voucherIds.add(row.scrap_voucher_id)
  const changeVoucherRows = db.prepare(
    'SELECT DISTINCT voucher_id FROM fixed_asset_change WHERE account_set_id=? AND asset_no=? AND voucher_id IS NOT NULL'
  ).all(req.accountSetId, row.asset_no) as Array<{ voucher_id: string }>
  for (const r of changeVoucherRows) voucherIds.add(r.voucher_id)

  const vouchers = [...voucherIds]
    .map(vid => db.prepare('SELECT id, voucher_no, status, source, voucher_date, year, period FROM vouchers WHERE id=? AND account_set_id=?').get(vid, req.accountSetId))
    .filter(Boolean) as Array<{ id: string; voucher_no: string; status: string; source: string | null; voucher_date: string; year: number; period: number }>
  const posted = vouchers.find(v => v.status === 'posted')
  if (posted) {
    return res.status(400).json({ code: 400, message: `该资产存在已记账凭证（${posted.voucher_no}），请先取消记账后再删除资产` })
  }

  let deletedVouchers = 0
  db.transaction(() => {
    // 引用清理（fx_reval/冲红/供应链）统一走 voucherDelete.ts（FIX-132 同源）。
    // 来源守卫在这里不适用（本模块就是 asset_* 凭证的回收入口，原先调 getVoucherUndeletableReason 必然抛错），
    // 只过总账 / 出纳期间闸。
    for (const v of vouchers) {
      const reason = getVoucherImmutableReason({
        db,
        accountSetId: req.accountSetId || '',
        voucher: { ...v, source: null },
        operation: 'delete',
      })
      if (reason) throw new Error(`${reason}：${v.voucher_no}`)
      deleteVoucherWithRefs(db, req.accountSetId || '', v)
      deletedVouchers++
    }
    // 孤儿业务数据：变动流水、折旧记录、工作量、领用记录、附件记录
    for (const sql of [
      'DELETE FROM fixed_asset_change WHERE account_set_id=? AND asset_no=?',
      'DELETE FROM fixed_asset_depr WHERE account_set_id=? AND asset_no=?',
      'DELETE FROM fixed_asset_workload WHERE account_set_id=? AND asset_no=?',
      'DELETE FROM fixed_asset_requisition WHERE account_set_id=? AND asset_no=?',
    ]) {
      db.prepare(sql).run(req.accountSetId, row.asset_no)
    }
    db.prepare('DELETE FROM fixed_asset_attachments WHERE account_set_id=? AND asset_id=?').run(req.accountSetId, req.params.id)
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
      const db = getDb()
      const result = disposeAsset({
        db,
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
        voucherTypeId: getAssetParamValue(db, req.accountSetId || '', 'asset:disposal_voucher_type_id'),
        accountScope: req.accountScope,
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

// ── 资产变动（原值变动 / 部门调拨 / 状态变更 / 折旧要素调整 / 拆分 / 减值 / 改良）────

// GET /asset/changes — 变动记录分页查询
router.get('/asset/changes', (req: AuthRequest, res) => {
  const { asset_no, kind, year, period, dept_code, keyword, page, page_size } = req.query as any
  const { total, rows } = listAssetChanges({
    db: getDb(),
    accountSetId: req.accountSetId || '',
    filters: {
      assetNo: asset_no || undefined,
      kind: kind || undefined,
      year: year ? parseInt(year) : undefined,
      period: period ? parseInt(period) : undefined,
      deptCode: dept_code || undefined,
      keyword: keyword || undefined,
      page: page ? parseInt(page) : 1,
      pageSize: page_size ? parseInt(page_size) : 20,
    },
  })
  res.json({ code: 0, data: { total, list: rows } })
})

// GET /asset/changes/batch-kinds — 支持批量的变动类型
router.get('/asset/changes/batch-kinds', (_req: AuthRequest, res) => {
  res.json({ code: 0, data: BATCH_CHANGE_KINDS })
})

// GET /asset/changes/:id — 变动详情
router.get('/asset/changes/:id', (req: AuthRequest, res) => {
  const row = getAssetChange({
    db: getDb(),
    accountSetId: req.accountSetId || '',
    changeId: req.params.id,
  })
  if (!row) return res.status(404).json({ code: 404, message: '变动记录不存在' })
  res.json({ code: 0, data: row })
})

// POST /asset/cards/:id/change — 登记变动（body.kind 分派）
router.post(
  '/asset/cards/:id/change',
  operationLog('固定资产变动', '固定资产'),
  (req: AuthRequest, res) => {
    const { kind, change_date, change_type_code, payload, generate_voucher, counter_account, remark } =
      req.body || {}
    if (!kind) return res.status(400).json({ code: 400, message: '变动类型不能为空' })
    if (!change_date) return res.status(400).json({ code: 400, message: '变动日期不能为空' })

    // AS-P1-12 / 评审 P2：减值、大修改良可由 asset:impair 单独授权（已有 asset:change 的用户兼容放行）；
    // 其余变动类型仍须 asset:change
    const assetChangeDenied = assetChangePermissionError(req, kind)
    if (assetChangeDenied) return res.status(403).json({ code: 403, message: assetChangeDenied })

    try {
      const db = getDb()
      const result = applyAssetChange({
        db,
        accountSetId: req.accountSetId || '',
        assetId: req.params.id,
        kind,
        changeDate: change_date,
        changeTypeCode: change_type_code ?? null,
        payload: payload || {},
        generateVoucher: generate_voucher ?? false,
        counterAccount: counter_account ?? null,
        remark: remark ?? null,
        operatorName: req.userName || '系统',
        operatorId: req.userId ?? null,
        voucherTypeId: getAssetParamValue(db, req.accountSetId || '', 'asset:change_voucher_type_id'),
      })

      // 科目授权：变动凭证分录科目须在授权范围内，否则整笔撤销
      if (result.voucherId) {
        const scopeErr = assertVoucherEntriesInScopeById(
          db,
          req.accountScope,
          result.voucherId,
          req.accountSetId || ''
        )
        if (scopeErr) {
          revokeAssetChange({ db, accountSetId: req.accountSetId || '', changeId: result.changeId })
          return res.status(403).json({ code: 403, message: scopeErr })
        }
      }

      res.json({ code: 0, data: result })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message || '登记变动失败' })
    }
  }
)

// POST /asset/cards/:id/split — 资产拆分（独立端点，返回新建卡片）
router.post(
  '/asset/cards/:id/split',
  operationLog('固定资产拆分', '固定资产'),
  (req: AuthRequest, res) => {
    const { change_date, children, remark } = req.body || {}
    if (!change_date) return res.status(400).json({ code: 400, message: '拆分日期不能为空' })

    try {
      const result = applyAssetChange({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        assetId: req.params.id,
        kind: 'split',
        changeDate: change_date,
        payload: { children: children || [] },
        remark: remark ?? null,
        operatorName: req.userName || '系统',
        operatorId: req.userId ?? null,
      })
      res.json({ code: 0, data: result })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message || '资产拆分失败' })
    }
  }
)

// POST /asset/changes/:id/revoke — 撤销变动（回滚字段 + 删凭证）
router.post(
  '/asset/changes/:id/revoke',
  operationLog('固定资产撤销变动', '固定资产'),
  (req: AuthRequest, res) => {
    const target = getDb()
      .prepare('SELECT change_kind FROM fixed_asset_change WHERE id=? AND account_set_id=?')
      .get(req.params.id, req.accountSetId) as { change_kind: string | null } | undefined
    const revokeDenied = target ? assetChangePermissionError(req, target.change_kind) : null
    if (revokeDenied) return res.status(403).json({ code: 403, message: revokeDenied })
    try {
      const result = revokeAssetChange({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        changeId: req.params.id,
      })
      res.json({ code: 0, data: result })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message || '撤销变动失败' })
    }
  }
)

// GET /asset/change-kinds — 变动类型枚举（含中文名与可调整的折旧要素字段）
router.get('/asset/change-kinds', (_req: AuthRequest, res) => {
  res.json({
    code: 0,
    data: {
      kinds: Object.entries(ASSET_CHANGE_KIND_LABELS).map(([code, name]) => ({ code, name })),
      deprFactorFields: Object.entries(DEPR_FACTOR_FIELDS).map(([code, name]) => ({ code, name })),
    },
  })
})

// ── 资产领用归还（P3-1）─────────────────────────────────────

// GET /asset/requisitions — 领用记录分页查询
router.get('/asset/requisitions', (req: AuthRequest, res) => {
  const {
    asset_no, action, dept_code, user_name, keyword,
    outstanding_only, overdue_only, date_from, date_to, page, page_size,
  } = req.query as any
  const { total, rows } = listRequisitions({
    db: getDb(),
    accountSetId: req.accountSetId || '',
    filters: {
      assetNo: asset_no || undefined,
      action: action || undefined,
      deptCode: dept_code || undefined,
      userName: user_name || undefined,
      keyword: keyword || undefined,
      outstandingOnly: outstanding_only === 'true' || outstanding_only === '1',
      overdueOnly: overdue_only === 'true' || overdue_only === '1',
      dateFrom: date_from || undefined,
      dateTo: date_to || undefined,
      page: page ? parseInt(page) : 1,
      pageSize: page_size ? parseInt(page_size) : 20,
    },
  })
  res.json({ code: 0, data: { total, list: rows } })
})

// GET /asset/cards/:id/requisitions — 某张卡片的领用归还历史
router.get('/asset/cards/:id/requisitions', (req: AuthRequest, res) => {
  try {
    const rows = getAssetRequisitions({
      db: getDb(),
      accountSetId: req.accountSetId || '',
      assetId: req.params.id,
    })
    res.json({ code: 0, data: rows })
  } catch (e: any) {
    res.status(404).json({ code: 404, message: e.message })
  }
})

// POST /asset/requisitions — 登记领用或归还
router.post(
  '/asset/requisitions',
  operationLog('固定资产领用归还', '固定资产'),
  (req: AuthRequest, res) => {
    const {
      asset_id, action, action_date, user_name, user_aux_id, dept_code,
      keeper, install_place, expect_return_date, condition_note, remark,
    } = req.body || {}
    if (!asset_id) return res.status(400).json({ code: 400, message: '请选择资产' })
    if (!action_date) return res.status(400).json({ code: 400, message: '日期不能为空' })

    try {
      const result = createRequisition({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        assetId: asset_id,
        action,
        actionDate: action_date,
        userName: user_name ?? null,
        userAuxId: user_aux_id ?? null,
        deptCode: dept_code ?? null,
        keeper: keeper ?? null,
        installPlace: install_place ?? null,
        expectReturnDate: expect_return_date ?? null,
        conditionNote: condition_note ?? null,
        remark: remark ?? null,
        operatorName: req.userName || '系统',
        operatorId: req.userId ?? null,
      })
      res.json({ code: 0, data: result })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message || '登记失败' })
    }
  }
)

// DELETE /asset/requisitions/:id — 删除最后一条领用/归还记录
router.delete(
  '/asset/requisitions/:id',
  operationLog('固定资产删除领用记录', '固定资产'),
  (req: AuthRequest, res) => {
    try {
      const result = deleteRequisition({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        requisitionId: req.params.id,
      })
      res.json({ code: 0, data: result })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message || '删除失败' })
    }
  }
)

// ── 资产卡片附件（P3-2）─────────────────────────────────────

// POST /asset/cards/:id/attachments — 上传附件（发票、合同、照片等）
router.post(
  '/asset/cards/:id/attachments',
  assetAttachmentUpload.array('file'),
  operationLog('上传资产附件', '固定资产'),
  async (req: AuthRequest, res) => {
    const assetId = req.params.id
    const accountSetId = req.accountSetId || ''

    const files = (req.files as Express.Multer.File[]) || []
    if (files.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择要上传的文件' })
    }

    const db = getDb()
    const asset = db
      .prepare('SELECT id FROM fixed_asset WHERE id=? AND account_set_id=?')
      .get(assetId, accountSetId)
    if (!asset) return res.status(404).json({ code: 404, message: '资产不存在' })

    const uploadDir = getUploadsDir('attachments')
    await fsp.mkdir(uploadDir, { recursive: true })

    const writtenPaths: string[] = []
    const attachments: any[] = []

    try {
      for (const file of files) {
        const ext = path.extname(file.originalname)
        const filename = `${uuidv4()}${ext}`
        const filePath = path.join(uploadDir, filename)
        await fsp.writeFile(filePath, file.buffer)
        writtenPaths.push(filePath)

        attachments.push({
          id: uuidv4(),
          account_set_id: accountSetId,
          asset_id: assetId,
          filename,
          original_name: fixAssetGarbledFilename(file.originalname),
          file_path: `/uploads/attachments/${filename}`,
          file_size: file.size,
          mime_type: file.mimetype,
          created_by: req.userId ?? null,
        })
      }

      const ins = db.prepare(
        `INSERT INTO fixed_asset_attachments
           (id, account_set_id, asset_id, filename, original_name, file_path, file_size, mime_type, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      db.transaction(() => {
        for (const a of attachments) {
          ins.run(
            a.id, a.account_set_id, a.asset_id, a.filename, a.original_name,
            a.file_path, a.file_size, a.mime_type, a.created_by
          )
        }
      })()

      res.json({ code: 0, data: attachments, message: `成功上传 ${attachments.length} 个文件` })
    } catch (error: any) {
      // 落库失败时清理已写入的物理文件，避免产生孤儿文件
      for (const p of writtenPaths) {
        await fsp.unlink(p).catch(() => {})
      }
      res.status(500).json({ code: 500, message: `文件写入失败: ${error.message}` })
    }
  }
)

// GET /asset/cards/:id/attachments — 附件列表
router.get('/asset/cards/:id/attachments', (req: AuthRequest, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, filename, original_name, file_path, file_size, mime_type, created_at, created_by
         FROM fixed_asset_attachments
        WHERE asset_id = ? AND account_set_id = ?
        ORDER BY created_at`
    )
    .all(req.params.id, req.accountSetId)
  res.json({ code: 0, data: rows })
})

// DELETE /asset/cards/:id/attachments/:attachmentId — 删除附件
router.delete(
  '/asset/cards/:id/attachments/:attachmentId',
  operationLog('删除资产附件', '固定资产'),
  async (req: AuthRequest, res) => {
    const { id: assetId, attachmentId } = req.params
    const db = getDb()
    try {
      const attachment = db
        .prepare(
          'SELECT * FROM fixed_asset_attachments WHERE id=? AND asset_id=? AND account_set_id=?'
        )
        .get(attachmentId, assetId, req.accountSetId) as any
      if (!attachment) return res.status(404).json({ code: 404, message: '附件不存在' })

      // basename 防目录穿越
      const filePath = resolveUploadFile('attachments', path.basename(attachment.filename))
      await fsp.unlink(filePath).catch(err => {
        console.warn(`物理文件删除失败: ${filePath}`, err)
      })

      db.prepare(
        'DELETE FROM fixed_asset_attachments WHERE id=? AND asset_id=? AND account_set_id=?'
      ).run(attachmentId, assetId, req.accountSetId)

      res.json({ code: 0, message: '附件已删除' })
    } catch (error: any) {
      res.status(500).json({ code: 500, message: error.message })
    }
  }
)

// ── 批量操作与数据交换（P4）─────────────────────────────────

// GET /asset/import/columns — 导入模板列定义（前端据此生成 Excel 模板与解析）
router.get('/asset/import/columns', (_req: AuthRequest, res) => {
  res.json({ code: 0, data: ASSET_IMPORT_COLUMNS })
})

// POST /asset/cards/batch/validate — 仅校验不写库，供导入前预览标红
router.post('/asset/cards/batch/validate', (req: AuthRequest, res) => {
  const rows = (req.body?.rows || []) as Array<Record<string, unknown>>
  const startRow = Number(req.body?.start_row ?? 2)
  const db = getDb()
  const dicts = loadImportDicts(db, req.accountSetId || '')
  const seenNos = new Set<string>()
  const errors: any[] = []

  rows.forEach((row, index) => {
    errors.push(
      ...validateImportRow({ row, rowNumber: startRow + index, dicts, seenNos })
    )
    const no = String(row.asset_no ?? '').trim()
    if (no) seenNos.add(no)
  })

  res.json({ code: 0, data: { rowCount: rows.length, errors } })
})

// POST /asset/cards/batch — 批量导入卡片（整批事务，全有或全无）
router.post(
  '/asset/cards/batch',
  operationLog('固定资产批量导入', '固定资产'),
  (req: AuthRequest, res) => {
    try {
      const result = batchImportAssets({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        rows: (req.body?.rows || []) as Array<Record<string, unknown>>,
        startRowNumber: Number(req.body?.start_row ?? 2),
      })
      if (result.errors.length > 0) {
        return res.status(400).json({ code: 400, message: '导入数据校验未通过', data: result })
      }
      res.json({ code: 0, data: result })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message || '批量导入失败' })
    }
  }
)

// POST /asset/changes/batch — 批量变动（部门调拨 / 状态变更 / 折旧要素）
router.post(
  '/asset/changes/batch',
  operationLog('固定资产批量变动', '固定资产'),
  (req: AuthRequest, res) => {
    const { asset_ids, kind, change_date, change_type_code, payload, remark } = req.body || {}
    if (!kind) return res.status(400).json({ code: 400, message: '变动类型不能为空' })
    if (!change_date) return res.status(400).json({ code: 400, message: '变动日期不能为空' })

    try {
      const result = batchApplyAssetChange({
        db: getDb(),
        accountSetId: req.accountSetId || '',
        assetIds: asset_ids || [],
        kind,
        changeDate: change_date,
        changeTypeCode: change_type_code ?? null,
        payload: payload || {},
        remark: remark ?? null,
        operatorName: req.userName || '系统',
        operatorId: req.userId ?? null,
      })
      if (result.errors.length > 0) {
        return res
          .status(400)
          .json({ code: 400, message: '部分资产变动失败，整批已回滚', data: result })
      }
      res.json({ code: 0, data: result })
    } catch (e: any) {
      res.status(400).json({ code: 400, message: e.message || '批量变动失败' })
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
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ code: 400, message: '请提供有效的年份和月份' })
  }
  if (!workloads || typeof workloads !== 'object' || Array.isArray(workloads)) {
    return res.status(400).json({ code: 400, message: 'workloads 必须是 { 资产编号: 工作量 } 的对象' })
  }
  for (const [assetNo, wl] of Object.entries(workloads)) {
    const n = Number(wl)
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ code: 400, message: `工作量必须是大于等于 0 的数字（资产 ${assetNo}）` })
    }
  }
  const db = getDb()
  const asid = req.accountSetId || ''
  // 本月工作量不得超过剩余工作量（总工作量 − 已完成），否则累计工作量会超过总量
  const getAsset = db.prepare(
    'SELECT asset_no, total_workload, workload_done FROM fixed_asset WHERE account_set_id=? AND asset_no=?'
  )
  const getDepr = db.prepare(
    'SELECT 1 FROM fixed_asset_depr WHERE account_set_id=? AND asset_no=? AND year=? AND month=?'
  )
  const getSaved = db.prepare(
    'SELECT workload FROM fixed_asset_workload WHERE account_set_id=? AND asset_no=? AND year=? AND month=?'
  )
  for (const [assetNo, wl] of Object.entries(workloads)) {
    const a = getAsset.get(asid, assetNo) as
      | { asset_no: string; total_workload: number | null; workload_done: number | null }
      | undefined
    if (!a) return res.status(400).json({ code: 400, message: `资产 ${assetNo} 不存在` })
    const total = Number(a.total_workload || 0)
    // 评审 P2：该期已计提的工作量不可再改——折旧额与 workload_done 都按计提当时的工作量算，
    // 改录后反折旧会按新值回退 workload_done，累计工作量与折旧序列对不上。须先反折旧再改。
    const deprDone = getDepr.get(asid, assetNo, year, month)
    if (deprDone) {
      const saved = Number((getSaved.get(asid, assetNo, year, month) as any)?.workload || 0)
      if (Math.abs(saved - Number(wl || 0)) > 1e-9) {
        return res.status(400).json({
          code: 400,
          message: `资产 ${assetNo} ${year}年${month}月 已计提折旧，工作量不能再修改，如需调整请先反折旧`,
        })
      }
      continue
    }
    const remaining = Math.max(0, Math.round((total - Number(a.workload_done || 0)) * 10000) / 10000)
    if (total > 0 && Number(wl) > remaining) {
      return res.status(400).json({
        code: 400,
        message: `资产 ${assetNo} 本月工作量 ${Number(wl)} 超过剩余工作量 ${remaining}（总工作量 ${total}）`,
      })
    }
  }
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

    // P0-5：目标期间已结账则拒绝计提；开账前的期间同样不能计提
    try {
      assertPeriodOpen(db, asid, Number(year), Number(month))
      assertPeriodNotBeforeGlStart(db, asid, Number(year), Number(month))
    } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message })
    }

    // P2-1：不允许对未来期间计提（此前可对 2030-01 随意计提）；当前期间 = 自然月与已结账下一期取较晚者（FIX-417）
    const maxYm = latestWritablePeriodKey(db, asid)
    if (Number(year) * 100 + Number(month) > maxYm) {
      return res.status(400).json({ code: 400, message: `不能对晚于当前期间（${Math.floor(maxYm / 100)}年${maxYm % 100}月）的期间计提折旧` })
    }

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
    } else {
      // AS-P1-3：未配置起始期间时的兜底连续性校验——
      // 此前 8 月漏提、9 月直接计提完全放行，中间月份永远漏提、累计折旧序列断裂
      const lastRow = db.prepare(
        'SELECT year, month FROM fixed_asset_depr WHERE account_set_id=? ORDER BY year DESC, month DESC LIMIT 1'
      ).get(asid) as { year: number; month: number } | undefined
      if (lastRow) {
        const nextMonth = lastRow.month >= 12 ? 1 : lastRow.month + 1
        const nextYear = lastRow.month === 12 ? lastRow.year + 1 : lastRow.year
        const targetYm = year * 100 + month
        const expectedYm = nextYear * 100 + nextMonth
        if (targetYm > expectedYm) {
          return res.status(400).json({
            code: 400,
            message: `检测到漏提：最近已计提期间为 ${lastRow.year}年${lastRow.month}月，请先完成 ${nextYear}年${nextMonth}月 折旧（或在系统参数中配置「折旧起始期间」）`,
          })
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
          // AS-P1-12：科目授权——折旧凭证分录科目不在授权范围内时删除凭证并告警（计提保留）
          const scopeErr = assertVoucherEntriesInScopeById(db, req.accountScope, voucherResult.voucherId, asid)
          if (scopeErr) {
            deleteVoucherRecords(db, voucherResult.voucherId)
            voucherResult = null
            throw new Error(scopeErr)
          }
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
      v.voucher_no as voucher_no,
      v.status as voucher_status
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

// GET /asset/depr/query — 折旧查询（第七份反馈：参照润衡「折旧查询」，按年月范围 + 条件逐月列出计提记录）
// from / to 为 YYYYMM（含两端）；部门 / 用途取计提当时的记录，类别取卡片当前类别
router.get('/asset/depr/query', (req: AuthRequest, res) => {
  const q = req.query as Record<string, string>
  try {
    res.json({ code: 0, data: queryDeprRecords(getDb(), req.accountSetId || '', {
      fromYm: Number(q.from), toYm: Number(q.to),
      category_code: q.category_code, dept_code: q.dept_code, purpose_code: q.purpose_code,
      depr_method: q.depr_method, keyword: q.keyword, hideZero: q.hide_zero === '1',
    }) })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e.message })
  }
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

    let voucherResult: any = null
    try {
      voucherResult = generateDeprVoucherForPeriod({
        db,
        accountSetId: asid,
        year: Number(year),
        month: Number(month),
        accumAccount: accum_account,
        makerName: (req as any).userName || '系统',
        voucherTypeId: getAssetParamValue(db, asid, 'asset:depr_voucher_type_id'),
      })
    } catch (e: any) {
      return res.status(400).json({ code: 400, message: e.message || '生成凭证失败' })
    }
    res.json({ code: 0, data: { voucher: voucherResult } })
  }
)

// ── 凭证管理：只删凭证（保留业务记录）+ 重新生成 ─────────────────────────

/** 按凭证类型细分写权限（读列表走 ASSET_PERMISSION_RULES 的 asset:view） */
function assetVoucherWriteDenied(req: AuthRequest, kind: AssetVoucherKind, changeKind?: string | null): string | null {
  if (req.permissions?.includes('*')) return null
  const need: Record<Exclude<AssetVoucherKind, 'change'>, string> = {
    purchase: 'asset:edit',
    depr: 'asset:depr',
    disposal: 'asset:dispose',
    inventory: 'asset:inventory',
  }
  if (kind === 'change') return assetChangePermissionError(req, changeKind ?? null)
  return req.permissions?.includes(need[kind]) ? null : '无此操作权限'
}

// GET /asset/vouchers?kind=&year=&month=&status=&keyword=&page=&page_size=
router.get('/asset/vouchers', (req: AuthRequest, res) => {
  const q = req.query as Record<string, string | undefined>
  if (q.kind && !isAssetVoucherKind(q.kind)) return res.status(400).json({ code: 400, message: '凭证类型不正确' })
  const status = q.status === 'generated' || q.status === 'missing' ? q.status : undefined
  const data = listAssetVouchers(getDb(), req.accountSetId || '', {
    kind: q.kind as AssetVoucherKind | undefined,
    year: q.year ? parseInt(q.year) : undefined,
    month: q.month ? parseInt(q.month) : undefined,
    status,
    keyword: q.keyword || undefined,
    refId: q.ref_id || undefined,
    page: q.page ? parseInt(q.page) : 1,
    pageSize: q.page_size ? parseInt(q.page_size) : 50,
  })
  res.json({ code: 0, data })
})

function parseVoucherTarget(req: AuthRequest): { kind: AssetVoucherKind; refId: string; changeKind: string | null } | string {
  const { kind, ref_id } = req.body || {}
  if (!isAssetVoucherKind(kind)) return '凭证类型不正确'
  if (!ref_id || typeof ref_id !== 'string') return '缺少业务记录标识'
  let changeKind: string | null = null
  if (kind === 'change') {
    const row = getDb()
      .prepare('SELECT change_kind FROM fixed_asset_change WHERE id=? AND account_set_id=?')
      .get(ref_id, req.accountSetId) as { change_kind: string | null } | undefined
    changeKind = row?.change_kind ?? null
  }
  return { kind, refId: ref_id, changeKind }
}

// POST /asset/vouchers/delete — 只删凭证，业务记录保留，回到「未生成」
router.post('/asset/vouchers/delete', operationLog('固定资产凭证删除', '固定资产'), (req: AuthRequest, res) => {
  const target = parseVoucherTarget(req)
  if (typeof target === 'string') return res.status(400).json({ code: 400, message: target })
  const denied = assetVoucherWriteDenied(req, target.kind, target.changeKind)
  if (denied) return res.status(403).json({ code: 403, message: denied })
  try {
    const result = deleteAssetVoucherOnly({
      db: getDb(),
      accountSetId: req.accountSetId || '',
      kind: target.kind,
      refId: target.refId,
    })
    res.json({ code: 0, data: result })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e.message || '删除凭证失败' })
  }
})

// POST /asset/vouchers/regenerate — 对「未生成」的业务重新生成凭证
router.post('/asset/vouchers/regenerate', operationLog('固定资产凭证重新生成', '固定资产'), (req: AuthRequest, res) => {
  const target = parseVoucherTarget(req)
  if (typeof target === 'string') return res.status(400).json({ code: 400, message: target })
  const denied = assetVoucherWriteDenied(req, target.kind, target.changeKind)
  if (denied) return res.status(403).json({ code: 403, message: denied })
  const b = req.body || {}
  try {
    // 本次指定的凭证类型（业务凭证中心选择），空则按各业务的凭证类型参数
    const voucherTypeId = normalizeRequestedVoucherTypeId(getDb(), req.accountSetId || '', b.voucher_type_id)
    const result = regenerateAssetVoucher({
      db: getDb(),
      accountSetId: req.accountSetId || '',
      kind: target.kind,
      refId: target.refId,
      operatorName: (req as any).userName || '系统',
      accountScope: req.accountScope,
      input: {
        creditAccount: b.credit_account,
        counterAccount: b.counter_account,
        accumAccount: b.accum_account,
        clearingAccount: b.clearing_account,
        disposalIncome: b.disposal_income,
        disposalExpense: b.disposal_expense,
        surplusAccount: b.surplus_account,
        deficitAccount: b.deficit_account,
        voucherTypeId,
      },
    })
    res.json({ code: 0, data: result })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e.message || '生成凭证失败' })
  }
})

// POST /asset/depr/reverse — 整期反折旧（删折旧记录 + 回退资产 + 删该期凭证）
router.post(
  '/asset/depr/reverse',
  operationLog('固定资产反折旧', '固定资产'),
  (req: AuthRequest, res) => {
    const { year, month } = req.body
    if (!year || !month) return res.status(400).json({ code: 400, message: '年份和月份不能为空' })
    const db = getDb()
    try {
      // P0-5：已结账期间不允许反折旧（会改动已结账期间的账面数据）
      assertPeriodOpen(db, req.accountSetId || '', Number(year), Number(month))
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
  // group_by=asset：全部资产逐项明细（第六份反馈：折旧要能看到每项资产，不只按类别汇总）
  if (!year || !month || (groupBy !== 'asset' && !groupCode)) return res.status(400).json({ code: 400, message: '参数不完整' })
  if (!['category', 'dept', 'asset'].includes(groupBy)) return res.status(400).json({ code: 400, message: 'group_by 仅支持 category / dept / asset' })
  const rows = queryDeprDetail({ db: getDb(), accountSetId: req.accountSetId || '', year, month, groupBy: groupBy as 'category' | 'dept' | 'asset', groupCode })
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
  const rows = queryCategorySummary({ db: getDb(), accountSetId: req.accountSetId || '', statusCode, includeDisposed: req.query.include_disposed === '1' || req.query.include_disposed === 'true' })
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
  const rows = queryDeptSummary({ db: getDb(), accountSetId: req.accountSetId || '', statusCode, includeDisposed: req.query.include_disposed === '1' || req.query.include_disposed === 'true' })
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
      deficitAccount: getAssetParamValue(db, asid, 'asset:inventory_deficit_account') || '1901', // 盘亏记待处理财产损溢；盘盈才记以前年度损益调整
      operatorName: (req as any).userName || '系统',
      accountScope: req.accountScope,
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
