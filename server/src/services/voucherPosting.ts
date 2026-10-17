import { v4 as uuidv4 } from 'uuid'
import { centsToYuan, yuanToCents } from '../utils/amountUtils.js'
import { buildAuxItemId as buildAuxItemIdUtil } from '../utils/auxItemId.js'
import { calcSignedBalance } from '../utils/accountBalance.js'
import { checkPostingIntegrity } from './postingIntegrityCheck.js'
import { validateInitBalanceBalancedForPosting } from './initBalanceTrial.js'
import { bumpLedgerDataEpoch } from './ledgerDataEpoch.js'

export interface VoucherEntryLike {
  account_id: string
  account_code: string
  account_name: string
  direction: 'debit' | 'credit'
  amount: number
  amount_cents?: number
  foreign_amount?: number | null
  dept_id?: string | number | null
  project_id?: string | number | null
  supplier_id?: string | number | null
  person_id?: string | number | null
  func_class_id?: string | number | null
  aux_data?: string | null
}

export interface VoucherLike {
  id: string
  year: number
  period: number
  status: 'draft' | 'audited' | 'posted'
  voucher_no?: string
}

export interface PostingContext {
  accountSetId: string
  userId?: string
  userName?: string
  requireAudit: boolean
  allowDirectPost: boolean
  /** FIX-252：批量记账已在任务开始时对涉及年度做过一次期初试算，逐张无需重复（每张 15ms） */
  skipInitBalanceCheck?: boolean
  /** FIX-324：批量记账整批共用的实时余额缓存（见 PostingIntegrityOptions.balanceCache） */
  balanceCache?: Map<string, number>
}

export function validateVoucherForUnpost(voucher: VoucherLike | null | undefined) {
  if (!voucher || voucher.status !== 'posted') {
    return '只有已记账的凭证可以反记账'
  }
  return null
}

export function getRequireAuditEnabled(
  requireAuditParam: { param_value?: string } | null | undefined
) {
  return requireAuditParam?.param_value === 'true'
}

export function getAllowDirectPost(
  allowDirectPostParam: { param_value?: string } | null | undefined
) {
  return allowDirectPostParam?.param_value === 'true'
}

export function loadVoucherEntries(
  db: {
    prepare: (sql: string) => { all: (...args: any[]) => any[] }
  },
  voucherId: string
) {
  return db
    .prepare('SELECT * FROM voucher_entries WHERE voucher_id=?')
    .all(voucherId) as VoucherEntryLike[]
}

export function validateVoucherCanPost(
  voucher: VoucherLike,
  requireAudit: boolean,
  allowDirectPost: boolean
) {
  if (requireAudit && voucher.status === 'draft') {
    if (!allowDirectPost) {
      return '该凭证尚未审核，不能记账'
    }
  }
  if (voucher.status === 'posted') {
    return '该凭证已记账'
  }
  return null
}

/**
 * GL-5：反记账后的状态。开启「必须审核」时回到已审核——但「允许直接记账」从草稿直接记的凭证
 * 从未审核过（审核人为空），回到已审核等于凭空多了一次审核，之后可跳过审核再次记账，故回草稿。
 */
export function getVoucherStatusAfterUnpost(requireAudit: boolean, wasAudited = true) {
  return requireAudit && wasAudited ? 'audited' : 'draft'
}

/** @see utils/auxItemId.ts */
export function buildAuxItemId(entry: VoucherEntryLike): string {
  return buildAuxItemIdUtil(entry)
}

/** 过账/反过账始终优先使用数据库中的完整分录（避免调用方传入字段不全） */
function resolvePostingEntries(
  db: { prepare: (sql: string) => { all: (...args: any[]) => any[] } },
  voucherId: string,
  entries: VoucherEntryLike[]
): VoucherEntryLike[] {
  const dbEntries = loadVoucherEntries(db, voucherId)
  return dbEntries.length > 0 ? dbEntries : entries
}

