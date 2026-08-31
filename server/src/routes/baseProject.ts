import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { extname, resolve } from 'path'
import { getDb, getDeployDir } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { buildWhereClause, normalizeImportCode, normalizeImportText, SqlParam } from '../services/baseValidation.js'
import {
  assertAuxCategoryDeletable,
  getAuxItemDeleteBlockReason,
  formatAuxItemDisplayLabel,
  getAuxItemDisplayLabelById,
} from '../services/auxDeleteGuard.js'
import {
  batchAuxItemsDeleteAsync,
  batchAuxItemsDeleteByCategoryAsync,
  batchAuxItemsImportAsync,
  exportAuxItemsAsync,
  importAuxItemsFileAsync,
} from '../services/baseBatchAsync.js'
import { lookupAuxItemsForImport } from '../services/auxImportMatch.js'
import {
  DEFAULT_LIST_LIMIT,
  isAllRequested,
  MAX_LIST_ALL,
  MAX_LIST_LIMIT,
  MAX_SYNC_BATCH_ROWS,
  parseLimitParam,
  parseOffsetParam,
} from '../utils/listLimits.js'

const router = Router()
router.use(authMiddleware)

const auxImportTempDir = resolve(getDeployDir(), 'tmp', 'aux-imports')
if (!existsSync(auxImportTempDir)) mkdirSync(auxImportTempDir, { recursive: true })
const auxImportUpload = multer({
  storage: multer.diskStorage({
    destination: auxImportTempDir,
    filename: (_req, file, callback) => {
      callback(null, `${uuidv4()}${extname(file.originalname).toLowerCase() || '.xlsx'}`)
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, /\.xlsx$/i.test(file.originalname))
  },
})

// ===================== 辅助核算类别 =====================

router.get('/aux-categories', (req: AuthRequest, res) => {
  const db = getDb()
  const { keyword } = req.query
  const conditions = ['account_set_id = ?']
  const params: SqlParam[] = [req.accountSetId || '']

  if (typeof keyword === 'string' && keyword) {
    conditions.push('(name LIKE ? OR code LIKE ?)')
    const keywordPattern = `%${keyword}%`
    params.push(keywordPattern, keywordPattern)
  }

  const where = buildWhereClause(conditions)
  const sql = `SELECT * FROM aux_categories${where} ORDER BY sort_order, code`
  const list = db.prepare(sql).all(...params) as any[]

  // 附加每个类别的字段配置
  const fieldsStmt = db.prepare('SELECT * FROM aux_category_fields WHERE category_id=? AND is_enabled=1 ORDER BY sort_order')
  for (const cat of list) {
    cat.fields = fieldsStmt.all(cat.id)
  }

  res.json({ code: 0, data: list })
})

router.post(
  '/aux-categories',
  operationLog('新增核算类别', '基础设置'),
  (req: AuthRequest, res) => {
    const { code, name, default_item_id, sort_order, fields } = req.body
    if (!code || !name) {
      return res.status(400).json({ code: 400, message: '编码、名称不能为空' })
    }
    const db = getDb()
    const duplicated = db
      .prepare('SELECT id FROM aux_categories WHERE account_set_id=? AND name=?')
      .get(req.accountSetId, name)
    if (duplicated) {
      return res.status(400).json({ code: 400, message: '类别名称不能重复' })
    }
    const id = uuidv4()

    const insertCategory = db.transaction(() => {
      db.prepare(
        'INSERT INTO aux_categories (id, account_set_id, code, name, default_item_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, req.accountSetId, code, name, default_item_id || null, sort_order || 0)

      // 保存字段配置
      if (Array.isArray(fields)) {
        const insertField = db.prepare(
          `INSERT INTO aux_category_fields (id, category_id, field_key, field_name, field_type, options_json, show_in_voucher, required_in_voucher, required_in_archive, sort_order, is_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i]
          if (!f.field_key || !f.field_name) continue
          insertField.run(
            uuidv4(), id,
            f.field_key, f.field_name, f.field_type || 'text',
            f.options_json || null,
            f.show_in_voucher ? 1 : 0,
            f.required_in_voucher ? 1 : 0,
            f.required_in_archive ? 1 : 0,
            f.sort_order ?? i
          )
        }
      }
    })

    insertCategory()
    res.json({ code: 0, message: '创建成功', data: { id } })
  }
)

router.put(
  '/aux-categories/:id',
  operationLog('修改核算类别', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const { name, default_item_id, sort_order, fields } = req.body
    const db = getDb()
    const duplicated = db
      .prepare('SELECT id FROM aux_categories WHERE account_set_id=? AND name=? AND id<>?')
      .get(req.accountSetId, name, id)
    if (duplicated) {
      return res.status(400).json({ code: 400, message: '类别名称不能重复' })
    }

    const updateCategory = db.transaction(() => {
      db.prepare(
        "UPDATE aux_categories SET name=?, default_item_id=?, sort_order=?, updated_at=datetime('now') WHERE id=?"
      ).run(name, default_item_id || null, sort_order || 0, id)

      // 更新字段配置：先禁用全部，再 upsert
      if (Array.isArray(fields)) {
        // 获取现有字段 key 集合
        const existingFields = db.prepare('SELECT id, field_key FROM aux_category_fields WHERE category_id=?').all(id) as any[]
        const existingMap = new Map(existingFields.map(f => [f.field_key, f.id]))

        const insertField = db.prepare(
          `INSERT INTO aux_category_fields (id, category_id, field_key, field_name, field_type, options_json, show_in_voucher, required_in_voucher, required_in_archive, sort_order, is_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        const updateField = db.prepare(
          `UPDATE aux_category_fields SET field_name=?, field_type=?, options_json=?, show_in_voucher=?, required_in_voucher=?, required_in_archive=?, sort_order=?, is_enabled=1, updated_at=datetime('now') WHERE id=?`
        )
        // 将不在新列表中的字段设为禁用
        const newKeys = new Set(fields.filter((f: any) => f.field_key).map((f: any) => f.field_key))
        for (const ef of existingFields) {
          if (!newKeys.has(ef.field_key)) {
            db.prepare("UPDATE aux_category_fields SET is_enabled=0, updated_at=datetime('now') WHERE id=?").run(ef.id)
          }
        }

        for (let i = 0; i < fields.length; i++) {
          const f = fields[i]
          if (!f.field_key || !f.field_name) continue
          const existingId = existingMap.get(f.field_key)
          if (existingId) {
            updateField.run(
              f.field_name, f.field_type || 'text', f.options_json || null,
              f.show_in_voucher ? 1 : 0, f.required_in_voucher ? 1 : 0, f.required_in_archive ? 1 : 0,
              f.sort_order ?? i, existingId
            )
          } else {
            insertField.run(
              uuidv4(), id,
              f.field_key, f.field_name, f.field_type || 'text',
              f.options_json || null,
              f.show_in_voucher ? 1 : 0, f.required_in_voucher ? 1 : 0, f.required_in_archive ? 1 : 0,
              f.sort_order ?? i
            )
          }
        }
      }
    })

    updateCategory()
    res.json({ code: 0, message: '更新成功' })
  }
)

router.delete(
  '/aux-categories/:id',
  operationLog('删除核算类别', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()

    try {
      assertAuxCategoryDeletable(db, req.accountSetId || '', id)
    } catch (error: any) {
      return res.status(400).json({ code: 400, message: error.message || '无法删除该辅助类目' })
    }

    // ON DELETE CASCADE 会自动删除 aux_category_fields
    db.prepare('DELETE FROM aux_categories WHERE id=?').run(id)
    res.json({ code: 0, message: '删除成功' })
  }
)

// ===================== 字段配置独立接口 =====================

router.get('/aux-category-fields', (req: AuthRequest, res) => {
  const db = getDb()
  const { category_id } = req.query
  if (!category_id) {
    return res.status(400).json({ code: 400, message: 'category_id 不能为空' })
  }
  const list = db.prepare(
    'SELECT * FROM aux_category_fields WHERE category_id=? AND is_enabled=1 ORDER BY sort_order'
  ).all(category_id as string)
  res.json({ code: 0, data: list })
})

router.post(
  '/aux-category-fields',
  operationLog('新增类别字段', '基础设置'),
  (req: AuthRequest, res) => {
    const { category_id, field_key, field_name, field_type, options_json, show_in_voucher, required_in_voucher, required_in_archive, sort_order } = req.body
    if (!category_id || !field_key || !field_name) {
      return res.status(400).json({ code: 400, message: '类别、字段编码、字段名称不能为空' })
    }
    const db = getDb()
    const duplicated = db
      .prepare('SELECT id FROM aux_category_fields WHERE category_id=? AND field_key=?')
      .get(category_id, field_key)
    if (duplicated) {
      return res.status(400).json({ code: 400, message: '字段编码已存在' })
    }
    const id = uuidv4()
    db.prepare(
      `INSERT INTO aux_category_fields (id, category_id, field_key, field_name, field_type, options_json, show_in_voucher, required_in_voucher, required_in_archive, sort_order, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(id, category_id, field_key, field_name, field_type || 'text', options_json || null,
      show_in_voucher ? 1 : 0, required_in_voucher ? 1 : 0, required_in_archive ? 1 : 0, sort_order || 0)
    res.json({ code: 0, message: '创建成功', data: { id } })
  }
)

router.put(
  '/aux-category-fields/:id',
  operationLog('修改类别字段', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const { field_name, field_type, options_json, show_in_voucher, required_in_voucher, required_in_archive, sort_order } = req.body
    const db = getDb()
    db.prepare(
      `UPDATE aux_category_fields SET field_name=?, field_type=?, options_json=?, show_in_voucher=?, required_in_voucher=?, required_in_archive=?, sort_order=?, updated_at=datetime('now') WHERE id=?`
    ).run(field_name, field_type || 'text', options_json || null,
      show_in_voucher ? 1 : 0, required_in_voucher ? 1 : 0, required_in_archive ? 1 : 0, sort_order || 0, id)
    res.json({ code: 0, message: '更新成功' })
  }
)

router.delete(
  '/aux-category-fields/:id',
  operationLog('删除类别字段', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    // 软删除：设为禁用
    db.prepare("UPDATE aux_category_fields SET is_enabled=0, updated_at=datetime('now') WHERE id=?").run(id)
    res.json({ code: 0, message: '删除成功' })
  }
)

// ===================== 辅助核算项目 =====================

router.get('/aux-items/stats', (req: AuthRequest, res) => {
  const db = getDb()
  const { type, category_id } = req.query
  const categoryId = (category_id || type) as string | undefined
  if (!categoryId) {
    return res.status(400).json({ code: 400, message: '请提供类别 type 或 category_id' })
  }
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) as count FROM aux_items
       WHERE account_set_id=? AND type=? GROUP BY status`
    )
    .all(req.accountSetId || '', categoryId) as Array<{ status: string; count: number }>
  let total = 0
  let active = 0
  let closed = 0
  for (const row of rows) {
    total += row.count
    if (row.status === 'active') active += row.count
    else if (row.status === 'closed') closed += row.count
  }
  res.json({ code: 0, data: { total, active, closed } })
})

router.get('/aux-items', (req: AuthRequest, res) => {
  const db = getDb()
  const { type, category_id, keyword, status, limit, offset, ids, order, all, page, pageSize } = req.query
  const conditions = ['ai.account_set_id = ?']
  const params: SqlParam[] = [req.accountSetId || '']

  const categoryIdParam = category_id || type
  if (typeof categoryIdParam === 'string' && categoryIdParam) {
    conditions.push('ai.type = ?')
    params.push(categoryIdParam)
  }

  const idList =
    typeof ids === 'string' && ids.trim()
      ? ids
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : []

  if (idList.length > 0) {
    conditions.push(`ai.id IN (${idList.map(() => '?').join(',')})`)
    params.push(...idList)
  }

  if (typeof keyword === 'string' && keyword) {
    conditions.push('(ai.name LIKE ? OR ai.code LIKE ? OR ai.field_values LIKE ?)')
    const keywordPattern = `%${keyword}%`
    params.push(keywordPattern, keywordPattern, keywordPattern)
  }

  if (typeof status === 'string' && status) {
    conditions.push('ai.status = ?')
    params.push(status)
  }

  const where = buildWhereClause(conditions)
  const orderDir = order === 'desc' ? 'DESC' : 'ASC'

  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM aux_items ai${where}`)
    .get(...params) as { count: number }
  const total = countRow?.count ?? 0

  let limitNum: number | null
  let offsetNum = 0

  if (idList.length > 0) {
    limitNum = null
  } else if (isAllRequested(all)) {
    limitNum = MAX_LIST_ALL
    offsetNum = 0
  } else if (page != null && page !== '' && (pageSize != null && pageSize !== '')) {
    const pageNum = Math.max(1, Number.parseInt(String(page), 10) || 1)
    const sizeNum = parseLimitParam(pageSize, { defaultLimit: DEFAULT_LIST_LIMIT, maxLimit: MAX_LIST_LIMIT }) ?? DEFAULT_LIST_LIMIT
    limitNum = sizeNum
    offsetNum = (pageNum - 1) * sizeNum
  } else {
    limitNum = parseLimitParam(limit, {
      defaultLimit: DEFAULT_LIST_LIMIT,
      maxLimit: MAX_LIST_LIMIT,
      allowUnlimited: false,
    })
    offsetNum = parseOffsetParam(offset)
  }

  let limitClause = ''
  if (limitNum != null) {
    limitClause = ` LIMIT ${limitNum} OFFSET ${offsetNum}`
  }

  const sql = `
    SELECT ai.*, ac.name as category_name, ac.code as category_code
    FROM aux_items ai
    LEFT JOIN aux_categories ac ON ac.id = ai.type${where}
    ORDER BY ai.code ${orderDir}${limitClause}
  `
  const list = db.prepare(sql).all(...params)

  res.json({ code: 0, data: list, total })
})

router.post('/aux-items', operationLog('新增核算项目', '基础设置'), (req: AuthRequest, res) => {
  const { type, code, name, remark, field_values } = req.body
  const normalizedCode = normalizeImportCode(String(code || ''))
  const normalizedName = normalizeImportText(String(name || ''))
  if (!type || !normalizedCode || !normalizedName) {
    return res.status(400).json({ code: 400, message: '类别、编码、名称不能为空' })
  }
  const db = getDb()

  // 校验自定义字段必填
  const requiredFields = db.prepare(
    'SELECT field_key, field_name FROM aux_category_fields WHERE category_id=? AND is_enabled=1 AND required_in_archive=1'
  ).all(type) as any[]
  const fv = field_values || {}
  for (const rf of requiredFields) {
    if (!fv[rf.field_key] || String(fv[rf.field_key]).trim() === '') {
      return res.status(400).json({ code: 400, message: `"${rf.field_name}" 为必填字段` })
    }
  }

  const duplicatedCode = db
    .prepare('SELECT id, code, name FROM aux_items WHERE account_set_id=? AND type=? AND code=?')
    .get(req.accountSetId, type, normalizedCode) as any
  if (duplicatedCode) {
    return res.status(400).json({
      code: 400,
      message: `项目编码已存在，不允许存盘。编码：${duplicatedCode.code}；名称：${duplicatedCode.name}`,
    })
  }
  const duplicated = db
    .prepare('SELECT id, code, name FROM aux_items WHERE account_set_id=? AND type=? AND name=?')
    .get(req.accountSetId, type, normalizedName) as any
  if (duplicated) {
    return res.status(400).json({
      code: 400,
      message: `项目名称已存在，不允许存盘。编码：${duplicated.code}；名称：${duplicated.name}`,
    })
  }
  const id = uuidv4()
  const fieldValuesJson = JSON.stringify(fv)
  db.prepare(
    'INSERT INTO aux_items (id, account_set_id, type, code, name, remark, field_values) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.accountSetId, type, normalizedCode, normalizedName, remark || '', fieldValuesJson)
  res.json({ code: 0, message: '创建成功', data: { id } })
})

router.put('/aux-items/:id', operationLog('修改核算项目', '基础设置'), (req: AuthRequest, res) => {
  const { id } = req.params
  const { code, name, status, remark, field_values } = req.body
  const normalizedName = normalizeImportText(String(name || ''))
  const normalizedCode = code != null ? normalizeImportCode(String(code)) : undefined
  const db = getDb()

  // 校验自定义字段必填
  const item = db.prepare('SELECT type FROM aux_items WHERE id=?').get(id) as any
  if (item) {
    const requiredFields = db.prepare(
      'SELECT field_key, field_name FROM aux_category_fields WHERE category_id=? AND is_enabled=1 AND required_in_archive=1'
    ).all(item.type) as any[]
    const fv = field_values || {}
    for (const rf of requiredFields) {
      if (!fv[rf.field_key] || String(fv[rf.field_key]).trim() === '') {
        return res.status(400).json({ code: 400, message: `"${rf.field_name}" 为必填字段` })
      }
    }
  }

  const duplicatedCode = db
    .prepare(
      'SELECT id, code, name FROM aux_items WHERE account_set_id=? AND type=(SELECT type FROM aux_items WHERE id=?) AND id<>? AND code=?'
    )
    .get(req.accountSetId, id, id, normalizedCode ?? code) as any
  if (duplicatedCode) {
    return res.status(400).json({
      code: 400,
      message: `项目编码已存在，不允许存盘。编码：${duplicatedCode.code}；名称：${duplicatedCode.name}`,
    })
  }
  const duplicated = db
    .prepare(
      'SELECT id, code, name FROM aux_items WHERE account_set_id=? AND type=(SELECT type FROM aux_items WHERE id=?) AND id<>? AND name=?'
    )
    .get(req.accountSetId, id, id, normalizedName) as any
  if (duplicated) {
    return res.status(400).json({
      code: 400,
      message: `项目名称已存在，不允许存盘。编码：${duplicated.code}；名称：${duplicated.name}`,
    })
  }
  const fieldValuesJson = JSON.stringify(field_values || {})
  db.prepare(
    "UPDATE aux_items SET code=?, name=?, status=?, remark=?, field_values=?, updated_at=datetime('now') WHERE id=?"
  ).run(normalizedCode ?? code, normalizedName, status, remark || '', fieldValuesJson, id)
  res.json({ code: 0, message: '更新成功' })
})

router.delete(
  '/aux-items/:id',
  operationLog('删除核算项目', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()

    try {
      const check = getAuxItemDeleteBlockReason(db, req.accountSetId || '', id)
      if (check.blocked) {
        return res.status(400).json({
          code: 400,
          message: check.message || '无法删除该辅助项目',
          data: check,
        })
      }
    } catch (error: any) {
      return res.status(400).json({ code: 400, message: error.message || '无法删除该辅助项目' })
    }

    db.prepare('DELETE FROM aux_items WHERE id=?').run(id)
    res.json({ code: 0, message: '删除成功' })
  }
)

// 批量删除核算项目
router.post(
  '/aux-items/batch-delete',
  operationLog('批量删除核算项目', '基础设置'),
  (req: AuthRequest, res) => {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供要删除的项目ID列表' })
    }
    if (ids.length > MAX_SYNC_BATCH_ROWS) {
      return res.status(400).json({
        code: 400,
        message: `同步删除最多 ${MAX_SYNC_BATCH_ROWS} 条，请使用 /aux-items/batch-delete-async`,
      })
    }

    const db = getDb()
    let successCount = 0
    let failCount = 0
    const failedItems: Array<{
      id: string
      label: string
      reason: string
      block?: ReturnType<typeof getAuxItemDeleteBlockReason>
    }> = []

    const deleteStmt = db.prepare('DELETE FROM aux_items WHERE id=?')
    for (const id of ids) {
      const check = getAuxItemDeleteBlockReason(db, req.accountSetId || '', id)
      const label = check.item
        ? formatAuxItemDisplayLabel(check.item)
        : getAuxItemDisplayLabelById(db, id)
      if (check.blocked) {
        failCount++
        failedItems.push({ id, label, reason: check.message || '无法删除', block: check })
        continue
      }

      try {
        deleteStmt.run(id)
        successCount++
      } catch {
        failCount++
        failedItems.push({ id, label, reason: '删除失败' })
      }
    }

    res.json({
      code: 0,
      message: `批量删除完成：成功 ${successCount} 个，跳过 ${failCount} 个`,
      data: {
        successCount,
        failCount,
        failedItems: failedItems.slice(0, 10), // 只返回前10个失败项
      },
    })
  }
)

// 批量导入核算项目
router.post(
  '/aux-items/batch-import',
  operationLog('批量导入核算项目', '基础设置'),
  (req: AuthRequest, res) => {
    const { items, type } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供要导入的项目列表' })
    }
    if (items.length > MAX_SYNC_BATCH_ROWS) {
      return res.status(400).json({
        code: 400,
        message: `同步导入最多 ${MAX_SYNC_BATCH_ROWS} 条，请使用 /aux-items/batch-import-async`,
      })
    }
    if (!type) {
      return res.status(400).json({ code: 400, message: '请提供项目类别' })
    }

    const db = getDb()
    let successCount = 0
    let failCount = 0
    const errors: Array<{ code: string; name: string; reason: string }> = []

    // 获取类别的字段配置
    const category = db.prepare('SELECT * FROM aux_categories WHERE id=?').get(type) as any
    if (!category) {
      return res.status(400).json({ code: 400, message: '项目类别不存在' })
    }

    const fields = db
      .prepare('SELECT * FROM aux_category_fields WHERE category_id=? AND is_enabled=1')
      .all(type) as any[]

    // 获取现有项目（用于检查重复）
    const existingItems = db
      .prepare('SELECT code, name FROM aux_items WHERE account_set_id=? AND type=?')
      .all(req.accountSetId, type) as any[]
    const existingCodes = new Set(existingItems.map(i => normalizeImportCode(String(i.code))))
    const existingNames = new Set(existingItems.map(i => normalizeImportText(i.name)))

    const insertStmt = db.prepare(
      'INSERT INTO aux_items (id, account_set_id, type, code, name, remark, field_values, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )

    try {
      for (const item of items) {
        try {
          // 验证必填字段
          const itemCode = normalizeImportCode(String(item.code || ''))
          const normalizedName = normalizeImportText(String(item.name || '').trim())
          if (!itemCode || !normalizedName) {
            failCount++
            errors.push({ code: item.code || '', name: item.name || '', reason: '编码和名称不能为空' })
            continue
          }

          // 检查编码重复
          if (existingCodes.has(itemCode)) {
            failCount++
            errors.push({ code: item.code, name: item.name, reason: '项目编码已存在' })
            continue
          }

          // 检查名称重复
          if (existingNames.has(normalizedName)) {
            failCount++
            errors.push({ code: item.code, name: item.name, reason: '项目名称已存在' })
            continue
          }

          // 验证自定义字段必填
          const fieldValues = item.field_values || {}
          let hasFieldError = false
          for (const field of fields) {
            if (field.required_in_archive && !fieldValues[field.field_key]) {
              failCount++
              errors.push({
                code: item.code,
                name: item.name,
                reason: `字段「${field.field_name}」为必填项`,
              })
              hasFieldError = true
              break
            }
          }
          if (hasFieldError) continue

          // 插入项目
          const id = uuidv4()
          const fieldValuesJson = JSON.stringify(fieldValues)
          insertStmt.run(
            id,
            req.accountSetId,
            type,
            itemCode,
            normalizedName,
            item.remark || '',
            fieldValuesJson,
            item.status || 'active'
          )

          successCount++
          existingCodes.add(itemCode)
          existingNames.add(normalizedName)
        } catch (error: any) {
          failCount++
          errors.push({
            code: item.code || '',
            name: item.name || '',
            reason: error.message || '导入失败',
          })
        }
      }

      res.json({
        code: 0,
        message: `批量导入完成：成功 ${successCount} 个，失败 ${failCount} 个`,
        data: {
          successCount,
          failCount,
          errors: errors.slice(0, 10), // 只返回前10个错误
        },
      })
    } catch (error: any) {
      return res.status(500).json({ code: 500, message: error.message || '批量导入失败' })
    }
  }
)

router.post(
  '/aux-items/batch-delete-async',
  operationLog('异步批量删除核算项目', '基础设置'),
  (req: AuthRequest, res) => {
    const { ids, type, category_id, status } = req.body
    if (type || category_id) {
      try {
        const taskId = batchAuxItemsDeleteByCategoryAsync(
          getDb(),
          req.accountSetId || '',
          String(type || category_id),
          typeof status === 'string' && status ? status : undefined
        )
        return res.json({ code: 0, message: '批量删除任务已创建', data: { taskId } })
      } catch (error: any) {
        return res.status(400).json({ code: 400, message: error.message || '创建任务失败' })
      }
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供要删除的项目ID列表或类别 type' })
    }
    try {
      const taskId = batchAuxItemsDeleteAsync(getDb(), req.accountSetId || '', ids)
      res.json({ code: 0, message: '批量删除任务已创建', data: { taskId } })
    } catch (error: any) {
      res.status(400).json({ code: 400, message: error.message || '创建任务失败' })
    }
  }
)

router.post(
  '/aux-items/batch-import-async',
  operationLog('异步批量导入核算项目', '基础设置'),
  (req: AuthRequest, res) => {
    const { items, type } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供要导入的项目列表' })
    }
    if (!type) {
      return res.status(400).json({ code: 400, message: '请提供项目类别' })
    }
    try {
      const taskId = batchAuxItemsImportAsync(getDb(), req.accountSetId || '', type, items)
      res.json({ code: 0, message: '批量导入任务已创建', data: { taskId } })
    } catch (error: any) {
      res.status(400).json({ code: 400, message: error.message || '创建任务失败' })
    }
  }
)

/** 辅助期初导入：按文件中出现的编码/名称批量查库，避免前端全量加载十万级项目 */
router.post(
  '/aux-items/export-async',
  operationLog('后台导出核算项目', '基础设置'),
  (req: AuthRequest, res) => {
    const type = String(req.body?.type || req.body?.category_id || '')
    if (!type) return res.status(400).json({ code: 400, message: '请提供项目类别 type' })
    try {
      const taskId = exportAuxItemsAsync(
        getDb(),
        req.accountSetId || '',
        type,
        typeof req.body?.status === 'string' ? req.body.status : undefined
      )
      res.json({ code: 0, message: '导出任务已创建', data: { taskId } })
    } catch (error: any) {
      res.status(400).json({ code: 400, message: error.message || '创建导出任务失败' })
    }
  }
)

router.post(
  '/aux-items/import-file-async',
  auxImportUpload.single('file'),
  operationLog('后台导入核算项目文件', '基础设置'),
  (req: AuthRequest, res) => {
    const type = String(req.body?.type || req.body?.category_id || '')
    if (!req.file) return res.status(400).json({ code: 400, message: '请上传 .xlsx 文件' })
    if (!type) {
      try { unlinkSync(req.file.path) } catch { /* 临时文件由维护任务清理 */ }
      return res.status(400).json({ code: 400, message: '请提供项目类别 type' })
    }
    try {
      const taskId = importAuxItemsFileAsync(
        getDb(),
        req.accountSetId || '',
        type,
        req.file.path
      )
      res.json({ code: 0, message: '文件导入任务已创建', data: { taskId } })
    } catch (error: any) {
      try { unlinkSync(req.file.path) } catch { /* 临时文件由维护任务清理 */ }
      res.status(400).json({ code: 400, message: error.message || '创建导入任务失败' })
    }
  }
)

router.post('/aux-items/import-match-index', (req: AuthRequest, res) => {
  const { type, category_id, codes, names } = req.body
  const categoryId = String(type || category_id || '')
  if (!categoryId) {
    return res.status(400).json({ code: 400, message: '请提供项目类别 type' })
  }
  const codeList = Array.isArray(codes) ? codes.map(String) : []
  const nameList = Array.isArray(names) ? names.map(String) : []
  if (codeList.length === 0 && nameList.length === 0) {
    return res.json({ code: 0, data: [] })
  }
  if (codeList.length > 500000 || nameList.length > 500000) {
    return res.status(400).json({ code: 400, message: '单次最多查询 500,000 个编码或名称，请分批请求' })
  }
  const items = lookupAuxItemsForImport(
    getDb(),
    req.accountSetId || '',
    categoryId,
    codeList,
    nameList
  )
  res.json({ code: 0, data: items })
})

export default router
