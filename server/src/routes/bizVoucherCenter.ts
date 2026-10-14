/**
 * 业务凭证中心接口（财务总账 → 日常业务 → 业务凭证）
 *
 * 汇总 + 进销存单据的列表 / 逐张生成 / 删除凭证；固定资产提供按日期区间的列表。
 * 出纳流水的列表 / 生成 / 删除由前端直接调用出纳模块现有接口。
 */
import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { genScmVoucherForDoc, genScmVouchersMerged, scmDocTypePerms, SCM_MERGE_MODES, type ScmMergeMode } from './scmDoc.js'
import {
  SCM_VOUCHER_DOC_TYPES,
  countAsset,
  countCashier,
  countScm,
  listAllAssetVouchers,
  listScmVoucherDocs,
  normalizeRange,
  type BizVoucherStatus,
} from '../services/bizVoucherCenter.js'
import { getVoucherUndeletableReason, deleteVoucherWithRefs } from '../services/voucherDelete.js'
import { isAssetVoucherKind } from '../services/assetVoucherManage.js'
import { assertModuleLicensed } from '../services/licenseService.js'
import { docTypeToModules, type LicenseModuleKey } from '../services/licenseModules.js'
import { getPaymentVoucherMode, isPaymentDocType } from '../services/paymentVoucherMode.js'
import { normalizeRequestedVoucherTypeId } from '../services/voucherEntry.js'

const router = Router()
router.use(authMiddleware)

const asid = (req: AuthRequest) => req.accountSetId || ''
const has = (req: AuthRequest, perm: string) => !!req.permissions?.includes('*') || !!req.permissions?.includes(perm)
const hasAny = (req: AuthRequest, perms: string[]) => perms.some(p => has(req, p))

/** 注册码是否包含该模块（任一） */
const licensed = (mods: LicenseModuleKey[]) => mods.length === 0 || !assertModuleLicensed(mods)

/** 当前用户能处理的进销存单据类型（业务域权限 + 模块授权）；结案结转 CA / 工序委外 OP 不在映射表里，分别按生产 / 委外 */
function allowedScmTypes(req: AuthRequest): string[] {
  // 通过出纳制证模式：收付款单的凭证由出纳生成，进销存一侧不列、不生成、不删除
  const cashierMode = getPaymentVoucherMode(getDb(), asid(req)) === 'cashier'
  return SCM_VOUCHER_DOC_TYPES.filter(t => {
    if (cashierMode && isPaymentDocType(t)) return false
    const perms = t === 'CA' ? ['scm:production'] : scmDocTypePerms(t)
    const mods: LicenseModuleKey[] = t === 'CA' ? ['production'] : t === 'OP' ? ['outsource'] : docTypeToModules(t)
    return perms.length > 0 && hasAny(req, perms) && licensed(mods)
  })
}
const canCashier = (req: AuthRequest) => hasAny(req, ['cashier:voucher', 'cashier:journal']) && licensed(['cashier'])
const canAsset = (req: AuthRequest) => has(req, 'asset:view') && licensed(['asset'])

/** 进销存模块所需的表不存在（未启用）时，按无数据处理 */
function hasTable(name: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
}

router.use('/biz-voucher', (req: AuthRequest, res, next) => {
  if (allowedScmTypes(req).length || canCashier(req) || canAsset(req)) return next()
  return res.status(403).json({ code: 403, message: '无此操作权限' })
})

router.get('/biz-voucher/summary', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const range = normalizeRange(req.query.start_date, req.query.end_date)
  const scmTypes = allowedScmTypes(req)
  res.json({
    code: 0,
    data: {
      scm: scmTypes.length && hasTable('scm_doc') ? countScm(db, aid, scmTypes, range) : null,
      cashier: canCashier(req) && hasTable('cashier_journal') ? countCashier(db, aid, req.accountScope, range) : null,
      asset: canAsset(req) && hasTable('fixed_asset') ? countAsset(db, aid, range) : null,
      scm_doc_types: scmTypes,
    },
  })
})

router.get('/biz-voucher/scm-docs', (req: AuthRequest, res) => {
  const q = req.query as Record<string, string | undefined>
  const status = (['pending', 'generated', 'all'].includes(String(q.status)) ? q.status : 'pending') as BizVoucherStatus
  const data = listScmVoucherDocs(getDb(), asid(req), {
    allowedTypes: allowedScmTypes(req),
    status,
    docType: q.doc_type || undefined,
    keyword: q.keyword || undefined,
    ...normalizeRange(q.start_date, q.end_date),
  }, Number(q.page) || 1, Number(q.page_size) || 50)
  res.json({ code: 0, data })
})

