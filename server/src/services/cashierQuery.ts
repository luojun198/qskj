/**
 * 出纳查询服务：现金/银行日记账列表（含逐行余额）、银行对账自动勾对
 */
import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'
import { buildVoucherNo } from './voucherEntry.js'
import { appendAccountScopeCondition, type AccountScopeContext } from './accountAuthorization.js'
import { assertGlPeriodOpen } from './voucherMutationGuard.js'
import { assertCashierPeriodOpen, isCashierPeriodClosed, parseBizDate } from './cashierPeriodClosing.js'
import { deleteVoucherWithRefs } from './voucherDelete.js'

export interface CashierAccount {
  code: string
  name: string
  is_cash: number
  is_bank: number
}

/** 现金/银行类末级科目（出纳日记账左侧科目树）；传入科目授权上下文则按白名单过滤 */
export function listCashierAccounts(accountSetId: string, ctx?: AccountScopeContext): CashierAccount[] {
  const db = getDb()
  const conditions: string[] = [
    'a.account_set_id = ?',
    'a.is_enabled = 1',
    '(a.is_cash = 1 OR a.is_bank = 1)',
    'NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id)',
  ]
  const params: string[] = [accountSetId]
  appendAccountScopeCondition(ctx, 'a.id', conditions, params)
  return db
    .prepare(
      `SELECT a.code, a.name, a.is_cash, a.is_bank
       FROM accounts a
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.code`
    )
    .all(...params) as CashierAccount[]
}

export interface JournalRow {
  id: string
  account_code: string
  currency: string
  biz_date: string
  seq: number
  summary: string | null
  debit: number
  credit: number
  settle_type: string | null
  bill_no: string | null
  counter_unit: string | null
  counter_account: string | null
  reconciled: number
  voucher_year: number | null
  voucher_month: number | null
  voucher_type: number | null
  voucher_no: number | null
  balance?: number
}

/** 出纳期初余额（无记录返回 0） */
export function getInitBalance(accountSetId: string, accountCode: string, currency = 'RMB'): number {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT balance FROM cashier_init_balance
       WHERE account_set_id = ? AND account_code = ? AND currency = ?`
    )
    .get(accountSetId, accountCode, currency) as { balance: number } | undefined
  return row?.balance ?? 0
}

/** 出纳科目涉及到的币别（含本位币 RMB），供前端币种切换 */
export function listCashierCurrencies(accountSetId: string): string[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT DISTINCT currency FROM (
      SELECT currency FROM cashier_journal WHERE account_set_id=? AND currency IS NOT NULL AND currency<>''
      UNION
      SELECT currency FROM cashier_init_balance WHERE account_set_id=? AND currency IS NOT NULL AND currency<>''
    ) ORDER BY currency
  `).all(accountSetId, accountSetId) as Array<{ currency: string }>
  const codes = rows.map(r => r.currency.trim().toUpperCase())
  if (!codes.includes('RMB')) codes.unshift('RMB')
  return codes
}

/**
 * 日记账列表（按科目+币别+日期区间），返回逐行余额。
 * 现金/银行为借方科目：余额 = 期初 + 借 - 贷。
 */
