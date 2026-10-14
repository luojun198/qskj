/**
 * 进销存 ACD 独立导入（润衡 POS 备份 → 当前账套进销存模块）
 *
 * 流程：previewScmAcd（只读预检）→ executeScmAcdImport（自动备份 + 事务导入 + 核对）→ revertScmAcdImport（撤销）。
 * 只写 scm_* 表，不碰总账 / 出纳 / 固定资产。计划见 .tasks/嘉之通进销存ACD导入-实施计划.md
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { getCostingMethod, COSTING_METHOD_LABELS } from '../scmCosting.js'
import { SCM_RESET_BUSINESS_TABLES } from '../scmResetTables.js'
import { type AcdTableSet, acdNum, detectScmAcd, parseAcdDate, readAcdMeta, readAcdTables } from './acdTables.js'
import { ensurePlaceholders, importMasterData, type MasterStats } from './master.js'
import { ACD_DOC_TYPE_MAP, ACD_ORDER_TYPE_MAP, collectReferences, type DocIndex, type DocStats, importDocuments } from './documents.js'
import { classifyWldj, type FinanceStats, importFinance } from './finance.js'
import { syncCashierAccountsFromGl } from '../cashierAccount.js'
import { verifyImport, type VerifyReport } from './verify.js'
import { DEFAULT_IMPORT_OPTIONS, type ImportContext, type ImportIssue, type ScmAcdImportOptions } from './types.js'

export { readAcdTables } from './acdTables.js'
export type { ScmAcdImportOptions } from './types.js'

/** 导入沿用润衡成本、不走成本层；按层计价的账套导入后层与结存对不上，先拦住 */
const LAYER_COSTING = new Set(['fifo', 'lifo', 'specified'])

export interface PreviewResult {
  meta: { company: string; linkedAccountSet: string; version: string; fileName?: string }
  dateRange: { from: string | null; to: string | null }
  tables: Array<{ table: string; label: string; rows: number }>
  docTypes: Array<{ acd: string; label: string; target: string | null; count: number; lines: number }>
  orders: Array<{ acd: string; label: string; target: string; count: number }>
  countDocs: number
  /** 第二批：收付款 / 发票 / 对账单 */
  finance: {
    payments: number; receipts: number; paymentAmount: number; receiptAmount: number
    invoices: number; invoiceAmount: number; statements: number
    settleAccounts: Array<{ lx: string; account: string | null; name: string | null; exists: boolean }>
  }
  conflicts: { items: string[]; partners: string[]; warehouses: string[] }
  existing: { docs: number; items: number; partners: number; warehouses: number }
  costingMethod: string
  blockers: string[]
  warnings: string[]
}

const TABLE_LABELS: Array<[string, string]> = [
  ['ckda', '仓库'], ['cpda', '物料'], ['khda', '往来单位'], ['dlk', '物料大类'], ['xlk', '物料小类'],
  ['ht1', '订单'], ['ht2', '订单明细'], ['pjnr1', '出入库单'], ['pjnr2', '出入库明细'], ['pdk', '盘点明细'],
  ['kcb', '当前库存（核对用）'], ['wldj', '往来流水（单据挂账 / 收付款 / 发票）'], ['wl_dzd', '对账单'],
]

const round2 = (n: number) => Math.round(n * 100) / 100

function countRows(db: Database.Database, sql: string, ...p: any[]): number {
  return Number((db.prepare(sql).get(...p) as any)?.c) || 0
}

