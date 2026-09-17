/**
 * 供应链统一单据路由 — 一期 P2 库存单据 + P3-P7 全链路
 *
 * scm_doc(头)+scm_doc_line(明细)+scm_doc_type(类型配置)，pjlb 区分类型。
 * 审核/反审核触发库存移动（scm_stock_move），计价引擎在 services/scmCosting。
 */
import { Router, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { applyMovingAvgIn, applyMovingAvgOut, reverseDocMoves, getCostingMethod } from '../services/scmCosting.js'
import { applyPayment, applyInvoice, reverseInvoice, reversePayment, getPartnerLedger, getAllPartnerLedger, applyReceivableFromShipment, applyPayableFromReceipt, applyOutsourceFeePayable, getOpenItems, getPaymentSources, verifyArAp, cancelVerify, listVerifies, getDocVerifiedInfo, getArApAging, getDueReminder, getPartnerCredit, getPartnerOpenAr, getPartnerBalanceSummary } from '../services/scmArAp.js'
import { assertAccountIdsInScope, type AccountScopeContext } from '../services/accountAuthorization.js'
import { assertGlPeriodOpen } from '../services/voucherMutationGuard.js'
import { maintainDocBatches, reverseDocBatches } from '../services/scmBatch.js'
import { maintainDocSerials, reverseDocSerials } from '../services/scmSerial.js'
import { computeIssueSuggestion, computeProductionPlanActionState, computePushedQty } from '../services/scmProduction.js'
import { getReportedGoodQtyByProduct, validateWorkReportQty } from '../services/scmWorkReport.js'
import { getQcDefectLines, validateFinishQc, validateQcDefectPush } from '../services/scmQcControl.js'
import { buildMissingAccountMessage, resolveScmAccount } from '../services/scmAccountResolver.js'
import {
  calculateMrpDocument,
  applyMrpAdjustments,
  createMrpDocument,
  currentMrpSourceRefs,
  findActiveMrpSource,
  getMrpDocumentSourceDetails,
  listMrpSourceOptions,
  replaceMrpSources,
  type MrpSourceKind,
} from '../services/scmMrpDocument.js'
import { getCostVariance } from '../services/scmCostVariance.js'
import { sendStateError } from '../utils/stateError.js'
import { assertModuleLicensed } from '../services/licenseService.js'
import { docTypeToModules, planTypeToModules, type LicenseModuleKey } from '../services/licenseModules.js'
import { restoreMissingSourceLineIds, restorePlanProductLineage } from '../services/scmDocLineage.js'
import { buildMrPushPreview, groupMrProductionPlanLines, resolveMrPushNodeSupplier } from '../services/scmMrPush.js'
import { buildSalesOrderAvailabilityLines, hasBatchDispatchRemaining } from '../services/scmSalesOrderAvailability.js'
import { buildScmPushOptions, type ScmPushSourceKind } from '../services/scmPushOptions.js'
import { getScmMaxAllowedQty, getScmOverrunPolicy } from '../services/scmOverrunPolicy.js'
import { querySalesOrderRelations } from '../services/scmSalesOrderRelations.js'
import { buildPurchaseReceiptDraftGroups, purchaseOrderPushSourceSql } from '../services/scmPurchaseBatchPush.js'
import { getStatementExternalOrderNos, getStatementSalesOrderNos } from '../services/scmStatementSalesOrder.js'
import { getPurchaseReceiptOrderNosByLine, getSalesDispatchOrderNosByLine } from '../services/scmSalesDispatchOrderNumbers.js'
import { executeBatchAtomically, normalizeBatchIds, validateBatchPushDocuments, validateProductionPlanBatchAction } from '../services/scmBatchDocuments.js'
import { applyAuditDefaultWarehouses, inspectAuditDefaultWarehouses } from '../services/scmAuditDefaultWarehouse.js'
import {
  validateFinishKitting,
  PHYSICAL_CHILD_DOC_TYPES,
  computeSourceLineUsedQty,
  findDraftDocumentUsingSourceLines,
  validatePlanFinishQuantities,
  validatePlanIssueQuantities,
  validatePlanLink,
  validateSourceLineQuantities,
} from '../services/scmDocumentControls.js'

const router = Router()
router.use(authMiddleware)

// ── 权限守卫（细化：业务域 + 操作权限，admin '*' 放行） ──────────────────
// 单据类型 → 业务域（与 seedDocTypes 的 category 保持一致）
const CODE_CATEGORY: Record<string, string> = {
  IS: 'inventory', OI: 'inventory', OO: 'inventory', TR: 'inventory', CK: 'inventory',
  PI: 'purchase', PR: 'purchase', PQ: 'purchase', PO: 'purchase', RP: 'purchase',
  SO: 'sale', SR: 'sale', SQ: 'sale', SOa: 'sale', RS: 'sale',
  PL: 'production', PF: 'production', PS: 'production', PB: 'production', PJ: 'production', AS: 'production', DS: 'production',
  WO: 'outsource', WI: 'outsource',
  PAY: 'finance', RCV: 'finance',
}
// 业务域 → 权限码
const CATEGORY_PERM: Record<string, string> = {
  inventory: 'scm:inventory', purchase: 'scm:purchase', sale: 'scm:sale',
  production: 'scm:production', outsource: 'scm:outsource', finance: 'scm:arap',
}
// 由单据 id 反查单据类型（用于 /scm/docs/:id[/op]）
function docTypeById(req: AuthRequest): string | undefined {
  const m = req.path.match(/^\/scm\/docs\/([0-9a-fA-F-]{8,})/)
  if (!m) return undefined
  try {
    const row = getDb().prepare('SELECT doc_type FROM scm_doc WHERE id=? AND account_set_id=?')
      .get(m[1], req.accountSetId || '') as { doc_type?: string } | undefined
    return row?.doc_type || undefined
  } catch { return undefined }
}
function docCategoryById(req: AuthRequest): string | undefined {
  const docType = docTypeById(req)
  return docType ? CODE_CATEGORY[docType] : undefined
}
/** 权限守卫用的单据类型：新增取 body、按 id 的接口反查、列表取筛选参数 */
function docTypeForPerm(req: AuthRequest): string | undefined {
  if (req.method === 'POST' && req.path === '/scm/docs') return String(req.body?.doc_type || '') || undefined
  if (/^\/scm\/docs\/[0-9a-fA-F-]{8,}/.test(req.path)) return docTypeById(req)
  return String(req.query?.doc_type || '') || undefined
}

// ── 模块授权守卫：按单据 id 的接口在全局 licenseMiddleware 里拿不到 doc_type，这里补一次 ──
// 生产 / 委外单据（PL/PF/WO/WI 等）要求对应模块已注册；其余单据类型归进销存，全局中间件已按 /api/scm 前缀校验。
function planTypeById(req: AuthRequest): string | undefined {
  const m = req.path.match(/^\/scm\/production-plans\/([0-9a-fA-F-]{8,})/)
  if (!m) return undefined
  try {
    const row = getDb().prepare('SELECT plan_type FROM scm_production_plan WHERE id=? AND account_set_id=?')
      .get(m[1], req.accountSetId || '') as { plan_type?: string } | undefined
    return row?.plan_type || undefined
  } catch { return undefined }
}
router.use((req: AuthRequest, res, next) => {
  let required: LicenseModuleKey[] = []
  if (/^\/scm\/docs\/[0-9a-fA-F-]{8,}/.test(req.path)) {
    required = docTypeToModules(docTypeById(req))
  } else if (/^\/scm\/production-plans\/[0-9a-fA-F-]{8,}/.test(req.path)) {
    const planType = planTypeById(req)
    if (planType) required = planTypeToModules(planType)
  }
  if (required.length === 0) return next()
  const error = assertModuleLicensed(required)
  if (error) return res.status(402).json({ code: error.code, message: error.message })
  return next()
})

router.use((req: AuthRequest, res, next) => {
  const p = req.path
  if (!p.startsWith('/scm/')) return next()
  if (req.permissions?.includes('*')) return next()
  const has = (perm: string) => !!req.permissions?.includes(perm)
  const deny = () => res.status(403).json({ code: 403, message: '无此操作权限' })

  let needAny: string[] | null = null   // 业务域权限（任一即可）
  let needAction: string | null = null  // 审核/删除等操作权限

  if (p === '/scm/docs/types' || p === '/scm/docs/next-no' || p === '/scm/boms/next-no') {
    return next()                        // 读类型/取号：任意已登录放行
  } else if (p === '/scm/docs/seed') {
    needAny = ['scm:import']
  } else if (p.startsWith('/scm/sales-order-relations')) {
    needAny = ['scm:sale']
  } else if (p.startsWith('/scm/docs')) {
    let cat: string | undefined
    if (req.method === 'POST' && p === '/scm/docs') {
      cat = CODE_CATEGORY[String(req.body?.doc_type || '')]
    } else if (/^\/scm\/docs\/[0-9a-fA-F-]{8,}/.test(p)) {
      cat = docCategoryById(req)
    } else {
      cat = CODE_CATEGORY[String(req.query?.doc_type || '')]  // 列表按筛选域
    }
    needAny = cat ? [CATEGORY_PERM[cat]] : null
    // 期初入库(IS)是建立库存的唯一入口，生产/委外单独授权时也要能用；
    // 除进销存的「其他出入库」权限外，额外接受专用的「期初库存」权限（scm:opening 属共享基础层）。
    if (docTypeForPerm(req) === 'IS') needAny = ['scm:inventory', 'scm:opening']
    if (/\/(audit|unaudit)$/.test(p)) needAction = 'scm:audit'
    else if (req.method === 'DELETE') needAction = 'scm:delete'
  } else if (p.startsWith('/scm/boms') || p.startsWith('/scm/production-plans') || p.startsWith('/scm/work-centers') || p.startsWith('/scm/routings') || p.startsWith('/scm/work-reports') || p.startsWith('/scm/qc-docs') || p.startsWith('/scm/mrp')) {
    needAny = ['scm:production', 'scm:outsource']  // BOM/工单/工作中心/工艺路线/报工/质检/MRP 为生产、委外共用
    if (/\/(audit|unaudit)$/.test(p)) needAction = 'scm:audit'
    else if (req.method === 'DELETE') needAction = 'scm:delete'
  } else if (p.startsWith('/scm/arap')) {
    needAny = ['scm:arap']
  } else {
    return next()                        // 其余 /scm/* 由各自路由文件守卫
  }

  if (needAny && !needAny.some(has)) return deny()
  if (needAction && !has(needAction)) return deny()
  next()
})

const asid = (req: AuthRequest) => req.accountSetId || ''
const userName = (req: AuthRequest) => (req as any).userName || '系统'

// seed doc types from ACD dj_lx + extended types
function seedDocTypes(db: ReturnType<typeof getDb>, accountSetId: string) {
  const seeds = [
    // inventory
    { code: 'IS', name: '期初入库',     dir: 'in',  stock: 1, ar_ap: 0, cat: 'inventory' },
    { code: 'PI', name: '采购入库',     dir: 'in',  stock: 1, ar_ap: 0, cat: 'purchase' },
    { code: 'PR', name: '采购退货',     dir: 'out', stock: 1, ar_ap: 0, cat: 'purchase' },
    { code: 'SO', name: '销售出库',     dir: 'out', stock: 1, ar_ap: 0, cat: 'sale' },
    { code: 'SR', name: '销售退货',     dir: 'in',  stock: 1, ar_ap: 0, cat: 'sale' },
    { code: 'OI', name: '其他入库',     dir: 'in',  stock: 1, ar_ap: 0, cat: 'inventory' },
    { code: 'OO', name: '其他出库',     dir: 'out', stock: 1, ar_ap: 0, cat: 'inventory' },
    { code: 'TR', name: '调拨单',       dir: 'none', stock: 1, ar_ap: 0, cat: 'inventory' },
    { code: 'CK', name: '盘点单',       dir: 'none', stock: 1, ar_ap: 0, cat: 'inventory' },
    // production
    { code: 'PL', name: '生产领用',     dir: 'out', stock: 1, ar_ap: 0, cat: 'production' },
    { code: 'PF', name: '完工入库',     dir: 'in',  stock: 1, ar_ap: 0, cat: 'production' },
    { code: 'PS', name: '不良品入库',   dir: 'in',  stock: 1, ar_ap: 0, cat: 'production' },
    { code: 'PB', name: '补料单',       dir: 'out', stock: 1, ar_ap: 0, cat: 'production' },
    { code: 'PJ', name: '退料单',       dir: 'in',  stock: 1, ar_ap: 0, cat: 'production' },
    { code: 'MRP',name: 'MRP计算单',    dir: 'none', stock: 0, ar_ap: 0, cat: 'production' },
    // outsourcing
    { code: 'WO', name: '委外发货',     dir: 'out', stock: 1, ar_ap: 0, cat: 'outsource' },
    { code: 'WI', name: '委外入库',     dir: 'in',  stock: 1, ar_ap: 0, cat: 'outsource' },
    // assembly
    { code: 'AS', name: '组装单',       dir: 'none', stock: 1, ar_ap: 0, cat: 'production' },
    { code: 'DS', name: '拆卸单',       dir: 'none', stock: 1, ar_ap: 0, cat: 'production' },
    // purchase/sale transactions (P3)
    { code: 'PQ', name: '采购询价单',   dir: 'none', stock: 0, ar_ap: 0, cat: 'purchase' },
    { code: 'PO', name: '采购订单',     dir: 'none', stock: 0, ar_ap: 0, cat: 'purchase' },
    { code: 'SQ', name: '销售报价单',   dir: 'none', stock: 0, ar_ap: 0, cat: 'sale' },
    { code: 'SOa',name: '销售订单',     dir: 'none', stock: 0, ar_ap: 0, cat: 'sale' },
    { code: 'RP', name: '采购发票',     dir: 'none', stock: 0, ar_ap: 1, cat: 'purchase' },
    { code: 'RS', name: '销售发票',     dir: 'none', stock: 0, ar_ap: 1, cat: 'sale' },
    { code: 'PAY',name: '付款单',       dir: 'none', stock: 0, ar_ap: 1, cat: 'finance' },
    { code: 'RCV',name: '收款单',       dir: 'none', stock: 0, ar_ap: 1, cat: 'finance' },
  ]
  const ins = db.prepare(
    'INSERT OR IGNORE INTO scm_doc_type (id, account_set_id, code, name, direction, affects_stock, affects_ar_ap, category) VALUES (?,?,?,?,?,?,?,?)'
  )
  for (const s of seeds) {
    ins.run(uuidv4(), accountSetId, s.code, s.name, s.dir, s.stock, s.ar_ap, s.cat)
  }
  // 收付款单使用金额明细，不参与物料/库存录入。迁移负责修复既有账套，此处保证新账套配置正确。
  db.prepare(`UPDATE scm_doc_type
    SET header_fields=?, line_fields=?, required_fields=?
    WHERE account_set_id=? AND code IN ('PAY','RCV')`).run(
    JSON.stringify(['partner', 'payment', 'settle_account', 'currency', 'remark']),
    JSON.stringify(['source_doc', 'amount', 'remark']),
    JSON.stringify(['partner', 'settle_account']),
    accountSetId,
  )
  return seeds.length
}

// auto-number: YYYYMM-code-001
// 单据编号：按参数 scm:doc_no_rule 模板生成，支持 {YYYY}{YY}{MM}{DD}{CODE}{SEQ:n}
// 默认 {YYYY}{MM}-{CODE}-{SEQ:3} 等价于历史 YYYYMM-CODE-001
/**
 * 生成单据号。
 *
 * 年月日取自单据日期而非服务器当前日期——补录上月单据时若按当前月取号，
 * 单号月份会与单据期间对不上（{YYYY}{MM} 规则下尤为明显）。
 */
export function nextDocNo(db: ReturnType<typeof getDb>, accountSetId: string, docTypeCode: string, docDate?: string | null): string {
  const now =
    typeof docDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(docDate)
      ? new Date(`${docDate.slice(0, 10)}T00:00:00`)
      : new Date()
  const ruleRow = db.prepare("SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='scm:doc_no_rule'").get(accountSetId) as any
  let rule = String(ruleRow?.param_value || '').trim() || '{YYYY}{MM}-{CODE}-{SEQ:3}'
  if (!/\{SEQ(:\d+)?\}/.test(rule)) rule += '-{SEQ:3}'  // 规则缺序号则补在末尾
  const YYYY = String(now.getFullYear()); const YY = YYYY.slice(2)
  const MM = String(now.getMonth() + 1).padStart(2, '0'); const DD = String(now.getDate()).padStart(2, '0')
  const tmpl = rule.replace(/\{YYYY\}/g, YYYY).replace(/\{YY\}/g, YY).replace(/\{MM\}/g, MM).replace(/\{DD\}/g, DD).replace(/\{CODE\}/g, docTypeCode)
  const seqM = tmpl.match(/\{SEQ(?::(\d+))?\}/)!
  const seqWidth = seqM[1] ? parseInt(seqM[1]) : 3
  const prefix = tmpl.slice(0, tmpl.indexOf(seqM[0]))
  const rows = db.prepare(
    'SELECT doc_no FROM scm_doc WHERE account_set_id=? AND doc_type=? AND doc_no LIKE ?'
  ).all(accountSetId, docTypeCode, `${prefix}%`) as Array<{ doc_no: string }>
  let max = 0
  for (const r of rows) {
    const m = r.doc_no.slice(prefix.length).match(/^(\d+)/)
    if (m) max = Math.max(max, parseInt(m[1]))
  }
  return tmpl.replace(seqM[0], String(max + 1).padStart(seqWidth, '0'))
}

/**
 * 在排它事务中取号并写库，遇唯一约束冲突自动重试（最多 3 次）。
 *
 * nextDocNo / nextSeqNo 都是「查最大值 + 1」，两个连接同时保存会取到同一个号，
 * 撞 UNIQUE(account_set_id, doc_type, doc_no) 后直接抛约束错误给用户（500）。
 * 用 BEGIN IMMEDIATE 把「取号 + 插入」括起来即可串行化；跨进程仍可能撞锁，
 * 故保留重试。口径与凭证录入（routes/voucher.ts）一致。
 */
function withDocNoRetry<T>(db: ReturnType<typeof getDb>, fn: () => T): T {
  const MAX_RETRIES = 3
  let lastError: any = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return db.transaction(fn).immediate()
    } catch (e: any) {
      lastError = e
      const msg = String(e?.message || '')
      const retryable =
        e?.code === 'SQLITE_BUSY' ||
        e?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        /UNIQUE constraint failed|database is locked/i.test(msg)
      if (!retryable) throw e
    }
  }
  throw lastError
}

// helper: lookup item by code → { id, name, inv_account, sale_account, ... }
function getItem(db: ReturnType<typeof getDb>, accountSetId: string, code: string) {
  return db.prepare('SELECT * FROM scm_item WHERE account_set_id=? AND code=?').get(accountSetId, code) as any
}

// 折扣口径（中国式「折」）：折率 dr ∈ (0,10]，N折=价格×N/10；dr<=0 表示不折扣（原价）。
function discountFactor(dr: number): number {
  const n = Number(dr) || 0
  return n > 0 ? n / 10 : 1
}
function round2(n: number): number { return Math.round(n * 100) / 100 }
function r6(n: number): number { return Math.round(n * 1000000) / 1000000 }

/**
 * 完工入库成本结转（实际成本·按计划数分摊，末批吸收差异）。
 * @returns isLast 是否末批；unitCost 单位成本=已领成本/计划数；thisAmount 本次入库金额；perUnit 入库单位成本
 */
export function computeFinishCost(p: { issuedCost: number; planQty: number; wipBefore: number; finishedBefore: number; thisQty: number }) {
  const isLast = p.planQty > 0 && (p.finishedBefore + p.thisQty) >= p.planQty - 1e-6
  const unitCost = p.planQty > 0 ? round2(p.issuedCost / p.planQty) : 0
  let thisAmount = isLast ? p.wipBefore : Math.min(round2(p.thisQty * unitCost), p.wipBefore)
  if (thisAmount < 0) thisAmount = 0
  const perUnit = p.thisQty > 0 ? round2(thisAmount / p.thisQty) : 0
  return { isLast, unitCost, thisAmount, perUnit }
}
// 行金额=数量×单价×折率系数；折扣额=原价-折后金额
function lineAmountWithDiscount(qty: number, price: number, dr: number): { amount: number; discount_amount: number } {
  const gross = (Number(qty) || 0) * (Number(price) || 0)
  const amount = round2(gross * discountFactor(dr))
  return { amount, discount_amount: round2(gross - amount) }
}

// 明细行落库列（create/update 共用，确保扩展字段不丢失）
const DOC_LINE_COLUMNS = [
  'id', 'account_set_id', 'doc_id', 'seq', 'item_code', 'warehouse_code', 'qty', 'price', 'amount',
  'tax_rate', 'tax_amount', 'unit_cost', 'batch_no', 'source_line_id', 'remark',
  'discount_rate', 'discount_amount', 'price_with_tax', 'spec', 'unit', 'expire_date', 'produce_date',
  'gift_flag', 'ref_no', 'scrap_rate', 'process_fee', 'field_values', 'supplier_code', 'source_type', 'serial_nos', 'bin_no', 'line_role', 'product_group',
  'arap_source_log_id',
]
function prepareDocLineInsert(db: ReturnType<typeof getDb>) {
  return db.prepare(
    `INSERT INTO scm_doc_line (${DOC_LINE_COLUMNS.join(',')}) VALUES (${DOC_LINE_COLUMNS.map(() => '?').join(',')})`
  )
}
// 缺料单（MR）保存时：空的供应商/来源按物料档案默认值回填（仅补空，不覆盖已填）。
// 物料档案 supplier_code 同时承载采购供应商与委外外协厂，按 source_type 区分用途。
function fillMrLineDefaults(db: ReturnType<typeof getDb>, aid: string, docType: string, lines: any[]) {
  if (docType !== 'MR' || !Array.isArray(lines) || !lines.length) return
  const codes = Array.from(new Set(lines.map(l => l && l.item_code).filter(Boolean)))
  if (!codes.length) return
  const ph = codes.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT code, supplier_code, source_type FROM scm_item WHERE account_set_id=? AND code IN (${ph})`
  ).all(aid, ...codes) as any[]
  const byCode = new Map(rows.map(r => [r.code, r]))
  for (const l of lines) {
    const it = byCode.get(l.item_code)
    if (!it) continue
    if (!l.supplier_code) l.supplier_code = it.supplier_code || ''
    if (!l.source_type) l.source_type = it.source_type || 'purchase'
  }
}

// 组装一行明细的落库值（含按折扣口径算好的金额）；返回 { values, qty, amount } 供累计合计
function buildDocLineRow(aid: string, docId: string, seq: number, l: any, headerWh?: string | null) {
  const q = Number(l.qty) || 0
  const p = Number(l.price) || 0
  const dr = Number(l.discount_rate) || 0
  // 发票类单据常常只填金额、不填数量单价（如「运费 500 元」一行）。
  // 原实现恒按 qty×price×折率 计算，这类行的金额会被直接算成 0 而丢失。
  // 仅在「没有数量」时才采用前端传入的金额；有数量仍按单价算，行为不变。
  const directAmount = q === 0 && l.amount != null && Number(l.amount) !== 0 ? round2(Number(l.amount)) : null
  const { amount, discount_amount } = directAmount != null
    ? { amount: directAmount, discount_amount: 0 }
    : lineAmountWithDiscount(q, p, dr)
  const fv = l.field_values && typeof l.field_values === 'object'
    ? JSON.stringify(l.field_values)
    : (l.field_values ?? '{}')
  const values = [
    uuidv4(), aid, docId, seq, l.item_code ?? null, l.warehouse_code || headerWh || null, q, p, amount,
    l.tax_rate ?? null, l.tax_amount ?? 0, l.unit_cost ?? 0, l.batch_no ?? null, l.source_line_id ?? null, l.remark ?? null,
    dr, discount_amount, Number(l.price_with_tax) || 0, l.spec ?? null, l.unit ?? null, l.expire_date ?? null, l.produce_date ?? null,
    l.gift_flag ? 1 : 0, l.ref_no ?? null, Number(l.scrap_rate) || 0, Number(l.process_fee) || 0, fv, l.supplier_code ?? null, l.source_type ?? null,
    Array.isArray(l.serial_nos) ? JSON.stringify(l.serial_nos) : (l.serial_nos ?? null),
    l.bin_no ?? null, l.line_role ?? null,
    (l.product_group === undefined || l.product_group === null || l.product_group === '') ? null : Number(l.product_group),
    l.arap_source_log_id ?? null,
  ]
  return { values, qty: q, amount }
}

/** 明细行落库数组中受整单折扣影响的列下标（从 DOC_LINE_COLUMNS 推导，避免手写魔法数字） */
export const LINE_COL_QTY = DOC_LINE_COLUMNS.indexOf('qty')
export const LINE_COL_PRICE = DOC_LINE_COLUMNS.indexOf('price')
export const LINE_COL_AMOUNT = DOC_LINE_COLUMNS.indexOf('amount')
export const LINE_COL_DISCOUNT_AMOUNT = DOC_LINE_COLUMNS.indexOf('discount_amount')
export const LINE_COL_TAX_AMOUNT = DOC_LINE_COLUMNS.indexOf('tax_amount')

/**
 * 把整单折扣分摊到各明细行。
 *
 * 原实现整单折扣只作用于表头 total_amount，行金额不变——而凭证、应收应付、库存成本
 * 全都按行取数，于是「单据合计 ≠ 凭证金额 ≠ 往来挂账额」。这里按行金额比例把折扣摊到
 * 行上（行折扣口径不变，整单折扣叠加在行折扣之后），税额同比例缩放，
 * 末行吸收舍入尾差，保证 Σ行金额 恒等于表头合计。
 *
 * 返回分摊后的合计金额（即表头 total_amount）。
 */
export function allocateHeaderDiscount(rows: Array<{ values: any[]; amount: number }>, discountRate: number): number {
  const factor = discountFactor(discountRate)
  const grossTotal = round2(rows.reduce((s, r) => s + r.amount, 0))
  if (factor === 1 || !rows.length) return grossTotal

  const target = round2(grossTotal * factor)
  let allocated = 0
  // 末行吸收尾差：只有当存在金额非 0 的行时才需要兜底，全 0 行单据直接按 target 返回
  const lastIdx = rows.reduce((idx, r, i) => (r.amount !== 0 ? i : idx), -1)

  rows.forEach((r, i) => {
    const oldAmount = r.amount
    const newAmount = i === lastIdx ? round2(target - allocated) : round2(oldAmount * factor)
    if (i !== lastIdx) allocated = round2(allocated + newAmount)

    const gross = round2((Number(r.values[LINE_COL_QTY]) || 0) * (Number(r.values[LINE_COL_PRICE]) || 0))
    r.values[LINE_COL_AMOUNT] = newAmount
    r.values[LINE_COL_DISCOUNT_AMOUNT] = round2(gross - newAmount)
    // 税额按折后金额同比例缩放（前端按折前金额×税率算的税额在此校正）
    const tax = Number(r.values[LINE_COL_TAX_AMOUNT]) || 0
    if (tax !== 0 && oldAmount !== 0) {
      r.values[LINE_COL_TAX_AMOUNT] = round2(tax * (newAmount / oldAmount))
    }
    r.amount = newAmount
  })

  return lastIdx >= 0 ? target : grossTotal
}

/**
 * 组装单（AS 成品行模式）各成品入库单价的分摊算法（纯函数，便于单测）。
 * - byGroup=true（新单：每条子件都带 product_group 且匹配成品组）：
 *   每个成品单价 = Σ(本组各子件 出库单价×数量) / 该成品数量（各成品互不混）。
 * - byGroup=false（旧单：子件无分组）：调用方按「全池成本/成品总数」摊。
 */
export function allocateAsProductCost(
  products: Array<{ product_group: any; qty: number }>,
  comps: Array<{ product_group: any; qty: number; unitCost: number }>
): { byGroup: boolean; unitCostByGroup: Map<any, number> } {
  const productGroups = new Set(products.map(p => p.product_group).filter(g => g !== null && g !== undefined))
  const activeComps = comps.filter(c => (Number(c.qty) || 0) > 0)
  const byGroup = activeComps.length > 0
    && activeComps.every(c => c.product_group !== null && c.product_group !== undefined && productGroups.has(c.product_group))
    && products.every(p => p.product_group !== null && p.product_group !== undefined)
  const unitCostByGroup = new Map<any, number>()
  if (byGroup) {
    for (const p of products) {
      const q = Number(p.qty) || 0
      let cost = 0
      for (const c of activeComps) if (c.product_group === p.product_group) cost += (Number(c.unitCost) || 0) * (Number(c.qty) || 0)
      unitCostByGroup.set(p.product_group, q > 0 ? Math.round(cost / q * 10000) / 10000 : 0)
    }
  }
  return { byGroup, unitCostByGroup }
}

// 单据表头扩展字段（scm_doc 已有列）：create/update 统一落库，避免漏写导致业务员等录入即丢
const DOC_HEADER_EXTRA_COLUMNS = [
  'biz_person', 'payment_type', 'settle_account', 'invoice_type', 'invoice_no', 'invoice_date',
  'contract_no', 'currency', 'exchange_rate', 'expect_date', 'credit_days', 'dest_warehouse_code', 'total_tax',
  'io_category', 'transport_method', 'tax_rate', 'field_values',
]
function docHeaderExtraValues(b: any) {
  return [
    b.biz_person ?? null, b.payment_type ?? null, b.settle_account ?? null,
    b.invoice_type ?? null, b.invoice_no ?? null, b.invoice_date ?? null,
    b.contract_no ?? null, b.currency || 'CNY', Number(b.exchange_rate) || 1,
    b.expect_date ?? null, Number(b.credit_days) || 0, b.dest_warehouse_code ?? null, Number(b.total_tax) || 0,
    b.io_category ?? null, b.transport_method ?? null, Number(b.tax_rate) || 0,
    // 表头/表尾自定义字段：对象 → JSON 字符串落库（顺序须与 DOC_HEADER_EXTRA_COLUMNS 末项对齐）
    JSON.stringify(b.field_values && typeof b.field_values === 'object' ? b.field_values : {}),
  ]
}

type PaymentValidation = { status: number; message: string } | null

/** 收付款单保存/审核共用校验：单位、账户、正金额，以及源应收应付归属和实时余额。 */
function validatePaymentData(
  db: ReturnType<typeof getDb>,
  aid: string,
  doc: any,
  lines: any[],
  scope?: AccountScopeContext,
): PaymentValidation {
  if (!['PAY', 'RCV'].includes(String(doc?.doc_type || ''))) return null
  if (!doc.partner_code) return { status: 400, message: '收付款单必须指定往来单位' }
  const partner = db.prepare('SELECT id, partner_type FROM scm_partner WHERE account_set_id=? AND code=?').get(aid, doc.partner_code) as any
  if (!partner) return { status: 400, message: `往来单位不存在：${doc.partner_code}` }
  const partnerType = String(partner.partner_type || '').trim().toLowerCase()
  const isBoth = !partnerType || partnerType === 'both' || partnerType === '双向' || partnerType === '3'
  const roleOk = doc.doc_type === 'RCV'
    ? isBoth || /customer|客户|^1$/.test(partnerType)
    : isBoth || /supplier|供应|^2$/.test(partnerType)
  if (!roleOk) return { status: 400, message: doc.doc_type === 'RCV' ? '收款单只能选择客户' : '付款单只能选择供应商' }
  if (!doc.settle_account) return { status: 400, message: '收付款单必须选择现金或银行账户' }
  const account = db.prepare(`SELECT a.id, a.code FROM accounts a
    WHERE a.account_set_id=? AND a.code=? AND a.is_enabled=1 AND (a.is_cash=1 OR a.is_bank=1)
      AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.account_set_id=a.account_set_id AND c.parent_id=a.id)
    LIMIT 1`).get(aid, doc.settle_account) as any
  if (!account) return { status: 400, message: `结算账户无效或不是启用的现金/银行末级科目：${doc.settle_account}` }
  const scopeErr = assertAccountIdsInScope(scope, [account.id])
  if (scopeErr) return { status: 403, message: scopeErr }
  if (!Array.isArray(lines) || lines.some(l => Number(l?.amount) < 0)) {
    return { status: 400, message: '收付款金额不能为负数' }
  }
  if (!lines.some(l => Number(l?.amount) > 0)) {
    return { status: 400, message: '收付款单至少需要一笔大于零的金额' }
  }
  const allowedTypes = doc.doc_type === 'RCV' ? ['SO'] : ['PI', 'WI']
  const seen = new Set<string>()
  const getSource = db.prepare(`SELECT l.id, l.partner_code, l.doc_type, l.doc_no, l.direction,
      l.amount, l.verified_amount, d.status AS doc_status
    FROM scm_ar_ap_log l
    LEFT JOIN scm_doc d ON d.account_set_id=l.account_set_id AND d.doc_type=l.doc_type AND d.doc_no=l.doc_no
    WHERE l.account_set_id=? AND l.id=?`)
  for (const line of lines) {
    if (!line?.arap_source_log_id || !(Number(line.amount) > 0)) continue
    const sourceId = String(line.arap_source_log_id)
    if (seen.has(sourceId)) return { status: 400, message: '同一源单不能重复选择' }
    seen.add(sourceId)
    const source = getSource.get(aid, sourceId) as any
    if (!source) return { status: 400, message: '所选应收应付源单不存在或已失效，请刷新后重选' }
    if (source.partner_code !== doc.partner_code) return { status: 400, message: `源单 ${source.doc_no} 不属于当前往来单位` }
    if (source.direction !== 'in' || !allowedTypes.includes(source.doc_type) || source.doc_status !== 'audited') {
      return { status: 400, message: `源单 ${source.doc_no} 类型或状态不允许用于当前收付款单` }
    }
    if (doc.status !== 'audited') {
      const open = round2(Number(source.amount) - Number(source.verified_amount))
      if (Number(line.amount) > open + 0.005) {
        return { status: 400, message: `源单 ${source.doc_no} 本次金额 ${round2(Number(line.amount))} 超过未结算余额 ${open}` }
      }
    }
  }
  return null
}

/** 收付款明细统一按 qty=1、price=amount 落库，item_code 为空，不保存空白金额行。 */
function normalizePaymentLines(docType: string, lines: any[]): any[] {
  if (!['PAY', 'RCV'].includes(docType) || !Array.isArray(lines)) return lines
  return lines
    .filter(l => Number(l?.amount) > 0)
    .map(l => ({ ...l, item_code: null, warehouse_code: null, qty: 1, price: round2(Number(l.amount)), amount: round2(Number(l.amount)) }))
}

// ── Doc type list ───────────────────────────────────────
router.get('/scm/docs/types', (req: AuthRequest, res) => {
  const db = getDb()
  let list = db.prepare('SELECT * FROM scm_doc_type WHERE account_set_id=? ORDER BY category, code').all(asid(req))
  if (!list.length) { seedDocTypes(db, asid(req)); list = db.prepare('SELECT * FROM scm_doc_type WHERE account_set_id=? ORDER BY category, code').all(asid(req)) }
  res.json({ code: 0, data: list })
})

router.post('/scm/docs/seed', (req: AuthRequest, res) => {
  res.json({ code: 0, data: { seeded: seedDocTypes(getDb(), asid(req)) } })
})

// 销售订单关联大表：以销售订单为根，批量递归归集采购、生产、质检及结算链。
// 加 try/catch：service 内部 BFS/聚合在任何意外情况下抛错时，能返回明确的错误信息，
// 而不是被 Express 默认错误处理器吞掉。前端 catch 也能拿到 message。
router.get('/scm/sales-order-relations', (req: AuthRequest, res) => {
  const { page, page_size, keyword, status, start_date, end_date } = req.query as Record<string, string | undefined>
  try {
    const data = querySalesOrderRelations(getDb(), asid(req), {
      page: Number(page) || 1,
      pageSize: Number(page_size) || 20,
      keyword,
      status,
      startDate: start_date,
      endDate: end_date,
    })
    res.json({ code: 0, data })
  } catch (err: any) {
    console.error('[scm/sales-order-relations] 查询失败:', err)
    res.status(500).json({ code: 500, message: err?.message || '销售订单关联数据查询失败' })
  }
})

// ── Doc CRUD ────────────────────────────────────────────
router.get('/scm/docs/next-no', (req: AuthRequest, res) => {
  res.json({ code: 0, data: { next_no: nextDocNo(getDb(), asid(req), (req.query.doc_type as string) || 'PI', req.query.doc_date as string) } })
})

// 列表富行查询（列表 + 上下游追溯共用）：带往来单位/仓库名、下推进度、各类关联计数。
// whereSql 用 d.* 别名；tail 可附 ORDER BY / LIMIT / OFFSET（其参数追加在 params 之后）。
//
// 性能说明：原实现把 16+ 个标量子查询挂到每行 d.* 上，导致一页 N 条主单据会触发 N×16 次关联
// 子查询（且其中 pushed_lines/fully_pushed_lines 还有嵌套聚合）。这里改为「先按过滤+排序+分页
// 拿到主行集合，再以 IN (...) 批量聚合后 JS 合并」，复杂度从 O(行数×子查询数) 降到固定几次
// 批量查询。返回字段与原实现 1:1 对齐。
function queryDocRows(db: ReturnType<typeof getDb>, whereSql: string, params: any[], tail = ''): any[] {
  // 1) 主行：仅带 partner_name / warehouse_name，去除所有标量子查询
  const rows = db.prepare(`
    SELECT d.*, p.name AS partner_name, w.name AS warehouse_name
    FROM scm_doc d
    LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
    LEFT JOIN scm_warehouse w ON w.account_set_id=d.account_set_id AND w.code=d.warehouse_code
    WHERE ${whereSql} ${tail}
  `).all(...params) as any[]
  if (rows.length === 0) return rows

  const ids = rows.map(r => r.id)
  const inPH = ids.map(() => '?').join(',')
  const accountSetId = rows[0].account_set_id

  // 2) scm_doc_line 维度：一次性把所有相关明细行拉到 JS 端做按 doc_id 聚合
  //    同时把 source_line_id 反查的下游数量（scm_doc_line + scm_production_plan_product）按 source_line_id 批量聚合后回填。
  //    注：原 SQL 中 pushed_qty 是「下游引用本主单所有明细行的数量之和」；pushed_lines 是「下游引用数量>0 的明细行数」；
  //    fully_pushed_lines 是「下游引用数量 >= qty 的明细行数」。这里一次性算清。
  const lineRows = db.prepare(`
    SELECT id, doc_id, qty, arap_source_log_id FROM scm_doc_line WHERE doc_id IN (${inPH})
  `).all(...ids) as any[]

  // 2a) 下游引用数量：scm_doc_line.source_line_id 反查 + 生产计划产品 source_line_id 反查
  //     注意：MRP 计算单/缺料单/生产计划也会写 source_line_id，但那是「计划占用」而非实物下推，
  //     混在一起会把刚生成 MRP 的订单误判成 full，导致它从「选择源单」里消失。故这里拆成两个口径：
  //     pushedByLine = 仅实物下游单据（按源单类型限定）；planOccupiedByLine = MRP/生产计划占用。
  const lineIds = lineRows.map(r => r.id)
  const pushedByLine = new Map<string, number>()
  const planOccupiedByLine = new Map<string, number>()
  if (lineIds.length) {
    const lph = lineIds.map(() => '?').join(',')
    const childTypes = [...new Set(rows.map(r => PHYSICAL_CHILD_DOC_TYPES[r.doc_type]).filter(Boolean))] as string[]
    if (childTypes.length) {
      const tph = childTypes.map(() => '?').join(',')
      const downstreamPushed = db.prepare(`
        SELECT l.source_line_id AS lid, COALESCE(SUM(l.qty), 0) AS qty
        FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
        WHERE l.source_line_id IN (${lph}) AND d.doc_type IN (${tph}) AND d.status<>'voided'
        GROUP BY l.source_line_id
      `).all(...lineIds, ...childTypes) as any[]
      for (const r of downstreamPushed) pushedByLine.set(r.lid, (pushedByLine.get(r.lid) || 0) + Number(r.qty || 0))
    }
    const planPushed = db.prepare(`
      SELECT source_line_id AS lid, COALESCE(SUM(plan_qty), 0) AS qty
      FROM scm_production_plan_product WHERE source_line_id IN (${lph}) GROUP BY source_line_id
    `).all(...lineIds) as any[]
    for (const r of planPushed) planOccupiedByLine.set(r.lid, (planOccupiedByLine.get(r.lid) || 0) + Number(r.qty || 0))
  }

  // 2b) 按 doc_id 聚合
  const linesByDoc = new Map<string, any[]>()
  for (const l of lineRows) {
    const arr = linesByDoc.get(l.doc_id) || []
    arr.push(l)
    linesByDoc.set(l.doc_id, arr)
  }

  // 3) 缺料单 + 下游单据计数：scm_doc 按 source_doc_id 聚合
  //    一次查询同时拿到 downstream_doc_count（全部下游）和 shortage_doc_count/id（doc_type='MR' 的下游）
  const downstreamAgg = db.prepare(`
    SELECT source_doc_id AS sid,
           COUNT(*) AS downstream_doc_count,
           SUM(CASE WHEN doc_type='MR' THEN 1 ELSE 0 END) AS shortage_doc_count,
           MIN(CASE WHEN doc_type='MR' THEN doc_no END) AS shortage_min_no
    FROM scm_doc
    WHERE account_set_id=? AND source_doc_id IN (${inPH})
    GROUP BY source_doc_id
  `).all(accountSetId, ...ids) as any[]
  const downstreamByDoc = new Map<string, any>(downstreamAgg.map(r => [r.sid, r]))
  // shortage_doc_id 需要单独取（最小 doc_no 对应的 id）
  const shortageIds = db.prepare(`
    SELECT m.source_doc_id AS sid, m.id AS mid, m.doc_no AS mno
    FROM scm_doc m
    WHERE m.account_set_id=? AND m.doc_type='MR' AND m.source_doc_id IN (${inPH})
      AND m.doc_no IN (
        SELECT MIN(m2.doc_no) FROM scm_doc m2
        WHERE m2.account_set_id=? AND m2.doc_type='MR' AND m2.source_doc_id=m.source_doc_id
      )
  `).all(accountSetId, ...ids, accountSetId) as any[]
  const shortageIdByDoc = new Map<string, string>()
  for (const r of shortageIds) if (!shortageIdByDoc.has(r.sid)) shortageIdByDoc.set(r.sid, r.mid)

  // 4) 生产计划下游计数
  const planAgg = db.prepare(`
    SELECT source_doc_id AS sid, COUNT(*) AS downstream_plan_count
    FROM scm_production_plan
    WHERE account_set_id=? AND source_doc_id IN (${inPH})
    GROUP BY source_doc_id
  `).all(accountSetId, ...ids) as any[]
  const planByDoc = new Map<string, number>(planAgg.map(r => [r.sid, Number(r.downstream_plan_count) || 0]))

  // 5) 上游单据计数：本主单的明细行引用了其它主单的明细行 → 统计不同的上游 pl.doc_id
  //    下游明细行计数：被其它主单的明细行引用的本主单明细行 → 统计不同的下游 cl.doc_id
  const upstreamAgg = db.prepare(`
    SELECT l.doc_id AS did, COUNT(DISTINCT pl.doc_id) AS upstream_doc_count
    FROM scm_doc_line l
    JOIN scm_doc_line pl ON pl.id = l.source_line_id
    WHERE l.doc_id IN (${inPH})
    GROUP BY l.doc_id
  `).all(...ids) as any[]
  const upstreamByDoc = new Map<string, number>(upstreamAgg.map(r => [r.did, Number(r.upstream_doc_count) || 0]))

  const downstreamLineAgg = db.prepare(`
    SELECT source_line.doc_id AS did, COUNT(DISTINCT cl.doc_id) AS downstream_line_count
    FROM scm_doc_line cl
    JOIN scm_doc_line source_line ON source_line.id = cl.source_line_id
    WHERE source_line.doc_id IN (${inPH})
    GROUP BY source_line.doc_id
  `).all(...ids) as any[]
  const downstreamLineByDoc = new Map<string, number>(downstreamLineAgg.map(r => [r.did, Number(r.downstream_line_count) || 0]))

  // 6) MRP 关联：source_kind IN ('sales_order','assembly') 且 mrp_doc.status IN ('draft','audited')
  //    一次 JOIN 同时取 count / 第一条 doc_id / status / doc_no
  const mrpAgg = db.prepare(`
    SELECT s.source_id AS sid,
           COUNT(DISTINCT md.id) AS mrp_source_count,
           MIN(md.id) AS mrp_doc_id_min
    FROM scm_mrp_source s
    JOIN scm_doc md ON md.id = s.mrp_doc_id
    WHERE s.account_set_id=? AND s.source_id IN (${inPH})
      AND s.source_kind IN ('sales_order','assembly')
      AND md.status IN ('draft','audited')
    GROUP BY s.source_id
  `).all(accountSetId, ...ids) as any[]
  const mrpDocIds = mrpAgg.map(r => r.mrp_doc_id_min).filter(Boolean)
  const mrpDocInfo = mrpDocIds.length
    ? new Map<string, any>((db.prepare(`SELECT id, status, doc_no FROM scm_doc WHERE id IN (${mrpDocIds.map(() => '?').join(',')})`).all(...mrpDocIds) as any[]).map(r => [r.id, r]))
    : new Map<string, any>()
  const mrpByDoc = new Map<string, any>(mrpAgg.map(r => [r.sid, r]))

  // 7) 合并到主行
  for (const doc of rows) {
    const lines = linesByDoc.get(doc.id) || []
    const totalLines = lines.length
    let pushedLines = 0, fullyPushedLines = 0, pushedQty = 0, planOccupiedQty = 0
    for (const l of lines) {
      const qty = Number(l.qty || 0)
      // 下游实物单据对本明细行的引用数量（不含 MRP/生产计划的计划占用）
      const linePushed = pushedByLine.get(l.id) || 0
      pushedQty += linePushed
      planOccupiedQty += planOccupiedByLine.get(l.id) || 0
      if (linePushed > 0) pushedLines++
      if (qty > 0 && linePushed >= qty) fullyPushedLines++
    }
    doc.total_lines = totalLines
    doc.pushed_lines = pushedLines
    doc.fully_pushed_lines = fullyPushedLines
    doc.pushed_qty = pushedQty
    doc.plan_occupied_qty = planOccupiedQty

    const down = downstreamByDoc.get(doc.id)
    doc.downstream_doc_count = Number(down?.downstream_doc_count) || 0
    doc.shortage_doc_count = Number(down?.shortage_doc_count) || 0
    doc.shortage_doc_id = shortageIdByDoc.get(doc.id) || null

    doc.downstream_plan_count = planByDoc.get(doc.id) || 0
    doc.upstream_doc_count = upstreamByDoc.get(doc.id) || 0
    doc.downstream_line_count = downstreamLineByDoc.get(doc.id) || 0

    const mrp = mrpByDoc.get(doc.id)
    if (mrp) {
      doc.mrp_source_count = Number(mrp.mrp_source_count) || 0
      const info = mrpDocInfo.get(mrp.mrp_doc_id_min)
      doc.mrp_doc_id = info?.id || null
      doc.mrp_status = info?.status || null
      doc.mrp_doc_no = info?.doc_no || null
    } else {
      doc.mrp_source_count = 0
      doc.mrp_doc_id = null
      doc.mrp_status = null
      doc.mrp_doc_no = null
    }

    // 预收/预付单标记：明细行存在且全部 arap_source_log_id 为空
    doc.is_advance = totalLines > 0 && lines.every(l => !l.arap_source_log_id) ? 1 : 0

    // 推导下推进度（与原实现一致）
    let progress = 'none'
    if (totalLines > 0) {
      if (fullyPushedLines === totalLines) progress = 'full'
      else if (pushedLines > 0) progress = 'part'
    }
    doc.push_progress = progress
  }
  return rows
}

function pushProgressOf(row: any): 'none' | 'part' | 'full' {
  const total = Number(row.total_lines) || 0
  const full = Number(row.fully_pushed_lines) || 0
  const pushed = Number(row.pushed_lines) || 0
  if (total > 0 && full === total) return 'full'
  return pushed > 0 ? 'part' : 'none'
}

router.get('/scm/docs', (req: AuthRequest, res) => {
  const db = getDb(); const { doc_type, partner_code, warehouse_code, status, start_date, end_date, payment_mode, keyword, biz_person, page = '1', page_size = '50' } = req.query as any
  const conds = ['d.account_set_id=?']; const ps: any[] = [asid(req)]
  if (doc_type) { conds.push('d.doc_type=?'); ps.push(doc_type) }
  if (partner_code) { conds.push('d.partner_code=?'); ps.push(partner_code) }
  if (warehouse_code) { conds.push('d.warehouse_code=?'); ps.push(warehouse_code) }
  if (status) { conds.push('d.status=?'); ps.push(status) }
  if (start_date) { conds.push('d.doc_date>=?'); ps.push(start_date) }
  if (end_date) { conds.push('d.doc_date<=?'); ps.push(end_date) }
  if (biz_person) { conds.push('d.biz_person=?'); ps.push(biz_person) }
  // 单据号/备注模糊搜索
  if (keyword) { const k = `%${String(keyword).trim()}%`; conds.push('(d.doc_no LIKE ? OR d.remark LIKE ?)'); ps.push(k, k) }
  // 预收/预付单：明细行存在且全部未关联应收/应付源单（arap_source_log_id 均为空）
  // 用 EXISTS（命中即返回）替代 COUNT(*)>0，避免对每行明细做全表计数
  if (payment_mode === 'advance') {
    conds.push(`EXISTS (SELECT 1 FROM scm_doc_line l WHERE l.doc_id = d.id)`)
    conds.push(`NOT EXISTS (SELECT 1 FROM scm_doc_line l WHERE l.doc_id = d.id AND l.arap_source_log_id IS NOT NULL)`)
  }
  const where = conds.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) c FROM scm_doc d WHERE ${where}`).get(...ps) as any).c
  const off = (parseInt(page) - 1) * parseInt(page_size)
  const list = queryDocRows(db, where, [...ps, parseInt(page_size), off], 'ORDER BY d.doc_date DESC, d.doc_no DESC LIMIT ? OFFSET ?')

  res.json({ code: 0, data: { list, total, page: parseInt(page), page_size: parseInt(page_size) } })
})