const MAX_BATCH = 200
/** 合并制证要一次拿到全部单据才能分组，上限放宽 */
const MAX_MERGE_BATCH = 2000
function readIds(body: any, max = MAX_BATCH): string[] | null {
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map((x: unknown) => String(x || '').trim()).filter(Boolean))] as string[] : []
  return ids.length && ids.length <= max ? ids : null
}

/**
 * 生成凭证。mode：single=每张单一张（默认，逐张，一张失败不影响其他）；
 * all=所选汇总一张、date=按日期汇总、partner=按客商汇总（均按期间再拆，不能跨期）。
 * 返回每张单据的结果（失败原因 / 辅助核算未对应明细 / 合并进的凭证号）。
 */
router.post('/biz-voucher/scm/generate', operationLog('业务凭证中心生成凭证', '凭证管理'), (req: AuthRequest, res) => {
  const rawMode = String(req.body?.mode || 'single')
  const mergeMode = (SCM_MERGE_MODES as readonly string[]).includes(rawMode) ? rawMode as ScmMergeMode : null
  if (rawMode !== 'single' && !mergeMode) return res.status(400).json({ code: 400, message: '生成方式无效' })
  const max = mergeMode ? MAX_MERGE_BATCH : MAX_BATCH
  const ids = readIds(req.body, max)
  if (!ids) return res.status(400).json({ code: 400, message: `请选择 1~${max} 张单据` })
  const db = getDb(); const aid = asid(req)
  // 本次指定的凭证类型（逐张路径由 genVoucherHandler 从 req.body 读取，这里先统一校验）
  let voucherTypeId: string | null
  try {
    voucherTypeId = normalizeRequestedVoucherTypeId(db, aid, req.body?.voucher_type_id)
  } catch (e: any) {
    return res.status(400).json({ code: 400, message: e.message })
  }
  const allowed = new Set(allowedScmTypes(req))
  const getDoc = db.prepare('SELECT id, doc_no, doc_type FROM scm_doc WHERE id=? AND account_set_id=?')
  if (mergeMode) {
    const denied: Array<{ id: string; doc_no: string; ok: false; message: string }> = []
    const passIds: string[] = []
    for (const id of ids) {
      const doc = getDoc.get(id, aid) as { id: string; doc_no: string; doc_type: string } | undefined
      if (!doc) denied.push({ id, doc_no: '', ok: false, message: '单据不存在' })
      else if (!allowed.has(doc.doc_type)) denied.push({ id, doc_no: doc.doc_no, ok: false, message: '无该类单据的操作权限，或该类单据不生成凭证' })
      else passIds.push(id)
    }
    const merged = passIds.length ? genScmVouchersMerged(req, passIds, mergeMode, voucherTypeId) : []
    const byId = new Map<string, any>([...denied, ...merged].map(r => [r.id, r]))
    const results = ids.map(id => byId.get(id))
    const voucherCount = new Set(results.filter(r => r.ok).map(r => r.voucher_id)).size
    return res.json({ code: 0, data: { results, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, voucher_count: voucherCount } })
  }
  const results = ids.map(id => {
    const doc = getDoc.get(id, aid) as { id: string; doc_no: string; doc_type: string } | undefined
    if (!doc) return { id, doc_no: '', ok: false, message: '单据不存在' }
    if (!allowed.has(doc.doc_type)) return { id, doc_no: doc.doc_no, ok: false, message: '无该类单据的操作权限，或该类单据不生成凭证' }
    const r = genScmVoucherForDoc(req, id)
    if (r.status >= 400 || r.body?.code !== 0) {
      return { id, doc_no: doc.doc_no, ok: false, message: r.body?.message || '生成失败', reason: r.body?.reason, data: r.body?.data }
    }
    return { id, doc_no: doc.doc_no, ok: true, voucher_id: r.body.data?.voucher_id, voucher_no: r.body.data?.voucher_no }
  })
  res.json({ code: 0, data: { results, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length } })
})