export function buildPreview(db: Database.Database, aid: string, t: AcdTableSet, fileName?: string): PreviewResult {
  const blockers: string[] = []
  const warnings: string[] = []
  const det = detectScmAcd(t)
  if (!det.ok) blockers.push(det.reason!)
  const meta = { ...readAcdMeta(t), fileName }

  const dates = t.get('pjnr1').map(r => parseAcdDate(r.rq)).filter(Boolean).sort() as string[]
  const lineCount = new Map<string, number>()
  for (const r of t.get('pjnr2')) lineCount.set(r.pjlb, (lineCount.get(r.pjlb) || 0) + 1)
  const docCount = new Map<string, number>()
  for (const r of t.get('pjnr1')) docCount.set(r.pjlb, (docCount.get(r.pjlb) || 0) + 1)
  const labelOf = new Map<string, string>(t.get('dj_lx').map(r => [r.pjlb, r.lb_jc]))
  const docTypes = [...docCount.entries()].map(([acd, count]) => {
    const m = ACD_DOC_TYPE_MAP[acd]
    return { acd, label: labelOf.get(acd) || m?.label || acd, target: m?.type ?? null, count, lines: lineCount.get(acd) || 0 }
  }).sort((a, b) => a.acd.localeCompare(b.acd))
  for (const d of docTypes) if (!d.target) warnings.push(`单据类别「${d.label}」${d.count} 张暂不支持导入，将跳过`)
  const countDocs = new Set([...t.get('pdk').map(r => r.pddh), ...t.get('pjnr2').filter(r => r.pjlb === 'PY' || r.pjlb === 'PK').map(r => r.pjdh)]).size

  const orderCount = new Map<string, number>()
  for (const r of t.get('ht1')) orderCount.set(r.htlb, (orderCount.get(r.htlb) || 0) + 1)
  const orders = [...orderCount.entries()].map(([acd, count]) => ({
    acd, label: ACD_ORDER_TYPE_MAP[acd]?.label || `订单类别 ${acd}`, target: ACD_ORDER_TYPE_MAP[acd]?.type || '', count,
  }))

  const conflictsOf = (table: string, codes: string[]) => {
    if (!codes.length) return []
    const have = new Set((db.prepare(`SELECT code FROM ${table} WHERE account_set_id=?`).all(aid) as any[]).map(r => r.code))
    return codes.filter(c => have.has(c))
  }
  const conflicts = {
    items: conflictsOf('scm_item', t.get('cpda').map(r => r.cpbh).filter(Boolean)),
    partners: conflictsOf('scm_partner', t.get('khda').map(r => r.dwbh).filter(Boolean)),
    warehouses: conflictsOf('scm_warehouse', t.get('ckda').map(r => r.ckbh).filter(Boolean)),
  }
  const existing = {
    docs: countRows(db, 'SELECT COUNT(*) c FROM scm_doc WHERE account_set_id=?', aid),
    items: countRows(db, 'SELECT COUNT(*) c FROM scm_item WHERE account_set_id=?', aid),
    partners: countRows(db, 'SELECT COUNT(*) c FROM scm_partner WHERE account_set_id=?', aid),
    warehouses: countRows(db, 'SELECT COUNT(*) c FROM scm_warehouse WHERE account_set_id=?', aid),
  }
  if (existing.docs > 0) {
    blockers.push(`本账套已有进销存单据 ${existing.docs} 张。第一期只支持全量导入，请先在「系统参数 → 供应链初始化」清空业务数据（会自动备份），或换一个账套`)
  }
  const stockRows = countRows(db, 'SELECT COUNT(*) c FROM scm_stock WHERE account_set_id=? AND ABS(qty) > 0.000001', aid)
  if (!existing.docs && stockRows > 0) blockers.push(`本账套已有库存结存 ${stockRows} 条，请先清空供应链业务数据`)
  const costingMethod = getCostingMethod(db, aid)
  if (LAYER_COSTING.has(costingMethod)) {
    blockers.push(`当前计价方式为「${COSTING_METHOD_LABELS[costingMethod] || costingMethod}」。导入沿用润衡成本，不生成成本层，请先在「系统参数 → 供应链」改为移动加权平均或全月平均`)
  }
  const n = conflicts.items.length + conflicts.partners.length + conflicts.warehouses.length
  if (n) warnings.push(`有 ${n} 个档案编码在本账套已存在，将按「编码冲突处理」选项跳过或覆盖`)
  // 收付款 / 发票：按单号合并后的张数，结算科目是否在本账套出纳账户中
  const { settle, payments, invoices } = classifyWldj(t)
  const groups = (rows: Array<Record<string, string>>, key: (r: Record<string, string>) => string) => new Set(rows.map(key)).size
  const payRows = payments.filter(r => acdNum(r.jf) >= acdNum(r.df))
  const rcvRows = payments.filter(r => acdNum(r.jf) < acdNum(r.df))
  let cashier = new Set<string>()
  try {
    syncCashierAccountsFromGl(db, aid)
    cashier = new Set((db.prepare('SELECT code FROM v_cashier_account WHERE account_set_id=?').all(aid) as any[]).map(r => r.code))
  } catch { /* 旧库无出纳账户视图 */ }
  const settleAccounts = [...settle.entries()].map(([lx, v]) => ({ lx, account: v.account, name: v.name, exists: !!v.account && cashier.has(v.account) }))
  const finance = {
    payments: groups(payRows, r => `${r.lx}|${r.dh}|${r.khbh}`),
    receipts: groups(rcvRows, r => `${r.lx}|${r.dh}|${r.khbh}`),
    paymentAmount: round2(payRows.reduce((a, r) => a + acdNum(r.jf) - acdNum(r.df), 0)),
    receiptAmount: round2(rcvRows.reduce((a, r) => a + acdNum(r.df) - acdNum(r.jf), 0)),
    invoices: groups(invoices, r => `${r.pjlb === 'A' || r.pjlb === 'G' || r.pjlb === 'D' ? 'RS' : 'RP'}|${r.lx}|${r.dh}|${r.khbh}`),
    invoiceAmount: round2(invoices.reduce((a, r) => a + acdNum(r.fpjf) + acdNum(r.fpdf), 0)),
    statements: t.count('wl_dzd'),
    settleAccounts,
  }
  const missing = settleAccounts.filter(a => a.account && !a.exists)
  if ((finance.payments || finance.receipts) && missing.length) {
    warnings.push(`结算科目 ${missing.map(a => `${a.account}（${a.name || a.lx}）`).join('、')} 在本账套出纳账户中不存在，收付款单仍会导入，但结算账户需在出纳账户档案中补建`)
  }

  return {
    meta, dateRange: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    tables: TABLE_LABELS.map(([table, label]) => ({ table, label, rows: t.count(table) })).filter(x => x.rows > 0),
    docTypes, orders, countDocs, finance, conflicts, existing, costingMethod, blockers, warnings,
  }
}