// 单据翻页（首/上一/下一/尾）：按与列表相同的过滤与排序，返回有序 id 数组（轻量，不分页）。
// 注意：须在 '/scm/docs/:id' 之前注册，否则被动态路由当成 id='ids'。
router.get('/scm/docs/ids', (req: AuthRequest, res) => {
  const db = getDb(); const { doc_type, partner_code, warehouse_code, status, start_date, end_date, payment_mode, keyword, biz_person } = req.query as any
  const conds = ['account_set_id=?']; const ps: any[] = [asid(req)]
  if (doc_type) { conds.push('doc_type=?'); ps.push(doc_type) }
  if (partner_code) { conds.push('partner_code=?'); ps.push(partner_code) }
  if (warehouse_code) { conds.push('warehouse_code=?'); ps.push(warehouse_code) }
  if (status) { conds.push('status=?'); ps.push(status) }
  if (start_date) { conds.push('doc_date>=?'); ps.push(start_date) }
  if (end_date) { conds.push('doc_date<=?'); ps.push(end_date) }
  if (biz_person) { conds.push('biz_person=?'); ps.push(biz_person) }
  if (keyword) { const k = `%${String(keyword).trim()}%`; conds.push('(doc_no LIKE ? OR remark LIKE ?)'); ps.push(k, k) }
  // 预收/预付单：与列表接口保持一致的过滤（EXISTS 形式，命中即返回，更快）
  if (payment_mode === 'advance') {
    conds.push(`EXISTS (SELECT 1 FROM scm_doc_line l WHERE l.doc_id = scm_doc.id)`)
    conds.push(`NOT EXISTS (SELECT 1 FROM scm_doc_line l WHERE l.doc_id = scm_doc.id AND l.arap_source_log_id IS NOT NULL)`)
  }
  const rows = db.prepare(`SELECT id FROM scm_doc WHERE ${conds.join(' AND ')} ORDER BY doc_date DESC, doc_no DESC`).all(...ps) as any[]
  res.json({ code: 0, data: rows.map(r => r.id) })
})

// 列表筛选用：按单据实际发生过的往来单位（DISTINCT partner_code + 关联 partner 名称）。
// 传 doc_type 时只返回该类型下出现过的，不传则返回账套下全部有过业务的单位。
router.get('/scm/docs/partner-options', (req: AuthRequest, res) => {
  const db = getDb(); const { doc_type } = req.query as any
  const conds = ['d.account_set_id=?', 'd.partner_code IS NOT NULL', "d.partner_code != ''"]; const ps: any[] = [asid(req)]
  if (doc_type) { conds.push('d.doc_type=?'); ps.push(doc_type) }
  const rows = db.prepare(`
    SELECT DISTINCT d.partner_code, p.name AS partner_name
    FROM scm_doc d
    LEFT JOIN scm_partner p ON p.account_set_id = d.account_set_id AND p.code = d.partner_code
    WHERE ${conds.join(' AND ')}
    ORDER BY partner_name
  `).all(...ps) as any[]
  res.json({ code: 0, data: rows })
})

// 列表筛选用：按单据实际发生过的业务员（DISTINCT biz_person）。
router.get('/scm/docs/biz-person-options', (req: AuthRequest, res) => {
  const db = getDb(); const { doc_type } = req.query as any
  const conds = ['account_set_id=?', 'biz_person IS NOT NULL', "biz_person != ''"]; const ps: any[] = [asid(req)]
  if (doc_type) { conds.push('doc_type=?'); ps.push(doc_type) }
  const rows = db.prepare(`
    SELECT DISTINCT biz_person FROM scm_doc WHERE ${conds.join(' AND ')} ORDER BY biz_person
  `).all(...ps) as any[]
  res.json({ code: 0, data: rows })
})

router.get('/scm/docs/:id', (req: AuthRequest, res) => {
  const db = getDb()
  const doc = db.prepare(`
    SELECT d.*, p.name AS partner_name, w.name AS warehouse_name, dw.name AS dest_warehouse_name
    FROM scm_doc d
    LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
    LEFT JOIN scm_warehouse w ON w.account_set_id=d.account_set_id AND w.code=d.warehouse_code
    LEFT JOIN scm_warehouse dw ON dw.account_set_id=d.account_set_id AND dw.code=d.dest_warehouse_code
    WHERE d.id=? AND d.account_set_id=?`).get(req.params.id, asid(req)) as any
  if (!doc) return res.status(404).json({ code: 404, message: '单据不存在' })
  
  // 每一行加上 pushed_qty
  const lines = db.prepare(`
    SELECT l.*, i.name AS item_name, i.spec, i.unit,
           i.supplier_code AS item_supplier, i.source_type AS item_source_type,
           i.serial_flag AS item_serial_flag,
           al.doc_type AS arap_source_doc_type, al.doc_no AS arap_source_doc_no,
           al.doc_date AS arap_source_doc_date, al.amount AS arap_source_amount,
           COALESCE(al.verified_amount,0) AS arap_source_settled_amount,
           ROUND(al.amount-COALESCE(al.verified_amount,0),2) AS arap_source_open_amount,
           sd.id AS arap_source_doc_id,
           ((SELECT COALESCE(SUM(l2.qty), 0) FROM scm_doc_line l2 WHERE l2.source_line_id = l.id)
            + (SELECT COALESCE(SUM(pp.plan_qty), 0) FROM scm_production_plan_product pp WHERE pp.source_line_id = l.id)) AS pushed_qty
    FROM scm_doc_line l
    LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    LEFT JOIN scm_ar_ap_log al ON al.account_set_id=l.account_set_id AND al.id=l.arap_source_log_id
    LEFT JOIN scm_doc sd ON sd.account_set_id=al.account_set_id AND sd.doc_type=al.doc_type AND sd.doc_no=al.doc_no
    WHERE l.doc_id=? ORDER BY l.seq
  `).all(req.params.id) as any[]
  if (doc.doc_type === 'PO' || doc.doc_type === 'SOa') {
    const childType = doc.doc_type === 'PO' ? 'PI' : 'SO'
    for (const line of lines) line.pushed_qty = computeSourceLineUsedQty(db, asid(req), childType, line.id)
  }
  if (doc.doc_type === 'SO') {
    const orderNos = getSalesDispatchOrderNosByLine(db, asid(req), lines)
    for (const line of lines) line.sales_order_no = orderNos.get(line.id) || ''
  }
  if (doc.doc_type === 'PI') {
    const orderNos = getPurchaseReceiptOrderNosByLine(db, asid(req), lines)
    for (const line of lines) line.purchase_order_no = orderNos.get(line.id) || ''
  }

  // 上游来源（行级，去重）：本单各行 source_line_id → 父行所属单据，支持多对一合并
  const source_docs = db.prepare(`
    SELECT DISTINCT d.id, d.doc_no, d.doc_type, d.status
    FROM scm_doc_line l
    JOIN scm_doc_line pl ON pl.id = l.source_line_id
    JOIN scm_doc d ON d.id = pl.doc_id
    WHERE l.doc_id=? AND l.source_line_id IS NOT NULL
    ORDER BY d.doc_no
  `).all(req.params.id) as any[]
  // 兼容旧字段：单一上游（仍取单据头 source_doc_id；否则取行级第一个）
  let source_doc: any = null
  if (doc.source_doc_id) {
    source_doc = db.prepare('SELECT id, doc_no, doc_type, status FROM scm_doc WHERE id=?').get(doc.source_doc_id)
  } else if (source_docs.length) {
    source_doc = source_docs[0]
  }

  // 下游关联（行级，去重）：引用了本单任一行的下游单据，支持一对多
  const target_docs = db.prepare(`
    SELECT DISTINCT d.id, d.doc_no, d.doc_type, d.status
    FROM scm_doc_line l
    JOIN scm_doc d ON d.id = l.doc_id
    WHERE l.source_line_id IN (SELECT id FROM scm_doc_line WHERE doc_id=?)
    ORDER BY d.doc_no
  `).all(req.params.id) as any[]
  // MRP 通过独立来源表引用销售订单/组装单，仍作为下游展示并锁定来源草稿。
  const mrpTargets = db.prepare(`SELECT DISTINCT d.id,d.doc_no,d.doc_type,d.status
    FROM scm_mrp_source s JOIN scm_doc d ON d.id=s.mrp_doc_id
    WHERE s.account_set_id=? AND s.source_id=? AND s.source_kind IN ('sales_order','assembly') AND d.status IN ('draft','audited')
    ORDER BY d.doc_no`).all(asid(req), req.params.id) as any[]
  for (const row of mrpTargets) if (!target_docs.some(target => target.id === row.id)) target_docs.push(row)

  // 表头/表尾自定义字段：JSON 字符串 → 对象（前端录入/打印按对象读取）
  let headerFieldValues: Record<string, any> = {}
  try { headerFieldValues = doc.field_values ? JSON.parse(doc.field_values) : {} } catch { headerFieldValues = {} }

  res.json({
    code: 0,
    data: {
      ...doc,
      field_values: headerFieldValues,
      lines,
      source_doc,
      source_docs,
      target_docs
    }
  })
})

// 完工入库(PF)/委外入库(WI) 成本明细：按成品拆「料/人工/制费/加工费」，料成本再逐物料展开。
// 料成本反推 = unit_cost×qty − labor_cost − overhead_cost − process_fee×qty（与审核写入口径一致）；
// 逐物料 = BOM 每件用量×(1+损耗) × 该料净领单价，按行吸收系数 f 还原到实际结转（末料吸收舍入残差）。
router.get('/scm/docs/:id/cost-detail', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare(`SELECT d.*, w.name AS warehouse_name, p.name AS partner_name, pp.code AS plan_code
    FROM scm_doc d
    LEFT JOIN scm_warehouse w ON w.account_set_id=d.account_set_id AND w.code=d.warehouse_code
    LEFT JOIN scm_partner p ON p.account_set_id=d.account_set_id AND p.code=d.partner_code
    LEFT JOIN scm_production_plan pp ON pp.id=d.plan_id
    WHERE d.id=? AND d.account_set_id=?`).get(req.params.id, aid) as any
  if (!doc) return res.status(404).json({ code: 404, message: '单据不存在' })
  if (!['PF', 'WI'].includes(doc.doc_type) || doc.status !== 'audited' || !doc.plan_id) {
    return res.json({ code: 0, data: { applicable: false } })
  }
  const issueUnitCost = getMaterialIssueUnitCost(db, aid, doc.plan_id)
  const rows = db.prepare(`SELECT l.*, i.name AS item_name, i.spec AS spec
    FROM scm_doc_line l LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    WHERE l.doc_id=? ORDER BY l.seq`).all(req.params.id) as any[]
  const findProd = db.prepare('SELECT id FROM scm_production_plan_product WHERE plan_id=? AND account_set_id=? AND item_code=? ORDER BY seq LIMIT 1')
  const getBomLines = db.prepare(`SELECT l.item_code, l.qty, l.scrap_rate, i.name AS item_name, i.spec AS spec
    FROM scm_production_plan_line l LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    WHERE l.product_id=? ORDER BY l.seq`)
  const summary = { material_cost: 0, labor: 0, overhead: 0, fee_total: 0, total_cost: 0 }
  const lines = rows.map(l => {
    const q = Number(l.qty) || 0
    const feeUnit = Number(l.process_fee) || 0
    const totalCost = round2((Number(l.unit_cost) || 0) * q)
    const feeTotal = round2(feeUnit * q)
    const labor = round2(Number(l.labor_cost) || 0)
    const overhead = round2(Number(l.overhead_cost) || 0)
    const materialCost = round2(totalCost - labor - overhead - feeTotal)
    // 逐物料料成本（BOM 上卷 × 吸收系数 f 还原到实际结转）
    const prod = findProd.get(doc.plan_id, aid, l.item_code) as any
    const bom = prod ? (getBomLines.all(prod.id) as any[]) : []
    const mats = bom.map(b => {
      const per = r6((Number(b.qty) || 0) * (1 + (Number(b.scrap_rate) || 0) / 100))
      const price = issueUnitCost.get(b.item_code) || 0
      return { item_code: b.item_code, item_name: b.item_name || '', spec: b.spec || '',
        per_unit: per, scrap_rate: Number(b.scrap_rate) || 0, issue_unit_price: r6(price),
        unit_subtotal: round2(per * price), _raw: per * price }
    })
    const rawTotal = mats.reduce((s, m) => s + m._raw * q, 0)
    const f = rawTotal > 0 ? materialCost / rawTotal : 0
    let allocated = 0
    const materials = mats.map((m, idx) => {
      const isLast = idx === mats.length - 1
      const actual = isLast ? round2(materialCost - allocated) : round2(m._raw * q * f)
      allocated = round2(allocated + actual)
      return { item_code: m.item_code, item_name: m.item_name, spec: m.spec,
        per_unit: m.per_unit, scrap_rate: m.scrap_rate, issue_unit_price: m.issue_unit_price,
        unit_subtotal: m.unit_subtotal, actual_cost: actual }
    })
    summary.material_cost = round2(summary.material_cost + materialCost)
    summary.labor = round2(summary.labor + labor)
    summary.overhead = round2(summary.overhead + overhead)
    summary.fee_total = round2(summary.fee_total + feeTotal)
    summary.total_cost = round2(summary.total_cost + totalCost)
    return { seq: l.seq, item_code: l.item_code, item_name: l.item_name || '', spec: l.spec || '',
      qty: q, unit_cost: round2(Number(l.unit_cost) || 0), total_cost: totalCost,
      material_cost: materialCost, mat_unit_cost: q > 0 ? round2(materialCost / q) : 0,
      labor, overhead, fee_total: feeTotal, fee_unit: feeUnit, absorb_factor: r6(f),
      materials }
  })
  res.json({ code: 0, data: { applicable: true,
    doc: { id: doc.id, doc_no: doc.doc_no, doc_type: doc.doc_type, doc_date: doc.doc_date, status: doc.status,
      plan_id: doc.plan_id, plan_code: doc.plan_code || '', warehouse_name: doc.warehouse_name || '', partner_name: doc.partner_name || '' },
    summary, lines } })
})


