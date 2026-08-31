import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog, AppError } from '../middleware/index.js'
import { AccountService } from '../services/accountService.js'
import { batchAccountsImportAsync } from '../services/baseBatchAsync.js'
import {
  getAccountRealtimeBalance,
  getAccountRealtimeAuxBalance,
  parseAuxBalanceSelections,
} from '../services/accountRealtimeBalance.js'
import { filterAccountsByScope } from '../services/accountAuthorization.js'
import { normalizeImportCode, normalizeImportText } from '../services/baseValidation.js'
import { MAX_SYNC_BATCH_ROWS } from '../utils/listLimits.js'
import {
  DEFAULT_LIST_LIMIT,
  isAllRequested,
  MAX_LIST_ALL,
  MAX_LIST_LIMIT,
  parseLimitParam,
  parseOffsetParam,
} from '../utils/listLimits.js'

const router = Router()
router.use(authMiddleware)

// ===================== 会计科目 =====================

router.get('/accounts', (req: AuthRequest, res) => {
  const db = getDb()
  const service = new AccountService(db)
  const { parent_id, keyword, direction, level, is_enabled, limit, offset, all } = req.query

  const list = service.getAccounts({
    account_set_id: req.accountSetId || '',
    parent_id: typeof parent_id === 'string' ? parent_id : undefined,
    keyword: typeof keyword === 'string' ? keyword : undefined,
    direction: typeof direction === 'string' ? direction : undefined,
    level: level !== undefined && level !== '' ? Number(level) : undefined,
    is_enabled: is_enabled !== undefined && is_enabled !== '' ? Number(is_enabled) : undefined,
    limit: isAllRequested(all)
      ? MAX_LIST_ALL
      : parseLimitParam(limit, { defaultLimit: DEFAULT_LIST_LIMIT, maxLimit: MAX_LIST_LIMIT }) ?? undefined,
    offset: parseOffsetParam(offset),
    all: isAllRequested(all),
  })

  const scoped = req.accountScope ? filterAccountsByScope(req.accountScope, list) : list
  const total = service.countAccounts({
    account_set_id: req.accountSetId || '',
    parent_id: typeof parent_id === 'string' ? parent_id : undefined,
    keyword: typeof keyword === 'string' ? keyword : undefined,
    direction: typeof direction === 'string' ? direction : undefined,
    level: level !== undefined && level !== '' ? Number(level) : undefined,
    is_enabled: is_enabled !== undefined && is_enabled !== '' ? Number(is_enabled) : undefined,
  })

  res.json({ code: 0, data: scoped, total: req.accountScope ? scoped.length : total })
})

// 检查科目是否被使用
router.get('/accounts/:id/usage', (req: AuthRequest, res) => {
  const { id } = req.params
  const db = getDb()
  const service = new AccountService(db)
  const usage = service.getAccountUsage(id)
  const childrenCount = service.countAllChildren(id)
  res.json({ code: 0, data: { ...usage, childrenCount } })
})

router.post('/accounts', operationLog('新增科目', '基础设置'), (req: AuthRequest, res) => {
  const {
    code,
    name,
    direction,
    level,
    parent_id,
    is_aux,
    aux_types,
    is_enabled,
    is_cash,
    is_bank,
    no_negative,
    migrate_from_parent,
  } = req.body

  if (!code || !name || !direction) {
    return res.status(400).json({ code: 400, message: '编码、名称、方向不能为空' })
  }

  const db = getDb()
  const service = new AccountService(db)

  if (service.isCodeExists(req.accountSetId || '', code)) {
    return res.status(400).json({ code: 400, message: '科目编码已存在' })
  }

  try {
    const id = service.createAccount({
      account_set_id: req.accountSetId || '',
      code,
      name,
      direction,
      level,
      parent_id,
      is_aux,
      aux_types,
      is_enabled,
      is_cash,
      is_bank,
      no_negative,
      migrate_from_parent,
    })
    res.json({ code: 0, message: '创建成功', data: { id } })
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message || '创建科目失败' })
  }
})

router.put('/accounts/:id', operationLog('修改科目', '基础设置'), (req: AuthRequest, res) => {
  const { id } = req.params
  const { name, direction, is_aux, aux_types, is_enabled, is_cash, is_bank, no_negative } = req.body

  const db = getDb()
  // 归属校验：跨账套或不存在的科目一律视为不存在（多账套隔离）
  const owns = db
    .prepare('SELECT id FROM accounts WHERE id = ? AND account_set_id = ?')
    .get(id, req.accountSetId)
  if (!owns) {
    return res.status(404).json({ code: 404, message: '科目不存在' })
  }
  const service = new AccountService(db)

  try {
    service.updateAccount(id, {
      name,
      direction,
      is_aux,
      aux_types,
      is_enabled,
      is_cash,
      is_bank,
      no_negative,
    })
    res.json({ code: 0, message: '更新成功' })
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message || '更新科目失败' })
  }
})