export function previewScmAcd(db: Database.Database, aid: string, buffer: Buffer, fileName?: string): PreviewResult {
  return buildPreview(db, aid, readAcdTables(buffer), fileName)
}

export interface ExecuteResult {
  batchId: string
  stats: { master: MasterStats; documents: DocStats; finance: FinanceStats }
  report: VerifyReport
  issues: ImportIssue[]
}

/** 导入（同步、单事务）。调用方负责先做账套备份。 */
export function executeScmAcdImport(
  db: Database.Database, aid: string, buffer: Buffer,
  params: { fileName?: string; operator: string; options?: Partial<ScmAcdImportOptions>; backupFile?: string | null }
): ExecuteResult {
  const t = readAcdTables(buffer)
  const preview = buildPreview(db, aid, t, params.fileName)
  if (preview.blockers.length) throw new Error(preview.blockers.join('；'))
  const options: ScmAcdImportOptions = { ...DEFAULT_IMPORT_OPTIONS, ...(params.options || {}) }
  if (options.conflict !== 'overwrite') options.conflict = 'skip'
  const batchId = uuidv4()
  const ctx: ImportContext = { accountSetId: aid, batchId, operator: params.operator, options, issues: [] }

  let master!: MasterStats
  let documents!: DocStats
  let finance!: FinanceStats
  db.transaction(() => {
    db.prepare(`INSERT INTO scm_acd_import_batch (id, account_set_id, file_name, company_name, options, status, operator, backup_file, created_at)
      VALUES (?,?,?,?,?, 'running', ?, ?, datetime('now','localtime'))`).run(batchId, aid, params.fileName ?? null, preview.meta.company || null,
      JSON.stringify(options), params.operator, params.backupFile ?? null)
    master = importMasterData(db, t, ctx)
    ensurePlaceholders(db, ctx, master, collectReferences(t))
    const index: DocIndex = new Map()
    documents = importDocuments(db, t, ctx, index)
    finance = importFinance(db, t, ctx, index)
    for (const [k, n] of Object.entries(documents.skipped)) ctx.issues.push({ level: 'warn', category: '单据', message: `${k}：${n} 条未导入` })
  })()
  try { db.pragma('optimize=0x10002') } catch { /* 只读库等情况忽略 */ }

  const report = verifyImport(db, aid, t)
  const stats = { master, documents, finance }
  db.prepare("UPDATE scm_acd_import_batch SET status='done', stats=?, report=? WHERE id=?")
    .run(JSON.stringify(stats), JSON.stringify({ ...report, issues: ctx.issues, preview: { meta: preview.meta, dateRange: preview.dateRange } }), batchId)
  return { batchId, stats, report, issues: ctx.issues }
}