router.post('/scm/docs', operationLog('供应链单据新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!b.doc_type) return res.status(400).json({ code: 400, message: '单据类型不能为空' })
  const paymentErr = validatePaymentData(db, asid(req), b, b.lines, req.accountScope)
  if (paymentErr) return res.status(paymentErr.status).json({ code: paymentErr.status, message: paymentErr.message })
  b.lines = normalizePaymentLines(b.doc_type, b.lines)

  const sourceError = validateSourceLineQuantities(db, asid(req), b.doc_type, b.lines || [])
  if (sourceError) return res.status(400).json({ code: 400, message: sourceError })
  const planCheck = validatePlanLink(db, asid(req), b.doc_type, b.plan_id)
  if (planCheck.message) return res.status(400).json({ code: 400, message: planCheck.message })
  if (b.plan_id) {
    const qtyError = validatePlanIssueQuantities(db, asid(req), b.plan_id, b.doc_type, b.lines || [])
      || validatePlanFinishQuantities(db, asid(req), b.plan_id, b.doc_type, b.lines || [])
    if (qtyError) return res.status(400).json({ code: 400, message: qtyError })
  }

  const docId = uuidv4()
  // 取号与插入必须在同一个排它事务内，否则并发保存会撞单号唯一约束
  const docNo = withDocNoRetry(db, () => {
    const docNo = nextDocNo(db, asid(req), b.doc_type, b.doc_date)
    db.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,partner_code,dept_code,warehouse_code,operator,maker,status,source_doc_id,bom_id,total_qty,total_amount,remark,discount_rate,plan_id,${DOC_HEADER_EXTRA_COLUMNS.join(',')})
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${DOC_HEADER_EXTRA_COLUMNS.map(() => '?').join(',')})`).run(
      docId, asid(req), b.doc_type, docNo, b.doc_date || new Date().toISOString().slice(0, 10),
      b.partner_code ?? null, b.dept_code ?? null, b.warehouse_code ?? null,
      b.operator || userName(req), userName(req), 'draft', b.source_doc_id ?? null, b.bom_id ?? null,
      Number(b.total_qty) || 0, Number(b.total_amount) || 0, b.remark ?? null, Number(b.discount_rate) || 0, b.plan_id ?? null,
      ...docHeaderExtraValues(b)
    )
    if (Array.isArray(b.lines)) {
      fillMrLineDefaults(db, asid(req), b.doc_type, b.lines)
      const ins = prepareDocLineInsert(db)
      let seq = 0; let tq = 0
      const rows: Array<{ values: any[]; qty: number; amount: number }> = []
      for (const l of b.lines) {
        seq++
        const row = buildDocLineRow(asid(req), docId, seq, l, b.warehouse_code)
        rows.push(row)
        tq += row.qty
      }
      // 整单折扣（折）分摊到行后再入库，保证 Σ行金额 == 表头合计 == 凭证/往来取数
      const total = allocateHeaderDiscount(rows, Number(b.discount_rate) || 0)
      for (const row of rows) ins.run(...row.values)
      db.prepare('UPDATE scm_doc SET total_qty=?,total_amount=? WHERE id=?').run(tq, total, docId)
    }
    return docNo
  })
  res.json({ code: 0, data: { id: docId, doc_no: docNo } })
})

router.put('/scm/docs/:id', operationLog('供应链单据修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  const ex = db.prepare('SELECT id, status, plan_id, doc_type, source_doc_id FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, asid(req)) as any
  if (!ex) return res.status(404).json({ code: 404, message: '单据不存在' })
  if (ex.status !== 'draft') return res.status(400).json({ code: 400, message: '仅草稿状态可修改' })
  b.doc_type = b.doc_type || ex.doc_type
  const paymentErr = validatePaymentData(db, asid(req), b, b.lines, req.accountScope)
  if (paymentErr) return res.status(paymentErr.status).json({ code: paymentErr.status, message: paymentErr.message })
  b.lines = normalizePaymentLines(b.doc_type, b.lines)

  // 草稿下游单再次保存时会重建全部明细。兼容未回传 source_line_id 的旧前端：
  // 依据仍随请求返回的原明细 id 恢复来源行，避免采购订单等上游单据的已下推数量归零。
  if (Array.isArray(b.lines)) {
    const existingLines = db.prepare(
      'SELECT id, source_line_id FROM scm_doc_line WHERE doc_id=? AND account_set_id=?'
    ).all(req.params.id, asid(req)) as Array<{ id: string; source_line_id: string | null }>
    restoreMissingSourceLineIds(b.lines, existingLines)
  }

  // 检查是否已被下游引用
  const isReferenced = db.prepare(`
    SELECT (
      (SELECT COUNT(*) FROM scm_doc_line WHERE source_line_id IN (SELECT id FROM scm_doc_line WHERE doc_id = ?))
      + (SELECT COUNT(*) FROM scm_production_plan WHERE source_doc_id = ?)
      + (SELECT COUNT(*) FROM scm_mrp_source WHERE source_id = ?)
    ) c
  `).get(req.params.id, req.params.id, req.params.id) as any
  if (isReferenced && isReferenced.c > 0) {
    return res.status(400).json({ code: 400, message: '该单据已被下游单据/计划引用，不可修改' })
  }

  // 工单生成的领料/完工单在通用单据页编辑时，plan_id 不在可编辑表头中。
  // 前端旧版本或非完整调用方未回传 plan_id 时必须保留原关联，不能把工单勾稽覆盖成 NULL。
  const preservedPlanId = b.plan_id || ex.plan_id || null
  // 已落库的表头来源同样属于业务勾稽关系，编辑草稿时不允许被旧客户端清空或改写。
  const preservedSourceDocId = ex.source_doc_id || b.source_doc_id || null
  const sourceError = validateSourceLineQuantities(db, asid(req), b.doc_type, b.lines || [], req.params.id)
  if (sourceError) return res.status(400).json({ code: 400, message: sourceError })
  const planCheck = validatePlanLink(db, asid(req), b.doc_type, preservedPlanId)
  if (planCheck.message) return res.status(400).json({ code: 400, message: planCheck.message })
  if (preservedPlanId) {
    const qtyError = validatePlanIssueQuantities(db, asid(req), preservedPlanId, b.doc_type, b.lines || [], req.params.id)
      || validatePlanFinishQuantities(db, asid(req), preservedPlanId, b.doc_type, b.lines || [], req.params.id)
    if (qtyError) return res.status(400).json({ code: 400, message: qtyError })
  }
  db.transaction(() => {
    // 关键列用 COALESCE(?, 列) 语义：请求未带该字段时保留原值。
    // 原实现 `b.doc_date ?? null` 会把旧前端漏传的单据日期直接置 NULL，
    // 进而破坏列表排序、账龄与期间归属。
    db.prepare(`UPDATE scm_doc SET doc_date=COALESCE(?,doc_date),partner_code=COALESCE(?,partner_code),dept_code=?,warehouse_code=COALESCE(?,warehouse_code),operator=?,source_doc_id=?,bom_id=?,remark=?,discount_rate=?,plan_id=?,maker=COALESCE(maker,?),${DOC_HEADER_EXTRA_COLUMNS.map(c => `${c}=?`).join(',')},updated_at=datetime('now') WHERE id=?`).run(
      b.doc_date ?? null, b.partner_code ?? null, b.dept_code ?? null, b.warehouse_code ?? null, b.operator || userName(req),
      preservedSourceDocId, b.bom_id ?? null, b.remark ?? null, Number(b.discount_rate) || 0, preservedPlanId, userName(req),
      ...docHeaderExtraValues(b), req.params.id
    )
    if (Array.isArray(b.lines)) {
      fillMrLineDefaults(db, asid(req), b.doc_type, b.lines)
      db.prepare('DELETE FROM scm_doc_line WHERE doc_id=?').run(req.params.id)
      const ins = prepareDocLineInsert(db)
      let seq = 0; let tq = 0
      const rows: Array<{ values: any[]; qty: number; amount: number }> = []
      for (const l of b.lines) {
        seq++
        const row = buildDocLineRow(asid(req), req.params.id, seq, l, b.warehouse_code)
        rows.push(row)
        tq += row.qty
      }
      // 整单折扣（折）分摊到行后再入库，保证 Σ行金额 == 表头合计 == 凭证/往来取数
      const total = allocateHeaderDiscount(rows, Number(b.discount_rate) || 0)
      for (const row of rows) ins.run(...row.values)
      db.prepare('UPDATE scm_doc SET total_qty=?,total_amount=? WHERE id=?').run(tq, total, req.params.id)
    }
  })()
  res.json({ code: 0, data: { ok: true } })
})

const deleteDocHandler = (req: AuthRequest, res: Response) => {
  const db = getDb()
  const ex = db.prepare('SELECT id, status FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, asid(req)) as any
  if (!ex) return res.status(404).json({ code: 404, message: '单据不存在' })
  if (ex.status !== 'draft') return res.status(400).json({ code: 400, message: '仅草稿状态可删除' })

  // 检查是否已被下游引用
  const isReferenced = db.prepare(`
    SELECT (
      (SELECT COUNT(*) FROM scm_doc_line WHERE source_line_id IN (SELECT id FROM scm_doc_line WHERE doc_id = ?))
      + (SELECT COUNT(*) FROM scm_production_plan WHERE source_doc_id = ?)
      + (SELECT COUNT(*) FROM scm_mrp_source WHERE source_id = ?)
    ) c
  `).get(req.params.id, req.params.id, req.params.id) as any
  if (isReferenced && isReferenced.c > 0) {
    return res.status(400).json({ code: 400, message: '该单据已被下游单据/计划引用，不可删除' })
  }

  db.prepare('DELETE FROM scm_doc_line WHERE doc_id=?').run(req.params.id)
  db.prepare('DELETE FROM scm_doc WHERE id=?').run(req.params.id)
  res.json({ code: 0, data: { ok: true } })
}
router.delete('/scm/docs/:id', operationLog('供应链单据删除', '供应链'), deleteDocHandler)

/** 工单头 scrap_qty = 各成品行报废数之和（与 finished_qty 的同步方式一致） */
function syncPlanScrapQty(db: ReturnType<typeof getDb>, aid: string, planId: string) {
  const total = (db.prepare('SELECT COALESCE(SUM(scrap_qty),0) s FROM scm_production_plan_product WHERE plan_id=?').get(planId) as any)?.s || 0
  db.prepare('UPDATE scm_production_plan SET scrap_qty=? WHERE id=? AND account_set_id=?').run(round2(total), planId, aid)
}

/**
 * 出库前按 (物料, 仓库) 聚合校验库存。
 *
 * 逐行独立比对会让「同一物料同仓拆成多行」的单据每行都通过校验，直到写库存时才由
 * applyMovingAvgOut 抛错；那时报出的「当前库存」已经扣掉了前几行，是个中间值，
 * 与用户在库存页看到的数字对不上，排查时很容易误判成库存算错。
 *
 * @param label 出错文案，收到物料显示名、可用量、本单合计需求量
 * @returns 错误信息；库存充足时返回 null
 */
function checkAggregatedOutStock(
  db: ReturnType<typeof getDb>,
  aid: string,
  rows: Array<{ item_code: string; warehouse_code: string | null | undefined; qty: number }>,
  label: (itemName: string, onHand: number, need: number) => string,
): string | null {
  const needByStock = new Map<string, { item: string; warehouse: string; qty: number }>()
  for (const r of rows) {
    const qty = Number(r.qty) || 0
    if (qty <= 0) continue
    const warehouse = String(r.warehouse_code || '')
    const key = `${warehouse}|${r.item_code}`
    const cur = needByStock.get(key) || { item: r.item_code, warehouse, qty: 0 }
    cur.qty = r6(cur.qty + qty)
    needByStock.set(key, cur)
  }
  for (const need of needByStock.values()) {
    const s = db.prepare('SELECT qty FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?')
      .get(aid, need.warehouse, need.item) as any
    const onHand = Number(s?.qty) || 0
    if (onHand < need.qty) {
      const item = getItem(db, aid, need.item)
      return label(item?.name || need.item, onHand, need.qty)
    }
  }
  return null
}

// ── 审核/反审核（触发库存移动） ─────────────────────────
// 导出供单元测试直接调用（批量操作也复用此 handler）
export const auditDocHandler = (req: AuthRequest, res: Response) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!doc) return res.status(404).json({ code: 404, message: '单据不存在' })
  if (doc.status === 'audited') {
    return res.json({ code: 0, data: { id: doc.id, status: doc.status, total_amount: Number(doc.total_amount) || 0,
      auditor: doc.auditor || '', audited_at: doc.audited_at || null, already_audited: true } })
  }
  if (doc.status !== 'draft') return res.status(400).json({ code: 400, message: '仅草稿可审核' })

  // 组装单作为 MRP 来源时，必须先把 MRP 计算结果审核冻结，再允许执行组装扣料/入库。
  // 否则组装单先审核会使草稿 MRP 在审核重算时失去有效来源。
  if (doc.doc_type === 'AS') {
    const draftMrp = db.prepare(`SELECT md.doc_no FROM scm_mrp_source s JOIN scm_doc md ON md.id=s.mrp_doc_id
      WHERE s.account_set_id=? AND s.source_kind='assembly' AND s.source_id=?
        AND md.doc_type='MRP' AND md.status='draft' LIMIT 1`).get(aid, doc.id) as any
    if (draftMrp) return res.status(400).json({ code: 400, message: `该组装单已进入草稿 MRP ${draftMrp.doc_no}，请先审核或删除该 MRP 计算单` })
  }

  const docType = db.prepare('SELECT * FROM scm_doc_type WHERE account_set_id=? AND code=?').get(aid, doc.doc_type) as any
  if (!docType) return res.status(400).json({ code: 400, message: '未知单据类型' })

  // 计价方式守卫：当前仅「移动加权平均」已实现，其余方式禁止过账，避免按错误口径计算成本
  if (docType.affects_stock) {
    const costing = getCostingMethod(db, aid)
    if (costing !== 'moving_avg') {
      const labels: Record<string, string> = { month_avg: '全月平均', fifo: '先进先出', lifo: '后进先出', specified: '指定成本' }
      return res.status(400).json({ code: 400, message: `当前计价方式『${labels[costing] || costing}』尚未实现，请在 系统参数→供应链 改为『移动加权平均』后再审核` })
    }
  }

  const lines = db.prepare('SELECT * FROM scm_doc_line WHERE doc_id=? ORDER BY seq').all(doc.id) as any[]
  const originalWarehouseCode = doc.warehouse_code
  const defaultWarehouseInspection = docType.affects_stock && !['AS', 'TR'].includes(doc.doc_type)
    ? inspectAuditDefaultWarehouses(db, aid, doc, lines)
    : { candidates: [], missing: [] }
  if (defaultWarehouseInspection.missing.length) {
    const first = defaultWarehouseInspection.missing[0]
    return res.status(400).json({
      code: 400,
      message: `物料「${first.item_name}」未指定仓库，且物料档案未设置默认仓库，无法审核`,
      data: { error_code: 'ITEM_DEFAULT_WAREHOUSE_MISSING', missing: defaultWarehouseInspection.missing },
    })
  }
  if (defaultWarehouseInspection.candidates.length && !req.body?.apply_item_default_warehouses) {
    return res.status(409).json({
      code: 409,
      message: '审核前需确认：将按物料档案默认仓库补齐空仓库',
      data: {
        error_code: 'DEFAULT_WAREHOUSE_CONFIRMATION_REQUIRED',
        doc: { id: doc.id, doc_no: doc.doc_no },
        candidates: defaultWarehouseInspection.candidates,
      },
    })
  }
  if (defaultWarehouseInspection.candidates.length) {
    const candidateByLineId = new Map(defaultWarehouseInspection.candidates.map(candidate => [candidate.line_id, candidate.warehouse_code]))
    for (const line of lines) line.warehouse_code = line.warehouse_code || candidateByLineId.get(line.id) || null
    const warehouses = new Set(lines.filter(line => Number(line.qty) > 0).map(line => String(line.warehouse_code || '').trim()).filter(Boolean))
    if (!doc.warehouse_code && warehouses.size === 1) doc.warehouse_code = [...warehouses][0]
  }
  const paymentErr = validatePaymentData(db, aid, doc, lines, req.accountScope)
  if (paymentErr) return res.status(paymentErr.status).json({ code: paymentErr.status, message: paymentErr.message })
  const sourceError = validateSourceLineQuantities(db, aid, doc.doc_type, lines, doc.id)
  if (sourceError) return res.status(400).json({ code: 400, message: sourceError })
  const planCheck = validatePlanLink(db, aid, doc.doc_type, doc.plan_id)
  if (planCheck.message) return res.status(400).json({ code: 400, message: planCheck.message })
  if (doc.plan_id) {
    const qtyError = validatePlanIssueQuantities(db, aid, doc.plan_id, doc.doc_type, lines, doc.id)
      || validatePlanFinishQuantities(db, aid, doc.plan_id, doc.doc_type, lines, doc.id)
    if (qtyError) return res.status(400).json({ code: 400, message: qtyError })
    if (doc.doc_type === 'PF' || doc.doc_type === 'WI') {
      const kittingError = validateFinishKitting(db, aid, doc.plan_id, lines)
      if (kittingError) return res.status(400).json({ code: 400, message: kittingError })
      const qcError = validateFinishQc(db, aid, doc)
      if (qcError) return res.status(400).json({ code: 400, message: qcError })
    }
  }

  // 销售发货单（销售出库 SO）：审核要扣库存、挂应收，故客户与仓库必填
  let creditWarning: string | null = null
  let serialWarning: string | null = null
  let invoiceNotice: string | null = null
  if (doc.doc_type === 'SO') {
    if (!doc.partner_code) return res.status(400).json({ code: 400, message: '销售出库单必须指定客户（往来单位），无法生成应收' })
    if (lines.some(l => Number(l.qty) > 0 && !l.warehouse_code)) {
      return res.status(400).json({ code: 400, message: '销售出库单每行必须指定仓库，无法扣减库存' })
    }
    // 信用额度控制（参数开关）：已用 = 未核销应收 + 本单发货额；超额按 block 阻断 / warn 放行提示
    const scmParam = (key: string, fb = '') => ((db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?').get(aid, key) as any)?.param_value ?? fb)
    if (scmParam('scm:credit_control_enabled') === '1') {
      const partner = db.prepare('SELECT credit_limit, name FROM scm_partner WHERE account_set_id=? AND code=?').get(aid, doc.partner_code) as any
      const limit = Number(partner?.credit_limit) || 0
      if (limit > 0) {
        const usedAr = getPartnerOpenAr(db, aid, doc.partner_code)
        const thisAmt = Number(doc.total_amount) || 0
        const used = Math.round((usedAr + thisAmt) * 100) / 100
        if (used > limit + 0.005) {
          const msg = `客户「${partner?.name || doc.partner_code}」信用额度超限：额度 ${limit}，未核销应收 ${usedAr}，本单 ${thisAmt}，合计占用 ${used}`
          if (scmParam('scm:credit_control_mode', 'warn') === 'block') {
            return res.status(400).json({ code: 400, message: msg + '，已阻止审核' })
          }
          creditWarning = msg
        }
      }
    }
  }

  // 出入库单据：每行须有可解析仓库（行仓 || 表头仓），否则底层写库存会触发「仓库不能为空」约束。
  // AS(组装·成品/子件多仓) 与 TR(调拨·调入/调出双仓) 另有专门仓库校验，此处跳过。
  if (docType.affects_stock && !['AS', 'TR'].includes(doc.doc_type)) {
    for (const l of lines) {
      if (Number(l.qty) > 0 && !(l.warehouse_code || doc.warehouse_code)) {
        const item = getItem(db, aid, l.item_code)
        return res.status(400).json({ code: 400, message: `物料「${item?.name || l.item_code}」未指定仓库，无法审核，请在明细行或表头指定仓库` })
      }
    }
  }

  // stock check: outbound types need enough qty（按 物料+仓库 聚合，避免同料多行各自过关）
  if (docType.direction === 'out' && docType.affects_stock) {
    const err = checkAggregatedOutStock(db, aid,
      lines.map((l: any) => ({ item_code: l.item_code, warehouse_code: l.warehouse_code, qty: l.qty })),
      (name, onHand, need) => `${name} 库存不足（当前 ${onHand}，需 ${need}）`)
    if (err) return res.status(400).json({ code: 400, message: err })
  }

  // 组装单「成品行模式」：明细带 line_role='product' 为成品行（入库），其余为子件行（出库）。
  // 缺料下推生成的组装单走此模式（承载行级记账）；无成品行的旧组装单仍走下方「子件反推成品」逻辑。
  const asProductLines = lines.filter((l: any) => l.line_role === 'product')
  const isAsProductMode = doc.doc_type === 'AS' && asProductLines.length > 0
  if (isAsProductMode) {
    const compLines = lines.filter((l: any) => l.line_role !== 'product')
    if (!compLines.some((l: any) => Number(l.qty) > 0)) return res.status(400).json({ code: 400, message: '组装单缺少子件行（出库料）' })
    for (const p of asProductLines) {
      if (!(Number(p.qty) > 0)) return res.status(400).json({ code: 400, message: '组装单成品行数量必须大于 0' })
      if (!(p.warehouse_code || doc.warehouse_code)) return res.status(400).json({ code: 400, message: '组装单需指定成品入库仓库' })
    }
    for (const l of compLines) {
      if (!l.qty || l.qty <= 0) continue
      if (!(l.warehouse_code || doc.warehouse_code)) return res.status(400).json({ code: 400, message: '组装单子件需指定仓库' })
    }
    const compStockErr = checkAggregatedOutStock(db, aid,
      compLines.map((l: any) => ({ item_code: l.item_code, warehouse_code: l.warehouse_code || doc.warehouse_code, qty: l.qty })),
      (name, onHand, need) => `子件「${name}」库存不足（当前 ${onHand}，需 ${need}）`)
    if (compStockErr) return res.status(400).json({ code: 400, message: compStockErr })
    // 按成品分组模式（每条子件都带 product_group）：每个成品必须有本组子件
    const activeComps = compLines.filter((l: any) => Number(l.qty) > 0)
    const grouped = activeComps.length > 0
      && activeComps.every((l: any) => l.product_group !== null && l.product_group !== undefined)
      && asProductLines.every((p: any) => p.product_group !== null && p.product_group !== undefined)
    if (grouped) {
      for (const p of asProductLines) {
        if (!activeComps.some((l: any) => l.product_group === p.product_group)) {
          const item = getItem(db, aid, p.item_code)
          return res.status(400).json({ code: 400, message: `成品「${item?.name || p.item_code}」缺少对应子件行` })
        }
      }
    }
  }

  // 组装/拆卸单（旧「子件反推成品」模式）：根据 BOM 审核，子件↔成品双向库存移动
  if ((doc.doc_type === 'AS' && !isAsProductMode) || doc.doc_type === 'DS') {
    if (!doc.bom_id) return res.status(400).json({ code: 400, message: '组装/拆卸单必须指定BOM' })
    const bom = db.prepare('SELECT * FROM scm_bom WHERE id=? AND account_set_id=?').get(doc.bom_id, aid) as any
    if (!bom) return res.status(400).json({ code: 400, message: '指定的BOM不存在' })
    const bomLines = db.prepare('SELECT * FROM scm_bom_line WHERE bom_id=? ORDER BY seq').all(doc.bom_id) as any[]
    // 根据 BOM 用料比例推导成品数量
    let fpQty = 0
    for (const bl of bomLines) {
      const docLine = lines.find((l: any) => l.item_code === bl.item_code)
      if (docLine && Number(bl.qty) > 0) fpQty = Math.max(fpQty, Number(docLine.qty) / Number(bl.qty))
    }
    if (fpQty <= 0) return res.status(400).json({ code: 400, message: `无法从明细行推导成品数量，请确认BOM「${bom.code}」与行物料匹配` })
    if (doc.doc_type === 'AS') {
      // 组装：校验子件库存
      for (const l of lines) {
        if (!l.qty || l.qty <= 0) continue
        if (!(l.warehouse_code || doc.warehouse_code)) return res.status(400).json({ code: 400, message: '组装单需指定仓库' })
      }
      const bomCompStockErr = checkAggregatedOutStock(db, aid,
        lines.map((l: any) => ({ item_code: l.item_code, warehouse_code: l.warehouse_code || doc.warehouse_code, qty: l.qty })),
        (name, onHand, need) => `子件「${name}」库存不足（当前 ${onHand}，需 ${need}）`)
      if (bomCompStockErr) return res.status(400).json({ code: 400, message: bomCompStockErr })
      if (!doc.warehouse_code) return res.status(400).json({ code: 400, message: '组装单需指定成品入库仓库' })
    } else {
      // 拆卸：校验成品库存
      const fpWh = doc.warehouse_code
      if (!fpWh) return res.status(400).json({ code: 400, message: '拆卸单需指定成品出库仓库' })
      const fpStock = db.prepare('SELECT qty FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?').get(aid, fpWh, bom.item_code) as any
      if (!fpStock || fpStock.qty < fpQty) {
        return res.status(400).json({ code: 400, message: `成品「${bom.item_code}」库存不足（当前 ${fpStock?.qty || 0}，需 ${fpQty}）` })
      }
    }
  }

  // 调拨单（TR）：约定 单据仓库=调出仓、明细行仓库=调入仓；校验调入仓与源仓库存
  if (doc.doc_type === 'TR') {
    const srcWh = doc.warehouse_code
    if (!srcWh) return res.status(400).json({ code: 400, message: '调拨单需指定调出仓（单据仓库）' })
    for (const l of lines) {
      if (!l.qty || l.qty <= 0) continue
      if (!l.warehouse_code) return res.status(400).json({ code: 400, message: '调拨单每行需指定调入仓' })
      if (l.warehouse_code === srcWh) return res.status(400).json({ code: 400, message: '调入仓与调出仓不能相同' })
    }
    const trStockErr = checkAggregatedOutStock(db, aid,
      lines.map((l: any) => ({ item_code: l.item_code, warehouse_code: srcWh, qty: l.qty })),
      (name, onHand, need) => `${name} 调出仓库存不足（当前 ${onHand}，需 ${need}）`)
    if (trStockErr) return res.status(400).json({ code: 400, message: trStockErr })
  }

  // 完工入库(PF)/委外入库(WI) 关联工单：审核前校验已归集领料/发料成本（无成本不允许入库）
  if ((doc.doc_type === 'PF' || doc.doc_type === 'WI') && doc.plan_id) {
    const plan = db.prepare('SELECT plan_qty FROM scm_production_plan WHERE id=? AND account_set_id=?').get(doc.plan_id, aid) as any
    if (!plan) return res.status(400).json({ code: 400, message: '关联工单不存在' })
    const sum = getPlanCostSummary(db, aid, doc.plan_id, Number(plan.plan_qty) || 0)
    if (sum.issuedCost <= 0) return res.status(400).json({ code: 400, message: doc.doc_type === 'WI' ? '工单尚未委外发货归集成本，无法委外入库，请先审核委外发货单' : '工单尚未领料归集成本，无法完工入库，请先审核领料单' })
  }

  // 收付款单：生成往来台账 + 出纳日记账。
  // 往来款由「货物流转」驱动：销售发货(SO)→应收、采购入库(PI)→应付；发票(RP/RS)不参与往来。
  const isPayment = doc.doc_type === 'PAY' || doc.doc_type === 'RCV'

  const runAudit = db.transaction(() => {
    if (defaultWarehouseInspection.candidates.length) {
      // 审核前的内存表头用于校验；落库仍须按原始空表头执行补齐。
      doc.warehouse_code = originalWarehouseCode
      applyAuditDefaultWarehouses(db, aid, doc, lines, defaultWarehouseInspection.candidates)
      const warehouses = new Set(lines.filter(line => Number(line.qty) > 0).map(line => String(line.warehouse_code || '').trim()).filter(Boolean))
      if (warehouses.size === 1) doc.warehouse_code = [...warehouses][0]
    }
    if (isPayment) {
      applyPayment(db, aid, doc, lines, userName(req))
    } else if (doc.doc_type === 'TR') {
      // 调拨：源仓出库取移动均价，按该成本入调入仓
      const srcWh = doc.warehouse_code
      for (const l of lines) {
        if (!l.qty || l.qty <= 0) continue
        const docRef = { type: doc.doc_type, no: doc.doc_no, seq: l.seq, date: doc.doc_date }
        const { unitCost } = applyMovingAvgOut(db, aid, srcWh, l.item_code, l.qty, docRef)
        applyMovingAvgIn(db, aid, l.warehouse_code, l.item_code, l.qty, unitCost, docRef)
        db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE id=?').run(unitCost, l.id)
      }
    } else if (doc.doc_type === 'CK') {
      // 盘点：明细行 qty=实盘数，与账面比较，盘盈按账面均价入、盘亏出
      for (const l of lines) {
        const wh = l.warehouse_code || doc.warehouse_code
        const s = db.prepare('SELECT qty, avg_cost FROM scm_stock WHERE account_set_id=? AND warehouse_code=? AND item_code=?').get(aid, wh, l.item_code) as any
        const bookQty = s?.qty || 0
        const cost = s?.avg_cost || l.unit_cost || l.price || 0
        const diff = Math.round((Number(l.qty) - bookQty) * 10000) / 10000
        const docRef = { type: doc.doc_type, no: doc.doc_no, seq: l.seq, date: doc.doc_date }
        if (diff > 0) applyMovingAvgIn(db, aid, wh, l.item_code, diff, cost, docRef)
        else if (diff < 0) applyMovingAvgOut(db, aid, wh, l.item_code, -diff, docRef)
        db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE id=?').run(cost, l.id)
      }
    } else if (doc.doc_type === 'AS' && isAsProductMode) {
      // 组装（成品行模式）：子件出库累计成本 → 成品入库。
      // 多成品「按成品分组」：每条子件带 product_group（=所属成品组号），成品单价按本组子件成本归集；
      // 旧单（子件无分组）→ 退回「全池成本 / 成品总数」摊法。
      // 1) 所有子件出库，记录出库单价
      const compCosts: Array<{ product_group: any; qty: number; unitCost: number }> = []
      for (const l of lines) {
        if (l.line_role === 'product' || !l.qty || l.qty <= 0) continue
        const wh = l.warehouse_code || doc.warehouse_code
        const { unitCost } = applyMovingAvgOut(db, aid, wh, l.item_code, l.qty, { type: doc.doc_type, no: doc.doc_no, seq: l.seq, date: doc.doc_date })
        db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE id=?').run(unitCost, l.id)
        compCosts.push({ product_group: l.product_group, qty: Number(l.qty) || 0, unitCost })
      }
      // 2) 计算各成品入库单价（分组归集 / 旧单全池摊）
      const alloc = allocateAsProductCost(
        asProductLines.map((p: any) => ({ product_group: p.product_group, qty: Number(p.qty) || 0 })),
        compCosts,
      )
      const totalCompCost = compCosts.reduce((s, c) => s + c.unitCost * c.qty, 0)
      const totalProd = asProductLines.reduce((s: number, p: any) => s + (Number(p.qty) || 0), 0)
      const pooledUnit = totalProd > 0 ? Math.round(totalCompCost / totalProd * 10000) / 10000 : 0
      // 3) 各成品入库
      for (const p of asProductLines) {
        const q = Number(p.qty) || 0
        if (q <= 0) continue
        const wh = p.warehouse_code || doc.warehouse_code
        const unit = alloc.byGroup ? (alloc.unitCostByGroup.get(p.product_group) ?? 0) : pooledUnit
        applyMovingAvgIn(db, aid, wh, p.item_code, q, unit, { type: doc.doc_type, no: doc.doc_no, seq: p.seq, date: doc.doc_date })
        db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE id=?').run(unit, p.id)
      }
    } else if (doc.doc_type === 'AS') {
      // 组装：子件出库按移动均价，成品按总成本入库
      const bom = db.prepare('SELECT * FROM scm_bom WHERE id=? AND account_set_id=?').get(doc.bom_id, aid) as any
      const bomLines = db.prepare('SELECT * FROM scm_bom_line WHERE bom_id=? ORDER BY seq').all(doc.bom_id) as any[]
      let fpQty = 0
      for (const bl of bomLines) {
        const dl = lines.find((l: any) => l.item_code === bl.item_code)
        if (dl && Number(bl.qty) > 0) fpQty = Math.max(fpQty, Number(dl.qty) / Number(bl.qty))
      }
      let totalCost = 0
      for (const l of lines) {
        if (!l.qty || l.qty <= 0) continue
        const wh = l.warehouse_code || doc.warehouse_code
        const docRef = { type: doc.doc_type, no: doc.doc_no, seq: l.seq, date: doc.doc_date }
        const { unitCost } = applyMovingAvgOut(db, aid, wh, l.item_code, l.qty, docRef)
        db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE id=?').run(unitCost, l.id)
        totalCost += unitCost * l.qty
      }
      const fpUnitCost = fpQty > 0 ? Math.round(totalCost / fpQty * 10000) / 10000 : 0
      const maxSeq = lines.reduce((max: number, l: any) => Math.max(max, l.seq || 0), 0)
      applyMovingAvgIn(db, aid, doc.warehouse_code, bom.item_code, fpQty, fpUnitCost,
        { type: doc.doc_type, no: doc.doc_no, seq: maxSeq + 1, date: doc.doc_date })
    } else if (doc.doc_type === 'DS') {
      // 拆卸：成品出库按移动均价，子件按加权比例分摊成本入库
      const bom = db.prepare('SELECT * FROM scm_bom WHERE id=? AND account_set_id=?').get(doc.bom_id, aid) as any
      const bomLines = db.prepare('SELECT * FROM scm_bom_line WHERE bom_id=? ORDER BY seq').all(doc.bom_id) as any[]
      let fpQty = 0
      for (const bl of bomLines) {
        const dl = lines.find((l: any) => l.item_code === bl.item_code)
        if (dl && Number(bl.qty) > 0) fpQty = Math.max(fpQty, Number(dl.qty) / Number(bl.qty))
      }
      const docRef0 = { type: doc.doc_type, no: doc.doc_no, seq: 0, date: doc.doc_date }
      const { unitCost: fpCost } = applyMovingAvgOut(db, aid, doc.warehouse_code, bom.item_code, fpQty, docRef0)
      const totalCost = fpCost * fpQty
      const totalBomQty = bomLines.reduce((s: number, bl: any) => s + Number(bl.qty), 0)
      for (const l of lines) {
        if (!l.qty || l.qty <= 0) continue
        const bl = bomLines.find((x: any) => x.item_code === l.item_code)
        const ratio = bl && totalBomQty > 0 ? Number(bl.qty) / totalBomQty : 1 / Math.max(lines.length, 1)
        const allocatedUnitCost = totalCost > 0 && l.qty > 0 ? Math.round(totalCost * ratio / l.qty * 10000) / 10000 : 0
        const wh = l.warehouse_code || doc.warehouse_code
        applyMovingAvgIn(db, aid, wh, l.item_code, l.qty, allocatedUnitCost, docRef0)
        db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE id=?').run(allocatedUnitCost, l.id)
      }
    } else if ((doc.doc_type === 'PF' || doc.doc_type === 'WI') && doc.plan_id) {
      // 完工入库(PF)/委外入库(WI)：按各成品 BOM·净领单价上卷结转料成本；末批吸收料 WIP 余额（在制归零）。
      // 委外入库另加「加工费」(行 process_fee 单价)：成品成本=料分摊+加工费；加工费生成委外厂应付。
      const sum = getPlanCostSummary(db, aid, doc.plan_id, 0)   // 本次入库尚未过账（finished_qty 未变）
      const issueUnitCost = sum.issueUnitCost
      const planProducts = db.prepare('SELECT id, item_code, plan_qty, finished_qty, COALESCE(scrap_qty,0) AS scrap_qty, labor_absorbed, overhead_absorbed FROM scm_production_plan_product WHERE plan_id=? AND account_set_id=?').all(doc.plan_id, aid) as any[]
      const prodByItem = new Map<string, any>(planProducts.map(p => [p.item_code, p]))
      // 各完工行的料上卷成本（不含加工费）+ 本批各成品完工数
      const lineRollup: number[] = []
      const batchQtyByProduct = new Map<string, number>()
      let sumRollup = 0
      for (const l of lines) {
        const q = Number(l.qty) || 0
        const prod = prodByItem.get(l.item_code)
        const rollup = prod ? round2(productMaterialUnitCost(db, prod.id, issueUnitCost) * q) : 0
        lineRollup.push(rollup)
        sumRollup = round2(sumRollup + rollup)
        if (prod && q > 0) batchQtyByProduct.set(prod.id, (batchQtyByProduct.get(prod.id) || 0) + q)
      }
      // 末批：本批后「所有成品」均达到计划数 → 吸收全部料 WIP。
      // 报废数一并计入：计划 10 件做出 8 好 2 废也是做完了，否则在制永远清不干净、工单关不掉。
      const isLastOfOrder = planProducts.every(p => (Number(p.finished_qty) || 0) + (Number(p.scrap_qty) || 0) + (batchQtyByProduct.get(p.id) || 0) >= (Number(p.plan_qty) || 0) - 1e-6)
      const wipBefore = sum.wip
      const materialBudget = isLastOfOrder ? Math.max(0, wipBefore) : Math.max(0, Math.min(sumRollup, wipBefore))
      const f = sumRollup > 0 ? materialBudget / sumRollup : 0
      // 自制完工(PF)：人工/制费按各成品报工归集分批结转进成品成本，跨批 true-up——
      //   本批吸收 = 末批(本批后该成品达计划数)吸收全部剩余；否则按进度暂提(bq×累计率÷计划数)且封顶=报工累计−已吸收。
      //   委外(WI)无人工，用加工费。逐行落 labor_cost/overhead_cost 供反审核回退与凭证拆分。
      const laborOh = doc.doc_type === 'PF' ? getPlanLaborOverhead(db, aid, doc.plan_id) : new Map<string, { labor: number; overhead: number }>()
      const lohBatchByProduct = new Map<string, { labor: number; overhead: number }>()
      for (const [pid, bq] of batchQtyByProduct) {
        const prod = planProducts.find(p => p.id === pid)
        const lo = laborOh.get(pid) || { labor: 0, overhead: 0 }
        const planQ = Number(prod?.plan_qty) || 0
        const lastForProd = (Number(prod?.finished_qty) || 0) + (Number(prod?.scrap_qty) || 0) + bq >= planQ - 1e-6
        const remL = Math.max(0, round2((lo.labor || 0) - (Number(prod?.labor_absorbed) || 0)))
        const remO = Math.max(0, round2((lo.overhead || 0) - (Number(prod?.overhead_absorbed) || 0)))
        const labor = planQ > 0 ? (lastForProd ? remL : Math.max(0, Math.min(round2(bq * (lo.labor || 0) / planQ), remL))) : 0
        const overhead = planQ > 0 ? (lastForProd ? remO : Math.max(0, Math.min(round2(bq * (lo.overhead || 0) / planQ), remO))) : 0
        lohBatchByProduct.set(pid, { labor, overhead })
      }
      // 每成品在本单的完工行数，用于把整批人工/制费不整除的余额落在该成品「最后一行」，
      // 保证 Σ逐行 labor_cost 恰等于累加进 labor_absorbed 的量（否则反审核 SUM 回退会残留、污染 true-up）。
      const lineCountByProduct = new Map<string, number>()
      for (const l of lines) { if (Number(l.qty) > 0) { const p = prodByItem.get(l.item_code); if (p) lineCountByProduct.set(p.id, (lineCountByProduct.get(p.id) || 0) + 1) } }
      const allocL = new Map<string, number>(); const allocO = new Map<string, number>(); const seen = new Map<string, number>()
      let inTotal = 0; let feeTotal = 0; let feeTaxTotal = 0; let i = 0
      for (const l of lines) {
        if (!l.qty || l.qty <= 0) { i++; continue }
        const q = Number(l.qty) || 0
        const matCost = round2(lineRollup[i] * f)
        const feeUnit = doc.doc_type === 'WI' ? (Number(l.process_fee) || 0) : 0
        const feeTax = doc.doc_type === 'WI' ? round2(Number(l.tax_amount) || 0) : 0
        const prod = prodByItem.get(l.item_code)
        const bq = prod ? (batchQtyByProduct.get(prod.id) || 0) : 0
        const lohB = prod ? lohBatchByProduct.get(prod.id) : undefined
        let lineLabor = 0, lineOverhead = 0
        if (prod && lohB && bq > 0) {
          const n = (seen.get(prod.id) || 0) + 1; seen.set(prod.id, n)
          const isLastLine = n >= (lineCountByProduct.get(prod.id) || 1)
          lineLabor = isLastLine ? round2(lohB.labor - (allocL.get(prod.id) || 0)) : round2(lohB.labor * q / bq)
          lineOverhead = isLastLine ? round2(lohB.overhead - (allocO.get(prod.id) || 0)) : round2(lohB.overhead * q / bq)
          allocL.set(prod.id, round2((allocL.get(prod.id) || 0) + lineLabor))
          allocO.set(prod.id, round2((allocO.get(prod.id) || 0) + lineOverhead))
        }
        const inCostUnit = round2(matCost / q + feeUnit + (lineLabor + lineOverhead) / q)
        feeTotal = round2(feeTotal + feeUnit * q)
        feeTaxTotal = round2(feeTaxTotal + feeTax)
        inTotal = round2(inTotal + inCostUnit * q)
        const wh = l.warehouse_code || doc.warehouse_code
        applyMovingAvgIn(db, aid, wh, l.item_code, l.qty, inCostUnit, { type: doc.doc_type, no: doc.doc_no, seq: l.seq, date: doc.doc_date })
        db.prepare('UPDATE scm_doc_line SET unit_cost=?, labor_cost=?, overhead_cost=? WHERE id=?').run(inCostUnit, lineLabor, lineOverhead, l.id)
        i++
      }
      // 累加各成品已吸收人工/制费（按逐行实落合计，确保与 scm_doc_line 一致、反审核可精确回退）
      for (const pid of lineCountByProduct.keys()) {
        db.prepare('UPDATE scm_production_plan_product SET labor_absorbed=ROUND(labor_absorbed+?,2), overhead_absorbed=ROUND(overhead_absorbed+?,2) WHERE id=?').run(allocL.get(pid) || 0, allocO.get(pid) || 0, pid)
      }
      db.prepare('UPDATE scm_doc SET total_amount=? WHERE id=?').run(inTotal, doc.id)
      // 委外加工费 → 委外厂应付（doc.partner_code 已为委外厂）
      if (doc.doc_type === 'WI' && feeTotal > 0) applyOutsourceFeePayable(db, aid, doc, round2(feeTotal + feeTaxTotal), feeTaxTotal)
      // 完工数回写对应成品行（逐成品累加），并同步头 legacy finished_qty 汇总
      const getF = db.prepare('SELECT COALESCE(finished_qty,0) f FROM scm_production_plan_product WHERE id=?')
      const setF = db.prepare('UPDATE scm_production_plan_product SET finished_qty=? WHERE id=?')
      for (const [pid, q] of batchQtyByProduct) { const cur = Number((getF.get(pid) as any)?.f) || 0; setF.run(r6(cur + q), pid) }
      const headFinished = (db.prepare('SELECT COALESCE(SUM(finished_qty),0) s FROM scm_production_plan_product WHERE plan_id=?').get(doc.plan_id) as any)?.s || 0
      db.prepare('UPDATE scm_production_plan SET finished_qty=? WHERE id=? AND account_set_id=?').run(round2(headFinished), doc.plan_id, aid)
    } else if (doc.doc_type === 'PS' && doc.plan_id) {
      // 不良品入库(PS)：按工单料成本上卷入不良品仓，回写 scrap_qty 并冲减料在制。
      // 原先落在通用入库分支按手工价（通常是 0）入库，废品的料成本全部压在合格品头上，
      // 工单在制也永远清不干净。人工/制费不由废品承担——废品损失只计料，与 PF 的 true-up 口径互补。
      const sum = getPlanCostSummary(db, aid, doc.plan_id, 0)
      const planProducts = db.prepare('SELECT id, item_code FROM scm_production_plan_product WHERE plan_id=? AND account_set_id=?').all(doc.plan_id, aid) as any[]
      const prodByItem = new Map<string, any>(planProducts.map(p => [p.item_code, p]))
      const lineRollup: number[] = []
      const batchQtyByProduct = new Map<string, number>()
      let sumRollup = 0
      for (const l of lines) {
        const q = Number(l.qty) || 0
        const prod = prodByItem.get(l.item_code)
        const rollup = prod ? round2(productMaterialUnitCost(db, prod.id, sum.issueUnitCost) * q) : 0
        lineRollup.push(rollup)
        sumRollup = round2(sumRollup + rollup)
        if (prod && q > 0) batchQtyByProduct.set(prod.id, (batchQtyByProduct.get(prod.id) || 0) + q)
      }
      // 封顶在当前料在制内，避免报废把工单成本冲成负数
      const budget = Math.max(0, Math.min(sumRollup, Math.max(0, sum.wip)))
      const f = sumRollup > 0 ? budget / sumRollup : 0
      let i = 0
      for (const l of lines) {
        if (!l.qty || l.qty <= 0) { i++; continue }
        const q = Number(l.qty)
        const unit = round2(round2(lineRollup[i] * f) / q)
        const wh = l.warehouse_code || doc.warehouse_code
        applyMovingAvgIn(db, aid, wh, l.item_code, q, unit, { type: doc.doc_type, no: doc.doc_no, seq: l.seq, date: doc.doc_date })
        db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE id=?').run(unit, l.id)
        i++
      }
      const addScrap = db.prepare('UPDATE scm_production_plan_product SET scrap_qty=ROUND(COALESCE(scrap_qty,0)+?,6) WHERE id=?')
      for (const [pid, q] of batchQtyByProduct) addScrap.run(q, pid)
      syncPlanScrapQty(db, aid, doc.plan_id)
    } else if (doc.doc_type === 'PJ' && doc.plan_id) {
      // 退料(PJ)：必须按**本工单的领用单价**回冲，不能取行上的 unit_cost/price（生成的退料单这两列通常是 0）。
      // 否则 5 件料以 0 成本退回原料仓：仓库数量涨了金额没涨，均价被稀释；
      // 同时 getMaterialIssueUnitCost 的「净领用额 ÷ 净领用量」分母变小而分子不变，工单料单价虚高，
      // 完工入库上卷的成品成本随之偏高。领用单价须在写入退料流水**之前**取，否则会把本单算进去。
      const issueUnitCost = getMaterialIssueUnitCost(db, aid, doc.plan_id)
      for (const l of lines) {
        if (!l.qty || l.qty <= 0) continue
        const wh = l.warehouse_code || doc.warehouse_code
        const cost = issueUnitCost.get(l.item_code) ?? (Number(l.unit_cost) || Number(l.price) || 0)
        applyMovingAvgIn(db, aid, wh, l.item_code, l.qty, cost, { type: doc.doc_type, no: doc.doc_no, seq: l.seq, date: doc.doc_date })
        db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE id=?').run(cost, l.id)
      }
    } else {
      for (const l of lines) {
        if (!l.qty || l.qty <= 0) continue
        if (!docType.affects_stock) continue
        if (docType.direction === 'in') {
          const cost = l.unit_cost || l.price || 0
          applyMovingAvgIn(db, aid, l.warehouse_code, l.item_code, l.qty, cost, { type: doc.doc_type, no: doc.doc_no, seq: l.seq, date: doc.doc_date })
        } else if (docType.direction === 'out') {
          const { unitCost } = applyMovingAvgOut(db, aid, l.warehouse_code, l.item_code, l.qty, { type: doc.doc_type, no: doc.doc_no, seq: l.seq, date: doc.doc_date })
          db.prepare('UPDATE scm_doc_line SET unit_cost=? WHERE id=?').run(unitCost, l.id)
        }
      }
    }
    // 往来挂账（一律按价税合计，与凭证应收/应付口径一致）：
    //   SO 销售发货 → 应收暂估；PI 采购入库 → 应付暂估；
    //   RP/RS 发票 → 有来源单据则校正该单的暂估额，无来源单据则新挂一条。
    if (doc.doc_type === 'SO') {
      applyReceivableFromShipment(db, aid, doc, lines)
    } else if (doc.doc_type === 'PI') {
      applyPayableFromReceipt(db, aid, doc, lines)
    } else if (doc.doc_type === 'RP' || doc.doc_type === 'RS') {
      const r = applyInvoice(db, aid, doc, lines)
      if (r.mode === 'adjust') {
        invoiceNotice = `已按发票金额 ${r.amount} 校正来源单据「${r.sourceDocNo}」的往来挂账`
      }
    }
    // 批次/保质期追溯（启用批次的物料）：与移动平均成本并行维护，出库不足会抛错回滚
    if (docType.affects_stock) maintainDocBatches(db, aid, doc.id)
    // 序列号追溯（启用序列号的物料）：个数须等于数量，入库登记/出库核销，异常回滚
    if (docType.affects_stock) {
      const w = maintainDocSerials(db, aid, doc.id)
      if (w.length) serialWarning = w.join('；')
    }
    db.prepare("UPDATE scm_doc SET status='audited', auditor=?, audited_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(userName(req), doc.id)
  })
  try {
    runAudit()
  } catch (e: any) {
    // 批次/序列号等业务校验失败：整单已回滚，返回 400 提示
    return res.status(400).json({ code: 400, message: e?.message || '审核失败' })
  }
  const latest = db.prepare('SELECT id,status,total_amount,auditor,audited_at FROM scm_doc WHERE id=?').get(doc.id) as any
  res.json({ code: 0, data: { ...latest, total_amount: Number(latest?.total_amount) || 0,
    already_audited: false, credit_warning: creditWarning, serial_warning: serialWarning, invoice_notice: invoiceNotice } })
}
router.post('/scm/docs/:id/audit', operationLog('供应链单据审核', '供应链'), auditDocHandler)

// 导出供单元测试直接调用（批量操作也复用此 handler）
export const unauditDocHandler = (req: AuthRequest, res: Response) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!doc) return res.status(404).json({ code: 404, message: '单据不存在' })
  if (doc.status !== 'audited') return res.status(400).json({ code: 400, message: '仅已审核可反审核' })
  // 已生成记账凭证的单据禁止反审核：反审核会回滚库存/往来，凭证却留在总账，两套账会脱节。
  // 需先到「凭证查询」删除关联凭证（scm_* 来源凭证允许删除，与 cashier/asset_* 不同），再反审核。
  if (doc.voucher_id) return res.status(400).json({ code: 400, message: '该单据已生成记账凭证，请先在凭证查询中删除关联凭证后再反审核' })

  const mrpSourceKind = doc.doc_type === 'SOa' ? 'sales_order' : doc.doc_type === 'AS' ? 'assembly' : null
  if (mrpSourceKind) {
    const mrp = findActiveMrpSource(db, aid, mrpSourceKind, doc.id)
    if (mrp) {
      const hint = mrp.status === 'draft' ? '；如需释放，请先删除该草稿 MRP 计算单' : ''
      return res.status(400).json({ code: 400, message: `该单据已进入 MRP 计算单 ${mrp.doc_no}，不能反审核${hint}` })
    }
  }

  // 检查是否已被下游引用
  const isReferenced = db.prepare(`
    SELECT (
      (SELECT COUNT(*) FROM scm_doc_line WHERE source_line_id IN (SELECT id FROM scm_doc_line WHERE doc_id = ?))
      + (SELECT COUNT(*) FROM scm_production_plan WHERE source_doc_id = ?)
    ) c
  `).get(req.params.id, req.params.id) as any
  if (isReferenced && isReferenced.c > 0) {
    return res.status(400).json({ code: 400, message: '该单据已被下游单据/计划引用，无法反审核' })
  }

  // 往来核销安全网：该单据的往来台账已参与核销时，禁止反审核（否则删除台账会破坏核销配平）
  const vInfo = getDocVerifiedInfo(db, aid, doc.doc_no)
  const isPaymentDoc = doc.doc_type === 'PAY' || doc.doc_type === 'RCV'
  if (vInfo.verified && !isPaymentDoc) {
    return res.status(400).json({ code: 400, message: `该单据已参与往来核销（核销单 ${vInfo.verify_nos.join('、')}），请先取消核销后再反审核` })
  }

  const runUnaudit = db.transaction(() => {
    const docType = db.prepare('SELECT * FROM scm_doc_type WHERE account_set_id=? AND code=?').get(aid, doc.doc_type) as any
    if (isPaymentDoc || doc.doc_type === 'RP' || doc.doc_type === 'RS') {
      reversePayment(db, aid, doc)
    } else {
    // 销售发货(SO)→回滚应收、采购入库(PI)→回滚应付（reversePayment 按 doc_no 删除往来台账，无出纳流水，安全）
    if (doc.doc_type === 'SO' || doc.doc_type === 'PI') reversePayment(db, aid, doc)
    // 发票(RP/RS) 反审核：校正过来源单据暂估的还原回来源金额，独立发票的删除自己的台账
    if (doc.doc_type === 'RP' || doc.doc_type === 'RS') reverseInvoice(db, aid, doc)
    // 委外入库(WI) 反审核：回退委外厂应付（reversePayment 按 doc_no 删除往来台账）
    if (doc.doc_type === 'WI') reversePayment(db, aid, doc)
    if (docType?.affects_stock) reverseDocMoves(db, aid, doc.id)
    // 批次台账回退（与库存移动回退并行）
    if (docType?.affects_stock) reverseDocBatches(db, aid, doc.id)
    // 序列号台账回退
    if (docType?.affects_stock) reverseDocSerials(db, aid, doc.id)
    // 不良品入库(PS) 反审核：回退各成品行报废数（库存与流水已由 reverseDocMoves 回退）
    if (doc.doc_type === 'PS' && doc.plan_id) {
      const psLines = db.prepare('SELECT item_code, COALESCE(SUM(qty),0) q FROM scm_doc_line WHERE doc_id=? GROUP BY item_code').all(doc.id) as any[]
      const findProd = db.prepare('SELECT id, COALESCE(scrap_qty,0) s FROM scm_production_plan_product WHERE plan_id=? AND item_code=? ORDER BY seq LIMIT 1')
      const setS = db.prepare('UPDATE scm_production_plan_product SET scrap_qty=? WHERE id=?')
      for (const pl of psLines) {
        const prod = findProd.get(doc.plan_id, pl.item_code) as any
        if (prod) setS.run(Math.max(0, r6((Number(prod.s) || 0) - (Number(pl.q) || 0))), prod.id)
      }
      syncPlanScrapQty(db, aid, doc.plan_id)
    }
    // 完工入库(PF)/委外入库(WI) 反审核：按成品逐行回退完工数（回退到对应成品行），并同步头汇总
    if ((doc.doc_type === 'PF' || doc.doc_type === 'WI') && doc.plan_id) {
      const pfLines = db.prepare('SELECT item_code, COALESCE(SUM(qty),0) q, COALESCE(SUM(labor_cost),0) lc, COALESCE(SUM(overhead_cost),0) oc FROM scm_doc_line WHERE doc_id=? GROUP BY item_code').all(doc.id) as any[]
      const findProd = db.prepare('SELECT id, COALESCE(finished_qty,0) f FROM scm_production_plan_product WHERE plan_id=? AND item_code=? ORDER BY seq LIMIT 1')
      const setF = db.prepare('UPDATE scm_production_plan_product SET finished_qty=? WHERE id=?')
      // 回退已吸收人工/制费（按本单各成品行合计），使跨批 true-up 状态与完工数一并回退
      const unabsorb = db.prepare('UPDATE scm_production_plan_product SET labor_absorbed=MAX(0,ROUND(labor_absorbed-?,2)), overhead_absorbed=MAX(0,ROUND(overhead_absorbed-?,2)) WHERE id=?')
      for (const pl of pfLines) {
        const prod = findProd.get(doc.plan_id, pl.item_code) as any
        if (prod) {
          setF.run(Math.max(0, r6((Number(prod.f) || 0) - (Number(pl.q) || 0))), prod.id)
          unabsorb.run(Number(pl.lc) || 0, Number(pl.oc) || 0, prod.id)
        }
      }
      const headFinished = (db.prepare('SELECT COALESCE(SUM(finished_qty),0) s FROM scm_production_plan_product WHERE plan_id=?').get(doc.plan_id) as any)?.s || 0
      db.prepare('UPDATE scm_production_plan SET finished_qty=? WHERE id=? AND account_set_id=?').run(round2(headFinished), doc.plan_id, aid)
    }
    }
    db.prepare("UPDATE scm_doc SET status='draft', auditor=NULL, audited_at=NULL, updated_at=datetime('now') WHERE id=?").run(doc.id)
  })
  try {
    runUnaudit()
  } catch (e: any) {
    return res.status(400).json({ code: 400, message: e?.message || '反审核失败' })
  }
  res.json({ code: 0, data: { ok: true } })
}
router.post('/scm/docs/:id/unaudit', operationLog('供应链单据反审核', '供应链'), unauditDocHandler)

// ── 采购资产入库：生成资产卡片（P5 凭证联动留 P5 完善） ──
router.post('/scm/docs/:id/gen-assets', operationLog('采购资产生成', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!doc || doc.status !== 'audited') return res.status(400).json({ code: 400, message: '单据未审核' })
  if (doc.doc_type !== 'PI') return res.status(400).json({ code: 400, message: '仅采购入库可生成资产' })

  const lines = db.prepare('SELECT * FROM scm_doc_line WHERE doc_id=?').all(doc.id) as any[]
  const assetLines = lines.filter(l => { const item = getItem(db, aid, l.item_code); return item?.is_asset === 1 })

  let created = 0
  for (const l of assetLines) {
    const item = getItem(db, aid, l.item_code)
    const assetNo = `CG-${doc.doc_no}-${l.seq}`
    if (db.prepare('SELECT id FROM fixed_asset WHERE account_set_id=? AND asset_no=?').get(aid, assetNo)) continue
    const assetId = uuidv4()
    const originalValue = Number(l.amount) || 0
    db.prepare(`INSERT INTO fixed_asset (id,account_set_id,asset_no,asset_name,category_code,status_code,original_value,salvage_rate,salvage_value,depr_method,use_months,accum_depr,depr_months_done,net_value,qty,unit,acquire_date,start_depr_date,remark)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?)`).run(
      assetId, aid, assetNo, item?.name || l.item_code, item?.category_code || null, '01',
      // P0-3：残值率统一小数口径（此前写 5 = 500%，与残值金额 5% 自相矛盾）
      originalValue, 0.05, Math.round(originalValue * 0.05 * 100) / 100,
      item?.use_months ? '1' : null, item?.use_months || 60,
      originalValue, 1, item?.unit || '个', doc.doc_date, doc.doc_date,
      `供应链采购入库${doc.doc_no}`
    )
    created++
  }
  res.json({ code: 0, data: { created, totalAssetLines: assetLines.length } })
})

// ── BOM（物料清单）CRUD ───────────────────────────────────────────────
// 缺料单按供应商生成采购询价/订单（旧入口兼容；采购订单主入口仍为下方预览下推）。
router.post('/scm/docs/:id/gen-purchase-docs', operationLog('缺料单生成采购单据', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const mr = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!mr) return res.status(404).json({ code: 404, message: '缺料单不存在' })
  if (mr.doc_type !== 'MR') return res.status(400).json({ code: 400, message: '仅缺料单可生成采购单据' })
  if (mr.status !== 'audited') return res.status(400).json({ code: 400, message: '缺料单未审核，不可下推' })
  const targetType = req.body?.target_type === 'PO' ? 'PO' : req.body?.target_type === 'PQ' ? 'PQ' : ''
  if (!targetType) return res.status(400).json({ code: 400, message: '目标单据类型仅支持采购询价单或采购订单' })

  const sourceLines = db.prepare(`
    SELECT l.*, COALESCE(NULLIF(l.source_type,''),i.source_type,'purchase') AS eff_source,
           COALESCE(NULLIF(l.supplier_code,''),i.supplier_code) AS eff_supplier,
           COALESCE(i.purchase_price,0) AS purchase_price
    FROM scm_doc_line l
    LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    WHERE l.doc_id=? ORDER BY l.seq
  `).all(mr.id) as any[]
  const groups = new Map<string, any[]>()
  for (const line of sourceLines) {
    if (line.eff_source !== 'purchase') continue
    const remain = r6((Number(line.qty) || 0) - computePushedQty(db, line.id))
    if (remain <= 0) continue
    const key = String(line.eff_supplier || '').trim()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push({ ...line, remain })
  }
  if (!groups.size) return res.status(400).json({ code: 400, message: '没有可下推的采购来源缺料明细' })

  const createdDocs: Array<{ id: string; doc_no: string; supplier_code: string; lines: number }> = []
  db.transaction(() => {
    for (const [supplier, lines] of groups) {
      const docId = uuidv4(); const docNo = nextDocNo(db, aid, targetType)
      const totalQty = r6(lines.reduce((sum, line) => sum + line.remain, 0))
      const totalAmount = round2(lines.reduce((sum, line) => sum + line.remain * (Number(line.purchase_price) || 0), 0))
      db.prepare(`INSERT INTO scm_doc
        (id,account_set_id,doc_type,doc_no,doc_date,partner_code,operator,maker,status,source_doc_id,total_qty,total_amount,remark)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        docId, aid, targetType, docNo, new Date().toISOString().slice(0, 10), supplier || null,
        userName(req), userName(req), 'draft', mr.id, totalQty, totalAmount, `缺料单 ${mr.doc_no} ${targetType === 'PQ' ? '询价' : '采购'}`
      )
      const ins = prepareDocLineInsert(db)
      let seq = 0
      for (const line of lines) {
        seq++
        ins.run(...buildDocLineRow(aid, docId, seq, {
          item_code: line.item_code, warehouse_code: line.warehouse_code, qty: line.remain,
          price: Number(line.purchase_price) || 0, source_line_id: line.id,
          supplier_code: supplier || null, source_type: 'purchase',
        }, line.warehouse_code).values)
      }
      createdDocs.push({ id: docId, doc_no: docNo, supplier_code: supplier, lines: lines.length })
    }
  })()
  res.json({ code: 0, data: { created: createdDocs.length, target_type: targetType, docs: createdDocs } })
})