router.delete('/accounts/:id', operationLog('删除科目', '基础设置'), (req: AuthRequest, res) => {
  const { id } = req.params
  const db = getDb()
  // 归属校验：跨账套或不存在的科目一律视为不存在（多账套隔离）
  const owns = db
    .prepare('SELECT id FROM accounts WHERE id = ? AND account_set_id = ?')
    .get(id, req.accountSetId)
  if (!owns) {
    return res.status(404).json({ code: 404, message: '科目不存在' })
  }
  const service = new AccountService(db)

  try {
    service.deleteAccount(id)
    res.json({ code: 0, message: '删除成功' })
  } catch (error: any) {
    if (error.message === '科目不存在') {
      return res.status(404).json({ code: 404, message: error.message })
    }
    return res.status(400).json({ code: 400, message: error.message })
  }
})

// 查询科目余额（凭证录入时实时查询，依赖记账数据）
//
// FIX-006 / P0-2+P0-3：旧实现直接读 account_balances.end_balance 单期行，
// 但该字段由 applyVoucherPosting 写入时仅 = 年初 + 本期净额，缺失 1~N-1 期发生额。
// 改为动态计算：年初余额 (init_balances) + 截至本期累计发生额（按科目方向折算）。
router.get('/accounts/:id/balance', (req: AuthRequest, res) => {
  const { id } = req.params
  const db = getDb()
  const year = Number(req.query.year) || new Date().getFullYear()
  const period = Number(req.query.period) || new Date().getMonth() + 1
  const accountSetId = req.accountSetId || ''

  const row = db
    .prepare(
      `
    SELECT
      a.direction,
      COALESCE(ib.init_balance, 0) as init_balance,
      COALESCE(cur.current_debit, 0) as current_debit,
      COALESCE(cur.current_credit, 0) as current_credit,
      CASE WHEN a.direction = 'debit'
        THEN COALESCE(ib.init_balance, 0) + COALESCE(cum.cum_debit, 0) - COALESCE(cum.cum_credit, 0)
        ELSE COALESCE(ib.init_balance, 0) + COALESCE(cum.cum_credit, 0) - COALESCE(cum.cum_debit, 0)
      END as end_balance
    FROM accounts a
    LEFT JOIN (
      SELECT account_id,
        CASE
          WHEN COUNT(CASE WHEN aux_item_id != '' THEN 1 END) > 0
          THEN SUM(CASE WHEN aux_item_id != '' THEN init_balance ELSE 0 END)
          ELSE SUM(CASE WHEN COALESCE(aux_item_id, '') = '' THEN init_balance ELSE 0 END)
        END as init_balance
      FROM init_balances
      WHERE year = ? AND account_set_id = ?
      GROUP BY account_id
    ) ib ON ib.account_id = a.id
    LEFT JOIN (
      SELECT account_id,
        SUM(current_debit) as current_debit,
        SUM(current_credit) as current_credit
      FROM account_balances
      WHERE year = ? AND period = ? AND account_set_id = ?
      GROUP BY account_id
    ) cur ON cur.account_id = a.id
    LEFT JOIN (
      SELECT account_id,
        SUM(current_debit) as cum_debit,
        SUM(current_credit) as cum_credit
      FROM account_balances
      WHERE year = ? AND period <= ? AND account_set_id = ?
      GROUP BY account_id
    ) cum ON cum.account_id = a.id
    WHERE a.id = ?
  `
    )
    .get(year, accountSetId, year, period, accountSetId, year, period, accountSetId, id) as any

  if (!row) {
    return res.json({
      code: 0,
      data: {
        init_balance: 0,
        current_debit: 0,
        current_credit: 0,
        end_balance: 0,
        direction: null,
      },
    })
  }

  res.json({ code: 0, data: row })
})

// 查询科目实时余额（不考虑记账因素，从期初余额+所有凭证分录汇总计算）
router.get('/accounts/:id/realtime-balance', (req: AuthRequest, res) => {
  const { id } = req.params
  const db = getDb()
  const year = Number(req.query.year) || new Date().getFullYear()
  const period = Number(req.query.period) || new Date().getMonth() + 1
  const accountSetId = req.accountSetId || ''

  const data = getAccountRealtimeBalance(db, {
    accountId: id,
    accountSetId,
    year,
    period,
  })

  if (!data) {
    return res.json({
      code: 0,
      data: {
        init_balance: 0,
        current_debit: 0,
        current_credit: 0,
        end_balance: 0,
        direction: null,
      },
    })
  }

  res.json({ code: 0, data })
})