export function listScmAcdBatches(db: Database.Database, aid: string) {
  return (db.prepare(`SELECT id, file_name, company_name, options, stats, status, operator, backup_file, created_at, reverted_at
      FROM scm_acd_import_batch WHERE account_set_id=? ORDER BY created_at DESC`).all(aid) as any[])
    .map(r => ({ ...r, options: safeJson(r.options), stats: safeJson(r.stats) }))
}

export function getScmAcdBatch(db: Database.Database, aid: string, id: string) {
  const r = db.prepare('SELECT * FROM scm_acd_import_batch WHERE id=? AND account_set_id=?').get(id, aid) as any
  if (!r) return null
  return { ...r, options: safeJson(r.options), stats: safeJson(r.stats), report: safeJson(r.report) }
}

function safeJson(s: string | null) {
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

/** 撤销前检查：只允许撤销仍生效的批次，且导入后没有在本系统新增进销存单据 */
export function revertBlocker(db: Database.Database, aid: string, id: string): string | null {
  const b = db.prepare('SELECT status FROM scm_acd_import_batch WHERE id=? AND account_set_id=?').get(id, aid) as any
  if (!b) return '导入批次不存在'
  if (b.status !== 'done') return '该批次已撤销或未完成'
  const others = countRows(db, 'SELECT COUNT(*) c FROM scm_doc WHERE account_set_id=? AND COALESCE(import_batch_id, \'\') <> ?', aid, id)
  if (others > 0) return `导入后本账套又新增了 ${others} 张进销存单据，不能整体撤销；如确需重来，请用「系统参数 → 供应链初始化」清空`
  return null
}

/**
 * 撤销：清空本账套进销存业务数据（导入时已要求无既有单据，故业务数据全部来自本批次），
 * 并删除本批次新建的档案；「覆盖」更新过的既有档案无法还原，可用导入前的备份恢复。
 */
export function revertScmAcdImport(db: Database.Database, aid: string, id: string) {
  const err = revertBlocker(db, aid, id)
  if (err) throw new Error(err)
  const existing = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r => r.name))
  const removed: Record<string, number> = {}
  db.transaction(() => {
    for (const tname of SCM_RESET_BUSINESS_TABLES) {
      if (existing.has(tname)) removed[tname] = db.prepare(`DELETE FROM ${tname} WHERE account_set_id=?`).run(aid).changes
    }
    removed.scm_item_unit = db.prepare(`DELETE FROM scm_item_unit WHERE account_set_id=? AND item_code IN
      (SELECT code FROM scm_item WHERE account_set_id=? AND import_batch_id=?)`).run(aid, aid, id).changes
    for (const tname of ['scm_item', 'scm_partner', 'scm_warehouse', 'scm_item_category', 'scm_unit']) {
      removed[tname] = db.prepare(`DELETE FROM ${tname} WHERE account_set_id=? AND import_batch_id=?`).run(aid, id).changes
    }
    db.prepare("UPDATE scm_acd_import_batch SET status='reverted', reverted_at=datetime('now','localtime') WHERE id=?").run(id)
  })()
  return removed
}