// 缺料单或 MRP 计算单的多层 BOM 分层下推预览。
router.get('/scm/docs/:id/downstream-preview', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const mr = db.prepare('SELECT id,doc_no,doc_type,status FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!mr) return res.status(404).json({ code: 404, message: '来源单据不存在' })
  if (!['MR', 'MRP'].includes(mr.doc_type)) return res.status(400).json({ code: 400, message: '仅缺料单或 MRP 计算单可做分层下推预览' })
  res.json({ code: 0, data: { doc: mr, ...buildMrPushPreview(db, aid, mr.id) } })
})

// 缺料单/MRP 下推生成：旧缺料单请求按明细生成；selected_nodes 请求按多层节点生成。
router.post('/scm/docs/:id/gen-downstream', operationLog('MRP/缺料单生成下游单据', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const mr = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!mr) return res.status(404).json({ code: 404, message: '来源单据不存在' })
  if (!['MR', 'MRP'].includes(mr.doc_type)) return res.status(400).json({ code: 400, message: '仅缺料单或 MRP 计算单可生成下游单据' })
  const sourceName = mr.doc_type === 'MRP' ? 'MRP计算单' : '缺料单'
  if (mr.status !== 'audited') return res.status(400).json({ code: 400, message: `${sourceName}未审核，不可下推` })

  const validTargets = new Set(['purchase', 'outsource', 'self', 'assembly'])
  const bodyTargets = Array.isArray(req.body?.targets)
    ? req.body.targets.filter((target: any) => validTargets.has(String(target)))
    : []
  const targetSet = new Set<string>(bodyTargets.length ? bodyTargets : Array.from(validTargets))
  const isMultiLevel = Array.isArray(req.body?.selected_nodes)
  if (mr.doc_type === 'MRP' && !isMultiLevel) {
    return res.status(400).json({ code: 400, message: 'MRP计算单必须先进入分层预览并选择本次下推数量' })
  }
  if (mr.doc_type === 'MRP') {
    const historicalMr = db.prepare("SELECT doc_no FROM scm_doc WHERE account_set_id=? AND doc_type='MR' AND source_doc_id=? LIMIT 1").get(aid, mr.id) as any
    if (historicalMr) {
      return res.status(400).json({ code: 400, message: `该MRP已生成历史缺料单 ${historicalMr.doc_no}，请从缺料单继续下推` })
    }
  }

  // 重复生成提示：按可靠的表头 source_doc_id 统计该缺料单已生成过的下游单据/计划。
  // 仅当「本次选中的目标类型」已生成过对应下游时才要求确认（force!==true 时不生成，返回 needConfirm）。
  const existDocs = db.prepare(
    'SELECT doc_type, COUNT(*) c FROM scm_doc WHERE account_set_id=? AND source_doc_id=? GROUP BY doc_type'
  ).all(aid, mr.id) as any[]
  const existPlans = db.prepare(
    'SELECT plan_type, COUNT(*) c FROM scm_production_plan WHERE account_set_id=? AND source_doc_id=? GROUP BY plan_type'
  ).all(aid, mr.id) as any[]
  const existing = {
    assembly: Number(existDocs.find(r => r.doc_type === 'AS')?.c) || 0,
    po: Number(existDocs.find(r => r.doc_type === 'PO')?.c) || 0,
    self_plans: Number(existPlans.find(r => r.plan_type === 'self')?.c) || 0,
    outsource_plans: Number(existPlans.find(r => r.plan_type === 'outsource')?.c) || 0,
  }
  const dupSelected =
    (targetSet.has('assembly') && existing.assembly > 0) ||
    (targetSet.has('purchase') && existing.po > 0) ||
    (targetSet.has('self') && existing.self_plans > 0) ||
    (targetSet.has('outsource') && existing.outsource_plans > 0)
  if (!isMultiLevel && dupSelected && req.body?.force !== true) {
    return res.json({ code: 0, data: { needConfirm: true, existing } })
  }

  const r6 = (n: number) => Math.round(n * 1000000) / 1000000
  const purchaseLines: any[] = []
  const outsourceLines: any[] = []
  const selfLines: any[] = []
  const assemblyLines: any[] = []
  let generationPreview: ReturnType<typeof buildMrPushPreview> | null = null

  const routeLine = (line: any) => {
    if (!(Number(line.remain) > 0)) return
    if (line.eff_source === 'self') {
      if (targetSet.has('self')) selfLines.push(line)
    } else if (line.eff_source === 'outsource') {
      if (targetSet.has('outsource')) outsourceLines.push(line)
    } else if (line.eff_source === 'assembly') {
      if (targetSet.has('assembly')) assemblyLines.push(line)
    } else if (targetSet.has('purchase')) {
      purchaseLines.push(line)
    }
  }

  if (isMultiLevel) {
    const preview = buildMrPushPreview(db, aid, mr.id)
    generationPreview = preview
    if (preview.has_cycle) {
      return res.status(400).json({ code: 400, message: `BOM 存在循环：${preview.cycles.map(path => path.join(' → ')).join('；')}，请先修正 BOM` })
    }
    const nodeMap = new Map(preview.nodes.map(node => [node.key, node]))
    for (const selected of req.body.selected_nodes as any[]) {
      const key = String(selected?.key || '')
      const node = nodeMap.get(key)
      if (!node) return res.status(400).json({ code: 400, message: `下推节点已失效：${key || '空节点'}，请刷新预览后重试` })
      let remaining = r6(Number(selected?.qty) || 0)
      if (remaining <= 0) continue
      const supplierCode = resolveMrPushNodeSupplier(node.source_type, node.supplier_code, selected?.supplier_code)
      if (node.source_type === 'outsource' && !supplierCode) {
        return res.status(400).json({ code: 400, message: `${node.item_code} 为委外来源，必须选择外协厂` })
      }
      const base = {
        item_code: node.item_code, item_name: node.item_name, spec: node.spec, unit: node.unit,
        eff_source: node.source_type, eff_supplier: supplierCode, purchase_price: node.purchase_price,
        bom_id: node.bom_id, bom_code: node.bom_code, warehouse_code: '', mr_level: node.level,
      }
      // 根物料优先按原缺料行分摊，保留 source_line_id；超出根行剩余量及递归节点按虚拟需求处理。
      for (const source of node.root_sources) {
        if (remaining <= 0) break
        const take = r6(Math.min(remaining, source.remaining_qty))
        if (take <= 0) continue
        routeLine({ ...base, remain: take, warehouse_code: source.warehouse_code, push_source_line_id: source.line_id })
        remaining = r6(remaining - take)
      }
      if (remaining > 0) {
        // MRP/预计算缺料单每个节点都有稳定结果行；人工多买也必须挂回该行，
        // 否则刷新预览时无法识别已经生成的超额数量。
        routeLine({ ...base, remain: remaining, push_source_line_id: node.root_sources[0]?.line_id || null })
      }
    }
  } else {
    generationPreview = buildMrPushPreview(db, aid, mr.id)
    const lines = db.prepare(`
      SELECT l.*,
             COALESCE(NULLIF(l.source_type, ''), i.source_type, 'purchase') AS eff_source,
             COALESCE(NULLIF(l.supplier_code, ''), i.supplier_code) AS eff_supplier,
             COALESCE(i.purchase_price, 0) AS purchase_price
      FROM scm_doc_line l
      LEFT JOIN scm_item i ON i.account_set_id = l.account_set_id AND i.code = l.item_code
      WHERE l.doc_id=?
      ORDER BY l.seq
    `).all(req.params.id) as any[]
    for (const line of lines) line.pushed_qty = computePushedQty(db, line.id)
    // 旧请求：人工指定每行下推数量；允许大于剩余量（多买），缺省按剩余量。
    const qtyOverride: Record<string, any> = (req.body && typeof req.body.quantities === 'object' && req.body.quantities) || {}
    for (const line of lines) {
      const baseRemain = r6((Number(line.qty) || 0) - (Number(line.pushed_qty) || 0))
      const hasOverride = Object.prototype.hasOwnProperty.call(qtyOverride, line.id) && qtyOverride[line.id] != null && qtyOverride[line.id] !== ''
      const remain = hasOverride ? r6(Number(qtyOverride[line.id]) || 0) : baseRemain
      if (remain <= 0) continue
      routeLine({
        ...line,
        remain,
        mr_level: generationPreview.nodes.find(node => node.item_code === line.item_code)?.level || 0,
      })
    }
  }

  if (!purchaseLines.length && !outsourceLines.length && !selfLines.length && !assemblyLines.length) {
    return res.status(400).json({ code: 400, message: '选中的类型没有可生成的缺料明细' })
  }

  // 供应商→业务员（salesman 名称）、业务员→所属部门（人员 aux_item.field_values.dept_code）：
  // 下推单据按供应商自动填「关联的业务员 + 部门」
  const partnerSalesman = new Map<string, string>()
  for (const p of db.prepare('SELECT code, salesman FROM scm_partner WHERE account_set_id=?').all(aid) as any[]) {
    if (p.code) partnerSalesman.set(p.code, p.salesman || '')
  }
  const personDept = new Map<string, string>()
  const personCat = db.prepare("SELECT id FROM aux_categories WHERE account_set_id=? AND code='person'").get(aid) as any
  if (personCat) {
    for (const it of db.prepare('SELECT name, field_values FROM aux_items WHERE account_set_id=? AND type=?').all(aid, personCat.id) as any[]) {
      let fv: any = {}
      try { fv = JSON.parse(it.field_values || '{}') } catch { /* ignore */ }
      if (it.name && fv && fv.dept_code) personDept.set(it.name, String(fv.dept_code))
    }
  }
  const staffOf = (supplierCode: string | null | undefined) => {
    const salesman = supplierCode ? (partnerSalesman.get(supplierCode) || '') : ''
    const dept_code = salesman ? (personDept.get(salesman) || '') : ''
    return { biz_person: salesman, dept_code }
  }

  const today = new Date().toISOString().slice(0, 10)
  const sourceLineOf = (line: any) => Object.prototype.hasOwnProperty.call(line, 'push_source_line_id')
    ? line.push_source_line_id
    : line.id
  const planCols = new Set((db.prepare('PRAGMA table_info(scm_production_plan)').all() as any[]).map(col => col.name))
  const nextPlanNo = (planType: 'outsource' | 'self') => {
    const now = new Date()
    const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${planType === 'outsource' ? 'OUT' : 'PP'}-`
    const rows = db.prepare('SELECT code FROM scm_production_plan WHERE account_set_id=? AND code LIKE ?').all(aid, `${prefix}%`) as any[]
    let max = 0
    for (const row of rows) {
      const matched = String(row.code || '').match(/-(\d+)$/)
      if (matched) max = Math.max(max, parseInt(matched[1], 10))
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`
  }
  // 把一组缺料行合并为「一张多成品工单」：每个缺料行 → 一个成品行（行级来源 source_line_id 落成品行，用于「已下推」防重）。
  // 自制：supplierCode=null；委外：同一 supplierCode 一张工单。返回成品数。
  const createMergedPlan = (planType: 'outsource' | 'self', supplierCode: string | null, groupLines: any[]) => {
    const planId = uuidv4()
    // 多层预览已确定 BOM；旧请求按“启用默认优先，否则编码第一张”补取。
    const productsMeta = groupLines.map(line => {
      const bom = line.bom_id
        ? { id: line.bom_id }
        : db.prepare("SELECT id FROM scm_bom WHERE account_set_id=? AND item_code=? AND status='active' ORDER BY is_default DESC,code LIMIT 1").get(aid, line.item_code) as any
      return { line, item_code: line.item_code, plan_qty: Number(line.remain) || 0, bom_id: bom?.id || null }
    })
    const totalQty = r6(productsMeta.reduce((s, p) => s + p.plan_qty, 0))
    const head = productsMeta[0]
    const staff = planType === 'outsource' ? staffOf(supplierCode) : { dept_code: '', biz_person: '' }
    // 头：legacy 字段取首成品代表 + plan_qty 汇总；source_line_id 留空（多源，来源落成品行）
    const data: Record<string, any> = {
      id: planId, account_set_id: aid, code: nextPlanNo(planType),
      item_code: head.item_code, bom_id: head.bom_id, plan_qty: totalQty,
      start_date: null, end_date: null, status: 'draft',
      remark: `${sourceName} ${mr.doc_no} ${planType === 'outsource' ? '委外' : '自制'}`,
      source_doc_id: mr.id, source_line_id: null,
      plan_type: planType,
      supplier_code: planType === 'outsource' ? (supplierCode || null) : null,
      dept_code: planType === 'outsource' ? (staff.dept_code || null) : null,
    }
    const cols = Object.keys(data).filter(key => planCols.has(key))
    db.prepare(`INSERT INTO scm_production_plan (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(key => data[key]))
    const insP = db.prepare(`INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty,bom_id,fp_warehouse,finished_qty,scrap_qty,source_line_id,source_doc_id)
      VALUES (?,?,?,?,?,?,?,?,0,0,?,?)`)
    const insL = db.prepare('INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,product_id,seq,item_code,qty,unit,scrap_rate,remark) VALUES (?,?,?,?,?,?,?,?,?,?)')
    let seq = 0
    for (const p of productsMeta) {
      seq++
      const productId = uuidv4()
      // 行级来源落成品行，用于该缺料行「已下推」防重
      insP.run(productId, aid, planId, seq, p.item_code, p.plan_qty, p.bom_id ?? null, null, sourceLineOf(p.line), mr.id)
      if (p.bom_id) {
        const bomLines = db.prepare("SELECT item_code, qty, unit, scrap_rate, remark FROM scm_bom_line WHERE bom_id=? AND line_type='component' ORDER BY seq").all(p.bom_id) as any[]
        let s = 0
        for (const bl of bomLines) { s++; insL.run(uuidv4(), aid, planId, productId, s, bl.item_code, Number(bl.qty) || 0, bl.unit ?? null, Number(bl.scrap_rate) || 0, bl.remark ?? null) }
      }
    }
    return productsMeta.length
  }

  let po = 0
  let outsource_plans = 0
  let self_plans = 0
  let outsource_products = 0
  let self_products = 0
  let assembly_docs = 0
  db.transaction(() => {
    const groups = new Map<string, any[]>()
    for (const line of purchaseLines) {
      const key = String(line.eff_supplier || '').trim()
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(line)
    }
    for (const [supplier, groupLines] of groups) {
      const poId = uuidv4()
      const docNo = nextDocNo(db, aid, 'PO')
      const staff = staffOf(supplier)   // 按供应商业务员自动填业务员+部门
      let totalQty = 0
      let totalAmount = 0
      for (const line of groupLines) {
        totalQty += Number(line.remain) || 0
        totalAmount += (Number(line.remain) || 0) * (Number(line.purchase_price) || 0)
      }
      db.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,partner_code,dept_code,biz_person,warehouse_code,operator,maker,status,source_doc_id,bom_id,total_qty,total_amount,remark)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        poId, aid, 'PO', docNo, today, supplier || null, staff.dept_code || null, staff.biz_person || null, null, userName(req), userName(req), 'draft', mr.id, null,
        r6(totalQty), Math.round(totalAmount * 100) / 100, `${sourceName} ${mr.doc_no} 采购`
      )
      const insLine = db.prepare(`INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,tax_rate,tax_amount,unit_cost,batch_no,source_line_id,remark)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      let seq = 0
      for (const line of groupLines) {
        seq++
        const qty = Number(line.remain) || 0
        const price = Number(line.purchase_price) || 0
        insLine.run(uuidv4(), aid, poId, seq, line.item_code, line.warehouse_code || null, qty, price, Math.round(qty * price * 100) / 100, null, 0, 0, null, sourceLineOf(line), null)
      }
      po++
    }
    // 自制按 BOM 层级分单；委外按“供应商 + BOM 层级”分单。
    const productionGroups = groupMrProductionPlanLines(
      [...selfLines, ...outsourceLines],
      generationPreview?.nodes || [],
    )
    for (const group of productionGroups) {
      const count = createMergedPlan(group.plan_type, group.supplier_code || null, group.lines)
      if (group.plan_type === 'self') {
        self_products += count
        self_plans++
      } else {
        outsource_products += count
        outsource_plans++
      }
    }
    // 组装：每个缺料成品 → 一张组装单（AS）草稿（成品行承载行级记账 + BOM 子件行）
    if (assemblyLines.length) {
      const insLine = prepareDocLineInsert(db)
      for (const line of assemblyLines) {
        const remain = Number(line.remain) || 0
        const fpWh = line.warehouse_code || null               // 成品入库仓（缺料行仓库兜底）
        const bomRow = line.bom_id
          ? { id: line.bom_id }
          : db.prepare("SELECT id FROM scm_bom WHERE account_set_id=? AND item_code=? AND status='active' ORDER BY is_default DESC,code LIMIT 1").get(aid, line.item_code) as any
        const bomId = bomRow?.id || null
        const bomLines = bomId
          ? db.prepare("SELECT item_code, qty, unit, scrap_rate, remark FROM scm_bom_line WHERE bom_id=? AND line_type='component' ORDER BY seq").all(bomId) as any[]
          : []
        const asId = uuidv4()
        const docNo = nextDocNo(db, aid, 'AS')
        db.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,partner_code,warehouse_code,operator,maker,status,source_doc_id,bom_id,total_qty,total_amount,remark)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          asId, aid, 'AS', docNo, today, null, fpWh, userName(req), userName(req), 'draft', mr.id, bomId,
          remain, 0, `${sourceName} ${mr.doc_no} 组装`
        )
        // 成品行（line_role=product，承载缺料行级记账）
        let seq = 0
        insLine.run(...buildDocLineRow(aid, asId, ++seq, {
          item_code: line.item_code, warehouse_code: fpWh, qty: remain, price: 0,
          source_line_id: sourceLineOf(line), line_role: 'product', unit: line.unit ?? null,
        }, fpWh).values)
        // 子件行（按 BOM 用量 × 成品数展开；无 BOM 则留空，用户进组装单手工加料/选 BOM 展开）
        for (const bl of bomLines) {
          insLine.run(...buildDocLineRow(aid, asId, ++seq, {
            item_code: bl.item_code, warehouse_code: null, qty: r6(remain * (Number(bl.qty) || 0)), price: 0,
            line_role: 'component', unit: bl.unit ?? null, scrap_rate: Number(bl.scrap_rate) || 0, remark: bl.remark ?? null,
          }, null).values)
        }
        assembly_docs++
      }
    }
  })()

  res.json({ code: 0, data: { needConfirm: false, po, outsource_plans, self_plans, outsource_products, self_products, assembly_docs } })
})