export function searchJournals(params: {
  accountSetId: string
  accountCodes?: string[]
  currency?: string
  startDate?: string
  endDate?: string
  summary?: string
  settleTypes?: string[]
  billNo?: string
  counterUnit?: string
  counterAccount?: string
  amountDirection?: 'all' | 'income' | 'expense'
  minAmount?: number
  maxAmount?: number
  reconciled?: 0 | 1
  hasVoucher?: 0 | 1
  page?: number
  pageSize?: number
}): { list: JournalRow[]; total: number } {
  const db = getDb()
  const conds = ['account_set_id = ?']
  const vals: any[] = [params.accountSetId]

  if (params.accountCodes && params.accountCodes.length > 0) {
    conds.push(`account_code IN (${params.accountCodes.map(() => '?').join(',')})`)
    vals.push(...params.accountCodes)
  }
  if (params.currency) {
    conds.push('currency = ?')
    vals.push(params.currency)
  }
  if (params.startDate) {
    conds.push('biz_date >= ?')
    vals.push(params.startDate)
  }
  if (params.endDate) {
    conds.push('biz_date <= ?')
    vals.push(params.endDate)
  }
  if (params.summary) {
    conds.push('summary LIKE ?')
    vals.push(`%${params.summary}%`)
  }
  if (params.settleTypes && params.settleTypes.length > 0) {
    conds.push(`settle_type IN (${params.settleTypes.map(() => '?').join(',')})`)
    vals.push(...params.settleTypes)
  }
  if (params.billNo) {
    conds.push('bill_no LIKE ?')
    vals.push(`%${params.billNo}%`)
  }
  if (params.counterUnit) {
    conds.push('counter_unit LIKE ?')
    vals.push(`%${params.counterUnit}%`)
  }
  if (params.counterAccount) {
    conds.push('counter_account = ?')
    vals.push(params.counterAccount)
  }
  
  // Amount Direction Filter
  const dir = params.amountDirection || 'all'
  let amountCol = '(debit + credit)'
  if (dir === 'income') {
    amountCol = 'debit'
    conds.push('debit > 0')
  } else if (dir === 'expense') {
    amountCol = 'credit'
    conds.push('credit > 0')
  }

  if (params.minAmount !== undefined) {
    conds.push(`${amountCol} >= ?`)
    vals.push(params.minAmount)
  }
  if (params.maxAmount !== undefined) {
    conds.push(`${amountCol} <= ?`)
    vals.push(params.maxAmount)
  }

  if (params.reconciled !== undefined) {
    conds.push('reconciled = ?')
    vals.push(params.reconciled)
  }
  if (params.hasVoucher !== undefined) {
    if (params.hasVoucher === 1) {
      conds.push('voucher_no IS NOT NULL')
    } else {
      conds.push('voucher_no IS NULL')
    }
  }

  const whereClause = conds.join(' AND ')

  // Count total
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM cashier_journal WHERE ${whereClause}`).get(...vals) as { total: number }
  const total = countRow.total

  // Pagination
  const page = params.page || 1
  const pageSize = params.pageSize || 100
  const offset = (page - 1) * pageSize

  const sql = `
    SELECT * FROM cashier_journal
    WHERE ${whereClause}
    ORDER BY biz_date DESC, seq DESC, created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `
  const list = db.prepare(sql).all(...vals) as JournalRow[]

  return { list, total }
}

export function listJournal(params: {
  accountSetId: string
  accountCode: string
  currency?: string
  startDate?: string
  endDate?: string
  /** 过滤对账状态：0=未对账，1=已对账，不传则返回全部 */
  reconciled?: 0 | 1
}): { opening: number; rows: JournalRow[]; closing: number; totalDebit: number; totalCredit: number } {
  const db = getDb()
  const { accountSetId, accountCode } = params
  const currency = params.currency || 'RMB'

  const opening = getInitBalance(accountSetId, accountCode, currency)

  // 区间前的累计净额，用于得到区间期初
  const conds = ['account_set_id = ?', 'account_code = ?', 'currency = ?']
  const before: any[] = [accountSetId, accountCode, currency]
  if (params.startDate) {
    conds.push('biz_date < ?')
    before.push(params.startDate)
  }
  const beforeNet = db
    .prepare(
      `SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c
       FROM cashier_journal WHERE ${conds.join(' AND ')}`
    )
    .get(...before) as { d: number; c: number }
  let running = opening + beforeNet.d - beforeNet.c
  const periodOpening = running

  const rowConds = ['account_set_id = ?', 'account_code = ?', 'currency = ?']
  const rowParams: any[] = [accountSetId, accountCode, currency]
  if (params.startDate) {
    rowConds.push('biz_date >= ?')
    rowParams.push(params.startDate)
  }
  if (params.endDate) {
    rowConds.push('biz_date <= ?')
    rowParams.push(params.endDate)
  }
  if (params.reconciled !== undefined) {
    rowConds.push('reconciled = ?')
    rowParams.push(params.reconciled)
  }
  const rows = db
    .prepare(
      `SELECT * FROM cashier_journal
       WHERE ${rowConds.join(' AND ')}
       ORDER BY biz_date, seq, created_at`
    )
    .all(...rowParams) as JournalRow[]

  let totalDebit = 0
  let totalCredit = 0
  for (const r of rows) {
    running += r.debit - r.credit
    r.balance = running
    totalDebit += r.debit
    totalCredit += r.credit
  }

  return { opening: periodOpening, rows, closing: running, totalDebit, totalCredit }
}

/**
 * 银行对账自动勾对：按 金额(借/贷) + 日期 匹配未达账。
 * useBillNo=true 时先按「票据号 + 日期 + 金额」优先匹配，再对剩余按「日期 + 金额」匹配。
 * 将匹配到的日记账与对账单标记 reconciled/matched 同一 batch，并写入 cashier_journal.match_batch。
 */
export function autoReconcile(params: {
  accountSetId: string
  accountCode: string
  startDate?: string
  endDate?: string
  /** 是否优先使用票据号辅助匹配（同日同金额多笔时票据号相同的优先配对） */
  useBillNo?: boolean
}): { matched: number; batch: number } {
  const db = getDb()
  const { accountSetId, accountCode } = params

  const dateCond = (col: string, ps: any[]) => {
    const c = [`account_set_id = ?`, `account_code = ?`]
    ps.push(accountSetId, accountCode)
    if (params.startDate) {
      c.push(`${col} >= ?`)
      ps.push(params.startDate)
    }
    if (params.endDate) {
      c.push(`${col} <= ?`)
      ps.push(params.endDate)
    }
    return c.join(' AND ')
  }

  const jp: any[] = []
  const journal = db
    .prepare(
      `SELECT id, biz_date, debit, credit, bill_no FROM cashier_journal
       WHERE ${dateCond('biz_date', jp)} AND reconciled = 0`
    )
    .all(...jp) as Array<{ id: string; biz_date: string; debit: number; credit: number; bill_no: string | null }>

  const sp: any[] = []
  const statements = db
    .prepare(
      `SELECT id, biz_date, debit, credit, bill_no FROM bank_statement
       WHERE ${dateCond('biz_date', sp)} AND matched = 0`
    )
    .all(...sp) as Array<{ id: string; biz_date: string; debit: number; credit: number; bill_no: string | null }>

  const batch = Date.now() % 2147483647
  // P1-5：每对分配唯一批次号（batch_序号）并写 bank_statement_id，撤销时精确反写单条；
  // 此前全批共用一个 match_batch，撤销任意一条会把同批 50 条对账单全部置回未匹配
  const markJ = db.prepare('UPDATE cashier_journal SET reconciled = 1, match_batch = ?, bank_statement_id = ? WHERE id = ?')
  const markS = db.prepare('UPDATE bank_statement SET matched = 1, match_batch = ? WHERE id = ?')

  const amountMatch = (j: typeof journal[0], st: typeof statements[0]) =>
    j.biz_date === st.biz_date &&
    Math.abs(j.debit - st.debit) < 0.005 &&
    Math.abs(j.credit - st.credit) < 0.005

  // P1-6：出纳已结账月份的日记账 / 对账单不参与勾对（勾对会改写已结账月的 reconciled）
  const closedCache = new Map<string, boolean>()
  const inClosedMonth = (bizDate: string) => {
    const ym = parseBizDate(bizDate)
    if (!ym) return true
    const key = `${ym.year}-${ym.month}`
    if (!closedCache.has(key)) closedCache.set(key, isCashierPeriodClosed(db, accountSetId, ym.year, ym.month))
    return closedCache.get(key)!
  }
  const openJournal = journal.filter(j => !inClosedMonth(j.biz_date))
  const openStatements = statements.filter(s => !inClosedMonth(s.biz_date))

  let matched = 0
  const usedJournal = new Set<string>()
  const usedStatement = new Set<string>()
  const pair = (j: typeof journal[0], st: typeof statements[0]) => {
    usedJournal.add(j.id)
    usedStatement.add(st.id)
    matched++
    const pairBatch = `${batch}_${matched}`
    markJ.run(pairBatch, st.id, j.id)
    markS.run(pairBatch, st.id)
  }

  const tx = db.transaction(() => {
    // 第一遍（仅 useBillNo=true）：票据号 + 日期 + 金额 三者均匹配
    if (params.useBillNo) {
      for (const st of openStatements) {
        if (!st.bill_no || usedStatement.has(st.id)) continue
        const hit = openJournal.find(
          j =>
            !usedJournal.has(j.id) &&
            j.bill_no === st.bill_no &&
            amountMatch(j, st)
        )
        if (hit) pair(hit, st)
      }
    }
    // 第二遍：日期 + 金额（跳过已匹配记录）
    for (const st of openStatements) {
      if (usedStatement.has(st.id)) continue
      const hit = openJournal.find(j => !usedJournal.has(j.id) && amountMatch(j, st))
      if (hit) pair(hit, st)
    }
  })
  tx()
  return { matched, batch }
}

/**
 * 手动勾对：将指定的日记账和银行对账单配对标记为已对账。
 * 两条记录必须均未对账且属于同一账套。
 */
export function manualReconcile(params: {
  db: any
  accountSetId: string
  journalId: string
  bankStatementId: string
}): { ok: true } | { error: string } {
  const { db, accountSetId, journalId, bankStatementId } = params

  const j = db.prepare('SELECT id, reconciled, biz_date FROM cashier_journal WHERE id=? AND account_set_id=?').get(journalId, accountSetId) as any
  if (!j) return { error: '日记账记录不存在' }
  if (j.reconciled) return { error: '该日记账记录已对账' }

  const st = db.prepare('SELECT id, matched, biz_date FROM bank_statement WHERE id=? AND account_set_id=?').get(bankStatementId, accountSetId) as any
  if (!st) return { error: '银行对账单记录不存在' }
  if (st.matched) return { error: '该银行对账单记录已对账' }

  // P1-6：出纳已结账月份不允许勾对
  try {
    assertCashierPeriodOpen(db, accountSetId, j.biz_date)
    assertCashierPeriodOpen(db, accountSetId, st.biz_date)
  } catch (e: any) {
    return { error: e.message }
  }

  const batch = String(Date.now() % 2147483647) + '_m'
  const tx = db.transaction(() => {
    db.prepare('UPDATE cashier_journal SET reconciled=1, match_batch=?, bank_statement_id=? WHERE id=?').run(batch, bankStatementId, journalId)
    db.prepare('UPDATE bank_statement SET matched=1, match_batch=? WHERE id=?').run(batch, bankStatementId)
  })
  tx()
  return { ok: true }
}

/**
 * 撤销勾对：将日记账恢复为未对账，并通过 match_batch 联动撤销对应的银行对账单。
 */
export function cancelReconcile(params: {
  db: any
  accountSetId: string
  journalId: string
}): { ok: true } | { error: string } {
  const { db, accountSetId, journalId } = params

  const j = db.prepare('SELECT id, reconciled, match_batch, bank_statement_id, biz_date FROM cashier_journal WHERE id=? AND account_set_id=?').get(journalId, accountSetId) as any
  if (!j) return { error: '日记账记录不存在' }
  if (!j.reconciled) return { error: '该日记账记录未处于对账状态' }

  // P1-6：出纳已结账月份不允许撤销勾对
  try {
    assertCashierPeriodOpen(db, accountSetId, j.biz_date)
  } catch (e: any) {
    return { error: e.message }
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE cashier_journal SET reconciled=0, match_batch=NULL, bank_statement_id=NULL WHERE id=?').run(journalId)
    if (j.bank_statement_id) {
      // P1-5：按 bank_statement_id 精确反写单条
      db.prepare('UPDATE bank_statement SET matched=0, match_batch=NULL WHERE id=? AND account_set_id=?').run(j.bank_statement_id, accountSetId)
    } else if (j.match_batch) {
      // 迁移 127 之前的存量：只有在该批次仅剩一条对账单时才按批次反写，避免连带清整批
      const cnt = (db.prepare('SELECT COUNT(*) c FROM bank_statement WHERE match_batch=? AND account_set_id=?').get(j.match_batch, accountSetId) as any)?.c ?? 0
      if (cnt === 1) {
        db.prepare('UPDATE bank_statement SET matched=0, match_batch=NULL WHERE match_batch=? AND account_set_id=?').run(j.match_batch, accountSetId)
      }
    }
  })
  tx()
  return { ok: true }
}

// ── 银行余额调节表 ─────────────────────────────────────────

export interface ReconciliationData {
  account_code: string
  end_date: string
  /** 企业账面余额（期初 + 累计借 − 累计贷） */
  enterprise_balance: number
  /** 银行对账单余额（所有 statement 行借贷净额） */
  bank_balance: number
  /** 企业已记、银行未记（cashier_journal reconciled=0） */
  enterprise_recorded: { biz_date: string; summary: string | null; debit: number; credit: number; settle_type: string | null; bill_no: string | null }[]
  /** 银行已记、企业未记（bank_statement matched=0） */
  bank_recorded: { biz_date: string; debit: number; credit: number; settle_type: string | null; bill_no: string | null }[]
  /** 调节后企业余额 */
  adjusted_enterprise: number
  /** 调节后银行余额 */
  adjusted_bank: number
  /** 差额（应为 0） */
  difference: number
}

/**
 * 生成银行余额调节表
 * 调节后余额 = 企业账面余额 − 企业已记银行未记付方 + 银行已记企业未记收方
 *              = 银行账面余额 − 银行已记企业未记付方 + 企业已记银行未记收方
 */
export function getBankReconciliation(params: {
  accountSetId: string
  accountCode: string
  currency?: string
  endDate: string
}): ReconciliationData {
  const db = getDb()
  const { accountSetId, accountCode } = params
  const currency = params.currency || 'RMB'
  const endDate = params.endDate

  // 1. 企业账面余额 = 期初 + 累计借 − 累计贷（截至 endDate）
  const opening = getInitBalance(accountSetId, accountCode, currency)
  const entResult = db.prepare(`
    SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c
    FROM cashier_journal
    WHERE account_set_id=? AND account_code=? AND currency=? AND biz_date <= ?
  `).get(accountSetId, accountCode, currency, endDate) as { d: number; c: number }
  const enterpriseBalance = opening + entResult.d - entResult.c

  // 2. 银行对账单余额（所有 statement 借贷净额）
  const bankResult = db.prepare(`
    SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c
    FROM bank_statement
    WHERE account_set_id=? AND account_code=? AND biz_date <= ?
  `).get(accountSetId, accountCode, endDate) as { d: number; c: number }
  const bankBalance = bankResult.d - bankResult.c

  // 3. 企业已记银行未记（reconciled=0 的日记账）
  const enterpriseRecorded = db.prepare(`
    SELECT biz_date, summary, debit, credit, settle_type, bill_no
    FROM cashier_journal
    WHERE account_set_id=? AND account_code=? AND currency=? AND biz_date <= ? AND reconciled=0
    ORDER BY biz_date, seq
  `).all(accountSetId, accountCode, currency, endDate) as any[]

  // 4. 银行已记企业未记（matched=0 的对账单）
  const bankRecorded = db.prepare(`
    SELECT biz_date, debit, credit, settle_type, bill_no
    FROM bank_statement
    WHERE account_set_id=? AND account_code=? AND biz_date <= ? AND matched=0
    ORDER BY biz_date, id
  `).all(accountSetId, accountCode, endDate) as any[]

  // 5. 计算调节后余额
  const entUnrecTotal = enterpriseRecorded.reduce((s, r) => s + r.credit - r.debit, 0)
  const bankUnrecTotal = bankRecorded.reduce((s, r) => s + r.credit - r.debit, 0)

  // 调节后企业余额 = 企业账面余额 - 企业已记银行未记(付方) + 银行已记企业未记(收方)
  // 用未达项净影响：银行未达 = (贷-借) 净支出，企业未达 = (贷-借) 净支出
  // 简化：调节后 = 企业余额 − (企业未达支出 − 企业未达收入) + (银行未达收入 − 银行未达支出)
  const enterpriseUnrecDebit = enterpriseRecorded.reduce((s, r) => s + r.credit, 0)
  const enterpriseUnrecCredit = enterpriseRecorded.reduce((s, r) => s + r.debit, 0)
  const bankUnrecDebit = bankRecorded.reduce((s, r) => s + r.credit, 0)
  const bankUnrecCredit = bankRecorded.reduce((s, r) => s + r.debit, 0)

  // 调节后企业余额 = 企业账面余额 + 银行已收企业未收 - 银行已付企业未付
  const adjustedEnterprise = enterpriseBalance + bankUnrecCredit - bankUnrecDebit
  // 调节后银行余额 = 银行账面余额 + 企业已收银行未收 - 企业已付银行未付
  const adjustedBank = bankBalance + enterpriseUnrecCredit - enterpriseUnrecDebit

  return {
    account_code: accountCode,
    end_date: endDate,
    enterprise_balance: Math.round(enterpriseBalance * 100) / 100,
    bank_balance: Math.round(bankBalance * 100) / 100,
    enterprise_recorded: enterpriseRecorded,
    bank_recorded: bankRecorded,
    adjusted_enterprise: Math.round(adjustedEnterprise * 100) / 100,
    adjusted_bank: Math.round(adjustedBank * 100) / 100,
    difference: Math.round((adjustedEnterprise - adjustedBank) * 100) / 100,
  }
}

// ── 出纳对账 → 生成凭证 ─────────────────────────────────

export interface CashierMissingCounterRow {
  id: string
  biz_date: string
  summary: string | null
  debit: number
  credit: number
}

/**
 * 每条出纳日记账独立生成一张会计凭证（一对一）。
 * 返回生成的凭证数量；遇到未填对方科目且无挂账科目时拦截。
 */
export function generateCashierVoucher(params: {
  db: any
  accountSetId: string
  accountCode: string
  startDate?: string
  endDate?: string
  makerName: string
  hangupAccountCode?: string
  ids?: string[]
}):
  | { syncedCount: number; voucherNos: string[] }
  | { error: string; missingRows?: CashierMissingCounterRow[] } {
  const { db, accountSetId, accountCode, startDate, endDate, makerName, hangupAccountCode, ids } = params

  // 1. 查询未生成凭证的出纳日记账
  const conds = ['j.account_set_id=?', 'j.account_code=?', 'j.voucher_no IS NULL']
  const vals: any[] = [accountSetId, accountCode]
  if (startDate) { conds.push('j.biz_date >= ?'); vals.push(startDate) }
  if (endDate)   { conds.push('j.biz_date <= ?'); vals.push(endDate) }
  if (ids && ids.length > 0) {
    conds.push(`j.id IN (${ids.map(() => '?').join(',')})`)
    vals.push(...ids)
  }
  const rows = db.prepare(`
    SELECT j.* FROM cashier_journal j
    WHERE ${conds.join(' AND ')}
    ORDER BY j.biz_date, j.seq
  `).all(...vals) as any[]
  if (rows.length === 0) return { error: '所选范围内没有未生成凭证的记录' }

  // P0-2：总账已结账（含已年结）期间不得再生成凭证，否则凭证永远无法记账、跨年期初也已固化
  const closedMonths = new Set<string>()
  for (const r of rows) {
    const ym = parseBizDate(r.biz_date)
    if (!ym) return { error: `日记账 ${r.biz_date} 日期格式不合法（${r.summary || r.id}）` }
    const key = `${ym.year}-${ym.month}`
    if (closedMonths.has(key)) continue
    try {
      assertGlPeriodOpen(db, accountSetId, ym.year, ym.month)
    } catch (e: any) {
      return { error: e?.message || '所属期间已结账' }
    }
    closedMonths.add(key)
  }

  // 2. 校验对方科目（缺失时拦截或挂账）
  const lookup = db.prepare('SELECT id, name FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
  const cashAcc = lookup.get(accountSetId, accountCode) as any
  if (!cashAcc) return { error: `科目 ${accountCode} 在账套中不存在` }

  const missingRows: CashierMissingCounterRow[] = rows
    .filter((r: any) => !r.counter_account)
    .map((r: any) => ({ id: r.id, biz_date: r.biz_date, summary: r.summary, debit: r.debit, credit: r.credit }))

  let hangupCode: string | undefined
  if (missingRows.length > 0) {
    if (!hangupAccountCode) {
      return { error: `有 ${missingRows.length} 条记录未填对方科目，请补全或指定挂账科目`, missingRows }
    }
    const ha = lookup.get(accountSetId, hangupAccountCode) as any
    if (!ha) return { error: `挂账科目 ${hangupAccountCode} 在账套中不存在` }
    const childCount = (db.prepare('SELECT COUNT(*) c FROM accounts WHERE parent_id=?').get(ha.id) as any)?.c ?? 0
    if (childCount > 0) return { error: `挂账科目 ${hangupAccountCode} 不是末级科目，请选择末级科目挂账` }
    hangupCode = hangupAccountCode
  }

  // 校验所有对方科目存在
  const allCounterCodes = [...new Set(rows.map((r: any) => r.counter_account || hangupCode!))]
  const missingCodes = allCounterCodes.filter(code => !lookup.get(accountSetId, code))
  if (missingCodes.length > 0) return { error: `对方科目不存在：${missingCodes.join('、')}` }

  // 3. 取凭证类型：优先读系统参数 cashier:default_voucher_type_id，取不到则用 code 最小的
  const defaultVtParam = db.prepare(
    `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='cashier:default_voucher_type_id' LIMIT 1`
  ).get(accountSetId) as any
  const vt = defaultVtParam?.param_value
    ? (db.prepare(`SELECT id, name FROM voucher_types WHERE account_set_id=? AND id=? LIMIT 1`).get(accountSetId, defaultVtParam.param_value) as any
      || db.prepare(`SELECT id, name FROM voucher_types WHERE (account_set_id=? OR account_set_id IS NULL) ORDER BY sort_order, code LIMIT 1`).get(accountSetId) as any)
    : db.prepare(`SELECT id, name FROM voucher_types WHERE (account_set_id=? OR account_set_id IS NULL) ORDER BY sort_order, code LIMIT 1`).get(accountSetId) as any
  const voucherTypeId = vt?.id || null
  const voucherTypeName: string = vt?.name || ''

  const insVoucher = db.prepare(`
    INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, total_amount, maker_name, remark, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cashier')
  `)
  const insEntry = db.prepare(`
    INSERT INTO voucher_entries (
      id, account_set_id, voucher_id, seq, account_id, account_code, account_name, 
      direction, amount, amount_cents, summary,
      dept_id, dept_name, project_id, project_name,
      supplier_id, supplier_name, person_id, person_name,
      func_class_id, func_class_name, aux_data
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updJournal = db.prepare(`
    UPDATE cashier_journal SET voucher_year=?, voucher_month=?, voucher_type=?, voucher_no=?, voucher_id=?, updated_at=datetime('now') WHERE id=?
  `)

  // 加载辅助类别映射（用于 ID 转 Code 及分配列）
  const categories = db.prepare(`SELECT id, code, name FROM aux_categories WHERE account_set_id=?`).all(accountSetId) as any[]
  const catMap = new Map(categories.map(c => [String(c.id), c]))
  const getItemName = db.prepare(`SELECT name FROM aux_items WHERE account_set_id=? AND id=? LIMIT 1`)

  const voucherNos: string[] = []

  // 4. 每条日记账独立生成一张凭证（事务包裹全部）
  const tx = db.transaction(() => {
    for (const r of rows) {
      const [year, month] = (r.biz_date as string).split('-').map(Number)
      // 本期最大号（含已生成的，确保号码不重复）
      const lastNo = (db.prepare(`
        SELECT CAST(CASE WHEN INSTR(voucher_no,'-')>0 THEN SUBSTR(voucher_no,INSTR(voucher_no,'-')+1) ELSE voucher_no END AS INTEGER) no
        FROM vouchers WHERE account_set_id=? AND year=? AND period=? ORDER BY no DESC LIMIT 1
      `).get(accountSetId, year, month) as any)?.no ?? 0
      const voucherNo = buildVoucherNo({ maxNo: lastNo, typeName: voucherTypeName || undefined })

      const counterCode = r.counter_account || hangupCode!
      const cAcc = lookup.get(accountSetId, counterCode) as any
      const amt = r.debit > 0 ? r.debit : r.credit
      const voucherId = uuidv4()

      insVoucher.run(voucherId, accountSetId, voucherNo, voucherTypeId, r.biz_date, year, month, amt, makerName, r.summary || '出纳生成')

      // 解析辅助核算
      const entryAux: any = {
        dept_id: null, dept_name: null, project_id: null, project_name: null,
        supplier_id: null, supplier_name: null, person_id: null, person_name: null,
        func_class_id: null, func_class_name: null, aux_data: null
      }
      if (r.counter_aux_item_id) {
        try {
          const selections = JSON.parse(r.counter_aux_item_id) as Record<string, string>
          const auxDataObj: Record<string, any> = {}
          for (const [catId, itemId] of Object.entries(selections)) {
            if (!itemId) continue
            const cat = catMap.get(catId)
            if (!cat) continue
            const itemName = (getItemName.get(accountSetId, itemId) as any)?.name || ''
            
            // 分配到固定列或 aux_data
            const code = cat.code
            if (code === 'dept') { entryAux.dept_id = itemId; entryAux.dept_name = itemName }
            else if (code === 'project' || code === 'proj') { entryAux.project_id = itemId; entryAux.project_name = itemName }
            else if (code === 'supplier' || code === 'customer' || code === 'supp') { entryAux.supplier_id = itemId; entryAux.supplier_name = itemName }
            else if (code === 'person' || code === 'pers') { entryAux.person_id = itemId; entryAux.person_name = itemName }
            else if (code === 'func_class' || code === 'func') { entryAux.func_class_id = itemId; entryAux.func_class_name = itemName }
            
            // 所有项都放入 aux_data 供前端展示
            auxDataObj[code] = { id: itemId, name: itemName }
          }
          if (Object.keys(auxDataObj).length > 0) {
            entryAux.aux_data = JSON.stringify(auxDataObj)
          }
        } catch { /* ignore */ }
      }

      const runEntry = (seq: number, accId: any, accCode: string, accName: string, direction: string, hasAux: boolean) => {
        const aux = hasAux ? entryAux : {
          dept_id: null, dept_name: null, project_id: null, project_name: null,
          supplier_id: null, supplier_name: null, person_id: null, person_name: null,
          func_class_id: null, func_class_name: null, aux_data: null
        }
        insEntry.run(
          uuidv4(), accountSetId, voucherId, seq, accId, accCode, accName, direction, amt, Math.round(amt * 100), r.summary || '出纳生成',
          aux.dept_id, aux.dept_name, aux.project_id, aux.project_name,
          aux.supplier_id, aux.supplier_name, aux.person_id, aux.person_name,
          aux.func_class_id, aux.func_class_name, aux.aux_data
        )
      }

      if (r.debit > 0) {
        // 收入：借现金，贷对方
        runEntry(1, cashAcc.id, accountCode, cashAcc.name, 'debit', false)
        runEntry(2, cAcc.id, counterCode, cAcc.name, 'credit', true)
      } else {
        // 支出：借对方，贷现金
        runEntry(1, cAcc.id, counterCode, cAcc.name, 'debit', true)
        runEntry(2, cashAcc.id, accountCode, cashAcc.name, 'credit', false)
      }

      updJournal.run(year, month, voucherTypeId, voucherNo, voucherId, r.id)
      voucherNos.push(voucherNo)
    }
  })
  tx()

  return { syncedCount: rows.length, voucherNos }
}

// ── 出纳日报 ─────────────────────────────────────────────

export interface DailyReportRow {
  account_code: string
  account_name: string
  opening: number
  income: number   // 借方
  expense: number  // 贷方
  closing: number
}

export function getAccountBalanceReport(params: {
  accountSetId: string
  startDate: string
  endDate: string
  currency?: string
}): { rows: DailyReportRow[]; total_income: number; total_expense: number } {
  const db = getDb()
  const { accountSetId, startDate, endDate } = params
  const currency = params.currency || 'RMB'

  // 现金+银行科目列表
  const accounts = db.prepare(`
    SELECT a.code, a.name FROM accounts a
    WHERE a.account_set_id=? AND (a.is_cash=1 OR a.is_bank=1)
      AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id=a.id)
    ORDER BY a.code
  `).all(accountSetId) as Array<{ code: string; name: string }>

  const rows: DailyReportRow[] = []
  let totalIncome = 0, totalExpense = 0

  for (const acc of accounts) {
    const opening = getInitBalance(accountSetId, acc.code, currency)
    // 开始日期之前的累计净额
    const before = db.prepare(`
      SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c
      FROM cashier_journal WHERE account_set_id=? AND account_code=? AND currency=? AND biz_date < ?
    `).get(accountSetId, acc.code, currency, startDate) as { d: number; c: number }
    const dayBefore = opening + before.d - before.c

    // 期间收支
    const period = db.prepare(`
      SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c
      FROM cashier_journal WHERE account_set_id=? AND account_code=? AND currency=? AND biz_date >= ? AND biz_date <= ?
    `).get(accountSetId, acc.code, currency, startDate, endDate) as { d: number; c: number }

    const closing = dayBefore + period.d - period.c
    totalIncome += period.d
    totalExpense += period.c
    rows.push({
      account_code: acc.code,
      account_name: acc.name,
      opening: Math.round(dayBefore * 100) / 100,
      income: Math.round(period.d * 100) / 100,
      expense: Math.round(period.c * 100) / 100,
      closing: Math.round(closing * 100) / 100,
    })
  }

  return { rows, total_income: Math.round(totalIncome * 100) / 100, total_expense: Math.round(totalExpense * 100) / 100 }
}

export function getCashFlowSummary(params: {
  accountSetId: string
  startDate?: string
  endDate?: string
  currency?: string
  groupBy: 'counter_account' | 'settle_type' | 'month'
}): any[] {
  const db = getDb()
  const { accountSetId, startDate, endDate, groupBy } = params

  const conds = ['j.account_set_id=?']
  const vals: any[] = [accountSetId]
  if (params.currency) { conds.push('j.currency = ?'); vals.push(params.currency) }
  if (startDate) { conds.push('j.biz_date >= ?'); vals.push(startDate) }
  if (endDate) { conds.push('j.biz_date <= ?'); vals.push(endDate) }

  let groupCol = ''
  let joinClause = ''
  let groupNameSelect = ''

  if (groupBy === 'month') {
    groupCol = "strftime('%Y-%m', j.biz_date)"
    groupNameSelect = `${groupCol} AS group_name`
  } else if (groupBy === 'settle_type') {
    groupCol = 'j.settle_type'
    joinClause = 'LEFT JOIN settle_type st ON j.settle_type = st.code AND j.account_set_id = st.account_set_id'
    groupNameSelect = `COALESCE(st.name, j.settle_type, '未指定') AS group_name`
  } else if (groupBy === 'counter_account') {
    groupCol = 'j.counter_account'
    joinClause = 'LEFT JOIN accounts a ON j.counter_account = a.code AND j.account_set_id = a.account_set_id'
    groupNameSelect = `COALESCE(a.name, j.counter_account, '未指定') AS group_name`
  }

  const sql = `
    SELECT
      ${groupCol} AS group_code,
      ${groupNameSelect},
      SUM(j.debit) AS income,
      SUM(j.credit) AS expense
    FROM cashier_journal j
    ${joinClause}
    WHERE ${conds.join(' AND ')}
    GROUP BY ${groupCol}
    ORDER BY group_code
  `

  const rows = db.prepare(sql).all(...vals) as any[]
  return rows.map(r => ({
    group_code: r.group_code || 'N/A',
    group_name: r.group_name || '未指定',
    income: Math.round((r.income || 0) * 100) / 100,
    expense: Math.round((r.expense || 0) * 100) / 100,
  }))
}

// ── 凭证自动同步到出纳日记账 ───────────────────────────────

/**
 * 凭证保存/修改后，检查是否涉及现金/银行科目，
 * 若启用自动同步（system_params cashier:auto_sync=1），则自动生成/更新出纳日记账。
 *
 * 幂等策略：按 (account_set_id, voucher_year, voucher_month, voucher_type, voucher_no, account_code, biz_date) 查重，
 * 存在则更新金额/摘要，不存在则插入。
 */
export function syncCashierFromVoucher(params: {
  db: any
  accountSetId: string
  voucherDate: string
  voucherYear: number
  voucherMonth: number
  voucherType: number | string | null
  voucherNo: string
  /** 凭证 id（迁移 127 后作为真正的关联键写入 cashier_journal.voucher_id） */
  voucherId?: string | null
  entries: Array<{ account_code: string; direction: 'debit' | 'credit'; amount: number; summary?: string }>
}): { synced: number } {
  const { db, accountSetId, voucherDate, voucherYear, voucherMonth, voucherType, voucherNo, voucherId = null, entries } = params

  // 检查是否启用自动同步（默认不启用，按账套独立配置）
  const cfg = db.prepare(
    "SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='cashier:auto_sync'"
  ).get(accountSetId) as any
  if (!cfg || cfg.param_value !== '1') return { synced: 0 }

  // 取现金/银行科目列表
  const cashBankCodes = db.prepare(
    'SELECT code FROM accounts WHERE account_set_id=? AND (is_cash=1 OR is_bank=1)'
  ).all(accountSetId) as Array<{ code: string }>
  const codeSet = new Set(cashBankCodes.map(a => a.code))
  const hasCashEntry = entries.some(e => codeSet.has(e.account_code))
  if (!hasCashEntry) return { synced: 0 }

  // P1-6：目标月份出纳已结账则拒绝写入（总账侧守卫已先拦，这里兜底）
  assertCashierPeriodOpen(db, accountSetId, voucherDate)

  // 查重用空值安全的 IS 比较：CW 凭证类型为 UUID，vt 恒为 null，
  // 若用 `voucher_type=?`（NULL 比较永不成立）会导致每次编辑凭证都重复插入日记账（FIX：见修复日志）。
  // P2-6：查重键不再含 biz_date——仅改凭证日期时此前会新插一行、原行留存，出纳余额翻倍；
  // 优先按 voucher_id 定位（迁移 127），无 voucher_id 的存量行回退到 年/期/类型/号。
  const findByVoucherId = db.prepare(`
    SELECT id, biz_date FROM cashier_journal
    WHERE account_set_id=? AND account_code=? AND voucher_id=?
    LIMIT 1
  `)
  const find = db.prepare(`
    SELECT id, biz_date FROM cashier_journal
    WHERE account_set_id=? AND account_code=?
      AND voucher_year=? AND voucher_month=? AND voucher_type IS ? AND voucher_no=?
    LIMIT 1
  `)
  const insert = db.prepare(`
    INSERT INTO cashier_journal
      (id, account_set_id, account_code, currency, biz_date, seq, summary, debit, credit,
       counter_account, voucher_year, voucher_month, voucher_type, voucher_no, voucher_id, created_by)
    VALUES (?, ?, ?, 'RMB', ?, 0, ?, ?, ?, NULL, ?, ?, ?, ?, ?, '凭证同步')
  `)
  const update = db.prepare(`
    UPDATE cashier_journal
       SET debit=?, credit=?, summary=?, biz_date=?, voucher_year=?, voucher_month=?, voucher_id=COALESCE(?, voucher_id),
           updated_at=datetime('now')
     WHERE id=?
  `)

  let synced = 0
  // voucher_type 列定义为 INTEGER（ACD 兼容），CW 内部用 UUID，取不到数字则存 null
  const vtNum = Number(voucherType)
  const vt = (voucherType != null && voucherType !== '' && !isNaN(vtNum)) ? vtNum : null
  for (const entry of entries) {
    if (!codeSet.has(entry.account_code)) continue
    const debit = entry.direction === 'debit' ? entry.amount : 0
    const credit = entry.direction === 'credit' ? entry.amount : 0
    const summary = entry.summary || '凭证'

    const existing =
      (voucherId ? (findByVoucherId.get(accountSetId, entry.account_code, voucherId) as any) : null) ||
      (find.get(accountSetId, entry.account_code, voucherYear, voucherMonth, vt, voucherNo) as any)
    if (existing) {
      // 原行所在月份已结账同样拒绝改写
      if (existing.biz_date !== voucherDate) assertCashierPeriodOpen(db, accountSetId, existing.biz_date)
      update.run(debit, credit, summary, voucherDate, voucherYear, voucherMonth, voucherId, existing.id)
    } else {
      insert.run(uuidv4(), accountSetId, entry.account_code, voucherDate, summary, debit, credit,
        voucherYear, voucherMonth, vt, voucherNo, voucherId)
    }
    synced++
  }
  return { synced }
}

/**
 * 出纳生成的凭证（source='cashier'）被重新编辑后，把「对方科目」回写出纳日记账。
 *
 * 适用场景：生成凭证时对未填对方科目的记录用「挂账科目」占位，事后在凭证录入界面
 * 把占位科目改成真实对方科目，需同步更新对应日记账记录的 counter_account。
 *
 * 关联定位：用编辑前的 (account_set_id, voucher_year, voucher_month, voucher_type, voucher_no)
 * 命中 generateCashierVoucher 写入的日记账行（一对一）。日记账行自带现金科目 account_code，
 * 凭证里 account_code ≠ 该现金科目、且「恰好一条」的分录即新对方科目。
 *
 * 仅回写 counter_account（不动 debit/credit/summary）；号/日期若改了则一并刷新链接字段，避免下次失配。
 * 找不到关联行、或对方分录不唯一时静默跳过，返回 updated:0。
 */
export function syncCashierCounterFromVoucher(params: {
  db: any
  accountSetId: string
  // 编辑前的关联标识（用于定位日记账行）
  oldYear: number
  oldMonth: number
  oldVoucherType: number | string | null
  oldVoucherNo: string
  // 编辑后的凭证分录
  entries: Array<{ account_code: string }>
  // 编辑后的新关联标识（号/日期若改了，刷新日记账链接）
  newYear: number
  newMonth: number
  newVoucherType: number | string | null
  newVoucherNo: string
  /** 凭证 id：迁移 127 后优先按 voucher_id 定位 */
  voucherId?: string | null
}): { updated: number } {
  const {
    db, accountSetId,
    oldYear, oldMonth, oldVoucherType, oldVoucherNo,
    entries,
    newYear, newMonth, newVoucherType, newVoucherNo,
    voucherId = null,
  } = params

  // 1. 优先按 voucher_id 定位；存量行回退到编辑前标识
  //   （voucher_type/voucher_no 列声明为 INTEGER 但实存 UUID/字符串，CAST 成文本比较）
  const journalRow =
    (voucherId
      ? (db.prepare('SELECT id, account_code, biz_date FROM cashier_journal WHERE account_set_id=? AND voucher_id=? LIMIT 1').get(accountSetId, voucherId) as any)
      : null) ||
    (db.prepare(`
      SELECT id, account_code, biz_date FROM cashier_journal
      WHERE account_set_id=? AND voucher_year=? AND voucher_month=?
        AND CAST(voucher_type AS TEXT)=? AND CAST(voucher_no AS TEXT)=?
      LIMIT 1
    `).get(
      accountSetId, oldYear, oldMonth,
      oldVoucherType == null ? '' : String(oldVoucherType),
      oldVoucherNo == null ? '' : String(oldVoucherNo),
    ) as any)
  if (!journalRow) return { updated: 0 }

  // P1-6：已结账月份的日记账行不回写
  assertCashierPeriodOpen(db, accountSetId, journalRow.biz_date)

  // 2. 对方分录 = account_code ≠ 现金科目；必须恰好一条，否则歧义跳过
  const counters = entries.filter(e => String(e.account_code) !== String(journalRow.account_code))
  if (counters.length !== 1) return { updated: 0 }
  const newCounterCode = counters[0].account_code

  // 3. 回写 counter_account，并刷新链接字段（号/日期若没改即原值）
  db.prepare(`
    UPDATE cashier_journal
    SET counter_account=?, voucher_year=?, voucher_month=?, voucher_type=?, voucher_no=?,
        voucher_id=COALESCE(?, voucher_id), updated_at=datetime('now')
    WHERE id=?
  `).run(
    newCounterCode, newYear, newMonth,
    newVoucherType == null ? null : String(newVoucherType),
    newVoucherNo == null ? null : String(newVoucherNo),
    voucherId,
    journalRow.id,
  )

  return { updated: 1 }
}
