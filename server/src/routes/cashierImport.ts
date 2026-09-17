/**
 * 银行对账单 Excel 导入
 *
 * POST /api/cashier/bank-statement/import — 上传文件 + 列映射 → 预览
 * POST /api/cashier/bank-statement/import/confirm — 确认写入 bank_statement
 * GET  /api/cashier/bank-statement/import/profiles — 已保存的列映射配置
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import { cashierPermissionGuard } from '../middleware/cashierPermission.js'
import { assertAccountIdInScope } from '../services/accountAuthorization.js'
import { assertCashierPeriodOpen, normalizeBizDate } from '../services/cashierPeriodClosing.js'

const router = Router()
router.use(authMiddleware)
// P2-13：显式挂权限守卫，不再依赖 index.ts 里 cashierRoutes 先于本路由挂载
router.use(cashierPermissionGuard)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

// 预览缓存（内存，仅本进程有效）
const previewCache = new Map<string, { rows: any[][]; fileName: string }>()

router.post('/cashier/bank-statement/import', upload.single('file'), async (req: AuthRequest, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ code: 400, message: '请选择文件' })

  const XLSX = await import('xlsx')
  const wb = XLSX.read(file.buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false })

  if (rows.length < 2) return res.status(400).json({ code: 400, message: '文件为空或只有表头' })

  const previewId = uuidv4()
  previewCache.set(previewId, { rows, fileName: file.originalname })
  // 5 分钟后过期
  setTimeout(() => previewCache.delete(previewId), 300000)

  res.json({
    code: 0,
    data: {
      preview_id: previewId,
      filename: file.originalname,
      total_rows: rows.length,
      sample_rows: rows.slice(0, 10),
    },
  })
})

router.post('/cashier/bank-statement/import/confirm', (req: AuthRequest, res) => {
  const { preview_id, account_code, mapping, skip_rows = 0, header_row = -1 } = req.body
  if (!preview_id || !account_code || !mapping) {
    return res.status(400).json({ code: 400, message: '缺少必要参数' })
  }

  const cached = previewCache.get(preview_id)
  if (!cached) return res.status(400).json({ code: 400, message: '预览已过期，请重新上传' })

  const { rows } = cached
  const db = getDb()
  const asid = req.accountSetId || ''
  // P1-10：科目授权
  const accRow = db.prepare('SELECT id FROM accounts WHERE account_set_id=? AND code=?').get(asid, account_code) as any
  const scopeErr = accRow ? assertAccountIdInScope(req.accountScope, accRow.id) : null
  if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })

  // 构建映射：{ excelColIndex: 'biz_date'|'debit'|'credit'|'bill_no'|'settle_type' }
  const colMap: Record<number, string> = {}
  for (const [field, idx] of Object.entries(mapping)) {
    const n = Number(idx)
    if (Number.isFinite(n) && n >= 0) colMap[n] = field
  }

  let inserted = 0
  const errors: Array<{ row: number; message: string }> = []
  const insert = db.prepare(`
    INSERT INTO bank_statement (id, account_set_id, account_code, biz_date, debit, credit, settle_type, bill_no, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import')
  `)

  // 保存列映射配置
  const profileKey = `cashier:bank_import_profile:${account_code}`
  db.prepare(`
    INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), asid, profileKey, JSON.stringify({ mapping, skip_rows, header_row }),
    `银行对账单导入列映射: ${account_code}`)

  const txn = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      if (i === header_row || i < skip_rows) continue
      const row = rows[i]
      const date = typeof colMap[Object.keys(colMap).find(k => colMap[Number(k)] === 'biz_date') as any] !== 'undefined'
        ? row[Number(Object.keys(colMap).find(k => colMap[Number(k)] === 'biz_date'))] : ''
      if (!date) continue
      // P1-6 / P1-7：日期严格规范化（含 Excel 序列号）+ 出纳已结账月份拒绝写入
      let dateStr: string
      try {
        dateStr = normalizeBizDate(date)
        assertCashierPeriodOpen(db, asid, dateStr)
      } catch (e: any) {
        errors.push({ row: i + 1, message: e.message })
        continue
      }

      insert.run(
        uuidv4(), asid, account_code, dateStr,
        safeNum(row, colMap, 'debit'),
        safeNum(row, colMap, 'credit'),
        rowCol(row, colMap, 'settle_type') || null,
        rowCol(row, colMap, 'bill_no') || null
      )
      inserted++
    }
  })
  txn()

  previewCache.delete(preview_id)
  res.json({ code: 0, data: { inserted, errors } })
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

// ── 工具函数 ──────────────────────────────────────────────

function safeNum(row: any[], colMap: Record<number, string>, field: string): number {
  const idx = Number(Object.keys(colMap).find(k => colMap[Number(k)] === field))
  if (isNaN(idx) || idx < 0) return 0
  const v = row[idx]
  if (v == null || v === '') return 0
  return Number(v) || 0
}

function rowCol(row: any[], colMap: Record<number, string>, field: string): string {
  const idx = Number(Object.keys(colMap).find(k => colMap[Number(k)] === field))
  if (isNaN(idx) || idx < 0) return ''
  return String(row[idx] ?? '').trim()
}

export default router