// ── 销售订单（SOa）库存处理 ───────────────────────────────
// 可用库存 = 现存量 − 其它已审核未发货销售订单占用（不含本单）；
// 缺口 = 剩余 − 可发，且扣减「本单已生成缺料单」的数量，避免重复补货。
router.post('/scm/docs/batch-availability', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  if (!req.permissions?.includes('*') && !req.permissions?.includes('scm:sale')) {
    return res.status(403).json({ code: 403, message: '无销售业务权限' })
  }
  let ids: string[]
  try { ids = normalizeBatchIds(req.body?.ids) }
  catch (error: any) { return res.status(400).json({ code: 400, message: error.message }) }
  const placeholders = ids.map(() => '?').join(',')
  const docs = db.prepare(`SELECT id,doc_no,doc_type,status,partner_code,COALESCE(NULLIF(currency,''),'CNY') currency,doc_date
    FROM scm_doc WHERE account_set_id=? AND id IN (${placeholders}) ORDER BY doc_date,doc_no`).all(aid, ...ids) as any[]
  if (docs.length !== ids.length) return res.status(404).json({ code: 404, message: '存在无效或不属于当前账套的销售订单' })
  try { validateBatchPushDocuments(docs) }
  catch (error: any) { return res.status(400).json({ code: 400, message: error.message }) }
  if (docs[0]?.doc_type !== 'SOa') return res.status(400).json({ code: 400, message: '仅销售订单可做批量库存计算' })

  const sourceLineIds = (db.prepare(`SELECT id FROM scm_doc_line WHERE account_set_id=? AND doc_id IN (${placeholders})`)
    .all(aid, ...ids) as any[]).map(line => String(line.id))
  const blockingDraft = findDraftDocumentUsingSourceLines(db, aid, 'SO', sourceLineIds)
  if (blockingDraft) return res.json({ code: 0, data: { docs, lines: [], existing_doc: blockingDraft } })

  const rows = db.prepare(`
    SELECT l.*, d.id AS source_doc_id, d.doc_no AS source_doc_no, d.doc_date AS source_doc_date,
           i.name AS item_name, i.spec, i.unit, w.name AS warehouse_name,
           COALESCE(s.qty,0) AS on_hand,
           COALESCE(NULLIF(l.source_type,''),i.source_type,'purchase') AS source_type,
           COALESCE(NULLIF(l.supplier_code,''),i.supplier_code) AS supplier_code,
           COALESCE(i.purchase_price,0) AS purchase_price,
           ((SELECT COALESCE(SUM(l2.qty-(SELECT COALESCE(SUM(srl.qty),0)
               FROM scm_doc_line srl JOIN scm_doc srd ON srd.id=srl.doc_id
               WHERE srl.source_line_id=l2.id AND srd.account_set_id=l.account_set_id
                 AND srd.doc_type='SR' AND srd.status='audited')),0)
             FROM scm_doc_line l2 JOIN scm_doc d2 ON d2.id=l2.doc_id
             WHERE l2.source_line_id=l.id AND d2.doc_type='SO' AND d2.status<>'voided')
             + (SELECT COALESCE(SUM(pp.plan_qty),0) FROM scm_production_plan_product pp WHERE pp.source_line_id=l.id)) AS pushed_qty,
           (SELECT COALESCE(SUM(ol.qty-(SELECT COALESCE(SUM(ol2.qty-(SELECT COALESCE(SUM(srl.qty),0)
               FROM scm_doc_line srl JOIN scm_doc srd ON srd.id=srl.doc_id
               WHERE srl.source_line_id=ol2.id AND srd.account_set_id=ol.account_set_id
                 AND srd.doc_type='SR' AND srd.status='audited')),0)
             FROM scm_doc_line ol2 JOIN scm_doc od2 ON od2.id=ol2.doc_id
             WHERE ol2.source_line_id=ol.id AND od2.doc_type='SO' AND od2.status<>'voided')),0)
              FROM scm_doc_line ol JOIN scm_doc od ON od.id=ol.doc_id
             WHERE od.account_set_id=l.account_set_id AND od.doc_type='SOa' AND od.status='audited'
               AND od.id NOT IN (${placeholders})
               AND ol.item_code=l.item_code AND IFNULL(ol.warehouse_code,'')=IFNULL(l.warehouse_code,'')) AS other_reserved
      FROM scm_doc_line l
      JOIN scm_doc d ON d.id=l.doc_id
      LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
      LEFT JOIN scm_stock s ON s.account_set_id=l.account_set_id AND s.item_code=l.item_code AND IFNULL(s.warehouse_code,'')=IFNULL(l.warehouse_code,'')
      LEFT JOIN scm_warehouse w ON w.account_set_id=l.account_set_id AND w.code=l.warehouse_code
     WHERE l.doc_id IN (${placeholders})
     ORDER BY d.doc_date,d.doc_no,l.seq
  `).all(...ids, ...ids) as any[]
  for (const row of rows) row.pushed_qty = computeSourceLineUsedQty(db, aid, 'SO', row.id)
  const mrRows = db.prepare(`SELECT ml.item_code,IFNULL(ml.warehouse_code,'') wh,COALESCE(SUM(ml.qty),0) qty
      FROM scm_doc_line ml JOIN scm_doc md ON md.id=ml.doc_id
     WHERE md.account_set_id=? AND md.doc_type='MR' AND md.source_doc_id IN (${placeholders})
     GROUP BY ml.item_code,IFNULL(ml.warehouse_code,'')`).all(aid, ...ids) as any[]
  const mrpRows = db.prepare(`SELECT s.item_code,IFNULL(json_extract(s.snapshot_json,'$.warehouse_code'),'') wh,
        COALESCE(SUM(s.allocated_net_qty),0) qty
      FROM scm_mrp_source s JOIN scm_doc d ON d.id=s.mrp_doc_id
     WHERE s.account_set_id=? AND s.source_kind='sales_order' AND s.source_id IN (${placeholders})
       AND d.doc_type='MRP' AND d.status IN ('draft','audited')
     GROUP BY s.item_code,IFNULL(json_extract(s.snapshot_json,'$.warehouse_code'),'')`).all(aid, ...ids) as any[]
  const policy = getScmOverrunPolicy(db, aid, 'sales')
  const lines = buildSalesOrderAvailabilityLines(rows, [...mrRows, ...mrpRows], { overrunRate: policy.enabled ? policy.rate : 0 })
  if (!hasBatchDispatchRemaining(lines)) return res.status(400).json({ code: 400, message: '选中订单已全部下推，没有剩余数量' })
  return res.json({ code: 0, data: { docs, lines } })
})

// 采购订单批量下推采购入库：按供应商和币别拆草稿，数量始终按来源行实时剩余量计算。
router.post('/scm/docs/batch-push-purchase', operationLog('采购订单批量下推采购入库', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  let ids: string[]
  try { ids = normalizeBatchIds(req.body?.ids) }
  catch (error: any) { return res.status(400).json({ code: 400, message: error.message }) }

  try {
    const result = db.transaction(() => {
      const placeholders = ids.map(() => '?').join(',')
      const docs = db.prepare(`${purchaseOrderPushSourceSql()} WHERE account_set_id=? AND id IN (${placeholders})`).all(aid, ...ids) as any[]
      if (docs.length !== ids.length) {
        throw Object.assign(new Error('选中采购订单已删除、无权限访问或不属于当前账套'), { stateKind: 'resource_missing' })
      }
      try { validateBatchPushDocuments(docs) }
      catch (error: any) { throw Object.assign(new Error(error.message), { stateKind: 'state_changed' }) }

      const sourceLines = db.prepare(`SELECT l.*,d.partner_code AS supplier_code,d.currency,d.doc_no AS source_doc_no
        FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
        WHERE l.account_set_id=? AND l.doc_id IN (${placeholders}) ORDER BY d.doc_no,l.seq`).all(aid, ...ids) as any[]
      for (const line of sourceLines) line.pushed_qty = computePushedQty(db, line.id)
      const groups = buildPurchaseReceiptDraftGroups(sourceLines)
      if (!groups.length) throw Object.assign(new Error('选中采购订单已全部下推，没有剩余数量'), { stateKind: 'state_changed' })

      const insLine = prepareDocLineInsert(db)
      const today = new Date().toISOString().slice(0, 10)
      return groups.map(group => {
        const id = uuidv4(); const docNo = nextDocNo(db, aid, 'PI')
        let totalQty = 0; let totalAmount = 0; let totalTax = 0
        const lines = group.lines.map(line => {
          const taxRate = Number(line.tax_rate) || 0
          return { ...line, tax_amount: round2((Number(line.qty) || 0) * (Number(line.price) || 0) * taxRate / 100) }
        })
        for (const line of lines) {
          const row = buildDocLineRow(aid, id, 0, line)
          totalQty += row.qty; totalAmount += row.amount
          totalTax += Number(line.tax_amount) || 0
        }
        db.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,partner_code,warehouse_code,operator,maker,status,source_doc_id,total_qty,total_amount,remark,currency,total_tax)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, aid, 'PI', docNo, today, group.partner_code, null, userName(req), userName(req), 'draft', null,
          r6(totalQty), round2(totalAmount), `采购订单批量下推`, group.currency, round2(totalTax),
        )
        let seq = 0
        for (const line of lines) {
          seq += 1
          const row = buildDocLineRow(aid, id, seq, line)
          insLine.run(...row.values)
        }
        return { id, doc_no: docNo, partner_code: group.partner_code, currency: group.currency }
      })
    })()
    return res.json({ code: 0, data: { created: result.length, docs: result } })
  } catch (error: any) {
    if (error?.stateKind === 'resource_missing') {
      return sendStateError(res, 'resource_missing', error.message, { resourceType: 'PO' })
    }
    if (error?.stateKind === 'state_changed') {
      return sendStateError(res, 'state_changed', error.message, { resourceType: 'PO' })
    }
    return res.status(400).json({ code: 400, message: error?.message || '采购订单批量下推失败' })
  }
})

router.get('/scm/docs/:id/availability', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!doc) return res.status(404).json({ code: 404, message: '单据不存在' })
  if (doc.doc_type !== 'SOa') return res.status(400).json({ code: 400, message: '仅销售订单可做库存处理' })
  if (doc.status !== 'audited') return res.status(400).json({ code: 400, message: '仅已审核的销售订单可做库存处理' })

  const rows = db.prepare(`
    SELECT l.*, i.name AS item_name, i.spec, i.unit, w.name AS warehouse_name,
           COALESCE(s.qty, 0) AS on_hand,
           COALESCE(NULLIF(l.source_type, ''), i.source_type, 'purchase') AS source_type,
           COALESCE(NULLIF(l.supplier_code, ''), i.supplier_code) AS supplier_code,
           COALESCE(i.purchase_price, 0) AS purchase_price,
           ((SELECT COALESCE(SUM(l2.qty-(SELECT COALESCE(SUM(srl.qty),0)
               FROM scm_doc_line srl JOIN scm_doc srd ON srd.id=srl.doc_id
               WHERE srl.source_line_id=l2.id AND srd.account_set_id=l.account_set_id
                 AND srd.doc_type='SR' AND srd.status='audited')),0)
             FROM scm_doc_line l2 JOIN scm_doc d2 ON d2.id=l2.doc_id
             WHERE l2.source_line_id=l.id AND d2.doc_type='SO' AND d2.status<>'voided')
             + (SELECT COALESCE(SUM(pp.plan_qty), 0) FROM scm_production_plan_product pp WHERE pp.source_line_id = l.id)) AS pushed_qty,
           (
             SELECT COALESCE(SUM(
               ol.qty - (SELECT COALESCE(SUM(ol2.qty-(SELECT COALESCE(SUM(srl.qty),0)
                 FROM scm_doc_line srl JOIN scm_doc srd ON srd.id=srl.doc_id
                 WHERE srl.source_line_id=ol2.id AND srd.account_set_id=ol.account_set_id
                   AND srd.doc_type='SR' AND srd.status='audited')),0)
                 FROM scm_doc_line ol2 JOIN scm_doc od2 ON od2.id=ol2.doc_id
                 WHERE ol2.source_line_id=ol.id AND od2.doc_type='SO' AND od2.status<>'voided')
             ), 0)
             FROM scm_doc_line ol
             JOIN scm_doc od ON od.id = ol.doc_id
             WHERE od.account_set_id = l.account_set_id
               AND od.doc_type = 'SOa' AND od.status = 'audited'
               AND od.id <> ?
               AND ol.item_code = l.item_code
               AND IFNULL(ol.warehouse_code, '') = IFNULL(l.warehouse_code, '')
           ) AS other_reserved
    FROM scm_doc_line l
    LEFT JOIN scm_item i ON i.account_set_id = l.account_set_id AND i.code = l.item_code
    LEFT JOIN scm_stock s ON s.account_set_id = l.account_set_id AND s.item_code = l.item_code AND IFNULL(s.warehouse_code, '') = IFNULL(l.warehouse_code, '')
    LEFT JOIN scm_warehouse w ON w.account_set_id = l.account_set_id AND w.code = l.warehouse_code
    WHERE l.doc_id = ?
    ORDER BY l.seq
  `).all(req.params.id, req.params.id) as any[]

  // 本单已生成缺料单的数量池（按 物料+仓库 汇总），用于扣减重复缺口
  const mrRows = db.prepare(`
    SELECT ml.item_code AS item_code, IFNULL(ml.warehouse_code, '') AS wh, COALESCE(SUM(ml.qty), 0) AS qty
    FROM scm_doc_line ml
    JOIN scm_doc md ON md.id = ml.doc_id
    WHERE md.account_set_id = ? AND md.doc_type = 'MR' AND md.source_doc_id = ?
    GROUP BY ml.item_code, IFNULL(ml.warehouse_code, '')
  `).all(aid, req.params.id) as any[]
  const mrpRows = db.prepare(`
    SELECT s.item_code, IFNULL(json_extract(s.snapshot_json,'$.warehouse_code'),'') AS wh,
           COALESCE(SUM(s.allocated_net_qty),0) AS qty
    FROM scm_mrp_source s JOIN scm_doc d ON d.id=s.mrp_doc_id
    WHERE s.account_set_id=? AND s.source_kind='sales_order' AND s.source_id=?
      AND d.doc_type='MRP' AND d.status IN ('draft','audited')
    GROUP BY s.item_code, IFNULL(json_extract(s.snapshot_json,'$.warehouse_code'),'')
  `).all(aid, req.params.id) as any[]
  const policy = getScmOverrunPolicy(db, aid, 'sales')
  const lines = buildSalesOrderAvailabilityLines(rows, [...mrRows, ...mrpRows], { overrunRate: policy.enabled ? policy.rate : 0 })

  // 本单已生成的缺料单（供前端防重复确认/跳转）
  const shortage_docs = db.prepare(`
    SELECT id, doc_no, status FROM scm_doc
    WHERE account_set_id = ? AND doc_type = 'MR' AND source_doc_id = ?
    ORDER BY doc_no
  `).all(aid, req.params.id) as any[]

  const mrp_docs = db.prepare(`SELECT DISTINCT d.id,d.doc_no,d.status
    FROM scm_mrp_source s JOIN scm_doc d ON d.id=s.mrp_doc_id
    WHERE s.account_set_id=? AND s.source_kind='sales_order' AND s.source_id=?
      AND d.doc_type='MRP' AND d.status IN ('draft','audited')
    ORDER BY d.doc_no`).all(aid, req.params.id) as any[]

  res.json({ code: 0, data: { doc, lines, shortage_docs, mrp_docs } })
})

// ── 单据上下游关联追溯 ───────────────────────────────────
// 上游：表头 source_doc_id + 行级 source_line_id 的父单（去重）。
// 下游：表头 source_doc_id + 行级 source_line_id 的子单（去重）+ 委外/生产计划（scm_production_plan.source_doc_id）。
router.get('/scm/docs/:id/downstream', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!doc) return res.status(404).json({ code: 404, message: '单据不存在' })

  // 取关联单据 id 集合（表头 source_doc_id + 行级 source_line_id，去重），再用列表富行查询补全字段。
  const idSet = (rows: any[]) => [...new Set(rows.map(r => r.id).filter(Boolean))]
  // 上游：表头父单 + 行级父单
  const upIds = idSet([
    ...(doc.source_doc_id ? [{ id: doc.source_doc_id }] : []),
    ...db.prepare(`SELECT DISTINCT pl.doc_id AS id FROM scm_doc_line l JOIN scm_doc_line pl ON pl.id = l.source_line_id WHERE l.doc_id = ? AND l.source_line_id IS NOT NULL`).all(req.params.id) as any[],
    ...db.prepare(`SELECT DISTINCT source_id AS id FROM scm_mrp_source WHERE account_set_id=? AND mrp_doc_id=? AND source_kind IN ('sales_order','assembly')`).all(aid, req.params.id) as any[],
  ])
  // 下游：表头子单 + 行级子单
  const downIds = idSet([
    ...db.prepare(`SELECT id FROM scm_doc WHERE account_set_id = ? AND source_doc_id = ?`).all(aid, req.params.id) as any[],
    ...db.prepare(`SELECT DISTINCT l.doc_id AS id FROM scm_doc_line l WHERE l.source_line_id IN (SELECT id FROM scm_doc_line WHERE doc_id = ?)`).all(req.params.id) as any[],
    ...db.prepare(`SELECT DISTINCT mrp_doc_id AS id FROM scm_mrp_source WHERE account_set_id=? AND source_id=?`).all(aid, req.params.id) as any[],
  ])
  const richByIds = (ids: string[]) => ids.length
    ? queryDocRows(db, `d.account_set_id=? AND d.id IN (${ids.map(() => '?').join(',')})`, [aid, ...ids],
        'ORDER BY d.doc_type, d.doc_no')
    : []
  const upstream_docs = richByIds(upIds)
  const downstream_docs = richByIds(downIds)

  const downstream_plans = db.prepare(`
    SELECT pp.id, pp.code, pp.plan_type, pp.item_code, i.name AS item_name, i.spec AS spec,
           pp.plan_qty, pp.supplier_code, pp.status, pp.start_date, pp.end_date, pp.remark
    FROM scm_production_plan pp
    LEFT JOIN scm_item i ON i.account_set_id = pp.account_set_id AND i.code = pp.item_code
    WHERE pp.account_set_id = ? AND pp.source_doc_id = ?
    ORDER BY pp.code
  `).all(aid, req.params.id) as any[]

  // 上游生产/委外计划：本单据挂在某工单名下（scm_doc.plan_id，领料/补料/完工/委外发货入库等均可能有）。
  // 与 downstream_plans（该单据下推生成了某工单）方向相反，两者互不冲突，同一单据一般只会命中其一。
  const upstream_plans = doc.plan_id ? db.prepare(`
    SELECT pp.id, pp.code, pp.plan_type, pp.item_code, i.name AS item_name, i.spec AS spec,
           pp.plan_qty, pp.supplier_code, pp.status, pp.start_date, pp.end_date, pp.remark
    FROM scm_production_plan pp
    LEFT JOIN scm_item i ON i.account_set_id = pp.account_set_id AND i.code = pp.item_code
    WHERE pp.account_set_id = ? AND pp.id = ?
  `).all(aid, doc.plan_id) as any[] : []

  res.json({ code: 0, data: { doc, upstream_docs, upstream_plans, downstream_docs, downstream_plans } })
})

router.get('/scm/boms/next-no', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const rows = db.prepare('SELECT code FROM scm_bom WHERE account_set_id=?').all(aid) as Array<{ code: string }>
  let maxNum = -1, width = 4, prefix = 'BOM'
  for (const r of rows) {
    const m = String(r.code || '').match(/^([A-Za-z\-_]*)(\d+)$/)
    if (m) {
      const n = parseInt(m[2], 10)
      if (n >= maxNum) { maxNum = n; width = m[2].length; prefix = m[1] }
    }
  }
  const nextNo = maxNum < 0 ? 'BOM0001' : prefix + String(maxNum + 1).padStart(width, '0')
  res.json({ code: 0, data: { next_no: nextNo } })
})
router.get('/scm/boms', (req: AuthRequest, res) => {
  const list = getDb().prepare('SELECT b.*, i.name AS item_name, i.spec AS spec FROM scm_bom b LEFT JOIN scm_item i ON i.account_set_id=b.account_set_id AND i.code=b.item_code WHERE b.account_set_id=? ORDER BY b.code').all(asid(req))
  res.json({ code: 0, data: list })
})
// BOM 反查（where-used）：某物料被哪些 BOM 用作子件（须先于 /scm/boms/:id 注册）
router.get('/scm/boms/where-used', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req); const { item_code } = req.query as any
  if (!item_code) return res.status(400).json({ code: 400, message: '请指定物料' })
  const rows = db.prepare(`SELECT b.id AS bom_id, b.code AS bom_code, b.name AS bom_name, b.version, b.item_code AS product_code,
      pi.name AS product_name, l.qty, l.unit, l.line_type, l.scrap_rate
    FROM scm_bom_line l JOIN scm_bom b ON b.id=l.bom_id
    LEFT JOIN scm_item pi ON pi.account_set_id=b.account_set_id AND pi.code=b.item_code
    WHERE l.account_set_id=? AND l.item_code=? ORDER BY b.code`).all(aid, item_code)
  res.json({ code: 0, data: rows })
})
// 写 BOM 明细行（含行类型/替代料组）——删旧重插
function writeBomLines(db: ReturnType<typeof getDb>, aid: string, bomId: string, lines: any[]) {
  db.prepare('DELETE FROM scm_bom_line WHERE bom_id=?').run(bomId)
  if (!Array.isArray(lines)) return
  const ins = db.prepare('INSERT INTO scm_bom_line (id,account_set_id,bom_id,seq,item_code,qty,unit,scrap_rate,remark,line_type,sub_group,sub_priority) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
  let seq = 0
  for (const l of lines) {
    if (!l || !l.item_code) continue
    seq++
    ins.run(uuidv4(), aid, bomId, seq, l.item_code, Number(l.qty) || 0, l.unit ?? null, Number(l.scrap_rate) || 0, l.remark ?? null, l.line_type || 'component', l.sub_group ?? null, Number(l.sub_priority) || 0)
  }
}
router.get('/scm/boms/:id', (req: AuthRequest, res) => {
  const db = getDb()
  const bom = db.prepare('SELECT * FROM scm_bom WHERE id=? AND account_set_id=?').get(req.params.id, asid(req))
  if (!bom) return res.status(404).json({ code: 404, message: 'BOM不存在' })
  const lines = db.prepare('SELECT l.*, i.name AS item_name, i.spec, i.unit FROM scm_bom_line l LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code WHERE l.bom_id=? ORDER BY l.seq').all(req.params.id)
  res.json({ code: 0, data: { ...(bom as any), lines } })
})
router.post('/scm/boms', operationLog('BOM新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!b.code || !b.item_code) return res.status(400).json({ code: 400, message: '编号和成品物料不能为空' })
  const id = uuidv4()
  db.transaction(() => {
    db.prepare('INSERT INTO scm_bom (id,account_set_id,code,name,item_code,status,version,effective_date,expire_date,is_default) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, asid(req), b.code, b.name ?? null, b.item_code, b.status || 'active', b.version || '1.0', b.effective_date ?? null, b.expire_date ?? null, b.is_default === 0 ? 0 : 1)
    writeBomLines(db, asid(req), id, b.lines)
  })()
  res.json({ code: 0, data: { id } })
})
router.put('/scm/boms/:id', operationLog('BOM修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body
  if (!db.prepare('SELECT id FROM scm_bom WHERE id=?').get(req.params.id)) return res.status(404).json({ code: 404, message: 'BOM不存在' })
  db.transaction(() => {
    db.prepare('UPDATE scm_bom SET name=?,item_code=?,status=?,version=?,effective_date=?,expire_date=?,is_default=? WHERE id=?')
      .run(b.name ?? null, b.item_code, b.status || 'active', b.version || '1.0', b.effective_date ?? null, b.expire_date ?? null, b.is_default === 0 ? 0 : 1, req.params.id)
    if (Array.isArray(b.lines)) writeBomLines(db, asid(req), req.params.id, b.lines)
  })()
  res.json({ code: 0, data: { ok: true } })
})
router.delete('/scm/boms/:id', operationLog('BOM删除', '供应链'), (req: AuthRequest, res) => {
  getDb().prepare('DELETE FROM scm_bom WHERE id=? AND account_set_id=?').run(req.params.id, asid(req))
  res.json({ code: 0, data: { ok: true } })
})

// ── 生产计划 CRUD ──────────────────────────────────────────────────
router.get('/scm/production-plans', (req: AuthRequest, res) => {
  // 成品摘要：product_count + 首成品名称/编号（多成品列表显示「成品A 等 N 项」）
  const list = getDb().prepare(`SELECT p.*, i.name AS item_name, i.spec AS spec, sp.name AS supplier_name,
      (SELECT COUNT(*) FROM scm_production_plan_product pp WHERE pp.plan_id=p.id) AS product_count,
      (SELECT COUNT(*) FROM scm_doc d WHERE d.account_set_id=p.account_set_id AND d.plan_id=p.id) AS doc_count,
      (SELECT s.mrp_doc_id FROM scm_mrp_source s JOIN scm_doc md ON md.id=s.mrp_doc_id
        WHERE s.account_set_id=p.account_set_id AND s.source_id=p.id AND s.source_kind IN ('production_plan','outsource_plan')
          AND md.status IN ('draft','audited') LIMIT 1) AS mrp_doc_id,
      (SELECT md.status FROM scm_mrp_source s JOIN scm_doc md ON md.id=s.mrp_doc_id
        WHERE s.account_set_id=p.account_set_id AND s.source_id=p.id AND s.source_kind IN ('production_plan','outsource_plan')
          AND md.status IN ('draft','audited') LIMIT 1) AS mrp_status,
      (SELECT md.doc_no FROM scm_mrp_source s JOIN scm_doc md ON md.id=s.mrp_doc_id
        WHERE s.account_set_id=p.account_set_id AND s.source_id=p.id AND s.source_kind IN ('production_plan','outsource_plan')
          AND md.status IN ('draft','audited') LIMIT 1) AS mrp_doc_no,
      (SELECT pp2.item_code FROM scm_production_plan_product pp2 WHERE pp2.plan_id=p.id ORDER BY pp2.seq LIMIT 1) AS first_product_code,
      (SELECT i2.name FROM scm_production_plan_product pp3 LEFT JOIN scm_item i2 ON i2.account_set_id=pp3.account_set_id AND i2.code=pp3.item_code WHERE pp3.plan_id=p.id ORDER BY pp3.seq LIMIT 1) AS first_product_name
    FROM scm_production_plan p
    LEFT JOIN scm_item i ON i.account_set_id=p.account_set_id AND i.code=p.item_code
    LEFT JOIN scm_partner sp ON sp.account_set_id=p.account_set_id AND sp.code=p.supplier_code
    WHERE p.account_set_id=? ORDER BY p.code DESC`).all(asid(req))
  res.json({ code: 0, data: list })
})
// ── MRP 计算单 ────────────────────────────────────────────────
// 旧即时全账套运算已退出业务流程，保留明确响应避免旧客户端静默得到错误口径。
router.get('/scm/mrp/run', (_req: AuthRequest, res) => {
  res.status(410).json({ code: 410, message: '即时MRP运算已停用，请创建MRP计算单并选择来源单据' })
})

// 销售订单、生产/委外计划、组装单的统一下推目标状态。
// 页面只负责展示和导航，真正生成时各写接口仍会再次校验，防止过期页面重复下推。
router.get('/scm/push-options', (req: AuthRequest, res) => {
  const kind = String(req.query.source_kind || '') as ScmPushSourceKind
  const sourceId = String(req.query.source_id || '')
  if (!['sales_order', 'production_plan', 'outsource_plan', 'assembly'].includes(kind)) {
    return res.status(400).json({ code: 400, message: '不支持的下推来源类型' })
  }
  if (!sourceId) return res.status(400).json({ code: 400, message: '缺少来源单据 ID' })
  try {
    res.json({ code: 0, data: { source_kind: kind, source_id: sourceId, actions: buildScmPushOptions(getDb(), asid(req), kind, sourceId) } })
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error?.message || '下推目标状态查询失败' })
  }
})

router.get('/scm/mrp-docs', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const { status, keyword = '', start_date, end_date } = req.query as any
  const conds = ["d.account_set_id=?", "d.doc_type='MRP'"]; const ps: any[] = [aid]
  if (status) { conds.push('d.status=?'); ps.push(status) }
  if (String(keyword).trim()) { conds.push('(d.doc_no LIKE ? OR d.remark LIKE ?)'); const like = `%${String(keyword).trim()}%`; ps.push(like, like) }
  if (start_date) { conds.push('d.doc_date>=?'); ps.push(start_date) }
  if (end_date) { conds.push('d.doc_date<=?'); ps.push(end_date) }
  const rows = db.prepare(`SELECT d.*,
      (SELECT COUNT(DISTINCT s.source_kind||':'||s.source_id) FROM scm_mrp_source s WHERE s.mrp_doc_id=d.id) source_count,
      (SELECT COUNT(*) FROM scm_doc_line l WHERE l.doc_id=d.id) result_count,
      (SELECT COALESCE(SUM(CAST(json_extract(l.field_values,'$.net_req') AS REAL)),0) FROM scm_doc_line l WHERE l.doc_id=d.id) net_qty,
      (SELECT COUNT(*) FROM scm_doc_line l WHERE l.doc_id=d.id) total_lines,
      (SELECT COUNT(*) FROM scm_doc_line l WHERE l.doc_id=d.id AND l.qty <= (
        (SELECT COALESCE(SUM(l2.qty),0) FROM scm_doc_line l2 WHERE l2.source_line_id=l.id)
        + (SELECT COALESCE(SUM(pp.plan_qty),0) FROM scm_production_plan_product pp WHERE pp.source_line_id=l.id))) fully_pushed_lines,
      (SELECT COUNT(*) FROM scm_doc_line l WHERE l.doc_id=d.id AND (
        (SELECT COALESCE(SUM(l2.qty),0) FROM scm_doc_line l2 WHERE l2.source_line_id=l.id)
        + (SELECT COALESCE(SUM(pp.plan_qty),0) FROM scm_production_plan_product pp WHERE pp.source_line_id=l.id)) > 0) pushed_lines,
      (SELECT id FROM scm_doc m WHERE m.account_set_id=d.account_set_id AND m.doc_type='MR' AND m.source_doc_id=d.id ORDER BY m.created_at LIMIT 1) shortage_doc_id,
      (SELECT doc_no FROM scm_doc m WHERE m.account_set_id=d.account_set_id AND m.doc_type='MR' AND m.source_doc_id=d.id ORDER BY m.created_at LIMIT 1) shortage_doc_no,
      (SELECT status FROM scm_doc m WHERE m.account_set_id=d.account_set_id AND m.doc_type='MR' AND m.source_doc_id=d.id ORDER BY m.created_at LIMIT 1) shortage_doc_status
    FROM scm_doc d WHERE ${conds.join(' AND ')} ORDER BY d.doc_date DESC,d.doc_no DESC`).all(...ps) as any[]
  res.json({ code: 0, data: rows.map(row => ({
    ...row,
    push_progress: pushProgressOf(row),
    field_values: (() => { try { return JSON.parse(row.field_values || '{}') } catch { return {} } })(),
  })) })
})

router.get('/scm/mrp-docs/source-options', (req: AuthRequest, res) => {
  try {
    const kind = String(req.query.kind || '') as MrpSourceKind
    const excludeOccupied = ['1', 'true'].includes(String(req.query.exclude_occupied || '').toLowerCase())
    const currentMrpId = String(req.query.current_mrp_id || '')
    res.json({ code: 0, data: listMrpSourceOptions(
      getDb(), asid(req), kind, String(req.query.keyword || ''), { excludeOccupied, currentMrpId },
    ) })
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error?.message || 'MRP来源查询失败' })
  }
})

router.post('/scm/mrp-docs', operationLog('MRP计算单新增', '供应链'), (req: AuthRequest, res) => {
  try { res.json({ code: 0, data: createMrpDocument(getDb(), asid(req), userName(req), req.body || {}) }) }
  catch (error: any) { res.status(400).json({ code: 400, message: error?.message || 'MRP计算单创建失败' }) }
})

router.get('/scm/mrp-docs/:id', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare("SELECT * FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='MRP'").get(req.params.id, aid) as any
  if (!doc) return sendStateError(res, 'resource_missing', 'MRP计算单不存在', { resourceType: 'MRP', resourceId: req.params.id })
  const sourceDetails = getMrpDocumentSourceDetails(db, aid, doc.id)
  const lines = db.prepare(`SELECT l.*,i.name item_name,i.spec,i.unit FROM scm_doc_line l
    LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    WHERE l.account_set_id=? AND l.doc_id=? ORDER BY l.seq`).all(aid, doc.id) as any[]
  const shortage = db.prepare("SELECT id,doc_no,status FROM scm_doc WHERE account_set_id=? AND doc_type='MR' AND source_doc_id=? ORDER BY created_at LIMIT 1").get(aid, doc.id) as any
  const parse = (value: any) => { try { return JSON.parse(value || '{}') } catch { return {} } }
  const progressRow = {
    total_lines: lines.length,
    pushed_lines: lines.filter(line => computePushedQty(db, line.id) > 0).length,
    fully_pushed_lines: lines.filter(line => computePushedQty(db, line.id) >= Number(line.qty || 0)).length,
  }
  res.json({ code: 0, data: {
    doc: { ...doc, push_progress: pushProgressOf(progressRow), field_values: parse(doc.field_values) },
    source_refs: currentMrpSourceRefs(db, aid, doc.id),
    source_summaries: sourceDetails.source_summaries,
    sources: sourceDetails.sources,
    lines: lines.map(line => ({ ...line, field_values: parse(line.field_values) })), shortage_doc: shortage || null,
  } })
})

