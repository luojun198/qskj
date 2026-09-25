/**
 * 银行对账单 Excel 导入（任意格式 + 自定义列映射）
 *
 * POST /api/cashier/bank-statement/import          — 上传文件 → 解析全部工作表，返回预览
 * POST /api/cashier/bank-statement/import/confirm  — 按工作表 / 表头行 / 列映射生成出纳日记账（dry_run 只试算；默认跳过疑似重复）
 * GET  /api/cashier/bank-statement/import/profiles — 已保存的列映射配置（按银行科目）
 * GET / POST /api/cashier/bank-statement/import/schemes、DELETE .../schemes/:id — 命名映射方案（账套内共用）
 *
 * FIX-259：不再固定第一个工作表；映射支持「借方列 + 贷方列」与「金额列 + 方向标志列（或正负号）」两种模式；
 * 新增摘要 / 对方户名 / 对方账号 / 余额；金额去千分位与货币符号；映射配置附带表头文字，下次按表头名回填。
 * FIX-262：对账单不再写 bank_statement、不再作为对账对象，确认导入直接生成出纳日记账（出纳对账改为对总账分录）。
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import { cashierPermissionGuard } from '../middleware/cashierPermission.js'
import { assertAccountIdInScope } from '../services/accountAuthorization.js'
import { normalizeBizDate } from '../services/cashierPeriodClosing.js'
import { importJournalRows, type JournalImportRow } from '../services/cashierJournalImport.js'
import { convertStatementRows, validateMapping, type AmountMode } from '../services/bankStatementImport.js'
import { listImportSchemes, saveImportScheme, deleteImportScheme } from '../services/bankImportScheme.js'
import { fixGarbledFilename } from '../utils/uploadFilename.js'

const router = Router()
router.use(authMiddleware)
// P2-13：显式挂权限守卫，不再依赖 index.ts 里 cashierRoutes 先于本路由挂载
router.use(cashierPermissionGuard)
/** FIX-254：10 万行 xlsx 约 16MB，原 20MB 上限约 12 万行就会 413；放宽到 50MB 并给出明确文案 */
const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_FILE_BYTES } })
/** 预览返回的样例行数（要足够让用户在其中找到表头行） */
const SAMPLE_ROWS = 20

// 预览缓存（内存，仅本进程有效）：按工作表名缓存行数组
const previewCache = new Map<string, { sheets: Record<string, any[][]>; fileName: string }>()

router.post('/cashier/bank-statement/import', (req, res, next) => {
  upload.single('file')(req, res, (err: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ code: 413, message: `文件超过 ${MAX_IMPORT_FILE_BYTES / 1024 / 1024}MB 上限，请按约 30 万行/份拆分后分批导入` })
    }
    next(err)
  })
}, async (req: AuthRequest, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ code: 400, message: '请选择文件' })

  const XLSX = await import('xlsx')
  let wb
  try {
    wb = XLSX.read(file.buffer, { type: 'buffer' })
  } catch {
    return res.status(400).json({ code: 400, message: '文件解析失败，请确认为 Excel / CSV 格式' })
  }
  const sheets: Record<string, any[][]> = {}
  const summary: Array<{ name: string; total_rows: number; sample_rows: any[][] }> = []
  for (const name of wb.SheetNames) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false })
    sheets[name] = rows
    summary.push({ name, total_rows: rows.length, sample_rows: rows.slice(0, SAMPLE_ROWS) })
  }
  if (!summary.some(s => s.total_rows >= 2)) {
    return res.status(400).json({ code: 400, message: '文件为空或只有表头' })
  }

  const previewId = uuidv4()
  // FIX-261：中文文件名按 latin1 解析后是乱码，还原为 UTF-8
  const fileName = fixGarbledFilename(file.originalname)
  previewCache.set(previewId, { sheets, fileName })
  // 5 分钟后过期
  setTimeout(() => previewCache.delete(previewId), 300000)

  res.json({
    code: 0,
    data: {
      preview_id: previewId,
      filename: fileName,
      sheets: summary,
    },
  })
})

