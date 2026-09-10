import { Router, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { accountHasAuxAccounting } from '../utils/auxItemId.js'
import {
  assertOpeningDebitCreditExclusive,
  normalizeOpeningDebitCredit,
} from '../utils/initBalanceOpening.js'
import {
  calcForeignInitBalance,
  normalizeForeignOpeningDebitCredit,
} from '../utils/initBalanceForeign.js'
import {
  calcQuantityInitBalance,
  normalizeQuantityOpeningDebitCredit,
} from '../utils/initBalanceQuantity.js'
import {
  checkInitBalanceAuxCategoryConsistency,
  getInitBalanceAuxConfig,
  getInitBalanceAuxDetails,
  saveInitBalanceAuxDetails,
  upsertInitBalanceAuxLine,
} from '../services/initBalanceAux.js'
import {
  checkInitBalanceEditable,
  checkInitBalanceAuxEditable,
  clearAuxInitBalances,
  clearDirectInitBalances,
  countAuxInitClearTargets,
  countInitBalanceClearTargets,
} from '../services/initBalanceClear.js'
import {
  batchAuxInitClearAsync,
  batchInitBalanceAuxSaveAsync,
  batchInitBalanceClearAsync,
  batchInitBalanceImportAsync,
  exportInitBalanceAuxAsync,
} from '../services/baseBatchAsync.js'
import {
  appendAccountScopeCondition,
  assertAccountIdInScope,
  assertAccountIdsInScope,
  assertAuxAllAccountsClearAllowed,
  resolveScopedAccountIdsForClear,
} from '../services/accountAuthorization.js'

const router = Router()
router.use(authMiddleware)

function normalizeAuxItemId(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function calcInitBalance(direction: string, totalDebit: number, totalCredit: number) {
  return direction === 'credit' ? totalCredit - totalDebit : totalDebit - totalCredit
}

function getInitBalanceTotals(db: any, accountSetId: string, year: number | string) {
  const balances = db
    .prepare(
      `
      SELECT SUM(init_debit) as total_debit, SUM(init_credit) as total_credit
      FROM init_balances
      WHERE account_set_id=? AND year=? AND aux_item_id=''
    `
    )
    .get(accountSetId, year) as any
  const totalDebit = balances?.total_debit || 0
  const totalCredit = balances?.total_credit || 0
  return {
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
    totalDebit,
    totalCredit,
  }
}

function assertAccountEditableForDirectInit(
  db: any,
  accountSetId: string,
  accountId: string,
  accountScope?: import('../services/accountAuthorization.js').AccountScopeContext
) {
  const scopeErr = assertAccountIdInScope(accountScope, accountId)
  if (scopeErr) {
    throw new Error(scopeErr)
  }
  const account = db
    .prepare(`SELECT is_aux, aux_types FROM accounts WHERE id=? AND account_set_id=?`)
    .get(accountId, accountSetId) as { is_aux?: number; aux_types?: string } | undefined
  if (account && accountHasAuxAccounting(account)) {
    throw new Error('该科目已启用辅助核算，请通过「辅助期初」录入，不能直接修改科目期初')
  }
}

router.get('/init-balances', (req: AuthRequest, res) => {
  const db = getDb()
  const { year, keyword } = req.query
  const y = Number(year) || new Date().getFullYear()

  const accountSet = db.prepare('SELECT * FROM account_sets WHERE id=?').get(req.accountSetId) as any
  const startDate = accountSet?.start_date ? new Date(accountSet.start_date) : null
  const startMonth = startDate ? startDate.getMonth() + 1 : 1
  const isMidYear = startMonth > 1

  let sql = `
    SELECT a.*, ib.init_balance, ib.init_debit, ib.init_credit,
           ib.opening_debit, ib.opening_credit,
           ib.pre_book_debit, ib.pre_book_credit,
           ib.foreign_init_balance, ib.foreign_opening_debit, ib.foreign_opening_credit,
           ib.foreign_pre_book_debit, ib.foreign_pre_book_credit,
           ib.qty_init_balance, ib.qty_opening_debit, ib.qty_opening_credit,
           ib.qty_pre_book_debit, ib.qty_pre_book_credit,
           ib.direction as balance_direction,
           (SELECT COUNT(*) FROM init_balances ib2
            WHERE ib2.account_set_id = a.account_set_id
              AND ib2.account_id = a.id
              AND ib2.year = ?
              AND ib2.aux_item_id != '') as aux_detail_count
    FROM accounts a
    LEFT JOIN init_balances ib
      ON a.id = ib.account_id
      AND ib.year = ?
      AND ib.account_set_id = ?
      AND ib.aux_item_id = ''
    WHERE a.account_set_id = ? AND a.is_enabled = 1
  `
  const params: any[] = [y, y, req.accountSetId, req.accountSetId]

  if (keyword && typeof keyword === 'string' && keyword.trim()) {
    const kw = `%${keyword.trim()}%`
    sql += ` AND (a.code LIKE ? OR a.name LIKE ?)`
    params.push(kw, kw)
  }

  const scopeConditions: string[] = []
  const scopeParams: string[] = []
  appendAccountScopeCondition(req.accountScope, 'a.id', scopeConditions, scopeParams)
  if (scopeConditions.length > 0) {
    sql += ` AND ${scopeConditions.join(' AND ')}`
    params.push(...scopeParams)
  }

  sql += ` ORDER BY a.code`

  const list = (db.prepare(sql).all(...params) as any[]).map(row => ({
    ...row,
    has_aux: accountHasAuxAccounting(row),
    aux_readonly: accountHasAuxAccounting(row),
  }))

  res.json({ code: 0, data: list, isMidYear, startMonth })
})

router.get('/init-balances/aux-config', (req: AuthRequest, res) => {
  const db = getDb()
  try {
    const data = getInitBalanceAuxConfig(db, req.accountSetId || '')
    res.json({ code: 0, data })
  } catch (error: any) {
    res.status(500).json({ code: 1, message: error.message })
  }
})

router.get('/init-balances/aux-details', (req: AuthRequest, res) => {
  const db = getDb()
  const { year, account_id, period } = req.query
  if (!account_id || typeof account_id !== 'string') {
    return res.status(400).json({ code: 1, message: '缺少 account_id' })
  }
  const scopeErr = assertAccountIdInScope(req.accountScope, account_id)
  if (scopeErr) {
    return res.status(403).json({ code: 403, message: scopeErr })
  }
  const y = Number(year) || new Date().getFullYear()
  const p = Number(period) || 1
  try {
    const linesMode =
      req.query.lines === 'none' ? 'none' : req.query.lines === 'page' ? 'page' : 'all'
    const offset = Number(req.query.offset) || 0
    const limit = Number(req.query.limit) || undefined
    const sortValues = new Set([
      'code',
      'name',
      'opening_debit',
      'opening_credit',
      'pre_book_debit',
      'pre_book_credit',
      'init_balance',
    ])
    const sort =
      typeof req.query.sort === 'string' && sortValues.has(req.query.sort)
        ? (req.query.sort as any)
        : undefined
    const data = getInitBalanceAuxDetails(db, req.accountSetId || '', account_id, y, p, {
      linesMode,
      offset,
      limit,
      categoryId:
        typeof req.query.category_id === 'string' ? req.query.category_id : undefined,
      keyword: typeof req.query.keyword === 'string' ? req.query.keyword : undefined,
      sort,
      order: req.query.order === 'desc' ? 'desc' : 'asc',
      nonzeroOnly: req.query.nonzero_only === '1' || req.query.nonzero_only === 'true',
    })
    res.json({ code: 0, data })
  } catch (error: any) {
    res.status(error.statusCode || 400).json({
      code: error.code || 1,
      message: error.message,
    })
  }
})

router.post(
  '/init-balances/aux-details/export-async',
  operationLog('后台导出辅助期初', '基础设置'),
  (req: AuthRequest, res) => {
    const accountId = String(req.body?.account_id || '')
    if (!accountId) return res.status(400).json({ code: 1, message: '缺少 account_id' })
    const scopeErr = assertAccountIdInScope(req.accountScope, accountId)
    if (scopeErr) return res.status(403).json({ code: 403, message: scopeErr })
    try {
      const taskId = exportInitBalanceAuxAsync(
        getDb(),
        req.accountSetId || '',
        accountId,
        Number(req.body?.year) || new Date().getFullYear(),
        Number(req.body?.period) || 1
      )
      res.json({ code: 0, message: '辅助期初导出任务已创建', data: { taskId } })
    } catch (error: any) {
      res.status(400).json({ code: 1, message: error.message || '创建导出任务失败' })
    }
  }
)

router.post(
  '/init-balances/aux-details/line',
  operationLog('保存辅助期初单行', '基础设置'),
  (req: AuthRequest, res) => {
    const { year, account_id, period, line } = req.body
    if (!account_id) {
      return res.status(400).json({ code: 1, message: '缺少 account_id' })
    }
    const scopeErrLine = assertAccountIdInScope(req.accountScope, account_id)
    if (scopeErrLine) {
      return res.status(403).json({ code: 403, message: scopeErrLine })
    }
    if (!line || typeof line !== 'object') {
      return res.status(400).json({ code: 1, message: '缺少 line' })
    }
    const db = getDb()
    const y = year || new Date().getFullYear()
    const p = period || 1
    try {
      const summary = upsertInitBalanceAuxLine(
        db,
        req.accountSetId || '',
        account_id,
        y,
        line,
        p
      )
      res.json({ code: 0, message: '保存成功', data: { summary } })
    } catch (error: any) {
      res.status(400).json({ code: 1, message: error.message })
    }
  }
)

router.post(
  '/init-balances/aux-details',
  operationLog('保存辅助期初余额', '基础设置'),
  (req: AuthRequest, res) => {
    const { year, account_id, period, lines } = req.body
    if (!account_id) {
      return res.status(400).json({ code: 1, message: '缺少 account_id' })
    }
    const scopeErrAux = assertAccountIdInScope(req.accountScope, account_id)
    if (scopeErrAux) {
      return res.status(403).json({ code: 403, message: scopeErrAux })
    }
    if (!Array.isArray(lines)) {
      return res.status(400).json({ code: 1, message: 'lines 必须为数组' })
    }
    const db = getDb()
    const y = year || new Date().getFullYear()
    const p = period || 1

    try {
      const summary = saveInitBalanceAuxDetails(
        db,
        req.accountSetId || '',
        account_id,
        y,
        lines,
        p
      )
      const totals = getInitBalanceTotals(db, req.accountSetId || '', y)
      res.json({
        code: 0,
        message: '保存成功',
        data: { summary, ...totals },
      })
    } catch (error: any) {
      res.status(400).json({ code: 1, message: error.message })
    }
  }
)

router.post('/init-balances', operationLog('录入期初余额', '基础设置'), (req: AuthRequest, res) => {
  const {
    account_id,
    direction,
    init_balance,
    init_debit,
    init_credit,
    year,
    period,
    aux_item_id,
    opening_debit,
    opening_credit,
    pre_book_debit,
    pre_book_credit,
    foreign_opening_debit,
    foreign_opening_credit,
    foreign_pre_book_debit,
    foreign_pre_book_credit,
    qty_opening_debit,
    qty_opening_credit,
    qty_pre_book_debit,
    qty_pre_book_credit,
  } = req.body
  const db = getDb()
  const y = year || new Date().getFullYear()
  const p = period || 1
  const auxItemId = normalizeAuxItemId(aux_item_id)

  try {
    // P1-32：年度锁——该年度已有已审核/已记账凭证时禁止改期初，否则会静默改变历史余额
    const editable = checkInitBalanceEditable(db, req.accountSetId || '', y)
    if (!editable.canEdit) {
      return res.status(400).json({ code: 1, message: editable.reason || '当前年度期初余额不允许修改' })
    }
    if (auxItemId === '') {
      assertAccountEditableForDirectInit(db, req.accountSetId || '', account_id, req.accountScope)
    } else {
      const scopeErr = assertAccountIdInScope(req.accountScope, account_id)
      if (scopeErr) {
        return res.status(403).json({ code: 403, message: scopeErr })
      }
    }
  } catch (error: any) {
    return res.status(400).json({ code: 1, message: error.message })
  }

  try {
    assertOpeningDebitCreditExclusive(opening_debit || 0, opening_credit || 0)
  } catch (error: any) {
    return res.status(400).json({ code: 1, message: error.message })
  }

  const opening = normalizeOpeningDebitCredit(opening_debit || 0, opening_credit || 0)
  const od = opening.opening_debit
  const oc = opening.opening_credit
  const pd = pre_book_debit || 0
  const pc = pre_book_credit || 0
  const totalDebit = od + pd
  const totalCredit = oc + pc
  const normalizedInitBalance = init_balance ?? calcInitBalance(direction, totalDebit, totalCredit)
  const foreignOpening = normalizeForeignOpeningDebitCredit(
    foreign_opening_debit,
    foreign_opening_credit
  )
  const fod = foreignOpening.foreign_opening_debit
  const foc = foreignOpening.foreign_opening_credit
  const fpd = Number(foreign_pre_book_debit) || 0
  const fpc = Number(foreign_pre_book_credit) || 0
  const foreignInitBalance = calcForeignInitBalance(direction, fod, foc, fpd, fpc)
  const qtyOpening = normalizeQuantityOpeningDebitCredit(qty_opening_debit, qty_opening_credit)
  const qod = qtyOpening.qty_opening_debit
  const qoc = qtyOpening.qty_opening_credit
  const qpd = Number(qty_pre_book_debit) || 0
  const qpc = Number(qty_pre_book_credit) || 0
  const qtyInitBalance = calcQuantityInitBalance(direction, qod, qoc, qpd, qpc)

  const existing = db
    .prepare(
      `SELECT id FROM init_balances WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id=?`
    )
    .get(req.accountSetId, account_id, y, p, auxItemId) as { id: string } | undefined

  if (existing) {
    db.prepare(
      `
      UPDATE init_balances SET
        direction=?, init_balance=?, init_debit=?, init_credit=?, aux_item_id=?,
        opening_debit=?, opening_credit=?, pre_book_debit=?, pre_book_credit=?,
        foreign_init_balance=?, foreign_opening_debit=?, foreign_opening_credit=?,
        foreign_pre_book_debit=?, foreign_pre_book_credit=?,
        qty_init_balance=?, qty_opening_debit=?, qty_opening_credit=?,
        qty_pre_book_debit=?, qty_pre_book_credit=?
      WHERE id=?
    `
    ).run(
      direction,
      normalizedInitBalance || 0,
      totalDebit,
      totalCredit,
      auxItemId,
      od,
      oc,
      pd,
      pc,
      foreignInitBalance,
      fod,
      foc,
      fpd,
      fpc,
      qtyInitBalance,
      qod,
      qoc,
      qpd,
      qpc,
      existing.id
    )
  } else {
    db.prepare(
      `
      INSERT INTO init_balances
        (id, account_set_id, account_id, direction, year, period,
         init_balance, init_debit, init_credit, aux_item_id,
         opening_debit, opening_credit, pre_book_debit, pre_book_credit,
         foreign_init_balance, foreign_opening_debit, foreign_opening_credit,
         foreign_pre_book_debit, foreign_pre_book_credit,
         qty_init_balance, qty_opening_debit, qty_opening_credit,
         qty_pre_book_debit, qty_pre_book_credit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      uuidv4(),
      req.accountSetId,
      account_id,
      direction,
      y,
      p,
      normalizedInitBalance || 0,
      totalDebit,
      totalCredit,
      auxItemId,
      od,
      oc,
      pd,
      pc,
      foreignInitBalance,
      fod,
      foc,
      fpd,
      fpc,
      qtyInitBalance,
      qod,
      qoc,
      qpd,
      qpc
    )
  }

  const totals = getInitBalanceTotals(db, req.accountSetId || '', y)
  res.json({
    code: 0,
    message: '保存成功',
    data: totals,
  })
})

router.post(
  '/init-balances/batch',
  operationLog('批量保存期初余额', '基础设置'),
  (req: AuthRequest, res) => {
    const { year, items } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ code: 1, message: '数据不能为空' })
    }
    const db = getDb()
    const y = year || new Date().getFullYear()

    // P1-32：年度锁——该年度已有已审核/已记账凭证时禁止批量改期初
    const editableBatch = checkInitBalanceEditable(db, req.accountSetId || '', y)
    if (!editableBatch.canEdit) {
      return res.status(400).json({ code: 1, message: editableBatch.reason || '当前年度期初余额不允许修改' })
    }

    const findExisting = db.prepare(
      `SELECT id FROM init_balances WHERE account_set_id=? AND account_id=? AND year=? AND period=? AND aux_item_id=?`
    )
    const updateStmt = db.prepare(`
      UPDATE init_balances SET
        direction=?, init_balance=?, init_debit=?, init_credit=?, aux_item_id=?,
        opening_debit=?, opening_credit=?, pre_book_debit=?, pre_book_credit=?
      WHERE id=?
    `)
    const insertStmt = db.prepare(`
      INSERT INTO init_balances
        (id, account_set_id, account_id, direction, year, period,
         init_balance, init_debit, init_credit, aux_item_id,
         opening_debit, opening_credit, pre_book_debit, pre_book_credit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    try {
      const runBatch = db.transaction(() => {
        for (const item of items) {
          const auxItemId = normalizeAuxItemId(item.aux_item_id)
          if (auxItemId === '') {
            assertAccountEditableForDirectInit(
              db,
              req.accountSetId || '',
              item.account_id,
              req.accountScope
            )
          } else {
            const scopeErrItem = assertAccountIdInScope(req.accountScope, item.account_id)
            if (scopeErrItem) {
              throw new Error(scopeErrItem)
            }
          }

          assertOpeningDebitCreditExclusive(item.opening_debit || 0, item.opening_credit || 0)
          const opening = normalizeOpeningDebitCredit(
            item.opening_debit || 0,
            item.opening_credit || 0
          )
          const od = opening.opening_debit
          const oc = opening.opening_credit
          const pd = item.pre_book_debit || 0
          const pc = item.pre_book_credit || 0
          const totalDebit = od + pd
          const totalCredit = oc + pc
          const initBalance = calcInitBalance(item.direction, totalDebit, totalCredit)
          const p = item.period || 1

          const existing = findExisting.get(req.accountSetId, item.account_id, y, p, auxItemId) as
            | { id: string }
            | undefined

          if (existing) {
            updateStmt.run(
              item.direction,
              initBalance,
              totalDebit,
              totalCredit,
              auxItemId,
              od,
              oc,
              pd,
              pc,
              existing.id
            )
          } else {
            insertStmt.run(
              uuidv4(),
              req.accountSetId,
              item.account_id,
              item.direction,
              y,
              p,
              initBalance,
              totalDebit,
              totalCredit,
              auxItemId,
              od,
              oc,
              pd,
              pc
            )
          }
        }
      })

      runBatch()
      const totals = getInitBalanceTotals(db, req.accountSetId || '', y)
      res.json({
        code: 0,
        message: `批量保存成功，共 ${items.length} 条`,
        data: totals,
      })
    } catch (error: any) {
      res.status(400).json({ code: 1, message: error.message })
    }
  }
)

router.get('/init-balances/can-edit', (req: AuthRequest, res) => {
  const { year } = req.query
  const db = getDb()
  const y = Number(year) || new Date().getFullYear()

  const { canEdit, reason } = checkInitBalanceEditable(db, req.accountSetId || '', y)
  res.json({
    code: 0,
    canEdit,
    reason,
  })
})

router.get('/init-balances/aux-can-edit', (req: AuthRequest, res) => {
  const { year } = req.query
  const db = getDb()
  const y = Number(year) || new Date().getFullYear()

  const { canEdit, reason } = checkInitBalanceAuxEditable(db, req.accountSetId || '', y)
  res.json({
    code: 0,
    canEdit,
    reason,
  })
})

// 清理预览：GET 与 POST 共用同一处理逻辑
// POST 版本用于筛选清理场景 —— 科目数量多时 account_ids 拼在 URL 上会超出
// Node 默认的请求头长度上限（16KB），连接被直接重置，前端只看到 Network Error
const handleClearPreview = (req: AuthRequest, res: Response) => {
  const source = req.method === 'POST' ? req.body : req.query
  const { year, mode, account_ids } = source || {}
  const db = getDb()
  const y = Number(year) || new Date().getFullYear()
  const clearMode = mode === 'aux' ? 'aux' : 'direct'
  let accountIds: string[] | undefined
  if (Array.isArray(account_ids)) {
    accountIds = account_ids.map(String).map(id => id.trim()).filter(Boolean)
  } else if (typeof account_ids === 'string' && account_ids.trim()) {
    accountIds = account_ids.split(',').map(id => id.trim()).filter(Boolean)
  }
  const scopeErrIds = assertAccountIdsInScope(req.accountScope, accountIds)
  if (scopeErrIds) {
    return res.status(403).json({ code: 403, message: scopeErrIds })
  }
  if (clearMode === 'aux') {
    const auxAllErr = assertAuxAllAccountsClearAllowed(req.accountScope)
    if (auxAllErr) {
      return res.status(403).json({ code: 403, message: auxAllErr })
    }
  }
  accountIds = resolveScopedAccountIdsForClear(req.accountScope, accountIds)

  try {
    const count = countInitBalanceClearTargets(db, req.accountSetId || '', y, clearMode, {
      accountIds,
    })
    res.json({ code: 0, data: { count, mode: clearMode } })
  } catch (error: any) {
    res.status(400).json({ code: 1, message: error.message })
  }
}

router.get('/init-balances/clear-preview', (req: AuthRequest, res) => {
  handleClearPreview(req, res)
})
router.post('/init-balances/clear-preview', (req: AuthRequest, res) => {
  handleClearPreview(req, res)
})

router.post(
  '/init-balances/batch-clear',
  operationLog('批量清理期初余额', '基础设置'),
  (req: AuthRequest, res) => {
    const { year, mode, account_ids } = req.body
    const db = getDb()
    const y = year || new Date().getFullYear()
    const clearMode = mode === 'aux' ? 'aux' : 'direct'
    let accountIds = Array.isArray(account_ids)
      ? account_ids.map(String).filter(Boolean)
      : undefined
    const scopeErrBatch = assertAccountIdsInScope(req.accountScope, accountIds)
    if (scopeErrBatch) {
      return res.status(403).json({ code: 403, message: scopeErrBatch })
    }
    if (clearMode === 'aux') {
      const auxAllErr = assertAuxAllAccountsClearAllowed(req.accountScope)
      if (auxAllErr) {
        return res.status(403).json({ code: 403, message: auxAllErr })
      }
    }
    accountIds = resolveScopedAccountIdsForClear(req.accountScope, accountIds)

    try {
      if (clearMode === 'aux') {
        const result = clearAuxInitBalances(db, req.accountSetId || '', y, 'all_accounts')
        const totals = getInitBalanceTotals(db, req.accountSetId || '', y)
        return res.json({
          code: 0,
          message: `已清理 ${result.deletedCount} 条辅助期初明细，涉及 ${result.affectedAccounts} 个科目`,
          data: { ...result, ...totals },
        })
      }

      const result = clearDirectInitBalances(db, req.accountSetId || '', y, { accountIds })
      const totals = getInitBalanceTotals(db, req.accountSetId || '', y)
      res.json({
        code: 0,
        message: `已清理 ${result.deletedCount} 条科目期初记录`,
        data: { ...result, ...totals },
      })
    } catch (error: any) {
      res.status(400).json({ code: 1, message: error.message })
    }
  }
)

router.get('/init-balances/aux-details/clear-preview', (req: AuthRequest, res) => {
  const { year, account_id, scope, category_id } = req.query
  const db = getDb()
  const y = Number(year) || new Date().getFullYear()
  const clearScope = scope === 'category' ? 'category' : 'account'

  if (!account_id || typeof account_id !== 'string') {
    return res.status(400).json({ code: 1, message: '缺少 account_id' })
  }
  const scopeErrPreview = assertAccountIdInScope(req.accountScope, account_id)
  if (scopeErrPreview) {
    return res.status(403).json({ code: 403, message: scopeErrPreview })
  }

  let categoryCode: string | undefined
  if (clearScope === 'category') {
    if (!category_id || typeof category_id !== 'string') {
      return res.status(400).json({ code: 1, message: '缺少 category_id' })
    }
    const category = db
      .prepare('SELECT code FROM aux_categories WHERE id=? AND account_set_id=?')
      .get(category_id, req.accountSetId) as { code: string } | undefined
    if (!category) {
      return res.status(400).json({ code: 1, message: '辅助类目不存在' })
    }
    categoryCode = category.code
  }

  try {
    const count = countAuxInitClearTargets(db, req.accountSetId || '', y, clearScope, {
      accountId: account_id,
      categoryCode,
    })
    res.json({ code: 0, data: { count, scope: clearScope } })
  } catch (error: any) {
    res.status(400).json({ code: 1, message: error.message })
  }
})

router.post(
  '/init-balances/aux-details/batch-clear',
  operationLog('批量清理辅助期初', '基础设置'),
  (req: AuthRequest, res) => {
    const { year, account_id, scope, category_id } = req.body
    const db = getDb()
    const y = year || new Date().getFullYear()
    const clearScope = scope === 'category' ? 'category' : 'account'

    if (!account_id) {
      return res.status(400).json({ code: 1, message: '缺少 account_id' })
    }
    const scopeErrClear = assertAccountIdInScope(req.accountScope, account_id)
    if (scopeErrClear) {
      return res.status(403).json({ code: 403, message: scopeErrClear })
    }

    let categoryCode: string | undefined
    if (clearScope === 'category') {
      if (!category_id) {
        return res.status(400).json({ code: 1, message: '缺少 category_id' })
      }
      const category = db
        .prepare('SELECT code FROM aux_categories WHERE id=? AND account_set_id=?')
        .get(category_id, req.accountSetId) as { code: string } | undefined
      if (!category) {
        return res.status(400).json({ code: 1, message: '辅助类目不存在' })
      }
      categoryCode = category.code
    }

    try {
      const result = clearAuxInitBalances(db, req.accountSetId || '', y, clearScope, {
        accountId: account_id,
        categoryCode,
      })
      const totals = getInitBalanceTotals(db, req.accountSetId || '', y)
      res.json({
        code: 0,
        message:
          clearScope === 'category'
            ? `已清理当前类目 ${result.deletedCount} 条辅助期初明细`
            : `已清理当前科目 ${result.deletedCount} 条辅助期初明细`,
        data: { ...result, ...totals },
      })
    } catch (error: any) {
      res.status(400).json({ code: 1, message: error.message })
    }
  }
)

router.get('/init-balances/check', (req: AuthRequest, res) => {
  const { year } = req.query
  const db = getDb()
  const y = Number(year) || new Date().getFullYear()
  const totals = getInitBalanceTotals(db, req.accountSetId || '', y)
  const auxCategoryCheck = checkInitBalanceAuxCategoryConsistency(
    db,
    req.accountSetId || '',
    y
  )
  res.json({
    code: 0,
    ...totals,
    auxCategoryConsistent: auxCategoryCheck.consistent,
    auxCategoryMismatches: auxCategoryCheck.mismatches,
  })
})

router.post(
  '/init-balances/batch-async',
  operationLog('异步批量保存期初余额', '基础设置'),
  (req: AuthRequest, res) => {
    const { year, items } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ code: 1, message: '数据不能为空' })
    }
    const db = getDb()
    const y = year || new Date().getFullYear()
    for (const item of items) {
      const scopeErrImport = assertAccountIdInScope(req.accountScope, item?.account_id)
      if (scopeErrImport) {
        return res.status(403).json({ code: 403, message: scopeErrImport })
      }
    }
    try {
      const taskId = batchInitBalanceImportAsync(db, req.accountSetId || '', y, items)
      res.json({ code: 0, message: '批量导入任务已创建', data: { taskId } })
    } catch (error: any) {
      res.status(400).json({ code: 1, message: error.message })
    }
  }
)

router.post(
  '/init-balances/batch-clear-async',
  operationLog('异步批量清理期初余额', '基础设置'),
  (req: AuthRequest, res) => {
    const { year, mode, account_ids } = req.body
    const db = getDb()
    const y = year || new Date().getFullYear()
    const clearMode = mode === 'aux' ? 'aux' : 'direct'
    let accountIds = Array.isArray(account_ids)
      ? account_ids.map(String).filter(Boolean)
      : undefined
    const scopeErrAsync = assertAccountIdsInScope(req.accountScope, accountIds)
    if (scopeErrAsync) {
      return res.status(403).json({ code: 403, message: scopeErrAsync })
    }
    if (clearMode === 'aux') {
      const auxAllErr = assertAuxAllAccountsClearAllowed(req.accountScope)
      if (auxAllErr) {
        return res.status(403).json({ code: 403, message: auxAllErr })
      }
    }
    accountIds = resolveScopedAccountIdsForClear(req.accountScope, accountIds)
    try {
      const taskId = batchInitBalanceClearAsync(
        db,
        req.accountSetId || '',
        y,
        clearMode,
        accountIds
      )
      res.json({ code: 0, message: '批量清理任务已创建', data: { taskId } })
    } catch (error: any) {
      res.status(400).json({ code: 1, message: error.message })
    }
  }
)

router.post(
  '/init-balances/aux-details/batch-clear-async',
  operationLog('异步批量清理辅助期初', '基础设置'),
  (req: AuthRequest, res) => {
    const { year, account_id, scope, category_id } = req.body
    const db = getDb()
    const y = year || new Date().getFullYear()
    const clearScope = scope === 'category' ? 'category' : 'account'

    if (!account_id) {
      return res.status(400).json({ code: 1, message: '缺少 account_id' })
    }
    const scopeErrAuxAsync = assertAccountIdInScope(req.accountScope, account_id)
    if (scopeErrAuxAsync) {
      return res.status(403).json({ code: 403, message: scopeErrAuxAsync })
    }

    let categoryCode: string | undefined
    if (clearScope === 'category') {
      if (!category_id) {
        return res.status(400).json({ code: 1, message: '缺少 category_id' })
      }
      const category = db
        .prepare('SELECT code FROM aux_categories WHERE id=? AND account_set_id=?')
        .get(category_id, req.accountSetId) as { code: string } | undefined
      if (!category) {
        return res.status(400).json({ code: 1, message: '辅助类目不存在' })
      }
      categoryCode = category.code
    }

    try {
      const taskId = batchAuxInitClearAsync(db, req.accountSetId || '', y, clearScope, {
        accountId: account_id,
        categoryCode,
      })
      res.json({ code: 0, message: '批量清理任务已创建', data: { taskId } })
    } catch (error: any) {
      res.status(400).json({ code: 1, message: error.message })
    }
  }
)

router.post(
  '/init-balances/aux-details/batch-save-async',
  operationLog('异步批量保存辅助期初', '基础设置'),
  (req: AuthRequest, res) => {
    const { year, account_id, period, lines } = req.body
    if (!account_id) {
      return res.status(400).json({ code: 1, message: '缺少 account_id' })
    }
    const scopeErr = assertAccountIdInScope(req.accountScope, account_id)
    if (scopeErr) {
      return res.status(403).json({ code: 403, message: scopeErr })
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ code: 1, message: 'lines 不能为空' })
    }

    const db = getDb()
    const y = year || new Date().getFullYear()
    const p = period || 1

    try {
      const taskId = batchInitBalanceAuxSaveAsync(
        db,
        req.accountSetId || '',
        account_id,
        y,
        lines,
        p
      )
      res.json({ code: 0, message: '批量保存任务已创建', data: { taskId } })
    } catch (error: any) {
      res.status(400).json({ code: 1, message: error.message })
    }
  }
)

export default router