router.put('/scm/mrp-docs/:id', operationLog('MRP计算单修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req); const body = req.body || {}
  const doc = db.prepare("SELECT * FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='MRP'").get(req.params.id, aid) as any
  if (!doc) return sendStateError(res, 'resource_missing', 'MRP计算单不存在', { resourceType: 'MRP', resourceId: req.params.id })
  if (doc.status !== 'draft') return sendStateError(res, 'state_changed', 'MRP计算单状态已变化，不能修改', { resourceType: 'MRP', resourceId: req.params.id, currentStatus: doc.status })
  try {
    db.transaction(() => {
      const oldFields = (() => { try { return JSON.parse(doc.field_values || '{}') } catch { return {} } })()
      const fields = {
        ...applyMrpAdjustments(db, aid, doc.id, oldFields, body),
        include_safety_stock: body.include_safety_stock !== false,
        calculated_at: null,
      }
      db.prepare("UPDATE scm_doc SET doc_date=?,remark=?,field_values=?,updated_at=datetime('now') WHERE id=?").run(body.doc_date || doc.doc_date, body.remark ?? doc.remark, JSON.stringify(fields), doc.id)
      if (Array.isArray(body.sources)) replaceMrpSources(db, aid, doc.id, body.sources)
      db.prepare('DELETE FROM scm_doc_line WHERE doc_id=? AND account_set_id=?').run(doc.id, aid)
      db.prepare('UPDATE scm_doc SET total_qty=0,total_amount=0 WHERE id=?').run(doc.id)
    })()
    res.json({ code: 0, data: { ok: true } })
  } catch (error: any) { res.status(400).json({ code: 400, message: error?.message || 'MRP计算单保存失败' }) }
})

router.post('/scm/mrp-docs/:id/calculate', operationLog('MRP计算', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare("SELECT status FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='MRP'").get(req.params.id, aid) as any
  if (!doc) return sendStateError(res, 'resource_missing', 'MRP计算单不存在', { resourceType: 'MRP', resourceId: req.params.id })
  if (doc.status !== 'draft') return sendStateError(res, 'state_changed', 'MRP计算单状态已变化，不能重新计算', { resourceType: 'MRP', resourceId: req.params.id, currentStatus: doc.status })
  try { res.json({ code: 0, data: calculateMrpDocument(db, aid, req.params.id) }) }
  catch (error: any) { res.status(400).json({ code: 400, message: error?.message || 'MRP计算失败' }) }
})

router.post('/scm/mrp-docs/:id/audit', operationLog('MRP计算单审核', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare("SELECT status FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='MRP'").get(req.params.id, aid) as any
  if (!doc) return sendStateError(res, 'resource_missing', 'MRP计算单不存在', { resourceType: 'MRP', resourceId: req.params.id })
  if (doc.status !== 'draft') return sendStateError(res, 'state_changed', 'MRP计算单状态已变化，不能审核', { resourceType: 'MRP', resourceId: req.params.id, currentStatus: doc.status })
  try {
    const result = db.transaction(() => {
      const calculated = calculateMrpDocument(db, aid, req.params.id)
      if (calculated.has_cycle) throw new Error(`BOM存在循环：${calculated.cycles.map(c => c.join(' → ')).join('；')}`)
      const changed = db.prepare("UPDATE scm_doc SET status='audited',auditor=?,audited_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND account_set_id=? AND doc_type='MRP' AND status='draft'").run(userName(req), req.params.id, aid)
      if (!changed.changes) throw new Error('MRP计算单状态已变化，请刷新后重试')
      return calculated
    })()
    res.json({ code: 0, data: { ok: true, ...result } })
  } catch (error: any) { res.status(400).json({ code: 400, message: error?.message || 'MRP计算单审核失败' }) }
})

router.post('/scm/mrp-docs/:id/unaudit', operationLog('MRP计算单反审核', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare("SELECT status FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='MRP'").get(req.params.id, aid) as any
  if (!doc) return sendStateError(res, 'resource_missing', 'MRP计算单不存在', { resourceType: 'MRP', resourceId: req.params.id })
  if (doc.status !== 'audited') return sendStateError(res, 'state_changed', 'MRP计算单状态已变化，不能反审核', { resourceType: 'MRP', resourceId: req.params.id, currentStatus: doc.status })
  const downstream = db.prepare('SELECT id,doc_no,doc_type FROM scm_doc WHERE account_set_id=? AND source_doc_id=? LIMIT 1').get(aid, req.params.id) as any
  if (downstream) return sendStateError(res, 'state_changed', `已生成下游单据 ${downstream.doc_no}，不能反审核`, { resourceType: 'MRP', resourceId: req.params.id, currentStatus: doc.status })
  const downstreamPlan = db.prepare('SELECT id,code FROM scm_production_plan WHERE account_set_id=? AND source_doc_id=? LIMIT 1').get(aid, req.params.id) as any
  if (downstreamPlan) return sendStateError(res, 'state_changed', `已生成下游计划 ${downstreamPlan.code}，不能反审核`, { resourceType: 'MRP', resourceId: req.params.id, currentStatus: doc.status })
  db.prepare("UPDATE scm_doc SET status='draft',auditor=NULL,audited_at=NULL,updated_at=datetime('now') WHERE id=?").run(req.params.id)
  res.json({ code: 0, data: { ok: true } })
})

router.post('/scm/mrp-docs/:id/gen-shortage', operationLog('MRP生成缺料单（旧接口）', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const mrp = db.prepare("SELECT id FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='MRP'").get(req.params.id, aid)
  if (!mrp) return sendStateError(res, 'resource_missing', 'MRP计算单不存在', { resourceType: 'MRP', resourceId: req.params.id })
  const existing = db.prepare("SELECT id,doc_no,status FROM scm_doc WHERE account_set_id=? AND doc_type='MR' AND source_doc_id=? ORDER BY created_at LIMIT 1").get(aid, req.params.id) as any
  if (existing) return res.json({ code: 0, data: { ...existing, reused: true } })
  return sendStateError(res, 'workflow_replaced', 'MRP 已升级为直接预览并下推流程', {
    resourceType: 'MRP', resourceId: req.params.id,
    suggestedRoute: { name: 'ScmMrPushPreview', params: { id: req.params.id } },
  })
})

router.delete('/scm/mrp-docs/:id', operationLog('MRP计算单删除', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare("SELECT status FROM scm_doc WHERE id=? AND account_set_id=? AND doc_type='MRP'").get(req.params.id, aid) as any
  if (!doc) return sendStateError(res, 'resource_missing', 'MRP计算单不存在', { resourceType: 'MRP', resourceId: req.params.id })
  if (doc.status !== 'draft') return sendStateError(res, 'state_changed', 'MRP计算单状态已变化，不能删除', { resourceType: 'MRP', resourceId: req.params.id, currentStatus: doc.status })
  const downstream = db.prepare('SELECT id FROM scm_doc WHERE account_set_id=? AND source_doc_id=? LIMIT 1').get(aid, req.params.id)
  if (downstream) return res.status(400).json({ code: 400, message: 'MRP计算单已被下游引用，不可删除' })
  const downstreamPlan = db.prepare('SELECT id FROM scm_production_plan WHERE account_set_id=? AND source_doc_id=? LIMIT 1').get(aid, req.params.id)
  if (downstreamPlan) return res.status(400).json({ code: 400, message: 'MRP计算单已被下游计划引用，不可删除' })
  db.prepare('DELETE FROM scm_doc WHERE id=? AND account_set_id=?').run(req.params.id, aid)
  res.json({ code: 0, data: { ok: true } })
})
// 标准成本差异分析：区间内完工成品 标准(BOM+工艺卷算) vs 实际(完工入库料/人工/制费) 差异
router.get('/scm/report/cost-variance', (req: AuthRequest, res) => {
  const { start_date, end_date } = req.query as any
  res.json({ code: 0, data: getCostVariance(getDb(), asid(req), start_date, end_date) })
})
// 齐套分析（须在 /:id 之前注册）：对已下达工单，展开 BOM 物料需求 vs 现有库存，算齐套率与缺口。
// 注：各工单独立按全量现有库存核算（不做跨工单库存竞争分配），用于单工单可投产判断。
router.get('/scm/production-plans/kitting', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const { plan_type } = req.query as any
  const conds = ["account_set_id=?", "status='released'"]; const ps: any[] = [aid]
  if (plan_type) { conds.push('plan_type=?'); ps.push(plan_type) }
  const plans = db.prepare(`SELECT * FROM scm_production_plan WHERE ${conds.join(' AND ')} ORDER BY priority DESC, code`).all(...ps) as any[]
  const stockOf = (code: string) => (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM scm_stock WHERE account_set_id=? AND item_code=?').get(aid, code) as any)?.q || 0
  const result = plans.map(plan => {
    const mats = computeIssueSuggestion(db, aid, plan)
      .filter((m: any) => (Number(m.suggest) || 0) > 0.0001)   // 待领(未领足)才纳入齐套判断
      .map((m: any) => {
        const need = round2(Number(m.suggest) || 0)             // 尚需领料量
        const available = round2(Number(stockOf(m.item_code)) || 0)
        const shortage = round2(Math.max(0, need - available))
        const rate = need > 0 ? Math.min(1, available / need) : 1
        return { item_code: m.item_code, item_name: m.item_name, unit: m.unit, need, available, shortage, rate: Math.round(rate * 10000) / 100 }
      })
    const shortageKinds = mats.filter((m: any) => m.shortage > 0.0001).length
    const kittingRate = mats.length ? Math.round(Math.min(...mats.map((m: any) => m.rate)) * 100) / 100 : 100
    return {
      plan_id: plan.id, plan_code: plan.code, plan_type: plan.plan_type,
      item_code: plan.item_code, plan_qty: plan.plan_qty, priority: plan.priority,
      material_kinds: mats.length, shortage_kinds: shortageKinds,
      kitting_rate: kittingRate, is_kitted: shortageKinds === 0, materials: mats,
    }
  })
  res.json({ code: 0, data: result })
})
// 计划号取号（须在 /:id 之前注册，避免被动态路由吞掉）：生产 PP-、委外 OUT-
router.get('/scm/production-plans/next-no', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const planType = (req.query.plan_type as string) === 'outsource' ? 'outsource' : 'self'
  const now = new Date()
  const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${planType === 'outsource' ? 'OUT' : 'PP'}-`
  const rows = db.prepare('SELECT code FROM scm_production_plan WHERE account_set_id=? AND code LIKE ?').all(aid, `${prefix}%`) as any[]
  let max = 0
  for (const r of rows) { const m = String(r.code || '').match(/-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)) }
  res.json({ code: 0, data: { next_no: `${prefix}${String(max + 1).padStart(3, '0')}` } })
})

// ── 工单「一单多成品」CRUD 辅助 ───────────────────────────────────
/** 把请求 body 归一为成品数组：优先 products[]；兼容旧单成品 body（头 item_code 包成一条） */
function normalizePlanProducts(b: any): any[] {
  if (Array.isArray(b?.products)) return b.products
  if (b?.item_code) return [{ item_code: b.item_code, plan_qty: b.plan_qty, bom_id: b.bom_id, fp_warehouse: b.fp_warehouse, lines: b.lines }]
  return []
}

/** 写入工单成品明细 + 各成品原料用料（删旧重插，连带原料行）。 */
function writePlanProducts(db: ReturnType<typeof getDb>, aid: string, planId: string, products: any[]) {
  db.prepare('DELETE FROM scm_production_plan_line WHERE plan_id=?').run(planId)
  db.prepare('DELETE FROM scm_production_plan_product WHERE plan_id=?').run(planId)
  if (!Array.isArray(products)) return
  const insP = db.prepare(`INSERT INTO scm_production_plan_product
    (id,account_set_id,plan_id,seq,item_code,plan_qty,bom_id,fp_warehouse,finished_qty,scrap_qty,remark,source_line_id,source_doc_id,process_fee,process_tax_rate)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const insL = db.prepare(`INSERT INTO scm_production_plan_line
    (id,account_set_id,plan_id,product_id,seq,item_code,qty,unit,scrap_rate,remark,warehouse_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  let pseq = 0
  for (const p of products) {
    if (!p || !p.item_code || !(Number(p.plan_qty) > 0)) continue
    pseq++
    const productId = uuidv4()
    insP.run(productId, aid, planId, pseq, p.item_code, Number(p.plan_qty) || 0, p.bom_id ?? null,
      p.fp_warehouse ?? null, Number(p.finished_qty) || 0, Number(p.scrap_qty) || 0, p.remark ?? null,
      p.source_line_id ?? null, p.source_doc_id ?? null, Number(p.process_fee) || 0, Number(p.process_tax_rate) || 0)
    let lseq = 0
    for (const l of (Array.isArray(p.lines) ? p.lines : [])) {
      if (!l || !l.item_code || !(Number(l.qty) > 0)) continue
      lseq++
      insL.run(uuidv4(), aid, planId, productId, lseq, l.item_code, Number(l.qty) || 0, l.unit ?? null,
        Number(l.scrap_rate) || 0, l.remark ?? null, l.warehouse_code || null)
    }
  }
}

/** 读工单成品明细（每个成品带其原料用料行；成品无料但有 bom_id 时只读展开主 BOM 兜底）。 */
function getPlanProducts(db: ReturnType<typeof getDb>, aid: string, planId: string): any[] {
  const products = db.prepare(`SELECT pp.*, i.name AS item_name, i.spec AS spec, i.unit AS item_unit,
      b.name AS bom_name, w.name AS fp_warehouse_name
    FROM scm_production_plan_product pp
    LEFT JOIN scm_item i ON i.account_set_id=pp.account_set_id AND i.code=pp.item_code
    LEFT JOIN scm_bom b ON b.id=pp.bom_id
    LEFT JOIN scm_warehouse w ON w.account_set_id=pp.account_set_id AND w.code=pp.fp_warehouse
    WHERE pp.plan_id=? AND pp.account_set_id=? ORDER BY pp.seq`).all(planId, aid) as any[]
  const getLines = db.prepare(`SELECT l.*, i.name AS item_name, i.spec AS spec, w.name AS warehouse_name
    FROM scm_production_plan_line l
    LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
    LEFT JOIN scm_warehouse w ON w.account_set_id=l.account_set_id AND w.code=l.warehouse_code
    WHERE l.product_id=? ORDER BY l.seq`)
  for (const p of products) {
    p.bom_lines = getLines.all(p.id) as any[]
    if (!p.bom_lines.length && p.bom_id) {
      p.bom_lines = db.prepare("SELECT l.*, i.name AS item_name, i.spec AS spec FROM scm_bom_line l LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code WHERE l.bom_id=? AND l.line_type='component' ORDER BY l.seq").all(p.bom_id) as any[]
    }
  }
  return products
}

router.post('/scm/production-plans', operationLog('生产计划新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body; const aid = asid(req)
  const products = normalizePlanProducts(b)
  if (!b.code) return res.status(400).json({ code: 400, message: '计划号不能为空' })
  if (!products.length) return res.status(400).json({ code: 400, message: '请至少添加一个成品（成品与计划数必填）' })
  if ((b.plan_type || 'self') === 'outsource' && !b.supplier_code) return res.status(400).json({ code: 400, message: '委外计划必须选择委外厂' })
  // 头级 legacy 列取「首成品」做代表 + plan_qty 汇总，供旧读取路径兜底；权威数据在成品明细表
  const head = products[0]
  const totalQty = products.reduce((s: number, p: any) => s + (Number(p.plan_qty) || 0), 0)
  const id = uuidv4()
  db.transaction(() => {
    db.prepare(`INSERT INTO scm_production_plan
      (id,account_set_id,code,item_code,plan_qty,start_date,end_date,status,remark,bom_id,dept_code,priority,yl_warehouse,fp_warehouse,plan_type,supplier_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, aid, b.code, head.item_code, totalQty, b.start_date ?? null, b.end_date ?? null,
      b.status || 'draft', b.remark ?? null, head.bom_id ?? null, b.dept_code ?? null, Number(b.priority) || 0,
      b.yl_warehouse ?? null, head.fp_warehouse ?? b.fp_warehouse ?? null, b.plan_type || 'self', b.supplier_code ?? null
    )
    writePlanProducts(db, aid, id, products)
  })()
  res.json({ code: 0, data: { id } })
})

// 编辑生产计划（仅草稿可改；已下达/已关闭工单禁改，避免改动计划数/BOM 引起成本与在制错乱）
router.put('/scm/production-plans/:id', operationLog('生产计划修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req); const b = req.body
  const p = db.prepare('SELECT id, status FROM scm_production_plan WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!p) return res.status(404).json({ code: 404, message: '计划不存在' })
  if ((p.status || 'draft') !== 'draft') return res.status(400).json({ code: 400, message: '仅草稿计划可编辑（已审核/已关闭工单不可修改）' })
  const products = normalizePlanProducts(b)
  if (!products.length) return res.status(400).json({ code: 400, message: '请至少添加一个成品（成品与计划数必填）' })
  if ((b.plan_type || 'self') === 'outsource' && !b.supplier_code) return res.status(400).json({ code: 400, message: '委外计划必须选择委外厂' })
  const existingProducts = db.prepare(
    'SELECT id,item_code,source_line_id,source_doc_id FROM scm_production_plan_product WHERE plan_id=? AND account_set_id=? ORDER BY seq'
  ).all(req.params.id, aid) as Array<{ id: string; item_code: string; source_line_id: string | null; source_doc_id: string | null }>
  const lineage = restorePlanProductLineage(products, existingProducts)
  if (lineage.unmatchedSourceProductIds.length) {
    return res.status(400).json({ code: 400, message: '该工单由上游单据下推生成，来源成品不可删除或改成其他物料；请刷新页面后重试' })
  }
  const head = products[0]
  const totalQty = products.reduce((s: number, x: any) => s + (Number(x.plan_qty) || 0), 0)
  db.transaction(() => {
    db.prepare(`UPDATE scm_production_plan SET
      item_code=?, plan_qty=?, bom_id=?, dept_code=?, priority=?, yl_warehouse=?, fp_warehouse=?, start_date=?, end_date=?, supplier_code=?, remark=?
      WHERE id=? AND account_set_id=?`).run(
      head.item_code, totalQty, head.bom_id ?? null, b.dept_code ?? null, Number(b.priority) || 0,
      b.yl_warehouse ?? null, head.fp_warehouse ?? b.fp_warehouse ?? null, b.start_date ?? null, b.end_date ?? null, b.supplier_code ?? null, b.remark ?? null,
      req.params.id, aid
    )
    writePlanProducts(db, aid, req.params.id, products)
  })()
  res.json({ code: 0, data: { ok: true } })
})

/** 每料净领单价 = (Σ PL/PB/WO 出金额 − Σ PJ 入金额) ÷ 净领数量。供按成品 BOM 上卷完工成本。 */
export function getMaterialIssueUnitCost(db: ReturnType<typeof getDb>, aid: string, planId: string): Map<string, number> {
  const rows = db.prepare(`
    SELECT m.item_code AS item_code,
      COALESCE(SUM(CASE WHEN m.direction='out' THEN m.qty ELSE -m.qty END),0) AS qty,
      COALESCE(SUM(CASE WHEN m.direction='out' THEN m.amount ELSE -m.amount END),0) AS amt
    FROM scm_stock_move m
    JOIN scm_doc d ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
    WHERE d.account_set_id=? AND d.plan_id=? AND d.doc_type IN ('PL','PB','WO','PJ')
    GROUP BY m.item_code
  `).all(aid, planId) as any[]
  const map = new Map<string, number>()
  for (const r of rows) {
    const qty = Number(r.qty) || 0
    map.set(r.item_code, qty > 0 ? (Number(r.amt) || 0) / qty : 0)
  }
  return map
}

/** 每料已领用净数量 = Σ(PL/PB/WO 出 − PJ 入) 已审核库存移动，按物料汇总（工单级池化，同料多成品共享）。 */
export function getPlanIssuedQtyByItem(db: ReturnType<typeof getDb>, aid: string, planId: string): Map<string, number> {
  const rows = db.prepare(`
    SELECT m.item_code AS item_code,
      COALESCE(SUM(CASE WHEN m.direction='out' THEN m.qty ELSE -m.qty END),0) AS qty
    FROM scm_stock_move m
    JOIN scm_doc d ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
    WHERE d.account_set_id=? AND d.plan_id=? AND d.doc_type IN ('PL','PB','WO','PJ')
    GROUP BY m.item_code
  `).all(aid, planId) as any[]
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.item_code, r6(Number(r.qty) || 0))
  return map
}

/** 某成品「每件料成本」= Σ(其 BOM 原料 每件用量×(1+损耗) × 该料净领单价)。 */
export function productMaterialUnitCost(db: ReturnType<typeof getDb>, productId: string, issueUnitCost: Map<string, number>): number {
  const lines = db.prepare('SELECT item_code, qty, scrap_rate FROM scm_production_plan_line WHERE product_id=?').all(productId) as any[]
  let c = 0
  for (const l of lines) {
    const per = (Number(l.qty) || 0) * (1 + (Number(l.scrap_rate) || 0) / 100)
    c += per * (issueUnitCost.get(l.item_code) || 0)
  }
  return c
}

// 工单成本归集（按 plan_id 汇总已审核库存移动）：领料/补料/委外发货(出) − 退料(入) = 已领料成本；完工/委外入库(入) = 已结转。
// 多成品：已领按物料池化；完工成本按各成品 BOM·净领单价上卷；WIP = 已领 − Σ(各成品 已完工数×每件料成本)。
export function getPlanCostSummary(db: ReturnType<typeof getDb>, aid: string, planId: string, planQtyLegacy: number) {
  const sumMove = (typesAndDir: string) => {
    const row = db.prepare(`
      SELECT COALESCE(SUM(m.amount),0) AS amt, COALESCE(SUM(m.qty),0) AS qty
      FROM scm_stock_move m
      JOIN scm_doc d ON d.account_set_id=m.account_set_id AND d.doc_type=m.doc_type AND d.doc_no=m.doc_no
      WHERE d.account_set_id=? AND d.plan_id=? ${typesAndDir}
    `).get(aid, planId) as any
    return { amt: Number(row?.amt) || 0, qty: Number(row?.qty) || 0 }
  }
  const issued = sumMove("AND d.doc_type IN ('PL','PB','WO') AND m.direction='out'")
  const returned = sumMove("AND d.doc_type='PJ' AND m.direction='in'")
  // 不良品(PS) 与完工(PF/WI) 同样是把料从在制转出，一并计入「已结转」
  const finished = sumMove("AND d.doc_type IN ('PF','WI','PS') AND m.direction='in'")
  const issuedCost = round2(issued.amt - returned.amt)
  const finishedCost = round2(finished.amt)
  const issueUnitCost = getMaterialIssueUnitCost(db, aid, planId)
  // 各成品：已完工料消耗 = 已完工数 × 每件料成本（BOM 上卷）
  const products = db.prepare('SELECT id, item_code, plan_qty, finished_qty, COALESCE(scrap_qty,0) AS scrap_qty, labor_absorbed, overhead_absorbed FROM scm_production_plan_product WHERE plan_id=? AND account_set_id=? ORDER BY seq').all(planId, aid) as any[]
  let totalPlanQty = 0
  let consumedCost = 0
  let laborAbsorbed = 0, overheadAbsorbed = 0
  const productCost = products.map(p => {
    const planQ = Number(p.plan_qty) || 0
    const fin = Number(p.finished_qty) || 0
    const scrapped = Number(p.scrap_qty) || 0
    totalPlanQty += planQ
    const matUnit = round2(productMaterialUnitCost(db, p.id, issueUnitCost))
    // 已消耗 = (已完工 + 已报废) × 每件料成本；报废也实实在在吃掉了料
    const consumed = round2((fin + scrapped) * matUnit)
    consumedCost = round2(consumedCost + consumed)
    laborAbsorbed = round2(laborAbsorbed + (Number(p.labor_absorbed) || 0))
    overheadAbsorbed = round2(overheadAbsorbed + (Number(p.overhead_absorbed) || 0))
    return { product_id: p.id, item_code: p.item_code, plan_qty: planQ, finished_qty: fin, scrap_qty: scrapped, mat_unit_cost: matUnit, consumed_cost: consumed }
  })
  if (!totalPlanQty) totalPlanQty = Number(planQtyLegacy) || 0
  const unitCost = totalPlanQty > 0 ? round2(issuedCost / totalPlanQty) : 0
  const wip = round2(issuedCost - consumedCost)
  // 报工人工/制费合计（工单成本统计，独立于成品库存单价）
  const laborOh = getPlanLaborOverhead(db, aid, planId)
  let laborTotal = 0, overheadTotal = 0
  for (const v of laborOh.values()) { laborTotal = round2(laborTotal + v.labor); overheadTotal = round2(overheadTotal + v.overhead) }
  // 人工/制费 已结转进成品成本(absorbed) vs 报工累计；差额为「人工/制费在制」
  const laborWip = round2((laborTotal + overheadTotal) - (laborAbsorbed + overheadAbsorbed))
  return { issuedCost, finishedCost, finishedQty: finished.qty, wip, unitCost, totalPlanQty, issueUnitCost, products: productCost,
    laborTotal, overheadTotal, laborAbsorbed, overheadAbsorbed, laborWip }
}

/** 工单各成品 已审核报工的人工/制费合计（product_id 为空的计划级报工按 plan_qty 分摊到各成品）。 */
export function getPlanLaborOverhead(db: ReturnType<typeof getDb>, aid: string, planId: string): Map<string, { labor: number; overhead: number }> {
  const rows = db.prepare(`SELECT product_id, COALESCE(SUM(labor_amount),0) labor, COALESCE(SUM(overhead_amount),0) overhead
    FROM scm_work_report WHERE account_set_id=? AND plan_id=? AND status='audited' GROUP BY product_id`).all(aid, planId) as any[]
  const byProduct = new Map<string, { labor: number; overhead: number }>()
  let plLabor = 0, plOverhead = 0
  for (const r of rows) {
    if (r.product_id) byProduct.set(r.product_id, { labor: Number(r.labor) || 0, overhead: Number(r.overhead) || 0 })
    else { plLabor += Number(r.labor) || 0; plOverhead += Number(r.overhead) || 0 }
  }
  if (plLabor || plOverhead) {
    const prods = db.prepare('SELECT id, plan_qty FROM scm_production_plan_product WHERE plan_id=? AND account_set_id=?').all(planId, aid) as any[]
    const totalQ = prods.reduce((s, p) => s + (Number(p.plan_qty) || 0), 0) || 1
    for (const p of prods) {
      const share = (Number(p.plan_qty) || 0) / totalQ
      const cur = byProduct.get(p.id) || { labor: 0, overhead: 0 }
      cur.labor = round2(cur.labor + plLabor * share); cur.overhead = round2(cur.overhead + plOverhead * share)
      byProduct.set(p.id, cur)
    }
  }
  return byProduct
}

// 工单详情：计划 + BOM 用料 + 已领/完工单据 + 成本归集
router.get('/scm/production-plans/:id', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const plan = db.prepare(`SELECT p.*, i.name AS item_name, i.unit AS item_unit,
      ylw.name AS yl_warehouse_name, fpw.name AS fp_warehouse_name, sp.name AS supplier_name,
      (SELECT s.mrp_doc_id FROM scm_mrp_source s JOIN scm_doc md ON md.id=s.mrp_doc_id
        WHERE s.account_set_id=p.account_set_id AND s.source_id=p.id AND s.source_kind IN ('production_plan','outsource_plan')
          AND md.status IN ('draft','audited') LIMIT 1) AS mrp_doc_id,
      (SELECT md.status FROM scm_mrp_source s JOIN scm_doc md ON md.id=s.mrp_doc_id
        WHERE s.account_set_id=p.account_set_id AND s.source_id=p.id AND s.source_kind IN ('production_plan','outsource_plan')
          AND md.status IN ('draft','audited') LIMIT 1) AS mrp_status,
      (SELECT md.doc_no FROM scm_mrp_source s JOIN scm_doc md ON md.id=s.mrp_doc_id
        WHERE s.account_set_id=p.account_set_id AND s.source_id=p.id AND s.source_kind IN ('production_plan','outsource_plan')
          AND md.status IN ('draft','audited') LIMIT 1) AS mrp_doc_no
    FROM scm_production_plan p
    LEFT JOIN scm_item i ON i.account_set_id=p.account_set_id AND i.code=p.item_code
    LEFT JOIN scm_warehouse ylw ON ylw.account_set_id=p.account_set_id AND ylw.code=p.yl_warehouse
    LEFT JOIN scm_warehouse fpw ON fpw.account_set_id=p.account_set_id AND fpw.code=p.fp_warehouse
    LEFT JOIN scm_partner sp ON sp.account_set_id=p.account_set_id AND sp.code=p.supplier_code
    WHERE p.id=? AND p.account_set_id=?`).get(req.params.id, aid) as any
  if (!plan) return res.status(404).json({ code: 404, message: '工单不存在' })
  // 成品明细（每个成品带其原料用料行）
  const products = getPlanProducts(db, aid, req.params.id)
  // 每料已领用净数量（工单级池化）→ 挂到各成品用料行，供「用料汇总」逐行展示已领用
  // 同一份建议同时提供「已领」列和动作状态，避免刷新工单时重复扫描库存移动。
  const issueRows = computeIssueSuggestion(db, aid, plan)
  const issuedByItem = new Map(issueRows.map(row => [row.item_code, Number(row.issued) || 0]))
  for (const p of products) for (const l of (p.bom_lines || [])) l.issued_qty = issuedByItem.get(l.item_code) || 0
  // 兼容：top-level bom_lines = 全工单原料汇总（旧前端字段），来自各成品原料行
  const bomLines = db.prepare('SELECT l.*, i.name AS item_name, i.spec AS spec, w.name AS warehouse_name FROM scm_production_plan_line l LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code LEFT JOIN scm_warehouse w ON w.account_set_id=l.account_set_id AND w.code=l.warehouse_code WHERE l.plan_id=? ORDER BY l.seq').all(req.params.id) as any[]
  const docs = db.prepare(`SELECT id, doc_no, doc_type, status, doc_date, total_qty, total_amount FROM scm_doc WHERE account_set_id=? AND plan_id=? ORDER BY doc_type, doc_no`).all(aid, req.params.id) as any[]
  const { issueUnitCost: _omit, ...cost } = getPlanCostSummary(db, aid, req.params.id, Number(plan.plan_qty) || 0)
  const actionState = computeProductionPlanActionState(db, aid, plan, issueRows)
  res.json({ code: 0, data: { plan, products, bom_lines: bomLines, docs, cost, action_state: actionState } })
})

// 生产/委外计划上下游关联追溯：上游=下推来源单据(source_doc_id)，下游=挂在本计划下的领料/完工/委外单(scm_doc.plan_id)。
// 与 /scm/docs/:id/downstream 同款字段（复用 queryDocRows 富行），供前端 DownstreamTrace.vue 复用同一套渲染。
router.get('/scm/production-plans/:id/downstream', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const plan = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!plan) return res.status(404).json({ code: 404, message: '工单不存在' })

  const richByIds = (ids: string[]) => ids.length
    ? queryDocRows(db, `d.account_set_id=? AND d.id IN (${ids.map(() => '?').join(',')})`, [aid, ...ids],
        'ORDER BY d.doc_type, d.doc_no')
    : []
  const upIds = plan.source_doc_id ? [plan.source_doc_id] : []
  const downIds = (db.prepare('SELECT id FROM scm_doc WHERE account_set_id=? AND plan_id=?').all(aid, req.params.id) as any[]).map(r => r.id)

  res.json({ code: 0, data: { plan, upstream_docs: richByIds(upIds), downstream_docs: richByIds(downIds) } })
})

// 下达：draft → released（之后才能领料/完工）
router.post('/scm/production-plans/:id/release', operationLog('工单审核', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const p = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!p) return res.status(404).json({ code: 404, message: '工单不存在' })
  if (p.status === 'closed') return res.status(400).json({ code: 400, message: '工单已关闭' })
  // 逐成品校验：每个成品须 plan_qty>0，且有 BOM 或用料明细
  const products = db.prepare('SELECT id, item_code, plan_qty, bom_id FROM scm_production_plan_product WHERE plan_id=? AND account_set_id=? ORDER BY seq').all(req.params.id, aid) as any[]
  if (!products.length) return res.status(400).json({ code: 400, message: '工单无成品，请先添加成品明细' })
  for (const pr of products) {
    if (!(Number(pr.plan_qty) > 0)) return res.status(400).json({ code: 400, message: `成品 ${pr.item_code} 计划数量需大于 0` })
    const lc = (db.prepare('SELECT COUNT(*) c FROM scm_production_plan_line WHERE product_id=?').get(pr.id) as any).c
    if (!pr.bom_id && !lc) return res.status(400).json({ code: 400, message: `成品 ${pr.item_code} 缺 BOM 或用料明细，无法审核` })
  }
  db.prepare("UPDATE scm_production_plan SET status='released' WHERE id=? AND account_set_id=?").run(req.params.id, aid)
  res.json({ code: 0, data: { ok: true } })
})

// 关闭：released → closed（结清在制；有未结清余额时提示）
router.post('/scm/production-plans/:id/close', operationLog('工单关闭', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const p = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!p) return res.status(404).json({ code: 404, message: '工单不存在' })
  if (p.status === 'closed') return res.json({ code: 0, data: { ok: true } })
  const cost = getPlanCostSummary(db, aid, req.params.id, Number(p.plan_qty) || 0)
  if (Math.abs(cost.wip) > 0.01 && req.body?.force !== true) {
    return res.status(400).json({ code: 409, message: `工单仍有在制余额 ${cost.wip}，请先做末批完工入库结清，或确认强制关闭`, data: { wip: cost.wip } })
  }
  db.prepare("UPDATE scm_production_plan SET status='closed' WHERE id=? AND account_set_id=?").run(req.params.id, aid)
  res.json({ code: 0, data: { ok: true, wip: cost.wip } })
})

// 重开（反关闭）：closed → 无完工且无关联单据 → 'draft'（可编辑）；否则 → 'released'（可继续领料/完工，成品用料仍锁定）。
// 面向「误关闭 / 空工单」场景，避免已关闭工单被永久卡死不能编辑/删除。
router.post('/scm/production-plans/:id/reopen', operationLog('工单重开', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const p = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!p) return res.status(404).json({ code: 404, message: '工单不存在' })
  if (p.status !== 'closed') return res.status(400).json({ code: 400, message: '仅已关闭工单可重开' })
  const finished = Number((db.prepare('SELECT COALESCE(SUM(finished_qty),0) s FROM scm_production_plan_product WHERE plan_id=? AND account_set_id=?').get(req.params.id, aid) as any)?.s) || 0
  const docCnt = Number((db.prepare('SELECT COUNT(*) c FROM scm_doc WHERE account_set_id=? AND plan_id=?').get(aid, req.params.id) as any)?.c) || 0
  const target = (finished <= 0 && docCnt === 0) ? 'draft' : 'released'
  db.prepare('UPDATE scm_production_plan SET status=? WHERE id=? AND account_set_id=?').run(target, req.params.id, aid)
  res.json({ code: 0, data: { ok: true, status: target } })
})

