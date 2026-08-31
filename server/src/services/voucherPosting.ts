import { v4 as uuidv4 } from 'uuid'
import { centsToYuan } from '../utils/amountUtils.js'
import { buildAuxItemId as buildAuxItemIdUtil } from '../utils/auxItemId.js'
import { calcSignedBalance } from '../utils/accountBalance.js'
import { checkPostingIntegrity } from './postingIntegrityCheck.js'
import { validateInitBalanceBalancedForPosting } from './initBalanceTrial.js'

export interface VoucherEntryLike {
  account_id: string
  account_code: string
  account_name: string
  direction: 'debit' | 'credit'
  amount: number
  amount_cents?: number
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
}

export interface PostingContext {
  accountSetId: string
  userId?: string
  userName?: string
  requireAudit: boolean
  allowDirectPost: boolean
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

export function getVoucherStatusAfterUnpost(requireAudit: boolean) {
  return requireAudit ? 'audited' : 'draft'
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

  const initBalanceError = validateInitBalanceBalancedForPosting(db, ctx.accountSetId, voucher.year)
  if (initBalanceError) {
    throw new Error(initBalanceError)
  }

  const resolvedEntries = resolvePostingEntries(db, voucher.id, entries)

  const integrityCheck = checkPostingIntegrity(
    db,
    ctx.accountSetId,
    voucher.year,
    voucher.period,
    resolvedEntries,
    { entriesAlreadyPersisted: true }
  )
  if (!integrityCheck.isValid) {
    throw new Error(integrityCheck.errors.join('；'))
  }

  const postVoucher = db.prepare(
    "UPDATE vouchers SET status=?, poster_id=?, poster_name=?, posted_at=datetime('now'), updated_at=datetime('now') WHERE id=?"
  )

  const getInitBalance = db.prepare(`
    SELECT COALESCE(SUM(init_balance), 0) as init_balance
    FROM init_balances
    WHERE account_set_id=? AND account_id=? AND year=? AND aux_item_id=?
  `)

  // FIX-006 / P0-2+P0-3：account_balances.end_balance 字段语义不可靠（仅 = 年初 + 本期净额，
  // 不含 1~N-1 期发生额），目前所有账簿/报表查询已改为动态计算，end_balance 列保留仅为
  // 历史兼容，不应被任何业务逻辑信任。
  const upsertBalance = db.prepare(`
    INSERT INTO account_balances (id, account_set_id, account_id, account_code, account_name, direction, year, period, init_balance, current_debit, current_credit, end_balance, end_debit, end_credit, aux_item_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_set_id, account_id, year, period, aux_item_id) DO UPDATE SET
      init_balance = COALESCE(init_balance, excluded.init_balance),
      current_debit = current_debit + excluded.current_debit,
      current_credit = current_credit + excluded.current_credit,
      end_balance = CASE WHEN direction = 'debit'
        THEN COALESCE(init_balance, 0) + (current_debit + excluded.current_debit) - (current_credit + excluded.current_credit)
        ELSE COALESCE(init_balance, 0) + (current_credit + excluded.current_credit) - (current_debit + excluded.current_debit)
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
      const accountRow = getAccountDirection.get(entry.account_id, ctx.accountSetId) as
        | { direction: 'debit' | 'credit' }
        | undefined
      const accountDirection = accountRow?.direction || 'debit'

      // 优先使用整数字段计算，避免浮点误差
      const amountToUse = entry.amount_cents ? centsToYuan(entry.amount_cents) : entry.amount
      const currentDebit = isDebit ? amountToUse : 0
      const currentCredit = isDebit ? 0 : amountToUse

      // Compute end_balance for the INSERT case (first posting to this account/period)
      const endBalance = calcSignedBalance(
        accountDirection,
        initBalance,
        currentDebit,
        currentCredit
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
        auxItemId
      )
    }
  })

  transaction()
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
      end_balance = end_balance - CASE WHEN direction = 'debit' THEN ? - ? ELSE ? - ? END
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

      const auxItemId = buildAuxItemId(entry)

      const result = revertBalanceExact.run(
        debitAmount,
        creditAmount,
        debitAmount,
        creditAmount,
        creditAmount,
        debitAmount,
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
    unpostVoucher.run(getVoucherStatusAfterUnpost(ctx.requireAudit), voucher.id)
  })

  transaction()
}
