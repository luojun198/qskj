import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import type { ExportColumnSpec, StyledXlsxRowSource } from '../services/styledExcelExport.js'

async function writeStyledXlsxToStream(
  ...args: Parameters<typeof import('../services/styledExcelExport.js').writeStyledXlsxToStream>
) {
  const module = await import('../services/styledExcelExport.js')
  return module.writeStyledXlsxToStream(...args)
}

function ensureXlsxFileName(value: string) {
  const safe = String(value || 'export').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
  return safe.toLowerCase().endsWith('.xlsx') ? safe : `${safe}.xlsx`
}

const router = Router()
router.use(authMiddleware)

/** 行数硬上限：Excel 单表上限约 104 万，这里给一个安全上限 */
const MAX_EXPORT_ROWS = 500000

/** 列树取叶子 key（参数模式下每个叶子列都必须带 key） */
function collectLeafKeys(columns: any[], out: (string | undefined)[] = []): (string | undefined)[] {
  for (const column of columns) {
    if (Array.isArray(column?.children) && column.children.length) collectLeafKeys(column.children, out)
    else out.push(typeof column?.key === 'string' ? column.key : undefined)
  }
  return out
}

/**
 * 通用「带样式表格」导出，两种模式：
 *  - spec 模式：前端把表格解析为「列树 + 已解析单元格矩阵」`rows` 发来，服务端生成 xlsx；
 *  - 参数模式（FIX-254）：`source: { type, params }`，前端只发筛选参数，列定义每列带 `key`，
 *    服务端自己查询、映射、流式生成——十万级序时账导出浏览器不再持有任何数据。
 * 两种模式都逐行流式写入响应，且每 2,000 行让出事件循环，导出期间其他请求不被阻塞。
 */
router.post('/styled-xlsx', async (req: AuthRequest, res) => {
  const { fileName, sheetName, title, subtitle, columns, rows, subtotalRows, summaryValues, stripe, source } =
    req.body || {}

  if (!Array.isArray(columns) || columns.length === 0) {
    return res.status(400).json({ code: 400, message: '缺少列定义' })
  }

  let rowSource: StyledXlsxRowSource
  if (source && typeof source === 'object') {
    const { EXPORT_SOURCES } = await import('../services/exportSources.js')
    const exportSource = EXPORT_SOURCES[String(source.type)]
    if (!exportSource) {
      return res.status(400).json({ code: 400, message: `不支持的导出数据源：${source.type}` })
    }
    // FIX-326：参数模式导出按数据源校验权限（此前只校验登录）
    const perms = req.permissions || []
    if (!perms.includes('*') && !exportSource.permissions.some(p => perms.includes(p))) {
      return res.status(403).json({ code: 403, message: '无此操作权限' })
    }
    const leafKeys = collectLeafKeys(columns)
    const badKey = leafKeys.find(key => !key || !(exportSource.keys.includes(key) || exportSource.keyPrefixes?.some(p => key.startsWith(p))))
    if (badKey !== undefined || leafKeys.some(key => !key)) {
      return res.status(400).json({ code: 400, message: `列定义缺少 key 或 key 不受支持：${badKey ?? '(空)'}` })
    }
    const ctx = {
      db: getDb(),
      accountSetId: req.accountSetId || '',
      accountScope: req.accountScope,
    }
    const params = source.params && typeof source.params === 'object' ? source.params : {}
    // 出纳日记账按科目授权（与 /cashier/journal 同口径）
    if (String(source.type) === 'cashierJournal' && req.accountScope?.restricted && !req.accountScope.bypass) {
      const { assertAccountIdInScope } = await import('../services/accountAuthorization.js')
      const acc = ctx.db.prepare('SELECT id FROM accounts WHERE account_set_id=? AND code=?').get(ctx.accountSetId, String((params as any).account_code || '')) as { id: string } | undefined
      const scopeErr = acc ? assertAccountIdInScope(req.accountScope, acc.id) : null
      if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })
    }
    let total: number
    try {
      total = exportSource.count(ctx, params)
    } catch (e: any) {
      return res.status(400).json({ code: 400, message: e?.message || '导出参数错误' })
    }
    if (total > MAX_EXPORT_ROWS) {
      return res
        .status(400)
        .json({ code: 400, message: `导出行数超过上限（${MAX_EXPORT_ROWS}），请缩小筛选范围` })
    }
    rowSource = exportSource.rows(ctx, params, leafKeys as string[])
  } else {
    if (!Array.isArray(rows)) {
      return res.status(400).json({ code: 400, message: '缺少数据行' })
    }
    if (rows.length > MAX_EXPORT_ROWS) {
      return res
        .status(400)
        .json({ code: 400, message: `导出行数超过上限（${MAX_EXPORT_ROWS}），请缩小筛选范围` })
    }
    rowSource = rows as (string | number | null)[][]
  }

  const safeName = ensureXlsxFileName(
    typeof fileName === 'string' && fileName.trim() ? fileName.trim() : '导出.xlsx'
  )
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}"`)

  try {
    await writeStyledXlsxToStream(
      {
        sheetName: typeof sheetName === 'string' ? sheetName : undefined,
        title: typeof title === 'string' ? title : undefined,
        subtitle: typeof subtitle === 'string' ? subtitle : undefined,
        columns: columns as ExportColumnSpec[],
        rows: rowSource,
        subtotalRows: Array.isArray(subtotalRows) ? subtotalRows : undefined,
        summaryValues: Array.isArray(summaryValues) ? summaryValues : undefined,
        stripe: stripe !== false,
      },
      res
    )
  } catch (error: any) {
    // 流已开始写就无法再回 JSON，只能中断连接并记日志；未开始写时返回 500
    console.error('[export] styled-xlsx 生成失败：', error?.message || error)
    if (!res.headersSent) {
      res.status(500).json({ code: 500, message: error?.message || '导出失败' })
    } else {
      res.destroy(error)
    }
  }
})

export default router
