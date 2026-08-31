import { Router } from 'express'
import { normalizePrintTemplateElements } from '../utils/printTemplateNormalize.js'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'
import { existsSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { getDb, getDeployDir } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { ensureDefaultPrintTemplateForAccountSet } from '../services/printTemplateDefaults.js'

const router = Router()

// 套打底图上传（已印好的凭证/账册/税票格式 PNG/JPG/PDF转图）
const printTplUpload = multer({
  storage: multer.diskStorage({
    destination: (req: any, _file, cb) => {
      const dir = join(getDeployDir(), 'uploads', 'print-templates', req.accountSetId || 'common')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (req: any, file, cb) => {
      const ext = extname(file.originalname).toLowerCase() || '.png'
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? ext : '.png'
      cb(null, `bg_${req.params.id}${safeExt}`)
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true)
    else cb(new Error('套打底图仅支持图片文件（PDF 请先转为 PNG）'))
  },
})

router.use(authMiddleware)

// hiprint 模板的列集合（含新字段）
const HIPRINT_COLUMNS = `id, name, paper_size, paper_width, paper_height,
        margin_top, margin_bottom, margin_left, margin_right,
        elements, template_type, template_key, panel, background_image,
        is_default, created_at, updated_at`

// 统一把一行 DB 记录映射成 API 输出（解析 elements/panel JSON）
function mapTemplateRow(t: any) {
  return {
    ...t,
    elements: normalizePrintTemplateElements(
      t.elements ? JSON.parse(t.elements) : [],
      t.paper_width,
      t.paper_height
    ),
    panel: t.panel ? JSON.parse(t.panel) : null,
    template_type: t.template_type || 'voucher',
    is_default: Boolean(t.is_default),
  }
}

// ===================== 打印模版管理 =====================

// 获取打印模版列表（支持按 template_type / template_key 筛选）
router.get('/print-templates', (req: AuthRequest, res) => {
  const db = getDb()
  const { template_type, template_key } = req.query as { template_type?: string; template_key?: string }

  const conditions = ['account_set_id = ?']
  const params: any[] = [req.accountSetId || '']
  if (template_type) {
    conditions.push('template_type = ?')
    params.push(template_type)
  }
  if (template_key) {
    conditions.push('template_key = ?')
    params.push(template_key)
  }

  const templates = db
    .prepare(
      `SELECT ${HIPRINT_COLUMNS}
       FROM print_templates
       WHERE ${conditions.join(' AND ')}
       ORDER BY is_default DESC, created_at DESC`
    )
    .all(...params)

  res.json({ code: 0, data: templates.map(mapTemplateRow) })
})

// 运行时可选模板（轻量：用于打印对话框的模板下拉）
// 必须定义在 /print-templates/:id 之前，否则 'applicable' 会被当作 :id
router.get('/print-templates/applicable', (req: AuthRequest, res) => {
  const db = getDb()
  const { template_type, template_key } = req.query as { template_type?: string; template_key?: string }

  const conditions = ['account_set_id = ?']
  const params: any[] = [req.accountSetId || '']
  if (template_type) {
    conditions.push('template_type = ?')
    params.push(template_type)
  }
  if (template_key) {
    conditions.push('template_key = ?')
    params.push(template_key)
  }

  const rows = db
    .prepare(
      `SELECT id, name, template_type, template_key, background_image, is_default
       FROM print_templates
       WHERE ${conditions.join(' AND ')}
       ORDER BY is_default DESC, created_at DESC`
    )
    .all(...params)

  res.json({
    code: 0,
    data: rows.map((t: any) => ({ ...t, is_default: Boolean(t.is_default) })),
  })
})

// 获取单个打印模版详情
router.get('/print-templates/:id', (req: AuthRequest, res) => {
  const { id } = req.params
  const db = getDb()
  const template = db
    .prepare(
      `SELECT ${HIPRINT_COLUMNS}
       FROM print_templates
       WHERE id = ? AND account_set_id = ?`
    )
    .get(id, req.accountSetId || '') as any

  if (!template) {
    return res.status(404).json({ code: 404, message: '打印模版不存在' })
  }

  res.json({ code: 0, data: mapTemplateRow(template) })
})

// 设置默认打印模版
router.post(
  '/print-templates/default/:id',
  operationLog('设置默认打印模版', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()

    // 检查模版是否存在
    const template = db
      .prepare('SELECT id FROM print_templates WHERE id = ? AND account_set_id = ?')
      .get(id, req.accountSetId || '')

    if (!template) {
      return res.status(404).json({ code: 404, message: '打印模版不存在' })
    }

    // 取消当前默认模版
    db.prepare('UPDATE print_templates SET is_default = 0 WHERE account_set_id = ?').run(
      req.accountSetId || ''
    )

    // 设置新的默认模版
    db.prepare('UPDATE print_templates SET is_default = 1, updated_at = datetime(\'now\') WHERE id = ?').run(
      id
    )

    res.json({ code: 0, message: '设置成功' })
  }
)

// 创建打印模版
router.post(
  '/print-templates',
  operationLog('创建打印模版', '基础设置'),
  (req: AuthRequest, res) => {
    const {
      name,
      paper_size,
      paper_width,
      paper_height,
      margin_top,
      margin_bottom,
      margin_left,
      margin_right,
      elements,
      template_type,
      template_key,
      panel,
    } = req.body

    // 验证必填字段
    if (!name || !paper_width || !paper_height) {
      return res.status(400).json({ code: 400, message: '缺少必填字段' })
    }

    const db = getDb()
    const id = uuidv4()

    try {
      db.prepare(
        `INSERT INTO print_templates
         (id, account_set_id, name, paper_size, paper_width, paper_height,
          margin_top, margin_bottom, margin_left, margin_right, elements,
          template_type, template_key, panel, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      ).run(
        id,
        req.accountSetId || '',
        name,
        paper_size || 'custom',
        paper_width,
        paper_height,
        margin_top ?? 15,
        margin_bottom ?? 15,
        margin_left ?? 10,
        margin_right ?? 10,
        JSON.stringify(elements || {}),
        template_type || 'voucher',
        template_key || null,
        panel ? JSON.stringify(panel) : null
      )

      res.json({ code: 0, message: '创建成功', data: { id } })
    } catch (error: any) {
      res.status(500).json({ code: 500, message: '创建失败：' + error.message })
    }
  }
)

// 更新打印模版
router.put(
  '/print-templates/:id',
  operationLog('更新打印模版', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const {
      name,
      paper_size,
      paper_width,
      paper_height,
      margin_top,
      margin_bottom,
      margin_left,
      margin_right,
      elements,
      template_type,
      template_key,
      panel,
    } = req.body

    const db = getDb()

    // 检查模版是否存在（连同当前值，未传的字段保持不变）
    const existing = db
      .prepare(
        `SELECT template_type, template_key, panel, elements FROM print_templates
         WHERE id = ? AND account_set_id = ?`
      )
      .get(id, req.accountSetId || '') as any

    if (!existing) {
      return res.status(404).json({ code: 404, message: '打印模版不存在' })
    }

    try {
      db.prepare(
        `UPDATE print_templates
         SET name = ?, paper_size = ?, paper_width = ?, paper_height = ?,
             margin_top = ?, margin_bottom = ?, margin_left = ?, margin_right = ?,
             elements = ?, template_type = ?, template_key = ?, panel = ?,
             updated_at = datetime('now')
         WHERE id = ? AND account_set_id = ?`
      ).run(
        name,
        paper_size,
        paper_width,
        paper_height,
        margin_top,
        margin_bottom,
        margin_left,
        margin_right,
        elements !== undefined ? JSON.stringify(elements || []) : existing.elements,
        template_type || existing.template_type || 'voucher',
        template_key !== undefined ? template_key : existing.template_key,
        panel !== undefined ? (panel ? JSON.stringify(panel) : null) : existing.panel,
        id,
        req.accountSetId || ''
      )

      res.json({ code: 0, message: '更新成功' })
    } catch (error: any) {
      console.error('[print-template] 更新失败:', error)
      res.status(500).json({ code: 500, message: '更新失败：' + error.message })
    }
  }
)

// 删除打印模版
router.delete(
  '/print-templates/:id',
  operationLog('删除打印模版', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()

    // 检查模版是否存在
    const template = db
      .prepare('SELECT id, is_default FROM print_templates WHERE id = ? AND account_set_id = ?')
      .get(id, req.accountSetId || '') as any

    if (!template) {
      return res.status(404).json({ code: 404, message: '打印模版不存在' })
    }

    // 不允许删除默认模版
    if (template.is_default) {
      return res.status(400).json({ code: 400, message: '不能删除默认模版' })
    }

    try {
      db.prepare('DELETE FROM print_templates WHERE id = ? AND account_set_id = ?').run(
        id,
        req.accountSetId || ''
      )

      res.json({ code: 0, message: '删除成功' })
    } catch (error: any) {
      res.status(500).json({ code: 500, message: '删除失败：' + error.message })
    }
  }
)

// 初始化默认打印模版（仅在没有默认模版时创建）
router.post(
  '/print-templates/init-default',
  operationLog('初始化默认打印模版', '基础设置'),
  (req: AuthRequest, res) => {
    const db = getDb()
    const accountSetId = req.accountSetId || ''

    const result = ensureDefaultPrintTemplateForAccountSet(db, accountSetId)

    if (!result.created) {
      return res.json({ code: 0, message: '已存在默认打印模版，无需初始化' })
    }

    res.json({ code: 0, message: '默认模版初始化成功', data: { id: result.id } })
  }
)

// 上传套打底图（已印好的凭证/账册/税票格式图片）
router.post(
  '/print-templates/:id/background',
  operationLog('上传套打底图', '基础设置'),
  printTplUpload.single('file'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()

    const template = db
      .prepare('SELECT id FROM print_templates WHERE id = ? AND account_set_id = ?')
      .get(id, req.accountSetId || '')

    if (!template) {
      return res.status(404).json({ code: 404, message: '打印模版不存在' })
    }
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请上传底图文件' })
    }

    const url = `/uploads/print-templates/${req.accountSetId || 'common'}/${req.file.filename}`
    db.prepare(
      `UPDATE print_templates SET background_image = ?, updated_at = datetime('now')
       WHERE id = ? AND account_set_id = ?`
    ).run(url, id, req.accountSetId || '')

    res.json({ code: 0, message: '底图上传成功', data: { background_image: url } })
  }
)

export default router
