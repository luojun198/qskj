import { Router } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import type { ExportColumnSpec } from '../services/styledExcelExport.js'

async function buildStyledXlsxBuffer(options: any) {
  const module = await import('../services/styledExcelExport.js')
  return module.buildStyledXlsxBuffer(options)
}

function ensureXlsxFileName(value: string) {
  const safe = String(value || 'export').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
  return safe.toLowerCase().endsWith('.xlsx') ? safe : `${safe}.xlsx`
}

const router = Router()
router.use(authMiddleware)

/** 行数硬上限：Excel 单表上限约 104 万，这里给一个安全上限 */
const MAX_EXPORT_ROWS = 500000

/**
 * 通用「带样式表格」导出：前端把表格解析为 spec（列树 + 已解析单元格矩阵），
 * 服务端生成 xlsx 并流式返回，避免十万级数据在浏览器端生成卡死。
 */
router.post('/styled-xlsx', async (req: AuthRequest, res) => {
  const { fileName, sheetName, title, subtitle, columns, rows, subtotalRows, summaryValues, stripe } =
    req.body || {}

  if (!Array.isArray(columns) || columns.length === 0) {
    return res.status(400).json({ code: 400, message: '缺少列定义' })
  }
  if (!Array.isArray(rows)) {
    return res.status(400).json({ code: 400, message: '缺少数据行' })
  }
  if (rows.length > MAX_EXPORT_ROWS) {
    return res
      .status(400)
      .json({ code: 400, message: `导出行数超过上限（${MAX_EXPORT_ROWS}），请缩小筛选范围` })
  }

  try {
    const buffer = await buildStyledXlsxBuffer({
      sheetName: typeof sheetName === 'string' ? sheetName : undefined,
      title: typeof title === 'string' ? title : undefined,
      subtitle: typeof subtitle === 'string' ? subtitle : undefined,
      columns: columns as ExportColumnSpec[],
      rows: rows as (string | number | null)[][],
      subtotalRows: Array.isArray(subtotalRows) ? subtotalRows : undefined,
      summaryValues: Array.isArray(summaryValues) ? summaryValues : undefined,
      stripe: stripe !== false,
    })

    const safeName = ensureXlsxFileName(
      typeof fileName === 'string' && fileName.trim() ? fileName.trim() : '导出.xlsx'
    )
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}"`)
    res.setHeader('Content-Length', buffer.length)
    res.end(buffer)
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error?.message || '导出失败' })
  }
})

export default router