// 反审核（反下达）：released → draft。仅当无下游单据（领料/完工等），有则须先删下游再反审核。
router.post('/scm/production-plans/:id/unrelease', operationLog('工单反审核', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const p = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!p) return res.status(404).json({ code: 404, message: '工单不存在' })
  if (p.status !== 'released') return res.status(400).json({ code: 400, message: '仅已审核工单可反审核' })
  const mrpKind = p.plan_type === 'outsource' ? 'outsource_plan' : 'production_plan'
  const mrp = findActiveMrpSource(db, aid, mrpKind, p.id)
  if (mrp) {
    const hint = mrp.status === 'draft' ? '；如需释放，请先删除该草稿 MRP 计算单' : ''
    return res.status(400).json({ code: 400, message: `该${p.plan_type === 'outsource' ? '委外' : '生产'}计划已进入 MRP 计算单 ${mrp.doc_no}，不能反审核${hint}` })
  }
  const docCnt = Number((db.prepare('SELECT COUNT(*) c FROM scm_doc WHERE account_set_id=? AND plan_id=?').get(aid, req.params.id) as any)?.c) || 0
  if (docCnt > 0) return res.status(400).json({ code: 400, message: '该工单已有下游单据（领料/完工等），请先删除下游单据再反审核' })
  db.prepare("UPDATE scm_production_plan SET status='draft' WHERE id=? AND account_set_id=?").run(req.params.id, aid)
  res.json({ code: 0, data: { ok: true } })
})

// 领料建议
router.get('/scm/production-plans/:id/issue-suggestion', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const plan = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!plan) return res.status(404).json({ code: 404, message: '工单不存在' })
  res.json({ code: 0, data: { plan_id: plan.id, yl_warehouse: plan.yl_warehouse, lines: computeIssueSuggestion(db, aid, plan) } })
})

// 一键生成领料单(PL) 草稿（带 plan_id + 原料仓 + 建议明细）
router.post('/scm/production-plans/:id/gen-issue', operationLog('工单生成领料单', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const plan = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!plan) return res.status(404).json({ code: 404, message: '工单不存在' })
  if (plan.status !== 'released') return res.status(400).json({ code: 400, message: '请先审核工单再生成领料单' })
  const isOut = plan.plan_type === 'outsource'
  const dt = isOut ? 'WO' : 'PL'      // 委外发货 / 生产领用
  // 领料建议涉及 BOM、已审核库存移动及草稿占用汇总；本次生成全程只计算一次。
  const issueRows = computeIssueSuggestion(db, aid, plan)
  const actionState = computeProductionPlanActionState(db, aid, plan, issueRows).issue
  if (actionState.status === 'blocked_draft') {
    return res.status(400).json({
      code: 400,
      message: `该工单已存在未审核的${isOut ? '委外发货单' : '领料单'} ${actionState.draft_doc?.doc_no || ''}，请先审核或删除后再生成`,
    })
  }
  if (actionState.status === 'completed') {
    return res.status(400).json({ code: 400, message: `该工单${isOut ? '已发料齐' : '已领齐'}，无需重复生成${isOut ? '委外发货单' : '领料单'}` })
  }
  if (actionState.status === 'not_required') {
    return res.status(400).json({ code: 400, message: `该工单无需${isOut ? '委外发料' : '领料'}` })
  }
  if (actionState.status === 'unavailable') {
    return res.status(400).json({ code: 400, message: actionState.reason || `该工单当前不可${isOut ? '委外发料' : '领料'}` })
  }
  const rows = issueRows.filter(r => r.suggest > 0)
  if (!rows.length) {
    return res.status(400).json({ code: 400, message: `该工单${isOut ? '已发料齐' : '已领齐'}，无需重复生成` })
  }
  const wh = plan.yl_warehouse || null
  const docNo = nextDocNo(db, aid, dt)
  const docId = uuidv4()
  db.transaction(() => {
    db.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,partner_code,warehouse_code,operator,maker,status,bom_id,plan_id,total_qty,total_amount,remark,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, '{}')`).run(
      docId, aid, dt, docNo, new Date().toISOString().slice(0, 10), isOut ? (plan.supplier_code ?? null) : null, wh, userName(req), userName(req), 'draft', plan.bom_id ?? null, plan.id,
      r6(rows.reduce((s, r) => s + r.suggest, 0)), 0, `工单 ${plan.code} ${isOut ? '委外发货' : '领料'}`
    )
    const ins = prepareDocLineInsert(db)
    let seq = 0
    for (const r of rows) {
      seq++
      // 行仓库优先（建议已解析为 行仓库||原料仓），表头 wh 兜底
      ins.run(...buildDocLineRow(aid, docId, seq, { item_code: r.item_code, warehouse_code: r.warehouse_code || wh, qty: r.suggest, price: 0 }, wh).values)
    }
  })()
  res.json({ code: 0, data: { id: docId, doc_no: docNo } })
})

// 一键生成完工入库(PF)/委外入库(WI) 草稿：一张单按成品逐行入库（带 plan_id + 各成品成品仓；委外可带加工费单价）。
// body: { products:[{product_id, qty, process_fee?}], fp_warehouse? }；兼容旧 { qty, process_fee }（作用于首成品）。
router.post('/scm/production-plans/:id/gen-finish', operationLog('工单生成完工入库', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const plan = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!plan) return res.status(404).json({ code: 404, message: '工单不存在' })
  if (plan.status !== 'released') return res.status(400).json({ code: 400, message: '请先审核工单再生成完工入库' })
  const isOut = plan.plan_type === 'outsource'
  const dt = isOut ? 'WI' : 'PF'        // 委外入库 / 完工入库
  const overrunPolicy = getScmOverrunPolicy(db, aid, isOut ? 'outsource' : 'production')
  const actionState = computeProductionPlanActionState(db, aid, plan).finish
  if (actionState.status === 'blocked_draft') {
    return res.status(400).json({
      code: 400,
      message: `该工单已存在未审核的${isOut ? '委外入库单' : '完工入库单'} ${actionState.draft_doc?.doc_no || ''}，请先审核或删除后再生成`,
    })
  }
  if (actionState.status === 'completed') {
    return res.status(400).json({ code: 400, message: `该工单已全部${isOut ? '委外入库' : '完工'}，无需重复生成` })
  }
  if (actionState.status === 'not_required') {
    return res.status(400).json({ code: 400, message: '该工单无可完工成品' })
  }
  const planProducts = db.prepare('SELECT id,item_code,plan_qty,finished_qty,COALESCE(scrap_qty,0) AS scrap_qty,fp_warehouse,process_fee,process_tax_rate FROM scm_production_plan_product WHERE plan_id=? AND account_set_id=? ORDER BY seq').all(plan.id, aid) as any[]
  if (!planProducts.length) return res.status(400).json({ code: 400, message: '工单无成品明细' })
  // 解析本次完工项：优先 body.products；兼容旧 {qty}（首成品）；都没有则取默认值——
  //   计划数 − 已完工 − 已报废，再受「已审核报工合格数 − 已完工」约束（没上报工习惯的用户不受影响）。
  const reportedGood = isOut ? new Map<string, number>() : getReportedGoodQtyByProduct(db, aid, plan.id)
  const defaultQty = (p: any) => {
    const planRemain = r6(Math.max(0, (Number(p.plan_qty) || 0) - (Number(p.finished_qty) || 0) - (Number(p.scrap_qty) || 0)))
    const reported = reportedGood.get(p.id)
    if (reported === undefined) return planRemain
    const reportRemain = r6(Math.max(0, reported - (Number(p.finished_qty) || 0)))
    return Math.min(planRemain, reportRemain)
  }
  let reqItems: any[]
  if (Array.isArray(req.body?.products)) reqItems = req.body.products
  else if (Number(req.body?.qty) > 0) reqItems = [{ product_id: planProducts[0].id, qty: Number(req.body.qty), process_fee: req.body?.process_fee }]
  else reqItems = planProducts.map(p => ({ product_id: p.id, qty: defaultQty(p) }))
  const prodById = new Map<string, any>(planProducts.map(p => [p.id, p]))
  const headWh = req.body?.fp_warehouse ? String(req.body.fp_warehouse) : null
  const docLines = [] as any[]
  for (const it of reqItems) {
    const prod = prodById.get(it.product_id)
    if (!prod) continue
    const q = Number(it.qty) || 0
    if (q <= 0) continue
    const maxAllowed = getScmMaxAllowedQty(Number(prod.plan_qty) || 0, overrunPolicy)
    const remain = r6(Math.max(0, maxAllowed - (Number(prod.finished_qty) || 0) - (Number(prod.scrap_qty) || 0)))
    if (q > remain + 1e-6) {
      return res.status(400).json({ code: 400, message: `成品 ${prod.item_code} 本次完工数 ${q} 超过剩余可完工数 ${remain}` })
    }
    const wh = headWh || prod.fp_warehouse || plan.fp_warehouse || null
    const fee = isOut ? Number(it.process_fee ?? prod.process_fee) || 0 : 0
    const taxRate = isOut ? Number(it.process_tax_rate ?? prod.process_tax_rate) || 0 : 0
    const taxAmount = isOut ? round2(fee * q * taxRate / 100) : 0
    docLines.push({ item_code: prod.item_code, warehouse_code: wh, qty: q, price: 0, process_fee: fee,
      tax_rate: taxRate, tax_amount: taxAmount, price_with_tax: round2(fee * (1 + taxRate / 100)) })
  }
  if (!docLines.length) return res.status(400).json({ code: 400, message: '完工数量需大于 0' })
  const totalQty = r6(docLines.reduce((s, l) => s + l.qty, 0))
  const headWhFinal = headWh || plan.fp_warehouse || docLines[0].warehouse_code || null
  const docNo = nextDocNo(db, aid, dt)
  const docId = uuidv4()
  db.transaction(() => {
    db.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,partner_code,warehouse_code,operator,maker,status,bom_id,plan_id,total_qty,total_amount,remark,field_values)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, '{}')`).run(
      docId, aid, dt, docNo, new Date().toISOString().slice(0, 10), isOut ? (plan.supplier_code ?? null) : null, headWhFinal, userName(req), userName(req), 'draft', plan.bom_id ?? null, plan.id,
      totalQty, 0, `工单 ${plan.code} ${isOut ? '委外入库' : '完工入库'}`
    )
    const ins = prepareDocLineInsert(db)
    let seq = 0
    for (const l of docLines) { seq++; ins.run(...buildDocLineRow(aid, docId, seq, l, headWhFinal).values) }
  })()
  res.json({ code: 0, data: { id: docId, doc_no: docNo } })
})
router.post('/scm/production-plans/batch-actions', operationLog('生产计划批量操作', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const action = String(req.body?.action || '') as 'delete' | 'unrelease' | 'reopen'
  if (!['delete', 'unrelease', 'reopen'].includes(action)) return res.status(400).json({ code: 400, message: '不支持的批量操作' })
  let ids: string[]
  try { ids = normalizeBatchIds(req.body?.ids) }
  catch (error: any) { return res.status(400).json({ code: 400, message: error.message }) }
  const placeholders = ids.map(() => '?').join(',')
  const plans = db.prepare(`SELECT p.id,p.code,p.plan_type,p.status,
      (SELECT COUNT(*) FROM scm_doc d WHERE d.account_set_id=p.account_set_id AND d.plan_id=p.id) AS doc_count,
      (SELECT md.status FROM scm_mrp_source s JOIN scm_doc md ON md.id=s.mrp_doc_id
        WHERE s.account_set_id=p.account_set_id AND s.source_id=p.id
          AND s.source_kind=CASE WHEN p.plan_type='outsource' THEN 'outsource_plan' ELSE 'production_plan' END
          AND md.status IN ('draft','audited') LIMIT 1) AS mrp_status
    FROM scm_production_plan p WHERE p.account_set_id=? AND p.id IN (${placeholders})`).all(aid, ...ids) as any[]
  if (plans.length !== ids.length) return res.status(404).json({ code: 404, message: '存在无效或不属于当前账套的计划' })
  const byId = new Map(plans.map(plan => [plan.id, plan]))
  const ordered = ids.map(id => byId.get(id))
  if (!req.permissions?.includes('*')) {
    const denied = ordered.some(plan => !req.permissions?.includes(plan.plan_type === 'outsource' ? 'scm:outsource' : 'scm:production'))
    if (denied) return res.status(403).json({ code: 403, message: '选中计划包含无权操作的业务域' })
    const actionPerm = action === 'delete' ? 'scm:delete' : 'scm:audit'
    if (!req.permissions?.includes(actionPerm)) return res.status(403).json({ code: 403, message: '无此操作权限' })
  }
  try { validateProductionPlanBatchAction(action, ordered) }
  catch (error: any) { return res.status(400).json({ code: 400, message: error.message }) }

  try {
    const results = executeBatchAtomically(db, ids, id => {
      const plan = byId.get(id)
      if (action === 'delete') {
        db.prepare('DELETE FROM scm_production_plan_line WHERE plan_id=?').run(id)
        db.prepare('DELETE FROM scm_production_plan_product WHERE plan_id=?').run(id)
        db.prepare('DELETE FROM scm_production_plan WHERE id=? AND account_set_id=?').run(id, aid)
        return { id, code: plan.code, status: 'deleted' }
      }
      if (action === 'unrelease') {
        db.prepare("UPDATE scm_production_plan SET status='draft' WHERE id=? AND account_set_id=?").run(id, aid)
        return { id, code: plan.code, status: 'draft' }
      }
      const finished = Number((db.prepare('SELECT COALESCE(SUM(finished_qty),0) s FROM scm_production_plan_product WHERE plan_id=? AND account_set_id=?').get(id, aid) as any)?.s) || 0
      const target = finished <= 0 && Number(plan.doc_count) === 0 ? 'draft' : 'released'
      db.prepare('UPDATE scm_production_plan SET status=? WHERE id=? AND account_set_id=?').run(target, id, aid)
      return { id, code: plan.code, status: target }
    })
    return res.json({ code: 0, data: { processed: ids.length, action, results } })
  } catch (error: any) {
    return res.status(400).json({ code: 400, message: error?.message || '批量操作失败' })
  }
})

router.delete('/scm/production-plans/:id', operationLog('生产计划删除', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const p = db.prepare('SELECT id, status FROM scm_production_plan WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!p) return res.status(404).json({ code: 404, message: '计划不存在' })
  if (p.status === 'audited') return res.status(400).json({ code: 400, message: '已审核计划不可删除' })
  db.transaction(() => {
    db.prepare('DELETE FROM scm_production_plan_line WHERE plan_id=?').run(req.params.id)
    db.prepare('DELETE FROM scm_production_plan_product WHERE plan_id=?').run(req.params.id)
    db.prepare('DELETE FROM scm_production_plan WHERE id=? AND account_set_id=?').run(req.params.id, aid)
  })()
  res.json({ code: 0, data: { ok: true } })
})

// ── 往来台账/对账查询 ───────────────────────────────────────────────
// 给台账明细挂上「与单据列表完全一致」的单据行(row.doc)，供前端复用 ScmDocActions 操作栏。
// 复用 queryDocRows（含 status/voucher_id/push_progress/source_doc_id 等），按 doc_no 映射（账套内唯一）。
function attachDocs(db: ReturnType<typeof getDb>, aid: string, ledger: any) {
  const nos = [...new Set(((ledger?.detail || []) as any[]).map(r => r.doc_no).filter(Boolean))]
  if (nos.length) {
    const ph = nos.map(() => '?').join(',')
    const docs = queryDocRows(db, `d.account_set_id=? AND d.doc_no IN (${ph})`, [aid, ...nos])
    const byNo = new Map(docs.map((d: any) => [d.doc_no, d]))
    const orderNos = getStatementSalesOrderNos(db, aid, docs)
    const externalOrderNos = getStatementExternalOrderNos(db, aid, docs)
    ledger.detail = (ledger.detail as any[]).map(r => {
      const doc = byNo.get(r.doc_no)
      return { ...r, doc: doc ? {
        ...doc,
        order_no: orderNos.get(doc.id) || '',
        sales_order_no: orderNos.get(doc.id) || '',
        external_order_no: externalOrderNos.get(doc.id) || '',
      } : null }
    })
  }
  return ledger
}
// 给已挂 row.doc 的台账，批量补挂该单据的明细行（对账单展开/打印用）。
// 一次查询取全部相关单据的明细行，避免逐单 N+1。item_name/spec/unit 与 GET /scm/docs/:id 一致取物料档案。
function attachDocLines(db: ReturnType<typeof getDb>, aid: string, ledger: any) {
  const ids = [...new Set(((ledger?.detail || []) as any[]).map(r => r.doc?.id).filter(Boolean))]
  if (ids.length) {
    const ph = ids.map(() => '?').join(',')
    const lines = db.prepare(`SELECT l.*, i.name AS item_name, i.spec AS spec, i.unit AS unit
      FROM scm_doc_line l LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code
      WHERE l.account_set_id=? AND l.doc_id IN (${ph}) ORDER BY l.doc_id, l.seq`).all(aid, ...ids) as any[]
    const byDoc = new Map<string, any[]>()
    for (const l of lines) { const a = byDoc.get(l.doc_id) || []; a.push(l); byDoc.set(l.doc_id, a) }
    ledger.detail = (ledger.detail as any[]).map(r => r.doc ? { ...r, doc: { ...r.doc, lines: byDoc.get(r.doc.id) || [] } } : r)
  }
  return ledger
}
// 全部往来（不选往来单位）：须先于 /:partnerCode 注册，避免被动态路由吞掉
router.get('/scm/arap', (req: AuthRequest, res) => {
  const { start_date, end_date, arap_type, with_lines } = req.query as any
  const db = getDb(); const aid = asid(req)
  let data = attachDocs(db, aid, getAllPartnerLedger(db, aid, start_date, end_date, arap_type))
  if (with_lines) data = attachDocLines(db, aid, data)
  res.json({ code: 0, data })
})
// 往来余额表：按往来单位汇总（期初/本期增加/本期减少/期末）——须先于 /scm/arap/:partnerCode 注册
router.get('/scm/arap/balance-summary', (req: AuthRequest, res) => {
  const { start_date, end_date, arap_type } = req.query as any
  const db = getDb(); const aid = asid(req)
  res.json({ code: 0, data: getPartnerBalanceSummary(db, aid, start_date, end_date, arap_type) })
})
// ── 单据级核销 + 预收预付（须先于 /scm/arap/:partnerCode 注册，避免被动态路由吞掉） ──
router.get('/scm/arap/open-items', (req: AuthRequest, res) => {
  const { partner_code, side } = req.query as any
  if (!partner_code) return res.status(400).json({ code: 400, message: '请指定往来单位' })
  res.json({ code: 0, data: getOpenItems(getDb(), asid(req), partner_code, side) })
})
router.get('/scm/arap/payment-sources', (req: AuthRequest, res) => {
  const { partner_code, payment_doc_type } = req.query as any
  if (!partner_code) return res.status(400).json({ code: 400, message: '请指定往来单位' })
  if (!['RCV', 'PAY'].includes(String(payment_doc_type || ''))) {
    return res.status(400).json({ code: 400, message: '收付款单类型无效' })
  }
  res.json({ code: 0, data: getPaymentSources(getDb(), asid(req), partner_code, payment_doc_type) })
})
router.get('/scm/arap/verify-list', (req: AuthRequest, res) => {
  const { partner_code } = req.query as any
  res.json({ code: 0, data: listVerifies(getDb(), asid(req), partner_code) })
})
// 到期提醒：逾期 + 临近到期的未核销应收应付（须先于 /scm/arap/:partnerCode 注册）
router.get('/scm/arap/due-reminder', (req: AuthRequest, res) => {
  const { as_of_date, upcoming_days } = req.query as any
  const asOf = as_of_date || new Date().toISOString().slice(0, 10)
  res.json({ code: 0, data: getDueReminder(getDb(), asid(req), asOf, Number(upcoming_days) || 7) })
})
router.post('/scm/arap/verify', operationLog('往来核销', '供应链'), (req: AuthRequest, res) => {
  try {
    const b = req.body || {}
    const r = verifyArAp(getDb(), asid(req), { partner_code: b.partner_code, verify_date: b.verify_date, operator: userName(req), matches: b.matches || [] })
    res.json({ code: 0, data: r })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e?.message || '核销失败' })
  }
})
router.post('/scm/arap/verify/:verifyNo/cancel', operationLog('取消往来核销', '供应链'), (req: AuthRequest, res) => {
  try {
    res.json({ code: 0, data: cancelVerify(getDb(), asid(req), req.params.verifyNo) })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e?.message || '取消核销失败' })
  }
})
router.get('/scm/arap/:partnerCode', (req: AuthRequest, res) => {
  const { start_date, end_date, arap_type, with_lines } = req.query as any
  const db = getDb(); const aid = asid(req)
  let data = attachDocs(db, aid, getPartnerLedger(db, aid, req.params.partnerCode, start_date, end_date, arap_type))
  if (with_lines) data = attachDocLines(db, aid, data)
  res.json({ code: 0, data })
})
// 应收应付账龄（按到期日 + 未核销额）
router.get('/scm/arap-aging', (req: AuthRequest, res) => {
  const { as_of_date } = req.query as any; const asOf = as_of_date || new Date().toISOString().slice(0, 10)
  res.json({ code: 0, data: getArApAging(getDb(), asid(req), asOf) })
})
// 客户信用占用：额度 / 已用(未核销应收) / 可用
router.get('/scm/partners/:code/credit', (req: AuthRequest, res) => {
  res.json({ code: 0, data: getPartnerCredit(getDb(), asid(req), req.params.code) })
})

// ── BOM 展开：返回按成品数量折算的子项用量列表 ─────────────────────
router.get('/scm/boms/:id/explode', (req: AuthRequest, res) => {
  const db = getDb(); const qty = Number(req.query.qty) || 1
  // 仅炸主件(component)为物料需求；副产品/联产品(by_product/co_product)是产出，不计入领料需求
  const lines = db.prepare("SELECT l.*, i.name AS item_name, i.spec, i.unit FROM scm_bom_line l LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code WHERE l.bom_id=? AND l.line_type='component' ORDER BY l.seq").all(req.params.id) as any[]
  const exploded = lines.map(l => ({
    item_code: l.item_code, item_name: l.item_name, spec: l.spec, unit: l.unit,
    qty_per_unit: l.qty, total_qty: Math.round(l.qty * qty * (1 + (l.scrap_rate || 0) / 100) * 10000) / 10000,
    scrap_rate: l.scrap_rate, remark: l.remark
  }))
  res.json({ code: 0, data: { bom_id: req.params.id, qty, lines: exploded } })
})

// ── BOM 多级树展开：把成品 BOM 递归炸成多级树，含用量与成本上推 ───────
// 成本基准：叶子(采购件)=物料档案进价 purchase_price；装配件=子件成本累计(自身进价不计)。
router.get('/scm/boms/:id/tree', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const qty = Number(req.query.qty) || 1
  const bom = db.prepare('SELECT * FROM scm_bom WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!bom) return res.status(404).json({ code: 404, message: 'BOM不存在' })

  const r6 = (n: number) => Math.round(n * 1e6) / 1e6
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4
  const r2 = (n: number) => Math.round(n * 100) / 100

  const itemCache = new Map<string, any>()
  const getItem = (code: string) => {
    if (itemCache.has(code)) return itemCache.get(code)
    const it = db.prepare(
      "SELECT name, spec, unit, item_type, COALESCE(purchase_price,0) AS purchase_price FROM scm_item WHERE account_set_id=? AND code=?"
    ).get(aid, code) as any
    itemCache.set(code, it || null); return it || null
  }
  // active BOM 子件（按 item_code 查，与缺料单多级下推一致），带缓存；无 BOM 返回 null
  const bomLineCache = new Map<string, any[] | null>()
  const getBomLines = (code: string) => {
    if (bomLineCache.has(code)) return bomLineCache.get(code)!
    const b = db.prepare(
      "SELECT id FROM scm_bom WHERE account_set_id=? AND item_code=? AND status='active' ORDER BY code LIMIT 1"
    ).get(aid, code) as any
    if (!b) { bomLineCache.set(code, null); return null }
    const ls = db.prepare("SELECT item_code, qty, unit, scrap_rate FROM scm_bom_line WHERE bom_id=? AND line_type='component' ORDER BY seq").all(b.id) as any[]
    bomLineCache.set(code, ls); return ls
  }
  // 根用本次请求的 BOM 明细（避免同成品存在多份 active BOM 时取错）；仅主件参与用量/成本上卷
  const rootLines = db.prepare("SELECT item_code, qty, unit, scrap_rate FROM scm_bom_line WHERE bom_id=? AND line_type='component' ORDER BY seq").all(bom.id) as any[]
  bomLineCache.set(bom.item_code, rootLines)

  const leafKinds = new Set<string>()
  let maxLevel = 0
  let seq = 0

  const build = (code: string, perQty: number, parentTotal: number, scrapRate: number, level: number, path: Set<string>): any => {
    const it = getItem(code)
    const total_qty = r6(parentTotal * perQty)
    if (level > maxLevel) maxLevel = level
    const node: any = {
      key: ++seq, item_code: code, item_name: it?.name || '', spec: it?.spec || '',
      unit: it?.unit || '', item_type: it?.item_type ?? null, level,
      per_qty: r6(perQty), total_qty, scrap_rate: scrapRate,
      cycle: false, is_assembly: false, unit_cost: 0, amount: 0, children: [] as any[],
    }
    const isCycle = path.has(code)
    if (isCycle) node.cycle = true
    const lines = isCycle ? null : getBomLines(code)
    if (lines && lines.length) {
      node.is_assembly = true
      const nextPath = new Set(path); nextPath.add(code)
      let uc = 0
      for (const l of lines) {
        const childPer = (Number(l.qty) || 0) * (1 + (Number(l.scrap_rate) || 0) / 100)
        const child = build(l.item_code, childPer, total_qty, Number(l.scrap_rate) || 0, level + 1, nextPath)
        if (l.unit) child.unit = l.unit
        node.children.push(child)
        uc += childPer * child.unit_cost
      }
      node.unit_cost = r4(uc)
    } else {
      node.unit_cost = r4(Number(it?.purchase_price) || 0)
      leafKinds.add(code)
    }
    node.amount = r2(total_qty * node.unit_cost)
    return node
  }

  const root = build(bom.item_code, 1, qty, 0, 0, new Set())
  res.json({ code: 0, data: {
    bom_id: bom.id, bom_code: bom.code, bom_name: bom.name, qty,
    root,
    summary: { unit_cost: root.unit_cost, total_cost: root.amount, leaf_kinds: leafKinds.size, max_level: maxLevel },
  } })
})

