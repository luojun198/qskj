import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'

const router = Router()
router.use(authMiddleware)

// ===================== 快捷键维护 =====================

// 获取所有快捷键配置
router.get('/', (req: AuthRequest, res) => {
  const db = getDb()
  const { module, keyword } = req.query

  let sql = `
    SELECT id, module, action, key, ctrl, alt, shift, meta,
           description, component_path, is_enabled, is_custom,
           created_at, updated_at
    FROM keyboard_shortcuts
    WHERE 1=1
  `
  const params: any[] = []

  // 按模块过滤
  if (module) {
    sql += ' AND module = ?'
    params.push(module)
  }

  // 关键字搜索（模块、操作、描述）
  if (keyword) {
    sql += ' AND (module LIKE ? OR action LIKE ? OR description LIKE ?)'
    const searchPattern = `%${keyword}%`
    params.push(searchPattern, searchPattern, searchPattern)
  }

  sql += ' ORDER BY module, id'

  const shortcuts = db.prepare(sql).all(...params)

  res.json({
    code: 0,
    data: shortcuts.map((s: any) => ({
      ...s,
      ctrl: Boolean(s.ctrl),
      alt: Boolean(s.alt),
      shift: Boolean(s.shift),
      meta: Boolean(s.meta),
      is_enabled: Boolean(s.is_enabled),
      is_custom: Boolean(s.is_custom),
    })),
  })
})

// 更新快捷键配置
router.put(
  '/:id',
  operationLog('更新快捷键配置', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const { key, ctrl, alt, shift, meta, description, is_enabled } = req.body
    const db = getDb()

    // 检查快捷键是否存在
    const shortcut = db
      .prepare('SELECT id, module FROM keyboard_shortcuts WHERE id = ?')
      .get(id) as any

    if (!shortcut) {
      return res.status(404).json({ code: 404, message: '快捷键配置不存在' })
    }

    // 验证必填字段
    if (!key || key.trim() === '') {
      return res.status(400).json({ code: 400, message: '按键不能为空' })
    }

    // 检查冲突（同模块内相同的快捷键组合）
    const conflict = db
      .prepare(
        `SELECT id FROM keyboard_shortcuts
         WHERE id != ? AND module = ? AND key = ? AND ctrl = ? AND alt = ? AND shift = ? AND is_enabled = 1`
      )
      .get(
        id,
        shortcut.module,
        key.trim(),
        ctrl ? 1 : 0,
        alt ? 1 : 0,
        shift ? 1 : 0
      )

    if (conflict) {
      return res.status(400).json({
        code: 400,
        message: '该模块内已存在相同的快捷键组合，请修改后重试',
      })
    }

    // 更新快捷键配置
    db.prepare(
      `UPDATE keyboard_shortcuts
       SET key = ?, ctrl = ?, alt = ?, shift = ?, meta = ?,
           description = ?, is_enabled = ?, is_custom = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      key.trim(),
      ctrl ? 1 : 0,
      alt ? 1 : 0,
      shift ? 1 : 0,
      meta ? 1 : 0,
      description || '',
      is_enabled ? 1 : 0,
      id
    )

    res.json({
      code: 0,
      message: '快捷键配置已更新，请刷新页面使其生效',
    })
  }
)

// 重置为默认配置
router.post(
  '/reset',
  operationLog('重置快捷键配置', '基础设置'),
  (req: AuthRequest, res) => {
    const db = getDb()

    // 删除所有快捷键配置
    db.prepare('DELETE FROM keyboard_shortcuts').run()

    // 重新插入默认数据
    const insert = db.prepare(`
      INSERT INTO keyboard_shortcuts
      (module, action, key, ctrl, alt, shift, meta, description, component_path, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const defaultShortcuts = [
      ['凭证录入表单', '保存', 's', 1, 0, 0, 0, '保存当前凭证', 'client/src/components/voucher/VoucherEntryForm.vue', 1],
      ['凭证录入表单', '保存并新增', 's', 0, 0, 1, 0, '保存当前凭证并新增下一张', 'client/src/components/voucher/VoucherEntryForm.vue', 1],
      ['凭证录入表单', '上传附件', 'f', 1, 0, 0, 0, '打开文件选择对话框', 'client/src/components/voucher/VoucherEntryForm.vue', 1],
      ['凭证录入表单', '关闭', 'Escape', 0, 0, 0, 0, '关闭凭证表单', 'client/src/components/voucher/VoucherEntryForm.vue', 1],
      ['凭证录入页面', '新增凭证', 's', 0, 0, 1, 0, '打开新增凭证对话框', 'client/src/views/voucher/Entry.vue', 1],
      ['凭证录入页面', '刷新列表', 'r', 1, 0, 0, 0, '刷新草稿凭证列表', 'client/src/views/voucher/Entry.vue', 1],
      ['凭证审核页面', '批量操作', 'e', 1, 0, 0, 0, '打开批量操作对话框', 'client/src/views/voucher/Audit.vue', 1],
      ['凭证审核页面', '批量反记账', 'd', 1, 0, 0, 0, '批量反记账操作', 'client/src/views/voucher/Audit.vue', 1],
    ]

    for (const shortcut of defaultShortcuts) {
      insert.run(...shortcut)
    }

    res.json({
      code: 0,
      message: '快捷键配置已重置为默认值',
    })
  }
)

export default router