router.post('/cashier/bank-statement/import/confirm', (req: AuthRequest, res) => {
  const {
    preview_id, account_code, mapping, sheet_name,
    amount_mode = 'dc', direction_in_values = [], header_labels = [],
  } = req.body
  if (!preview_id || !account_code || !mapping) {
    return res.status(400).json({ code: 400, message: '缺少必要参数' })
  }

  const cached = previewCache.get(preview_id)
  if (!cached) return res.status(400).json({ code: 400, message: '预览已过期，请重新上传' })

  const sheetName = sheet_name && cached.sheets[sheet_name] ? sheet_name : Object.keys(cached.sheets)[0]
  const rows = cached.sheets[sheetName]
  if (!rows) return res.status(400).json({ code: 400, message: '工作表不存在' })

  // 兼容旧协议：skip_rows / header_row → data_start_row
  const header_row = Number.isFinite(Number(req.body.header_row)) && req.body.header_row !== undefined ? Number(req.body.header_row) : -1
  let dataStartRow: number
  if (req.body.data_start_row !== undefined && Number.isFinite(Number(req.body.data_start_row))) dataStartRow = Number(req.body.data_start_row)
  else if (header_row >= 0) dataStartRow = header_row + 1
  else dataStartRow = Number(req.body.skip_rows) || 0

  const db = getDb()
  const asid = req.accountSetId || ''
  // P1-10：科目授权
  const accRow = db.prepare('SELECT id FROM accounts WHERE account_set_id=? AND code=?').get(asid, account_code) as any
  const scopeErr = accRow ? assertAccountIdInScope(req.accountScope, accRow.id) : null
  if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })

  const mode: AmountMode = amount_mode === 'single' ? 'single' : 'dc'
  const inValues = (Array.isArray(direction_in_values) ? direction_in_values : []).map((v: any) => String(v).trim()).filter(Boolean)
  const mappingErr = validateMapping(mapping, mode, inValues)
  if (mappingErr) return res.status(400).json({ code: 400, message: mappingErr })

  const dryRun = !!req.body.dry_run
  // 保存列映射配置（附带表头文字，下次按表头名回填）；试算不保存
  if (!dryRun) {
    const profileKey = `cashier:bank_import_profile:${account_code}`
    db.prepare(`
      INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuidv4(), asid, profileKey, JSON.stringify({
      sheet_name: sheetName, header_row, data_start_row: dataStartRow, amount_mode: mode,
      mapping, direction_in_values: inValues, header_labels,
    }), `银行对账单导入列映射: ${account_code}`)
  }

  // FIX-262：对账单只作导入工具——解析后直接生成出纳日记账（期间闸 / 金额校验 / 汇率 / 序号 / 疑似重复见 importJournalRows）
  const parsed = convertStatementRows(rows, {
    mapping, headerRow: header_row, dataStartRow, amountMode: mode, directionInValues: inValues,
    resolveDate: (raw: unknown) => normalizeBizDate(raw),
  })
  // 对账单上的结算方式是文字，按名称 / 编码对到结算方式字典，对不上留空
  const settleTypes = db.prepare('SELECT code, name FROM settle_type WHERE account_set_id=?').all(asid) as Array<{ code: string; name: string }>
  const settleCode = (text: string | null) => {
    if (!text) return null
    const t = text.trim()
    return settleTypes.find(s => s.name === t || s.code === t)?.code
      ?? settleTypes.find(s => t.includes(s.name) || s.name.includes(t))?.code ?? null
  }
  const journalRows: JournalImportRow[] = parsed.records.map(r => ({
    biz_date: r.biz_date,
    debit: r.debit,
    credit: r.credit,
    summary: r.summary,
    settle_type: settleCode(r.settle_type),
    bill_no: r.bill_no,
    counter_unit: r.counter_name,
    bank_account: r.counter_account,
    row_no: r.row_no,
  }))
  importJournalRows(db, {
    accountSetId: asid,
    accountCode: account_code,
    rows: journalRows,
    maker: (req as any).user?.name || '对账单导入',
    skipDuplicates: req.body.skip_duplicates !== false,
    dryRun,
  }).then(r => {
    if ('error' in r) return res.status(400).json({ code: 400, message: r.error })
    if (!dryRun) previewCache.delete(preview_id)
    const errors = [...parsed.errors, ...r.errors].sort((x, y) => x.row - y.row)
    res.json({ code: 0, data: { inserted: r.inserted, skipped: r.skipped, errors, total: journalRows.length, dry_run: dryRun } })
  }).catch(e => res.status(500).json({ code: 500, message: e?.message || '导入失败' }))
})
/** 获取已保存的列映射配置 */
router.get('/cashier/bank-statement/import/profiles', (req: AuthRequest, res) => {
  const db = getDb()
  const rows = db.prepare(
    "SELECT param_key, param_value FROM system_params WHERE account_set_id=? AND param_key LIKE 'cashier:bank_import_profile:%'"
  ).all(req.accountSetId || '') as any[]
  const profiles: Record<string, any> = {}
  for (const r of rows) {
    const code = r.param_key.split(':').pop() || ''
    profiles[code] = JSON.parse(r.param_value)
  }
  res.json({ code: 0, data: profiles })
})

/** 命名映射方案：列表 / 新建或覆盖 / 删除 */
router.get('/cashier/bank-statement/import/schemes', (req: AuthRequest, res) => {
  res.json({ code: 0, data: listImportSchemes(getDb(), req.accountSetId || '') })
})

router.post('/cashier/bank-statement/import/schemes', (req: AuthRequest, res) => {
  try {
    res.json({ code: 0, data: saveImportScheme(getDb(), req.accountSetId || '', req.body) })
  } catch (e: any) {
    res.status(400).json({ code: 400, message: e?.message || '保存方案失败' })
  }
})

router.delete('/cashier/bank-statement/import/schemes/:id', (req: AuthRequest, res) => {
  if (!deleteImportScheme(getDb(), req.accountSetId || '', req.params.id)) {
    return res.status(404).json({ code: 404, message: '方案不存在或已被删除' })
  }
  res.json({ code: 0, data: null })
})

export default router