/** 按单据删除其凭证（与总账删除凭证同守卫：已记账 / 期间已结账不能删），单据恢复「待生成」 */
router.post('/biz-voucher/scm/delete', operationLog('业务凭证中心删除凭证', '凭证管理'), (req: AuthRequest, res) => {
  if (!has(req, 'voucher:entry')) return res.status(403).json({ code: 403, message: '删除凭证需要「凭证录入」权限' })
  const ids = readIds(req.body)
  if (!ids) return res.status(400).json({ code: 400, message: `请选择 1~${MAX_BATCH} 张单据` })
  const db = getDb(); const aid = asid(req)
  const allowed = new Set(allowedScmTypes(req))
  const getDoc = db.prepare('SELECT id, doc_no, doc_type, voucher_id FROM scm_doc WHERE id=? AND account_set_id=?')
  const getVoucher = db.prepare('SELECT * FROM vouchers WHERE id=? AND account_set_id=?')
  const affected = new Map<string, { year: number; period: number; voucher_type_id: string | null }>()
  const deletedShared = new Map<string, string>()
  const results = ids.map(id => {
    const doc = getDoc.get(id, aid) as { id: string; doc_no: string; doc_type: string; voucher_id: string | null } | undefined
    if (!doc) return { id, doc_no: '', ok: false, message: '单据不存在' }
    if (!allowed.has(doc.doc_type)) return { id, doc_no: doc.doc_no, ok: false, message: '无该类单据的操作权限' }
    if (!doc.voucher_id) {
      // 合并凭证：同批前面的单据已删掉这张凭证，本单随之恢复待生成
      const via = deletedShared.get(id)
      if (via) return { id, doc_no: doc.doc_no, ok: true, voucher_no: via, message: `合并凭证 ${via} 已删除` }
      return { id, doc_no: doc.doc_no, ok: false, message: '尚未生成凭证' }
    }
    const voucher = getVoucher.get(doc.voucher_id, aid) as any
    if (!voucher) {
      // 凭证已在别处被删、单据还挂着 id：顺手清掉，单据恢复待生成
      db.prepare('UPDATE scm_doc SET voucher_id=NULL WHERE id=?').run(id)
      return { id, doc_no: doc.doc_no, ok: true, voucher_no: '', message: '凭证已不存在，已恢复为待生成' }
    }
    const reason = getVoucherUndeletableReason(voucher, { db, accountSetId: aid, bypassSourceGuard: true })
    if (reason) return { id, doc_no: doc.doc_no, ok: false, voucher_no: voucher.voucher_no, message: reason }
    // 合并凭证：同一张凭证上的其它单据一并恢复待生成
    const sharers = db.prepare('SELECT id, doc_no FROM scm_doc WHERE account_set_id=? AND voucher_id=? AND id<>?').all(aid, voucher.id, id) as Array<{ id: string; doc_no: string }>
    deleteVoucherWithRefs(db, aid, voucher)
    for (const sh of sharers) deletedShared.set(sh.id, voucher.voucher_no)
    affected.set(`${voucher.year}-${voucher.period}-${voucher.voucher_type_id ?? ''}`, {
      year: voucher.year, period: voucher.period, voucher_type_id: voucher.voucher_type_id ?? null,
    })
    return {
      id, doc_no: doc.doc_no, ok: true, voucher_no: voucher.voucher_no,
      // shared_ids：前端分批删除时据此跳过后续批次里的同凭证单据
      ...(sharers.length ? { message: `合并凭证，${sharers.map(x => x.doc_no).join('、')} 一并恢复待生成`, shared_ids: sharers.map(x => x.id) } : {}),
    }
  })
  res.json({
    code: 0,
    data: { results, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, affectedGroups: [...affected.values()] },
  })
})

/** 固定资产：按日期区间（月份）筛选的凭证列表，生成 / 删除仍走 /asset/vouchers/* */
router.get('/biz-voucher/asset-items', (req: AuthRequest, res) => {
  if (!canAsset(req)) return res.status(403).json({ code: 403, message: '无此操作权限' })
  const q = req.query as Record<string, string | undefined>
  if (q.kind && !isAssetVoucherKind(q.kind)) return res.status(400).json({ code: 400, message: '凭证类型不正确' })
  const status = q.status === 'pending' ? 'missing' : q.status === 'generated' ? 'generated' : undefined
  const rows = listAllAssetVouchers(getDb(), asid(req), {
    kind: q.kind && isAssetVoucherKind(q.kind) ? q.kind : undefined,
    status,
    keyword: q.keyword || undefined,
    ...normalizeRange(q.start_date, q.end_date),
  })
  const page = Math.max(Number(q.page) || 1, 1)
  const size = Math.min(Math.max(Number(q.page_size) || 50, 1), 500)
  res.json({ code: 0, data: { list: rows.slice((page - 1) * size, page * size), total: rows.length, page, page_size: size } })
})

export default router
