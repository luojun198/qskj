import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'

const router = Router()
router.use(authMiddleware)

const asid = (req: AuthRequest) => req.accountSetId || ''

/** 列方案管理权限守卫：admin '*' 放行，否则需 scm:colscheme。/my 不走此守卫（任意登录用户可读自己的方案）。 */
function requireColScheme(req: AuthRequest, res: any, next: any) {
  if (req.permissions?.includes('*')) return next()
  if (req.permissions?.includes('scm:colscheme')) return next()
  return res.status(403).json({ code: 403, message: '无「列方案设置」权限' })
}

function parseHidden(s: any): string[] {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.map(String) : [] } catch { return [] }
}

// ── 当前用户在某 target+doc_type 下生效的方案（任意登录用户可读） ──────────
// 注意：必须定义在 /scm/col-schemes/:id 之前
router.get('/scm/col-schemes/my', (req: AuthRequest, res) => {
  const db = getDb()
  const { target, doc_type } = req.query as { target?: string; doc_type?: string }
  if (!target || !doc_type) return res.json({ code: 0, data: { scheme_id: null, name: null, hidden_cols: [] } })
  const row = db.prepare(
    `SELECT s.id, s.name, s.hidden_cols
       FROM scm_col_scheme_user u
       JOIN scm_col_scheme s ON s.id = u.scheme_id
      WHERE u.account_set_id = ? AND u.user_id = ? AND s.target = ? AND s.doc_type = ?
      LIMIT 1`
  ).get(asid(req), req.userId || '', target, doc_type) as any
  if (!row) return res.json({ code: 0, data: { scheme_id: null, name: null, hidden_cols: [] } })
  res.json({ code: 0, data: { scheme_id: row.id, name: row.name, hidden_cols: parseHidden(row.hidden_cols) } })
})

// ── 当前账套用户列表（供分配选择） ──────────────────────────────────────
router.get('/scm/col-schemes/users', requireColScheme, (req: AuthRequest, res) => {
  const db = getDb()
  const rows = db.prepare(
    `SELECT id, username, COALESCE(nickname, '') AS nickname
       FROM users WHERE account_set_id = ? AND COALESCE(status, 'active') = 'active'
      ORDER BY username`
  ).all(asid(req))
  res.json({ code: 0, data: rows })
})

// ── 方案列表（含每方案已分配的 user_ids） ───────────────────────────────
router.get('/scm/col-schemes', requireColScheme, (req: AuthRequest, res) => {
  const db = getDb()
  const { target, doc_type } = req.query as { target?: string; doc_type?: string }
  const conds = ['account_set_id = ?']
  const params: any[] = [asid(req)]
  if (target) { conds.push('target = ?'); params.push(target) }
  if (doc_type) { conds.push('doc_type = ?'); params.push(doc_type) }
  const schemes = db.prepare(
    `SELECT id, target, doc_type, name, hidden_cols, is_default, created_at, updated_at
       FROM scm_col_scheme WHERE ${conds.join(' AND ')}
      ORDER BY target, doc_type, created_at DESC`
  ).all(...params) as any[]
  const userStmt = db.prepare('SELECT user_id FROM scm_col_scheme_user WHERE scheme_id = ?')
  const data = schemes.map(s => ({
    ...s,
    hidden_cols: parseHidden(s.hidden_cols),
    is_default: Boolean(s.is_default),
    user_ids: (userStmt.all(s.id) as any[]).map(u => u.user_id),
  }))
  res.json({ code: 0, data })
})