// 查询科目下各辅助项目的实时余额（selections=dept:id1,project:id2）
router.get('/accounts/:id/realtime-aux-balances', (req: AuthRequest, res) => {
  const { id } = req.params
  const db = getDb()
  const year = Number(req.query.year) || new Date().getFullYear()
  const period = Number(req.query.period) || new Date().getMonth() + 1
  const accountSetId = req.accountSetId || ''
  const selections = parseAuxBalanceSelections(req.query.selections as string | undefined)

  const acc = db
    .prepare('SELECT direction FROM accounts WHERE id=? AND account_set_id=?')
    .get(id, accountSetId) as { direction: 'debit' | 'credit' } | undefined
  if (!acc || selections.length === 0) {
    return res.json({ code: 0, data: [] })
  }

  const itemNameStmt = db.prepare('SELECT name FROM aux_items WHERE id=? AND account_set_id=?')

  const balances = selections.map(sel => {
    const row = getAccountRealtimeAuxBalance(db, {
      accountId: id,
      accountSetId,
      year,
      period,
      categoryCode: sel.categoryCode,
      itemId: sel.itemId,
      accountDirection: acc.direction,
    })
    const itemRow = itemNameStmt.get(sel.itemId, accountSetId) as { name: string } | undefined
    row.item_name = itemRow?.name || ''
    return row
  })

  res.json({ code: 0, data: balances })
})

// 批量导入科目
router.post(
  '/accounts/batch-import',
  operationLog('批量导入科目', '基础设置'),
  (req: AuthRequest, res) => {
    const { accounts } = req.body
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供要导入的科目列表' })
    }
    if (accounts.length > MAX_SYNC_BATCH_ROWS) {
      return res.status(400).json({
        code: 400,
        message: `同步导入最多 ${MAX_SYNC_BATCH_ROWS} 条，请使用 /accounts/batch-import-async`,
      })
    }

    const db = getDb()
    const service = new AccountService(db)
    const accountSetId = req.accountSetId || ''

    let successCount = 0
    let failCount = 0
    const errors: Array<{ code: string; name: string; reason: string }> = []
    const importedAccounts: any[] = []

    // 获取现有科目列表
    const existingAccounts = service.getAccounts({ account_set_id: accountSetId })

    // 辅助函数：根据上级编码查找 parent_id
    function findParentId(parentCode: string | null | undefined): string | null {
      if (!parentCode) return null
      const key = normalizeImportCode(parentCode)
      const parent = [...existingAccounts, ...importedAccounts].find(
        a => normalizeImportCode(String(a.code)) === key
      )
      return parent?.id || null
    }

    try {
      for (const item of accounts) {
        try {
          // 验证必填字段
          const itemCode = normalizeImportCode(String(item.code || ''))
          const itemName = normalizeImportText(String(item.name || ''))
          if (!itemCode || !itemName || !item.direction) {
            failCount++
            errors.push({
              code: item.code || '',
              name: item.name || '',
              reason: '编码、名称、方向不能为空',
            })
            continue
          }

          // 检查编码是否已存在
          if (service.isCodeExists(accountSetId, itemCode)) {
            failCount++
            errors.push({ code: itemCode, name: itemName, reason: '科目编码已存在' })
            continue
          }

          // 查找上级科目
          const parentId = findParentId(item.parent_code)
          const parent = parentId
            ? [...existingAccounts, ...importedAccounts].find(a => a.id === parentId)
            : null
          const level = parent ? (parent.level || 0) + 1 : 1

          // 创建科目
          const id = service.createAccount({
            account_set_id: accountSetId,
            code: itemCode,
            name: itemName,
            direction: item.direction,
            level,
            parent_id: parentId,
            is_aux: item.is_aux || 0,
            aux_types: item.aux_types || null,
            is_enabled: item.is_enabled !== undefined ? item.is_enabled : 1,
            is_cash: item.is_cash || 0,
            is_bank: item.is_bank || 0,
            no_negative: item.no_negative || 0,
          })

          successCount++
          // 记录已导入的科目，供后续行查找上级
          importedAccounts.push({
            id,
            code: itemCode,
            name: itemName,
            level,
            direction: item.direction,
          })
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
  '/accounts/batch-import-async',
  operationLog('异步批量导入科目', '基础设置'),
  (req: AuthRequest, res) => {
    const { accounts } = req.body
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供要导入的科目列表' })
    }
    try {
      const taskId = batchAccountsImportAsync(getDb(), req.accountSetId || '', accounts)
      res.json({ code: 0, message: '批量导入任务已创建', data: { taskId } })
    } catch (error: any) {
      res.status(400).json({ code: 400, message: error.message || '创建任务失败' })
    }
  }
)

// ===================== 现金流向项目 =====================

router.get('/cash-flow-items', (req: AuthRequest, res) => {
  const db = getDb()
  const list = db.prepare('SELECT code, name FROM cash_flow_items ORDER BY code').all()
  res.json({ code: 0, data: list })
})

// 检查并补充缺失的父科目
router.post('/accounts/repair-hierarchy', operationLog('修复科目层级', '基础设置'), (req: AuthRequest, res) => {
  const db = getDb()
  const service = new AccountService(db)
  try {
    const result = service.repairAccountHierarchy(req.accountSetId || '')
    res.json({
      code: 0,
      message: `已校验 ${result.total} 个科目，修复 ${result.updated} 个`,
      data: result,
    })
  } catch (error: any) {
    res.status(400).json({ code: 400, message: error.message || '修复科目层级失败' })
  }
})

export default router