/** 按分录 amount 重算借贷（整数分），不平时返回错误文案 */
export function getPostingBalanceError(entries: VoucherEntryLike[]): string | null {
  if (!entries || entries.length === 0) {
    return '凭证没有分录，不能记账'
  }
  let debitCents = 0
  let creditCents = 0
  for (const entry of entries) {
    const cents = yuanToCents(Number(entry.amount) || 0)
    if (entry.direction === 'debit') debitCents += cents
    else creditCents += cents
  }
  if (debitCents !== creditCents) {
    return `凭证借贷不平衡，拒绝记账：借方 ${centsToYuan(debitCents).toFixed(2)} != 贷方 ${centsToYuan(creditCents).toFixed(2)}`
  }
  return null
}

export function applyVoucherPosting(
  db: any,
  voucher: VoucherLike,
  entries: VoucherEntryLike[],
  ctx: PostingContext
) {
  // 幂等保护：从 DB 读取凭证当前状态，已 posted 时拒绝重复累加。
  // 这层保护避免因调用方漏调 validateVoucherCanPost 导致 account_balances 被
  // 重复累加（曾出现 6001001 销货收入 current_credit 被加成 2 × 501 的脏数据）。
  const dbVoucher = db.prepare('SELECT status FROM vouchers WHERE id=?').get(voucher.id) as
    | { status?: string }
    | undefined
  if (dbVoucher?.status === 'posted') {
    const label = voucher.voucher_no?.trim() || '该凭证'
    throw new Error(`凭证「${label}」已记账，拒绝重复执行`)
  }

  if (!ctx.skipInitBalanceCheck) {
    const initBalanceError = validateInitBalanceBalancedForPosting(db, ctx.accountSetId, voucher.year)
    if (initBalanceError) {
      throw new Error(initBalanceError)
    }
  }

  const resolvedEntries = resolvePostingEntries(db, voucher.id, entries)

  // FIX-131：过账前最后一道借贷平衡闸，按落库 amount 在整数分域重算，
  // 杜绝任何调用方（手工/结转/调汇/推凭）绕过录入校验把不平凭证写进 account_balances
  const balanceError = getPostingBalanceError(resolvedEntries)
  if (balanceError) {
    throw new Error(balanceError)
  }

  const integrityCheck = checkPostingIntegrity(
    db,
    ctx.accountSetId,
    voucher.year,
    voucher.period,
    resolvedEntries,
    { entriesAlreadyPersisted: true, balanceCache: ctx.balanceCache }
  )
  if (!integrityCheck.isValid) {
    throw new Error(integrityCheck.errors.join('；'))
  }

  const postVoucher = db.prepare(
    "UPDATE vouchers SET status=?, poster_id=?, poster_name=?, posted_at=datetime('now'), updated_at=datetime('now') WHERE id=?"
  )

  const getInitBalance = db.prepare(`
    SELECT COALESCE(SUM(init_balance), 0) as init_balance,
           COALESCE(SUM(foreign_init_balance), 0) as foreign_init_balance
    FROM init_balances
    WHERE account_set_id=? AND account_id=? AND year=? AND aux_item_id=?
  `)

  // FIX-006 / P0-2+P0-3：account_balances.end_balance 字段语义不可靠（仅 = 年初 + 本期净额，
  // 不含 1~N-1 期发生额），目前所有账簿/报表查询已改为动态计算，end_balance 列保留仅为
  // 历史兼容，不应被任何业务逻辑信任。
  const upsertBalance = db.prepare(`
    INSERT INTO account_balances (
      id, account_set_id, account_id, account_code, account_name, direction, year, period,
      init_balance, current_debit, current_credit, end_balance, end_debit, end_credit, aux_item_id,
      foreign_init_balance, foreign_current_debit, foreign_current_credit, foreign_end_balance
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_set_id, account_id, year, period, aux_item_id) DO UPDATE SET
      init_balance = COALESCE(init_balance, excluded.init_balance),
      current_debit = current_debit + excluded.current_debit,
      current_credit = current_credit + excluded.current_credit,
      end_balance = CASE WHEN direction = 'debit'
        THEN COALESCE(init_balance, 0) + (current_debit + excluded.current_debit) - (current_credit + excluded.current_credit)
        ELSE COALESCE(init_balance, 0) + (current_credit + excluded.current_credit) - (current_debit + excluded.current_debit)
      END,
      foreign_init_balance = COALESCE(foreign_init_balance, excluded.foreign_init_balance),
      foreign_current_debit = COALESCE(foreign_current_debit, 0) + excluded.foreign_current_debit,
      foreign_current_credit = COALESCE(foreign_current_credit, 0) + excluded.foreign_current_credit,
      foreign_end_balance = CASE WHEN direction = 'debit'
        THEN COALESCE(foreign_init_balance, 0) + (COALESCE(foreign_current_debit, 0) + excluded.foreign_current_debit)
             - (COALESCE(foreign_current_credit, 0) + excluded.foreign_current_credit)
        ELSE COALESCE(foreign_init_balance, 0) + (COALESCE(foreign_current_credit, 0) + excluded.foreign_current_credit)
             - (COALESCE(foreign_current_debit, 0) + excluded.foreign_current_debit)
      END
  `)

  const getAccountDirection = db.prepare(`
    SELECT direction FROM accounts WHERE id=? AND account_set_id=?
  `)

  const transaction = db.transaction(() => {
    postVoucher.run('posted', ctx.userId, ctx.userName, voucher.id)

    for (const entry of resolvedEntries) {
      const isDebit = entry.direction === 'debit'
      const auxItemId = buildAuxItemId(entry)
      const initBalRow = getInitBalance.get(
        ctx.accountSetId,
        entry.account_id,
        voucher.year,
        auxItemId
      ) as any
      const initBalance = initBalRow?.init_balance || 0
      const foreignInitBalance = initBalRow?.foreign_init_balance || 0
      const accountRow = getAccountDirection.get(entry.account_id, ctx.accountSetId) as
        | { direction: 'debit' | 'credit' }
        | undefined
      const accountDirection = accountRow?.direction || 'debit'

      // 优先使用整数字段计算，避免浮点误差
      const amountToUse = entry.amount_cents ? centsToYuan(entry.amount_cents) : entry.amount
      const currentDebit = isDebit ? amountToUse : 0
      const currentCredit = isDebit ? 0 : amountToUse
      const foreignAmount = Number(entry.foreign_amount) || 0
      const foreignCurrentDebit = isDebit ? foreignAmount : 0
      const foreignCurrentCredit = isDebit ? 0 : foreignAmount

      // Compute end_balance for the INSERT case (first posting to this account/period)
      const endBalance = calcSignedBalance(
        accountDirection,
        initBalance,
        currentDebit,
        currentCredit
      )
      const foreignEndBalance = calcSignedBalance(
        accountDirection,
        foreignInitBalance,
        foreignCurrentDebit,
        foreignCurrentCredit
      )

      upsertBalance.run(
        uuidv4(),
        ctx.accountSetId,
        entry.account_id,
        entry.account_code,
        entry.account_name,
        accountDirection,
        voucher.year,
        voucher.period,
        initBalance,
        currentDebit,
        currentCredit,
        endBalance,
        0,
        0,
        auxItemId,
        foreignInitBalance,
        foreignCurrentDebit,
        foreignCurrentCredit,
        foreignEndBalance
      )
    }
  })

  transaction()
  bumpLedgerDataEpoch()
}

