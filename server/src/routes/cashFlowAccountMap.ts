/**
 * 基础资料 → 科目现金流量项目
 *
 * GET    /                       ?tab=asset|liability|common|equity|cost|pl  科目行 + 4 个项目
 * GET    /options                主表 / 附表项目下拉
 * PUT    /:accountId             改一行（body: 4 个编码中的任意几个 + applyToChildren）
 * POST   /restore-default        按默认规则覆盖（body.tab 可选）
 * GET    /copy-targets           可复制到的其他账套（同用户名、启用、有本功能权限）
 * POST   /copy                   复制到其他账套（body.targetAccountSetIds）
 */
import { Router } from 'express'
import { authMiddleware, requirePermission, type AuthRequest } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import {
  copyCashFlowMappingToAccountSets,
  resolveCashFlowProfile,
  ensureCashFlowMappingSeeded,
  listCashFlowMapRows,
  loadCashFlowItemsLite,
  presetCashFlowMapping,
  updateCashFlowMapRow,
  classifyCashFlowItem,
  type AccountTab,
} from '../services/cashFlowAccountMap.js'
import { SUPPLEMENT_NET_PROFIT_CODE } from '../config/cashFlowAccountDefaults.js'
import { resolveUserPermissions } from '../services/userRoleLinks.js'

const router = Router()
router.use(authMiddleware)

const PERMISSION = 'base:cashitem'
const TAB_KEYS = new Set<string>(['asset', 'liability', 'common', 'equity', 'cost', 'pl'])

function parseTab(raw: unknown): AccountTab | null {
  const v = String(raw || '')
  return TAB_KEYS.has(v as AccountTab) ? (v as AccountTab) : null
}


router.get('/options', requirePermission(PERMISSION), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const accountSetId = req.accountSetId || ''
    ensureCashFlowMappingSeeded(db, accountSetId)
    const profile = resolveCashFlowProfile(db, accountSetId)
    const labels = profile.activityLabels
    const ACTIVITY_LABEL: Record<string, string> = { operating: labels.operating, investing: labels.investing, financing: labels.financing }
    const items = loadCashFlowItemsLite(db, accountSetId)
    const main = items
      .filter(i => i.kind !== 'supplement' && i.is_leaf !== 0)
      .map(i => {
        const cls = classifyCashFlowItem(i)
        return {
          code: i.code,
          name: i.name,
          activity: cls.activity,
          group: cls.activity && cls.flow ? `${ACTIVITY_LABEL[cls.activity]}${cls.flow === 'in' ? '流入' : '流出'}` : '其他',
          flow: cls.flow,
        }
      })
    const supplement = profile.hasSupplement
      ? items.filter(i => i.kind === 'supplement' && i.code !== SUPPLEMENT_NET_PROFIT_CODE).map(i => ({ code: i.code, name: i.name }))
      : []
    res.json({
      code: 0,
      data: {
        tabs: profile.tabs,
        main,
        supplement,
        standard: profile.key,
        standardName: profile.name,
        hasSupplement: profile.hasSupplement,
        activityLabels: labels,
      },
    })
  } catch (error: any) {
    console.error('读取现金流量项目选项失败:', error)
    res.status(500).json({ code: 500, message: error.message || '读取失败' })
  }
})

router.get('/', requirePermission(PERMISSION), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const accountSetId = req.accountSetId || ''
    const tab = parseTab(req.query.tab) || 'asset'
    const seeded = ensureCashFlowMappingSeeded(db, accountSetId)
    const rows = listCashFlowMapRows(db, accountSetId, tab)
    res.json({ code: 0, data: { tab, rows, seeded } })
  } catch (error: any) {
    console.error('读取科目现金流量项目失败:', error)
    res.status(500).json({ code: 500, message: error.message || '读取失败' })
  }
})

router.put('/:accountId', requirePermission(PERMISSION), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const accountSetId = req.accountSetId || ''
    const body = req.body || {}
    const patch: Record<string, string | null> = {}
    for (const key of ['main_credit_code', 'main_debit_code', 'supp_credit_code', 'supp_debit_code']) {
      if (key in body) patch[key] = body[key] === null || body[key] === undefined ? null : String(body[key])
    }
    const result = updateCashFlowMapRow(db, accountSetId, req.params.accountId, patch, !!body.applyToChildren)
    if (result.error) return res.status(400).json({ code: 400, message: result.error })
    res.json({ code: 0, data: result })
  } catch (error: any) {
    console.error('保存科目现金流量项目失败:', error)
    res.status(500).json({ code: 500, message: error.message || '保存失败' })
  }
})

router.post('/restore-default', requirePermission(PERMISSION), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const accountSetId = req.accountSetId || ''
    const tab = parseTab(req.body?.tab)
    const result = presetCashFlowMapping(db, accountSetId, { overwrite: true, tab: tab || undefined })
    res.json({ code: 0, data: result })
  } catch (error: any) {
    console.error('恢复默认现金流量项目失败:', error)
    res.status(500).json({ code: 500, message: error.message || '恢复默认失败' })
  }
})

/** 当前登录用户在其他账套里的同名、启用、有本功能权限的账号 → 可复制的目标账套 */
function listCopyTargets(req: AuthRequest): Array<{ id: string; name: string; code: string | null }> {
  const db = getDb()
  const me = db.prepare('SELECT username FROM users WHERE id = ? AND account_set_id = ?').get(req.userId, req.accountSetId) as
    | { username: string }
    | undefined
  if (!me) return []
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, u.role_id, u.custom_permissions, a.id, a.name, a.code
       FROM users u JOIN account_sets a ON a.id = u.account_set_id
       WHERE u.username = ? AND u.account_set_id != ? AND u.status = 'active'
       ORDER BY a.code, a.name`
    )
    .all(me.username, req.accountSetId) as Array<{
    user_id: string
    role_id: string | null
    custom_permissions: string | null
    id: string
    name: string
    code: string | null
  }>
  return rows
    .filter(r => {
      const perms = resolveUserPermissions(db, {
        userId: r.user_id,
        accountSetId: r.id,
        roleId: r.role_id,
        customPermissions: r.custom_permissions,
      })
      return perms.includes('*') || perms.includes(PERMISSION)
    })
    .map(r => ({ id: r.id, name: r.name, code: r.code }))
}

router.get('/copy-targets', requirePermission(PERMISSION), (req: AuthRequest, res) => {
  try {
    res.json({ code: 0, data: listCopyTargets(req) })
  } catch (error: any) {
    console.error('读取可复制账套失败:', error)
    res.status(500).json({ code: 500, message: error.message || '读取失败' })
  }
})

router.post('/copy', requirePermission(PERMISSION), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const requested: string[] = Array.isArray(req.body?.targetAccountSetIds) ? req.body.targetAccountSetIds.map(String) : []
    if (requested.length === 0) return res.status(400).json({ code: 400, message: '请选择目标账套' })
    const allowed = new Map(listCopyTargets(req).map(t => [t.id, t]))
    const denied = requested.filter(id => !allowed.has(id))
    if (denied.length) {
      return res.status(403).json({ code: 403, message: '包含无权限的目标账套，请重新选择' })
    }
    const results = copyCashFlowMappingToAccountSets(db, req.accountSetId || '', requested).map(r => ({
      ...r,
      accountSetName: allowed.get(r.accountSetId)?.name || r.accountSetId,
    }))
    res.json({ code: 0, data: results })
  } catch (error: any) {
    console.error('复制科目现金流量项目失败:', error)
    res.status(500).json({ code: 500, message: error.message || '复制失败' })
  }
})

export default router