// ── 单据生成凭证（P5） ──────────────────────────────────────────────
// 导出供单元测试直接调用（批量操作也复用此 handler）
export const genVoucherHandler = (req: AuthRequest, res: Response) => {
  const db = getDb(); const aid = asid(req)
  const doc = db.prepare('SELECT * FROM scm_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!doc || doc.status !== 'audited') return res.status(400).json({ code: 400, message: '单据未审核' })
  if (doc.voucher_id) return res.status(400).json({ code: 400, message: '已生成凭证' })
  const lines = db.prepare('SELECT * FROM scm_doc_line WHERE doc_id=?').all(doc.id) as any[]
  if (!lines.length) return res.status(400).json({ code: 400, message: '无明细行' })

  const docType = db.prepare('SELECT * FROM scm_doc_type WHERE account_set_id=? AND code=?').get(aid, doc.doc_type) as any
  if (!docType) return res.status(400).json({ code: 400, message: '未知单据类型' })

  // 由来源单据下推的发票不单独制证：来源单据（PI 采购入库 / SO 销售发货）审核制证时
  // 已经把存货、税额、往来一次记完，发票只负责校正金额与勾稽，再记一次就是重复入账。
  if ((doc.doc_type === 'RP' || doc.doc_type === 'RS') && doc.source_doc_id) {
    const src = db.prepare('SELECT doc_no, voucher_id FROM scm_doc WHERE id=? AND account_set_id=?')
      .get(doc.source_doc_id, aid) as any
    if (src) {
      return res.status(400).json({
        code: 400,
        message: src.voucher_id
          ? `本发票由来源单据「${src.doc_no}」下推，该单已生成凭证，发票无需重复制证`
          : `本发票由来源单据「${src.doc_no}」下推，请在来源单据上生成凭证`,
      })
    }
  }
  const paymentErr = validatePaymentData(db, aid, doc, lines, req.accountScope)
  if (paymentErr) return res.status(paymentErr.status).json({ code: paymentErr.status, message: paymentErr.message })

  // 往来单位（取应收/应付科目）
  const partner = doc.partner_code
    ? db.prepare('SELECT ar_account, ap_account FROM scm_partner WHERE account_set_id=? AND code=?').get(aid, doc.partner_code) as any
    : null

  // 供应链对方科目：系统参数已配 > 默认编码在本账套存在 > 按科目名称探测。
  // 第三级是必需的——默认编码取自《企业会计准则》科目表，而 ACD 导入的账套用润衡科目表，
  // 进项税在那边是 2221001001 不是 22210101，不探测的话带税单据永远出不了凭证。
  const scmAcc = (key: string, fb: string): string => resolveScmAccount(db, aid, key)?.code || fb
  const AP = partner?.ap_account || scmAcc('scm:acc_ap', '2202')          // 应付账款
  const AR = partner?.ar_account || scmAcc('scm:acc_ar', '1122')          // 应收账款
  const REV = scmAcc('scm:acc_revenue', '6001')                          // 主营业务收入
  const COST = scmAcc('scm:acc_cost', '6401')                            // 主营业务成本
  const OTHER = scmAcc('scm:acc_other', '1901')                          // 其他出入库对方（待处理财产损溢）
  const PROD = scmAcc('scm:acc_production', '5001')                       // 生产成本
  const LABOR = scmAcc('scm:acc_labor', '2211')                          // 应付职工薪酬（完工人工来源）
  const OVERHEAD = scmAcc('scm:acc_overhead', '5101')                    // 制造费用（完工制费来源）
  const TAX_IN = scmAcc('scm:acc_tax_input', '22210101')                 // 应交税费-进项税
  const TAX_OUT = scmAcc('scm:acc_tax_output', '22210105')               // 应交税费-销项税

  // 按科目汇总分录（借方/贷方）
  const lookupAcc = db.prepare('SELECT id, code, name FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
  const entries: Array<{ code: string; name: string; id: string; debit: number; credit: number; summary: string }> = []
  const missing = new Set<string>()
  const addEntry = (code: string, side: 'debit' | 'credit', amt: number, summary: string) => {
    if (!code || !(amt > 0)) return
    const acc = lookupAcc.get(aid, code) as any
    if (!acc) { missing.add(code); return }
    let e = entries.find(x => x.code === code && x.id === acc.id)
    if (!e) { e = { code, name: acc.name, id: acc.id, debit: 0, credit: 0, summary }; entries.push(e) }
    e[side] = Math.round((e[side] + amt) * 100) / 100
  }

  const cat = docType.category
  const dir = docType.direction
  for (const l of lines) {
    if (cat === 'finance') {
      const amt = Math.round(Number(l.amount || 0) * 100) / 100
      if (amt <= 0) continue
      const sumr = `${doc.doc_no} ${l.remark || doc.remark || (doc.doc_type === 'RCV' ? '收款' : '付款')}`
      if (doc.doc_type === 'RCV') {
        addEntry(doc.settle_account, 'debit', amt, sumr)
        addEntry(AR, 'credit', amt, sumr)
      } else {
        addEntry(AP, 'debit', amt, sumr)
        addEntry(doc.settle_account, 'credit', amt, sumr)
      }
      continue
    }
    // 发票行允许「只有金额、没有数量」（如运费行），不能按数量过滤掉
    const isInvoiceDoc = doc.doc_type === 'RP' || doc.doc_type === 'RS'
    if (!isInvoiceDoc && (!l.qty || l.qty <= 0)) continue
    if (isInvoiceDoc && !(Number(l.amount) || 0) && !(Number(l.tax_amount) || 0)) continue
    const item = getItem(db, aid, l.item_code)
    const invCode = item?.inv_account || '1405'                          // 存货科目（默认 库存商品）
    const sumr = `${doc.doc_no} ${item?.name || l.item_code}`
    const amt = Math.round(Number(l.amount || l.qty * (l.price || l.unit_cost || 0)) * 100) / 100   // 业务金额(进价/售价，不含税)
    const tax = Math.round(Number(l.tax_amount || 0) * 100) / 100        // 税额
    const cost = Math.round(Number((l.unit_cost || 0) * l.qty) * 100) / 100  // 库存成本额(审核回写)
    if (amt <= 0 && cost <= 0) continue

    if (doc.doc_type === 'RP' || doc.doc_type === 'RS') {
      // 发票单（dir='none'，不动库存）。有来源单据的发票不在此制证——来源单据
      // （PI/SO）审核制证时已经把存货、税额、往来一次性记完了，发票只是校正金额与勾稽，
      // 再记一次会重复入账。该情形在循环外拦截，这里只处理独立录入的发票。
      if (doc.doc_type === 'RP') {
        // 独立采购发票：借 存货 + 进项税 / 贷 应付
        addEntry(invCode, 'debit', amt, sumr); addEntry(TAX_IN, 'debit', tax, sumr); addEntry(AP, 'credit', amt + tax, sumr)
      } else {
        // 独立销售发票：借 应收 / 贷 收入 + 销项。无库存移动，故不结转成本。
        addEntry(AR, 'debit', amt + tax, sumr); addEntry(REV, 'credit', amt, sumr); addEntry(TAX_OUT, 'credit', tax, sumr)
      }
    } else if (cat === 'purchase') {
      // 采购入库：借 存货 + 进项税 / 贷 应付；采购退货反向
      if (dir === 'in') { addEntry(invCode, 'debit', amt, sumr); addEntry(TAX_IN, 'debit', tax, sumr); addEntry(AP, 'credit', amt + tax, sumr) }
      else if (dir === 'out') { addEntry(invCode, 'credit', amt, sumr); addEntry(TAX_IN, 'credit', tax, sumr); addEntry(AP, 'debit', amt + tax, sumr) }
    } else if (cat === 'sale') {
      // 销售出库：确认收入(借应收/贷收入+销项) + 结转成本(借成本/贷存货)；销售退货反向
      if (dir === 'out') {
        addEntry(AR, 'debit', amt + tax, sumr); addEntry(REV, 'credit', amt, sumr); addEntry(TAX_OUT, 'credit', tax, sumr)
        addEntry(COST, 'debit', cost, sumr); addEntry(invCode, 'credit', cost, sumr)
      } else if (dir === 'in') {
        addEntry(AR, 'credit', amt + tax, sumr); addEntry(REV, 'debit', amt, sumr); addEntry(TAX_OUT, 'debit', tax, sumr)
        addEntry(COST, 'credit', cost, sumr); addEntry(invCode, 'debit', cost, sumr)
      }
    } else if (cat === 'production') {
      // 完工入库/生产领用/组装/拆卸
      const v = cost > 0 ? cost : amt
      const isProductLine = l.line_role === 'product'
      if (dir === 'in') {
        // 完工入库：借存货(全 v) / 贷生产成本(料) / 贷应付职工薪酬(人工) / 贷制造费用(制费)。
        // 逐行裁剪保证 料+人工+制费 恒等于 v（料极小、人工占主导的舍入边界也不会使凭证失衡）。
        const labor = Math.min(Math.max(0, Math.round(Number(l.labor_cost || 0) * 100) / 100), v)
        const overhead = Math.min(Math.max(0, Math.round(Number(l.overhead_cost || 0) * 100) / 100), Math.round((v - labor) * 100) / 100)
        const material = Math.round((v - labor - overhead) * 100) / 100
        addEntry(invCode, 'debit', v, sumr)
        addEntry(PROD, 'credit', material, sumr)
        if (labor > 0) addEntry(LABOR, 'credit', labor, sumr)
        if (overhead > 0) addEntry(OVERHEAD, 'credit', overhead, sumr)
      }
      else if (dir === 'out') { addEntry(PROD, 'debit', v, sumr); addEntry(invCode, 'credit', v, sumr) }
      else if (doc.doc_type === 'AS') {
        // 组装：子件消耗 贷存货/借生产成本；「成品行模式」的成品行是入库，方向相反。
        // 成品行必须在这里按行记账——它没有 BOM 可依（缺料下推生成的组装单 bom_id 为空），
        // 循环外的 BOM 补充块救不了它，漏判会把成品记成贷方存货，方向与实际库存移动相反。
        if (isProductLine) { addEntry(invCode, 'debit', v, sumr); addEntry(PROD, 'credit', v, sumr) }
        else { addEntry(invCode, 'credit', v, sumr); addEntry(PROD, 'debit', v, sumr) }
      } else if (doc.doc_type === 'DS') {
        // 拆卸：子件产生 借存货/贷生产成本；成品行是出库，方向相反
        if (isProductLine) { addEntry(PROD, 'debit', v, sumr); addEntry(invCode, 'credit', v, sumr) }
        else { addEntry(invCode, 'debit', v, sumr); addEntry(PROD, 'credit', v, sumr) }
      }
    } else if (cat === 'outsource') {
      // 委外发货(WO,出)：料投入在制 借生产成本/贷存货；委外入库(WI,入)：成品入库 借存货(全)/贷生产成本(料)/贷应付(加工费)
      const v = cost > 0 ? cost : amt
      if (dir === 'out') {
        addEntry(PROD, 'debit', v, sumr); addEntry(invCode, 'credit', v, sumr)
      } else {
        const fee = Math.round((Number(l.process_fee) || 0) * l.qty * 100) / 100
        const feeTax = Math.round((Number(l.tax_amount) || 0) * 100) / 100
        const material = Math.round((v - fee) * 100) / 100
        addEntry(invCode, 'debit', v, sumr)
        addEntry(PROD, 'credit', material, sumr)
        if (feeTax > 0) addEntry(TAX_IN, 'debit', feeTax, sumr)
        if (fee > 0) addEntry(AP, 'credit', fee + feeTax, sumr)
      }
    } else {
      // 其他出入库(inventory)：借/贷 存货 与 待处理科目对开；调拨/盘点 none 不生成
      const v = cost > 0 ? cost : amt
      if (dir === 'in') { addEntry(invCode, 'debit', v, sumr); addEntry(OTHER, 'credit', v, sumr) }
      else if (dir === 'out') { addEntry(invCode, 'credit', v, sumr); addEntry(OTHER, 'debit', v, sumr) }
    }
  }

  if (missing.size) return res.status(400).json({ code: 400, message: buildMissingAccountMessage(db, aid, [...missing]) })

  // AS/DS 成品分录：仅「无成品行的旧 BOM 模式」需要在此补充成品；
  // 成品行模式（line_role='product'）已在循环内逐行按入/出库方向记账，且允许没有 bom_id。
  const hasProductLine = lines.some((l: any) => l.line_role === 'product')
  if ((doc.doc_type === 'AS' || doc.doc_type === 'DS') && !hasProductLine) {
    if (!doc.bom_id) return res.status(400).json({ code: 400, message: '组装/拆卸单必须指定BOM才能生成凭证' })
    const bom = db.prepare('SELECT * FROM scm_bom WHERE id=? AND account_set_id=?').get(doc.bom_id, aid) as any
    if (bom) {
      const fpItem = getItem(db, aid, bom.item_code)
      const fpInvCode = fpItem?.inv_account || '1405'
      const prodEntry = entries.find(e => e.code === PROD)
      const netProd = (prodEntry?.debit || 0) - (prodEntry?.credit || 0)  // +debit = 子件消耗（AS）；-credit = 子件产生（DS）
      if (Math.abs(netProd) > 0.005) {
        const fpSummary = `${doc.doc_no} 成品 ${fpItem?.name || bom.item_code}`
        if (doc.doc_type === 'AS') {
          // 组装成品入库：借存货(成品) / 贷生产成本 ← 消耗的 netProd
          addEntry(fpInvCode, 'debit', Math.abs(netProd), fpSummary)
          addEntry(PROD, 'credit', Math.abs(netProd), fpSummary)
        } else {
          // 拆卸成品出库：借生产成本 / 贷存货(成品)
          addEntry(PROD, 'debit', Math.abs(netProd), fpSummary)
          addEntry(fpInvCode, 'credit', Math.abs(netProd), fpSummary)
        }
      }
    }
  }

  if (!entries.length) return res.status(400).json({ code: 400, message: '无有效分录（该单据类型可能不生成凭证）' })
  const entryScopeErr = assertAccountIdsInScope(req.accountScope, entries.map(e => e.id))
  if (entryScopeErr) return res.status(403).json({ code: 403, message: entryScopeErr })

  // 生成凭证
  const totalDebit = Math.round(entries.reduce((s, e) => s + e.debit, 0) * 100) / 100
  const totalCredit = Math.round(entries.reduce((s, e) => s + e.credit, 0) * 100) / 100
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({ code: 400, message: `借贷不平衡（借 ${totalDebit} / 贷 ${totalCredit}），请检查单据成本与税额` })
  }
  const voucherId = uuidv4()
  const year = parseInt((doc.doc_date || '').split('-')[0]) || new Date().getFullYear()
  const month = parseInt((doc.doc_date || '').split('-')[1]) || new Date().getMonth() + 1
  // P1-16：总账已结账期间不得再由单据推出凭证
  try { assertGlPeriodOpen(db, aid, year, month) } catch (e: any) {
    return res.status(400).json({ code: 400, message: e.message })
  }
  const lastNo = (db.prepare('SELECT CAST(CASE WHEN INSTR(voucher_no,\'-\')>0 THEN SUBSTR(voucher_no,INSTR(voucher_no,\'-\')+1) ELSE voucher_no END AS INTEGER) no FROM vouchers WHERE account_set_id=? AND year=? AND period=? ORDER BY no DESC LIMIT 1').get(aid, year, month) as any)?.no ?? 0
  const voucherNo = String(lastNo + 1).padStart(3, '0')

  db.transaction(() => {
    db.prepare(`INSERT INTO vouchers (id,account_set_id,voucher_no,voucher_type_id,voucher_date,year,period,total_amount,maker_name,remark,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      voucherId, aid, voucherNo, null, doc.doc_date, year, month, totalDebit, userName(req),
      `供应链单据${doc.doc_no}`, `scm_${doc.doc_type.toLowerCase()}`
    )
    const insE = db.prepare('INSERT INTO voucher_entries (id,account_set_id,voucher_id,seq,account_id,account_code,account_name,direction,amount,amount_cents,summary) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    let seq = 1
    for (const e of entries) {
      if (e.debit > 0) insE.run(uuidv4(), aid, voucherId, seq++, e.id, e.code, e.name, 'debit', e.debit, Math.round(e.debit * 100), e.summary)
      if (e.credit > 0) insE.run(uuidv4(), aid, voucherId, seq++, e.id, e.code, e.name, 'credit', e.credit, Math.round(e.credit * 100), e.summary)
    }
    db.prepare('UPDATE scm_doc SET voucher_id=? WHERE id=?').run(voucherId, doc.id)
  })()
  res.json({ code: 0, data: { voucher_id: voucherId, voucher_no: voucherNo, entry_count: entries.length } })
}
router.post('/scm/docs/:id/gen-voucher', operationLog('单据生成凭证', '供应链'), genVoucherHandler)

type InternalDocHandler = (req: AuthRequest, res: Response) => unknown

class BatchActionHttpError extends Error {
  constructor(public statusCode: number, message: string, public docId?: string) {
    super(message)
  }
}

function invokeDocHandler(handler: InternalDocHandler, req: AuthRequest, id: string): any {
  let statusCode = 200
  let payload: any
  const response = {
    status(code: number) { statusCode = code; return this },
    json(body: any) { payload = body; return this },
  } as unknown as Response
  const internalReq = Object.assign(Object.create(Object.getPrototypeOf(req)), req, {
    params: { ...req.params, id },
  }) as AuthRequest
  handler(internalReq, response)
  if (statusCode >= 400 || (payload && payload.code !== 0)) {
    throw new BatchActionHttpError(statusCode, payload?.message || '批量操作失败', id)
  }
  return payload?.data
}

router.post('/scm/docs/batch-actions', operationLog('供应链单据批量操作', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const action = String(req.body?.action || '') as 'audit' | 'unaudit' | 'delete' | 'gen_voucher'
  const handlers: Record<typeof action, InternalDocHandler> = {
    audit: auditDocHandler,
    unaudit: unauditDocHandler,
    delete: deleteDocHandler,
    gen_voucher: genVoucherHandler,
  }
  if (!handlers[action]) return res.status(400).json({ code: 400, message: '不支持的批量操作' })

  let ids: string[]
  try { ids = normalizeBatchIds(req.body?.ids) }
  catch (error: any) { return res.status(400).json({ code: 400, message: error.message }) }

  const placeholders = ids.map(() => '?').join(',')
  const docs = db.prepare(`SELECT id,doc_no,doc_type,status,voucher_id FROM scm_doc WHERE account_set_id=? AND id IN (${placeholders})`)
    .all(aid, ...ids) as any[]
  if (docs.length !== ids.length) return res.status(404).json({ code: 404, message: '存在无效或不属于当前账套的单据' })
  const byId = new Map(docs.map(doc => [doc.id, doc]))
  const ordered = ids.map(id => byId.get(id))

  if (!req.permissions?.includes('*')) {
    const requiredDomains = new Set(ordered.map(doc => CATEGORY_PERM[CODE_CATEGORY[doc.doc_type]]).filter(Boolean))
    if ([...requiredDomains].some(perm => !req.permissions?.includes(perm))) {
      return res.status(403).json({ code: 403, message: '选中单据包含无权操作的业务域' })
    }
    const actionPerm = action === 'delete' ? 'scm:delete' : (action === 'audit' || action === 'unaudit') ? 'scm:audit' : null
    if (actionPerm && !req.permissions?.includes(actionPerm)) return res.status(403).json({ code: 403, message: '无此操作权限' })
  }

  const invalid = ordered.find(doc => {
    if (doc.doc_type === 'MRP') return true
    if (action === 'audit' || action === 'delete') return doc.status !== 'draft'
    if (action === 'unaudit' || action === 'gen_voucher') return doc.status !== 'audited'
    return false
  })
  if (invalid) return res.status(400).json({ code: 400, message: `单据 ${invalid.doc_no} 状态不符合批量${action === 'audit' ? '审核' : action === 'unaudit' ? '反审核' : action === 'delete' ? '删除' : '生成凭证'}条件` })
  if (action === 'gen_voucher') {
    const generated = ordered.find(doc => doc.voucher_id)
    if (generated) return res.status(400).json({ code: 400, message: `单据 ${generated.doc_no} 已生成凭证` })
  }

  if (action === 'audit') {
    const stockTypes = new Map((db.prepare('SELECT code, affects_stock FROM scm_doc_type WHERE account_set_id=?').all(aid) as any[])
      .map(type => [type.code, Number(type.affects_stock) === 1]))
    const confirmations: any[] = []
    const missing: any[] = []
    for (const doc of ordered) {
      if (!stockTypes.get(doc.doc_type) || ['AS', 'TR'].includes(doc.doc_type)) continue
      const lines = db.prepare('SELECT * FROM scm_doc_line WHERE doc_id=? ORDER BY seq').all(doc.id) as any[]
      const inspected = inspectAuditDefaultWarehouses(db, aid, doc, lines)
      if (inspected.missing.length) missing.push({ doc: { id: doc.id, doc_no: doc.doc_no }, lines: inspected.missing })
      else if (inspected.candidates.length) confirmations.push({ doc: { id: doc.id, doc_no: doc.doc_no }, candidates: inspected.candidates })
    }
    if (missing.length) {
      return res.status(400).json({
        code: 400,
        message: `单据 ${missing[0].doc.doc_no}：物料档案未设置默认仓库，无法自动补齐`,
        data: { error_code: 'ITEM_DEFAULT_WAREHOUSE_MISSING', missing },
      })
    }
    if (confirmations.length && !req.body?.apply_item_default_warehouses) {
      return res.status(409).json({
        code: 409,
        message: '审核前需确认：将按物料档案默认仓库补齐空仓库',
        data: { error_code: 'DEFAULT_WAREHOUSE_CONFIRMATION_REQUIRED', docs: confirmations },
      })
    }
  }

  try {
    const results = executeBatchAtomically(db, ids, id => invokeDocHandler(handlers[action], req, id))
    return res.json({ code: 0, data: { processed: ids.length, action, results } })
  } catch (error: any) {
    const status = error instanceof BatchActionHttpError ? error.statusCode : 400
    const failed = error instanceof BatchActionHttpError && error.docId ? byId.get(error.docId) : null
    return res.status(status).json({ code: status, message: `${failed?.doc_no ? `单据 ${failed.doc_no}：` : ''}${error?.message || '批量操作失败'}` })
  }
})

// ══ 生产模块增强 Phase 1：工作中心 / 工艺路线 / 生产报工 ══════════════════════
function nextSeqNo(db: ReturnType<typeof getDb>, table: string, col: string, aid: string, prefix: string): string {
  const now = new Date()
  const p = `${prefix}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`
  const rows = db.prepare(`SELECT ${col} v FROM ${table} WHERE account_set_id=? AND ${col} LIKE ?`).all(aid, `${p}%`) as any[]
  let max = 0
  for (const r of rows) { const m = String(r.v).match(/(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)) }
  return p + String(max + 1).padStart(3, '0')
}

// ── 工作中心 ──
router.get('/scm/work-centers', (req: AuthRequest, res) => {
  res.json({ code: 0, data: getDb().prepare('SELECT * FROM scm_work_center WHERE account_set_id=? ORDER BY code').all(asid(req)) })
})
router.post('/scm/work-centers', operationLog('工作中心新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body; const aid = asid(req)
  if (!b.code || !b.name) return res.status(400).json({ code: 400, message: '编码和名称不能为空' })
  if (db.prepare('SELECT id FROM scm_work_center WHERE account_set_id=? AND code=?').get(aid, b.code)) return res.status(409).json({ code: 409, message: '编码已存在' })
  const id = uuidv4()
  db.prepare(`INSERT INTO scm_work_center (id,account_set_id,code,name,category,labor_rate,overhead_rate,enabled,remark) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, aid, b.code, b.name, b.category || 'inhouse', Number(b.labor_rate) || 0, Number(b.overhead_rate) || 0, b.enabled === 0 ? 0 : 1, b.remark ?? null)
  res.json({ code: 0, data: { id } })
})
router.put('/scm/work-centers/:id', operationLog('工作中心修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body; const aid = asid(req)
  db.prepare(`UPDATE scm_work_center SET name=?,category=?,labor_rate=?,overhead_rate=?,enabled=?,remark=?,updated_at=datetime('now') WHERE id=? AND account_set_id=?`)
    .run(b.name, b.category || 'inhouse', Number(b.labor_rate) || 0, Number(b.overhead_rate) || 0, b.enabled === 0 ? 0 : 1, b.remark ?? null, req.params.id, aid)
  res.json({ code: 0, data: { ok: true } })
})
router.delete('/scm/work-centers/:id', operationLog('工作中心删除', '供应链'), (req: AuthRequest, res) => {
  getDb().prepare('DELETE FROM scm_work_center WHERE id=? AND account_set_id=?').run(req.params.id, asid(req))
  res.json({ code: 0, data: { ok: true } })
})

// ── 工艺路线 ──
router.get('/scm/routings', (req: AuthRequest, res) => {
  const db = getDb(); const { item_code } = req.query as any
  const conds = ['r.account_set_id=?']; const ps: any[] = [asid(req)]
  if (item_code) { conds.push('r.item_code=?'); ps.push(item_code) }
  res.json({ code: 0, data: db.prepare(`SELECT r.*, i.name AS item_name FROM scm_routing r LEFT JOIN scm_item i ON i.account_set_id=r.account_set_id AND i.code=r.item_code WHERE ${conds.join(' AND ')} ORDER BY r.code`).all(...ps) })
})
router.get('/scm/routings/next-no', (req: AuthRequest, res) => res.json({ code: 0, data: { next_no: nextSeqNo(getDb(), 'scm_routing', 'code', asid(req), 'RT') } }))
router.get('/scm/routings/:id', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const r = db.prepare('SELECT * FROM scm_routing WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!r) return res.status(404).json({ code: 404, message: '工艺路线不存在' })
  r.lines = db.prepare(`SELECT l.*, w.name AS work_center_name FROM scm_routing_line l LEFT JOIN scm_work_center w ON w.account_set_id=l.account_set_id AND w.code=l.work_center_code WHERE l.routing_id=? ORDER BY l.seq`).all(req.params.id)
  res.json({ code: 0, data: r })
})
function writeRoutingLines(db: ReturnType<typeof getDb>, aid: string, routingId: string, lines: any[]) {
  db.prepare('DELETE FROM scm_routing_line WHERE routing_id=?').run(routingId)
  const ins = db.prepare('INSERT INTO scm_routing_line (id,account_set_id,routing_id,seq,process_name,work_center_code,std_hours,is_outsource,remark) VALUES (?,?,?,?,?,?,?,?,?)')
  let seq = 0
  for (const l of (Array.isArray(lines) ? lines : [])) {
    if (!l || !l.process_name) continue
    seq++
    ins.run(uuidv4(), aid, routingId, seq, l.process_name, l.work_center_code ?? null, Number(l.std_hours) || 0, l.is_outsource ? 1 : 0, l.remark ?? null)
  }
}
router.post('/scm/routings', operationLog('工艺路线新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body; const aid = asid(req)
  if (!b.code || !b.item_code) return res.status(400).json({ code: 400, message: '编码和成品不能为空' })
  if (db.prepare('SELECT id FROM scm_routing WHERE account_set_id=? AND code=?').get(aid, b.code)) return res.status(409).json({ code: 409, message: '编码已存在' })
  const id = uuidv4()
  db.transaction(() => {
    db.prepare('INSERT INTO scm_routing (id,account_set_id,code,name,item_code,status,remark) VALUES (?,?,?,?,?,?,?)').run(id, aid, b.code, b.name ?? null, b.item_code, b.status || 'active', b.remark ?? null)
    writeRoutingLines(db, aid, id, b.lines)
  })()
  res.json({ code: 0, data: { id } })
})
router.put('/scm/routings/:id', operationLog('工艺路线修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body; const aid = asid(req)
  if (!db.prepare('SELECT id FROM scm_routing WHERE id=? AND account_set_id=?').get(req.params.id, aid)) return res.status(404).json({ code: 404, message: '工艺路线不存在' })
  db.transaction(() => {
    db.prepare(`UPDATE scm_routing SET name=?,item_code=?,status=?,remark=?,updated_at=datetime('now') WHERE id=? AND account_set_id=?`).run(b.name ?? null, b.item_code, b.status || 'active', b.remark ?? null, req.params.id, aid)
    writeRoutingLines(db, aid, req.params.id, b.lines)
  })()
  res.json({ code: 0, data: { ok: true } })
})
router.delete('/scm/routings/:id', operationLog('工艺路线删除', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  db.transaction(() => {
    db.prepare('DELETE FROM scm_routing_line WHERE routing_id=?').run(req.params.id)
    db.prepare('DELETE FROM scm_routing WHERE id=? AND account_set_id=?').run(req.params.id, aid)
  })()
  res.json({ code: 0, data: { ok: true } })
})

// ── 生产报工 ──
router.get('/scm/work-reports', (req: AuthRequest, res) => {
  const db = getDb(); const { plan_id } = req.query as any
  const conds = ['wr.account_set_id=?']; const ps: any[] = [asid(req)]
  if (plan_id) { conds.push('wr.plan_id=?'); ps.push(plan_id) }
  res.json({ code: 0, data: db.prepare(`SELECT wr.*, pp.code AS plan_code, w.name AS work_center_name
    FROM scm_work_report wr LEFT JOIN scm_production_plan pp ON pp.id=wr.plan_id
    LEFT JOIN scm_work_center w ON w.account_set_id=wr.account_set_id AND w.code=wr.work_center_code
    WHERE ${conds.join(' AND ')} ORDER BY wr.report_date DESC, wr.created_at DESC`).all(...ps) })
})
router.get('/scm/work-reports/next-no', (req: AuthRequest, res) => res.json({ code: 0, data: { next_no: nextSeqNo(getDb(), 'scm_work_report', 'report_no', asid(req), 'WR') } }))
// 报工人工/制费金额 = 工时 × 工作中心费率（建单/改单时算好存库）
function calcReportAmounts(db: ReturnType<typeof getDb>, aid: string, b: any) {
  const wc = b.work_center_code ? db.prepare('SELECT labor_rate, overhead_rate FROM scm_work_center WHERE account_set_id=? AND code=?').get(aid, b.work_center_code) as any : null
  const hrs = Number(b.work_hours) || 0
  return { labor: Math.round(hrs * (Number(wc?.labor_rate) || 0) * 100) / 100, overhead: Math.round(hrs * (Number(wc?.overhead_rate) || 0) * 100) / 100 }
}
router.post('/scm/work-reports', operationLog('生产报工新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body; const aid = asid(req)
  if (!b.plan_id) return res.status(400).json({ code: 400, message: '请选择工单' })
  const qtyError = validateWorkReportQty(db, aid, {
    planId: b.plan_id, productId: b.product_id, qty: b.qty, scrapQty: b.scrap_qty,
  })
  if (qtyError) return res.status(400).json({ code: 400, message: qtyError })
  const { labor, overhead } = calcReportAmounts(db, aid, b)
  const id = uuidv4(); const no = b.report_no || nextSeqNo(db, 'scm_work_report', 'report_no', aid, 'WR')
  db.prepare(`INSERT INTO scm_work_report (id,account_set_id,plan_id,product_id,report_no,report_date,item_code,process_name,work_center_code,qty,scrap_qty,work_hours,labor_amount,overhead_amount,operator,remark,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft')`).run(
    id, aid, b.plan_id, b.product_id ?? null, no, b.report_date || new Date().toISOString().slice(0, 10), b.item_code ?? null, b.process_name ?? null, b.work_center_code ?? null,
    Number(b.qty) || 0, Number(b.scrap_qty) || 0, Number(b.work_hours) || 0, labor, overhead, userName(req), b.remark ?? null)
  res.json({ code: 0, data: { id, report_no: no } })
})
router.put('/scm/work-reports/:id', operationLog('生产报工修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body; const aid = asid(req)
  const ex = db.prepare('SELECT status, plan_id FROM scm_work_report WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!ex) return res.status(404).json({ code: 404, message: '报工单不存在' })
  if (ex.status === 'audited') return res.status(400).json({ code: 400, message: '已审核报工不可修改' })
  const qtyError = validateWorkReportQty(db, aid, {
    planId: b.plan_id || ex.plan_id, productId: b.product_id, qty: b.qty, scrapQty: b.scrap_qty,
    excludeReportId: req.params.id,
  })
  if (qtyError) return res.status(400).json({ code: 400, message: qtyError })
  const { labor, overhead } = calcReportAmounts(db, aid, b)
  db.prepare(`UPDATE scm_work_report SET product_id=?,report_date=?,item_code=?,process_name=?,work_center_code=?,qty=?,scrap_qty=?,work_hours=?,labor_amount=?,overhead_amount=?,remark=? WHERE id=? AND account_set_id=?`)
    .run(b.product_id ?? null, b.report_date, b.item_code ?? null, b.process_name ?? null, b.work_center_code ?? null, Number(b.qty) || 0, Number(b.scrap_qty) || 0, Number(b.work_hours) || 0, labor, overhead, b.remark ?? null, req.params.id, aid)
  res.json({ code: 0, data: { ok: true } })
})
router.post('/scm/work-reports/:id/audit', operationLog('生产报工审核', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const ex = db.prepare('SELECT status FROM scm_work_report WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!ex) return res.status(404).json({ code: 404, message: '报工单不存在' })
  if (ex.status === 'audited') return res.status(400).json({ code: 400, message: '已审核' })
  db.prepare("UPDATE scm_work_report SET status='audited', auditor=?, audited_at=datetime('now') WHERE id=?").run(userName(req), req.params.id)
  res.json({ code: 0, data: { ok: true } })
})
router.post('/scm/work-reports/:id/unaudit', operationLog('生产报工反审核', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const ex = db.prepare('SELECT wr.status, wr.plan_id FROM scm_work_report wr WHERE wr.id=? AND wr.account_set_id=?').get(req.params.id, aid) as any
  if (!ex) return res.status(404).json({ code: 404, message: '报工单不存在' })
  if (ex.status !== 'audited') return res.status(400).json({ code: 400, message: '仅已审核可反审核' })
  // 安全网：该工单已有完工入库（人工/制费已上卷）时禁止反审核报工
  const finished = db.prepare("SELECT COUNT(*) c FROM scm_doc WHERE account_set_id=? AND plan_id=? AND doc_type='PF' AND status='audited'").get(aid, ex.plan_id) as any
  if (finished?.c > 0) return res.status(400).json({ code: 400, message: '该工单已有完工入库（人工/制费已结转），请先反审核完工单再反审核报工' })
  db.prepare("UPDATE scm_work_report SET status='draft', auditor=NULL, audited_at=NULL WHERE id=?").run(req.params.id)
  res.json({ code: 0, data: { ok: true } })
})
router.delete('/scm/work-reports/:id', operationLog('生产报工删除', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const ex = db.prepare('SELECT status FROM scm_work_report WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (ex?.status === 'audited') return res.status(400).json({ code: 400, message: '已审核报工不可删除' })
  db.prepare('DELETE FROM scm_work_report WHERE id=? AND account_set_id=?').run(req.params.id, aid)
  res.json({ code: 0, data: { ok: true } })
})

// ══ 生产模块增强 Phase 2：质检单（IQC/IPQC/FQC）+ 不良追溯 ═══════════════════
router.get('/scm/qc-docs', (req: AuthRequest, res) => {
  const db = getDb(); const { qc_type, source_doc_id } = req.query as any
  const conds = ['q.account_set_id=?']; const ps: any[] = [asid(req)]
  if (qc_type) { conds.push('q.qc_type=?'); ps.push(qc_type) }
  if (source_doc_id) { conds.push('q.source_doc_id=?'); ps.push(source_doc_id) }
  res.json({ code: 0, data: db.prepare(`SELECT q.*, p.name AS partner_name,
      (SELECT COALESCE(SUM(defect_qty),0) FROM scm_qc_line WHERE qc_doc_id=q.id) AS defect_total
    FROM scm_qc_doc q LEFT JOIN scm_partner p ON p.account_set_id=q.account_set_id AND p.code=q.partner_code
    WHERE ${conds.join(' AND ')} ORDER BY q.qc_date DESC, q.created_at DESC`).all(...ps) })
})
router.get('/scm/qc-docs/next-no', (req: AuthRequest, res) => {
  const { qc_type } = req.query as any
  const prefix = qc_type === 'FQC' ? 'FQC' : qc_type === 'IPQC' ? 'IPQC' : 'IQC'
  res.json({ code: 0, data: { next_no: nextSeqNo(getDb(), 'scm_qc_doc', 'qc_no', asid(req), prefix) } })
})
router.get('/scm/qc-docs/:id', (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const q = db.prepare('SELECT * FROM scm_qc_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!q) return res.status(404).json({ code: 404, message: '质检单不存在' })
  q.lines = db.prepare('SELECT l.*, i.name AS item_name, i.spec, i.unit FROM scm_qc_line l LEFT JOIN scm_item i ON i.account_set_id=l.account_set_id AND i.code=l.item_code WHERE l.qc_doc_id=? ORDER BY l.seq').all(req.params.id)
  res.json({ code: 0, data: q })
})
function writeQcLines(db: ReturnType<typeof getDb>, aid: string, qcId: string, lines: any[]) {
  db.prepare('DELETE FROM scm_qc_line WHERE qc_doc_id=?').run(qcId)
  const ins = db.prepare('INSERT INTO scm_qc_line (id,account_set_id,qc_doc_id,seq,item_code,batch_no,inspect_qty,qualified_qty,defect_qty,defect_reason,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  let seq = 0
  for (const l of (Array.isArray(lines) ? lines : [])) {
    if (!l || !l.item_code) continue
    seq++
    ins.run(uuidv4(), aid, qcId, seq, l.item_code, l.batch_no ?? null, Number(l.inspect_qty) || 0, Number(l.qualified_qty) || 0, Number(l.defect_qty) || 0, l.defect_reason ?? null, l.remark ?? null)
  }
}
router.post('/scm/qc-docs', operationLog('质检单新增', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body; const aid = asid(req)
  const no = b.qc_no || nextSeqNo(db, 'scm_qc_doc', 'qc_no', aid, b.qc_type === 'FQC' ? 'FQC' : b.qc_type === 'IPQC' ? 'IPQC' : 'IQC')
  const id = uuidv4()
  db.transaction(() => {
    db.prepare(`INSERT INTO scm_qc_doc (id,account_set_id,qc_no,qc_type,qc_date,source_doc_type,source_doc_id,source_doc_no,partner_code,inspector,result,status,remark,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`).run(
      id, aid, no, b.qc_type || 'IQC', b.qc_date || new Date().toISOString().slice(0, 10), b.source_doc_type ?? null, b.source_doc_id ?? null, b.source_doc_no ?? null,
      b.partner_code ?? null, b.inspector ?? userName(req), b.result || 'pass', b.remark ?? null, userName(req))
    writeQcLines(db, aid, id, b.lines)
  })()
  res.json({ code: 0, data: { id, qc_no: no } })
})
router.put('/scm/qc-docs/:id', operationLog('质检单修改', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const b = req.body; const aid = asid(req)
  const ex = db.prepare('SELECT status FROM scm_qc_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!ex) return res.status(404).json({ code: 404, message: '质检单不存在' })
  if (ex.status === 'audited') return res.status(400).json({ code: 400, message: '已审核质检单不可修改' })
  db.transaction(() => {
    db.prepare(`UPDATE scm_qc_doc SET qc_type=?,qc_date=?,source_doc_type=?,source_doc_id=?,source_doc_no=?,partner_code=?,inspector=?,result=?,remark=?,updated_at=datetime('now') WHERE id=? AND account_set_id=?`)
      .run(b.qc_type || 'IQC', b.qc_date, b.source_doc_type ?? null, b.source_doc_id ?? null, b.source_doc_no ?? null, b.partner_code ?? null, b.inspector ?? null, b.result || 'pass', b.remark ?? null, req.params.id, aid)
    if (Array.isArray(b.lines)) writeQcLines(db, aid, req.params.id, b.lines)
  })()
  res.json({ code: 0, data: { ok: true } })
})
router.post('/scm/qc-docs/:id/audit', operationLog('质检单审核', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const ex = db.prepare('SELECT status FROM scm_qc_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!ex) return res.status(404).json({ code: 404, message: '质检单不存在' })
  if (ex.status === 'audited') return res.status(400).json({ code: 400, message: '已审核' })
  db.prepare("UPDATE scm_qc_doc SET status='audited', auditor=?, audited_at=datetime('now') WHERE id=?").run(userName(req), req.params.id)
  res.json({ code: 0, data: { ok: true } })
})
router.post('/scm/qc-docs/:id/unaudit', operationLog('质检单反审核', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const ex = db.prepare('SELECT status FROM scm_qc_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (!ex) return res.status(404).json({ code: 404, message: '质检单不存在' })
  if (ex.status !== 'audited') return res.status(400).json({ code: 400, message: '仅已审核可反审核' })
  db.prepare("UPDATE scm_qc_doc SET status='draft', auditor=NULL, audited_at=NULL WHERE id=?").run(req.params.id)
  res.json({ code: 0, data: { ok: true } })
})
// 质检单不良明细 → 一键生成不良品入库单(PS) 草稿。
// body: { plan_id?, warehouse_code? }；plan_id 缺省取质检单来源（source_doc_type='production_plan'）。
router.post('/scm/qc-docs/:id/gen-defect', operationLog('质检单下推不良品入库', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const qc = db.prepare('SELECT * FROM scm_qc_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  const planId = req.body?.plan_id || (qc?.source_doc_type === 'production_plan' ? qc.source_doc_id : null)
  const defectLines = qc ? getQcDefectLines(db, aid, qc.id) : []
  const err = validateQcDefectPush(qc, planId, defectLines)
  if (err) return res.status(qc ? 400 : 404).json({ code: qc ? 400 : 404, message: err })

  const plan = db.prepare('SELECT * FROM scm_production_plan WHERE id=? AND account_set_id=?').get(planId, aid) as any
  if (!plan) return res.status(400).json({ code: 400, message: '关联工单不存在' })
  if (plan.status !== 'released') return res.status(400).json({ code: 400, message: '请先审核工单再下推不良品入库' })

  const existing = db.prepare("SELECT doc_no FROM scm_doc WHERE account_set_id=? AND source_doc_id=? AND doc_type='PS' AND status<>'voided' LIMIT 1")
    .get(aid, qc.id) as any
  if (existing) return res.status(400).json({ code: 400, message: `该质检单已下推不良品入库单 ${existing.doc_no}，请勿重复下推` })

  const wh = req.body?.warehouse_code || plan.fp_warehouse || null
  if (!wh) return res.status(400).json({ code: 400, message: '请指定不良品入库仓库（工单未设成品仓）' })
  const docNo = nextDocNo(db, aid, 'PS')
  const docId = uuidv4()
  db.transaction(() => {
    db.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,warehouse_code,operator,maker,status,plan_id,source_doc_id,total_qty,total_amount,remark,field_values)
      VALUES (?,?,'PS',?,?,?,?,?,'draft',?,?,?,0,?, '{}')`).run(
      docId, aid, docNo, qc.qc_date || new Date().toISOString().slice(0, 10), wh, userName(req), userName(req),
      plan.id, qc.id, r6(defectLines.reduce((sum, l) => sum + l.qty, 0)), `质检单 ${qc.qc_no} 不良品入库`,
    )
    const ins = prepareDocLineInsert(db)
    let seq = 0
    for (const l of defectLines) {
      seq++
      ins.run(...buildDocLineRow(aid, docId, seq, {
        item_code: l.item_code, warehouse_code: wh, qty: l.qty, price: 0,
        batch_no: l.batch_no, remark: l.remark,
      }, wh).values)
    }
  })()
  res.json({ code: 0, data: { id: docId, doc_no: docNo } })
})

router.delete('/scm/qc-docs/:id', operationLog('质检单删除', '供应链'), (req: AuthRequest, res) => {
  const db = getDb(); const aid = asid(req)
  const ex = db.prepare('SELECT status FROM scm_qc_doc WHERE id=? AND account_set_id=?').get(req.params.id, aid) as any
  if (ex?.status === 'audited') return res.status(400).json({ code: 400, message: '已审核质检单不可删除' })
  db.transaction(() => {
    db.prepare('DELETE FROM scm_qc_line WHERE qc_doc_id=?').run(req.params.id)
    db.prepare('DELETE FROM scm_qc_doc WHERE id=? AND account_set_id=?').run(req.params.id, aid)
  })()
  res.json({ code: 0, data: { ok: true } })
})

export default router