// ── 创建方案 ────────────────────────────────────────────────────────────
router.post('/scm/col-schemes', requireColScheme, operationLog('创建列方案', '供应链'), (req: AuthRequest, res) => {
  const { target, doc_type, name, hidden_cols } = req.body
  if (!target || !doc_type || !name) {
    return res.status(400).json({ code: 400, message: '缺少必填字段（target/doc_type/name）' })
  }
  const db = getDb()
  const id = uuidv4()
  db.prepare(
    `INSERT INTO scm_col_scheme (id, account_set_id, target, doc_type, name, hidden_cols, is_default)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(id, asid(req), target, doc_type, name, JSON.stringify(Array.isArray(hidden_cols) ? hidden_cols : []))
  res.json({ code: 0, message: '创建成功', data: { id } })
})

// ── 更新方案（名称 / hidden_cols） ──────────────────────────────────────
router.put('/scm/col-schemes/:id', requireColScheme, operationLog('更新列方案', '供应链'), (req: AuthRequest, res) => {
  const { id } = req.params
  const { name, hidden_cols } = req.body
  const db = getDb()
  const existing = db.prepare('SELECT name, hidden_cols FROM scm_col_scheme WHERE id = ? AND account_set_id = ?')
    .get(id, asid(req)) as any
  if (!existing) return res.status(404).json({ code: 404, message: '方案不存在' })
  db.prepare(
    `UPDATE scm_col_scheme SET name = ?, hidden_cols = ?, updated_at = datetime('now')
      WHERE id = ? AND account_set_id = ?`
  ).run(
    name ?? existing.name,
    hidden_cols !== undefined ? JSON.stringify(Array.isArray(hidden_cols) ? hidden_cols : []) : existing.hidden_cols,
    id, asid(req)
  )
  res.json({ code: 0, message: '更新成功' })
})

// ── 删除方案（连带分配，FK ON DELETE CASCADE） ──────────────────────────
router.delete('/scm/col-schemes/:id', requireColScheme, operationLog('删除列方案', '供应链'), (req: AuthRequest, res) => {
  const { id } = req.params
  const db = getDb()
  const existing = db.prepare('SELECT id FROM scm_col_scheme WHERE id = ? AND account_set_id = ?').get(id, asid(req))
  if (!existing) return res.status(404).json({ code: 404, message: '方案不存在' })
  db.prepare('DELETE FROM scm_col_scheme_user WHERE scheme_id = ?').run(id)
  db.prepare('DELETE FROM scm_col_scheme WHERE id = ? AND account_set_id = ?').run(id, asid(req))
  res.json({ code: 0, message: '删除成功' })
})

// ── 分配用户（替换式：保证一个用户在同 target+doc_type 下只属一个方案） ──
router.post('/scm/col-schemes/:id/assign', requireColScheme, operationLog('分配列方案', '供应链'), (req: AuthRequest, res) => {
  const { id } = req.params
  const { user_ids } = req.body as { user_ids?: string[] }
  const db = getDb()
  const scheme = db.prepare('SELECT id, target, doc_type FROM scm_col_scheme WHERE id = ? AND account_set_id = ?')
    .get(id, asid(req)) as any
  if (!scheme) return res.status(404).json({ code: 404, message: '方案不存在' })
  const ids = Array.isArray(user_ids) ? user_ids.filter(Boolean) : []

  // 同 target+doc_type 下的所有兄弟方案 id（含本方案），用于清除用户旧分配
  const siblings = db.prepare(
    'SELECT id FROM scm_col_scheme WHERE account_set_id = ? AND target = ? AND doc_type = ?'
  ).all(asid(req), scheme.target, scheme.doc_type) as any[]
  const siblingIds = siblings.map(s => s.id)
  const placeholders = siblingIds.map(() => '?').join(',')

  const tx = db.transaction(() => {
    // 1. 清空本方案现有分配
    db.prepare('DELETE FROM scm_col_scheme_user WHERE scheme_id = ?').run(id)
    // 2. 对每个目标用户，先解除其在兄弟方案下的分配（同类型唯一），再分配到本方案
    const delUser = db.prepare(
      `DELETE FROM scm_col_scheme_user WHERE account_set_id = ? AND user_id = ? AND scheme_id IN (${placeholders})`
    )
    const ins = db.prepare('INSERT INTO scm_col_scheme_user (id, account_set_id, scheme_id, user_id) VALUES (?, ?, ?, ?)')
    for (const uid of ids) {
      delUser.run(asid(req), uid, ...siblingIds)
      ins.run(uuidv4(), asid(req), id, uid)
    }
  })
  tx()
  res.json({ code: 0, message: '分配成功', data: { count: ids.length } })
})

export default router
