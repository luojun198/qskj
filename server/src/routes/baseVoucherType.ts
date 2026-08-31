import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'

const router = Router()
router.use(authMiddleware)

// ===================== 凭证类型 =====================

router.get('/voucher-types', (req: AuthRequest, res) => {
  const db = getDb()
  const list = db
    .prepare(
      `SELECT *
       FROM voucher_types
       WHERE account_set_id=? OR account_set_id IS NULL
       ORDER BY
         CASE WHEN code IS NOT NULL AND code != '' AND code NOT GLOB '*[^0-9]*' THEN 0 ELSE 1 END,
         CASE WHEN code IS NOT NULL AND code != '' AND code NOT GLOB '*[^0-9]*' THEN CAST(code AS INTEGER) END,
         code COLLATE NOCASE ASC,
         sort_order ASC`
    )
    .all(req.accountSetId)
  res.json({ code: 0, data: list })
})

router.post('/voucher-types', operationLog('新增凭证类型', '基础设置'), (req: AuthRequest, res) => {
  const { name, code, description, sort_order } = req.body
  const db = getDb()
  const id = uuidv4()
  db.prepare(
    'INSERT INTO voucher_types (id, account_set_id, name, code, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, req.accountSetId, name, code, description, sort_order || 0)
  res.json({ code: 0, message: '创建成功', data: { id } })
})

router.put(
  '/voucher-types/:id',
  operationLog('修改凭证类型', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const { name, code, description, sort_order } = req.body
    const db = getDb()
    db.prepare(
      'UPDATE voucher_types SET name=?, code=?, description=?, sort_order=? WHERE id=?'
    ).run(name, code, description, sort_order, id)
    res.json({ code: 0, message: '更新成功' })
  }
)

router.delete(
  '/voucher-types/:id',
  operationLog('删除凭证类型', '基础设置'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    db.prepare('DELETE FROM voucher_types WHERE id=?').run(id)
    res.json({ code: 0, message: '删除成功' })
  }
)

export default router