export function applyVoucherUnpost(
  db: any,
  voucher: VoucherLike,
  entries: VoucherEntryLike[],
  ctx: PostingContext
) {
  const resolvedEntries = resolvePostingEntries(db, voucher.id, entries)

  // FIX-008 / P1-12：
  // 旧实现在精确 aux_item_id 匹配失败时，会回退到 aux_item_id IS NULL OR '' 的非辅助行扣减，
  // 这会把辅助核算分录的金额错扣到"非辅助桶"上，造成余额污染。
  // 修复策略：
  //   1) 用 COALESCE(aux_item_id, '') = ? 处理 NULL/'' 等价，从根本上避免 NULL 不命中的问题；
  //   2) 不再 fallback。若精确扣减依然 changes=0，说明对应过账行已被删除或从未写入，
  //      属于数据完整性事故 —— 抛错让上层 transaction 回滚，避免静默扣错桶。
  const revertBalanceExact = db.prepare(`
    UPDATE account_balances SET
      current_debit = current_debit - ?,
      current_credit = current_credit - ?,
      end_balance = end_balance - CASE WHEN direction = 'debit' THEN ? - ? ELSE ? - ? END,
      foreign_current_debit = COALESCE(foreign_current_debit, 0) - ?,
      foreign_current_credit = COALESCE(foreign_current_credit, 0) - ?,
      foreign_end_balance = COALESCE(foreign_end_balance, 0) - CASE WHEN direction = 'debit' THEN ? - ? ELSE ? - ? END
    WHERE account_set_id=? AND account_id=? AND year=? AND period=?
      AND COALESCE(aux_item_id, '') = ?
  `)

  const cleanupZeroBalance = db.prepare(`
    DELETE FROM account_balances
    WHERE account_set_id=? AND year=? AND period=?
      AND current_debit = 0 AND current_credit = 0
      AND COALESCE(init_balance, 0) = 0
  `)

  const unpostVoucher = db.prepare(
    "UPDATE vouchers SET status=?, poster_id=NULL, poster_name=NULL, posted_at=NULL, updated_at=datetime('now') WHERE id=?"
  )

  const transaction = db.transaction(() => {
    for (const entry of resolvedEntries) {
      const isDebit = entry.direction === 'debit'

      // 优先使用整数字段计算，避免浮点误差
      const amountToUse = entry.amount_cents ? centsToYuan(entry.amount_cents) : entry.amount
      const debitAmount = isDebit ? amountToUse : 0
      const creditAmount = isDebit ? 0 : amountToUse
      const foreignAmount = Number(entry.foreign_amount) || 0
      const foreignDebit = isDebit ? foreignAmount : 0
      const foreignCredit = isDebit ? 0 : foreignAmount

      const auxItemId = buildAuxItemId(entry)

      const result = revertBalanceExact.run(
        debitAmount,
        creditAmount,
        debitAmount,
        creditAmount,
        creditAmount,
        debitAmount,
        foreignDebit,
        foreignCredit,
        foreignDebit,
        foreignCredit,
        foreignCredit,
        foreignDebit,
        ctx.accountSetId,
        entry.account_id,
        voucher.year,
        voucher.period,
        auxItemId
      )

      // FIX-008：精确匹配失败即视为数据完整性问题，拒绝继续以免错扣
      if (!result.changes || result.changes === 0) {
        throw new Error(
          `反记账失败：未找到对应余额行（凭证=${voucher.id} 科目=${entry.account_id} 期间=${voucher.year}/${voucher.period} 辅助=${auxItemId || '(无)'}）。可能该期余额数据已损坏，请使用「重建科目余额」工具修复后再重试。`
        )
      }
    }

    cleanupZeroBalance.run(ctx.accountSetId, voucher.year, voucher.period)
    // 老库 / 精简测试库无审核人列时沿用原口径（视为审核过）
    const voucherCols = new Set((db.prepare('PRAGMA table_info(vouchers)').all() as Array<{ name: string }>).map(c => c.name))
    let wasAudited = true
    if (voucherCols.has('auditor_id') && voucherCols.has('auditor_name')) {
      const auditRow = db
        .prepare('SELECT auditor_id, auditor_name FROM vouchers WHERE id = ?')
        .get(voucher.id) as { auditor_id?: string | null; auditor_name?: string | null } | undefined
      wasAudited = !!(auditRow?.auditor_id || String(auditRow?.auditor_name || '').trim())
    }
    unpostVoucher.run(getVoucherStatusAfterUnpost(ctx.requireAudit, wasAudited), voucher.id)
  })

  transaction()
  bumpLedgerDataEpoch()
}
