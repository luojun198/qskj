/**
 * 出纳日记账批量写入（Excel 导入与 FIX-262 对账单导入共用）：
 * 日期规范化 + 出纳 / 总账期间闸、借贷金额校验、币种跟科目走（外币按日期取默认汇率或行内汇率）、
 * 序号接在该科目现有最大序号之后；可选「疑似重复」跳过（同日期、同借贷金额、双方都有票据号时票据号也相同）。
 */
import { round2Symmetric } from '../utils/amountUtils.js'
import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { assertCashierPeriodOpen, normalizeBizDate, parseBizDate } from './cashierPeriodClosing.js'
import { assertGlPeriodOpen, assertNotBeforeGlStart } from './voucherMutationGuard.js'
import {
  computeBaseAmounts, getCashierAccountCurrency, getCashierBaseCurrency, resolveCashierRate,
} from './cashierQuery.js'

export const round2 = (n: number) => round2Symmetric(n)

/** 批量导入每个事务的行数（FIX-254） */
export const IMPORT_CHUNK_ROWS = 5000

/**
 * 新写入的业务日期：严格规范化为 YYYY-MM-DD（P1-7），并同时过出纳结账闸与总账期间闸（P0-2）。
 * 返回规范化后的日期。
 */
export function assertJournalDateWritable(db: Database, accountSetId: string, raw: unknown): string {
  const bizDate = normalizeBizDate(raw)
  assertCashierPeriodOpen(db, accountSetId, bizDate)
  const ym = parseBizDate(bizDate)!
  assertGlPeriodOpen(db, accountSetId, ym.year, ym.month)
  assertNotBeforeGlStart(db, accountSetId, bizDate, '日记账日期')
  return bizDate
}

/** 借贷金额校验（P2-10 / P2-2）：必须是有限数字、非负，且有且仅有一方大于 0 */
export function validateJournalAmounts(debit: unknown, credit: unknown): string | null {
  const d = Number(debit ?? 0)
  const c = Number(credit ?? 0)
  if (!Number.isFinite(d) || !Number.isFinite(c)) return '借方 / 贷方金额必须是数字'
  if (d < 0 || c < 0) return '借方 / 贷方金额不能为负数'
  if (d > 0 && c > 0) return '借方与贷方金额不能同时大于 0'
  if (!(d > 0) && !(c > 0)) return '借方、贷方金额不能同时为空或零'
  return null
}

export interface JournalImportRow {
  biz_date: unknown
  debit?: unknown
  credit?: unknown
  summary?: string | null
  settle_type?: string | null
  bill_no?: string | null
  counter_unit?: string | null
  counter_account?: string | null
  bank_name?: string | null
  bank_account?: string | null
  exchange_rate?: unknown
  seq?: number | null
  /** 源文件行号（错误 / 重复提示用），缺省按数组下标 + 1 */
  row_no?: number
}

export interface JournalImportResult {
  inserted: number
  skipped: Array<{ row: number; biz_date: string; debit: number; credit: number; summary: string | null }>
  errors: Array<{ row: number; message: string }>
}

/** 票据号相同时允许的入账日期差（银行到账常晚于出纳记账一两天） */
const DUP_BILL_DAY_TOLERANCE = 7

/**
 * 疑似重复识别器：同借贷金额，且
 * - 同日期（双方都有票据号时票据号也须相同），或
 * - 双方票据号相同、日期相差不超过 DUP_BILL_DAY_TOLERANCE 天（出纳 9-28 记账、银行 9-29 到账的同一笔）。
 * 每条已有日记账最多「认领」一行导入数据（同一文件两笔相同交易只算一笔重复）；同日期优先认领。
 */
function duplicateMatcher(db: Database, asid: string, code: string, currency: string) {
  const existing = db.prepare(
    'SELECT id, biz_date, debit, credit, bill_no FROM cashier_journal WHERE account_set_id=? AND account_code=? AND currency=?'
  ).all(asid, code, currency) as Array<{ id: string; biz_date: string; debit: number; credit: number; bill_no: string | null }>
  const byAmount = new Map<string, typeof existing>()
  for (const e of existing) {
    const k = `${round2(e.debit)}|${round2(e.credit)}`
    if (!byAmount.has(k)) byAmount.set(k, [])
    byAmount.get(k)!.push(e)
  }
  const used = new Set<string>()
  const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000
  return (date: string, debit: number, credit: number, billNo: string | null | undefined) => {
    const list = byAmount.get(`${debit}|${credit}`)
    if (!list) return false
    const bill = String(billNo ?? '').trim()
    const sameBill = (e: { bill_no: string | null }) => !!bill && !!e.bill_no && e.bill_no.trim() === bill
    const hit = list.find(e => !used.has(e.id) && e.biz_date === date && (!bill || !e.bill_no || sameBill(e)))
      ?? list.find(e => !used.has(e.id) && sameBill(e) && days(e.biz_date, date) <= DUP_BILL_DAY_TOLERANCE)
    if (!hit) return false
    used.add(hit.id)
    return true
  }
}

/**
 * 批量写入日记账。按 IMPORT_CHUNK_ROWS 分片提交并让出事件循环（FIX-254）。
 * dryRun=true 只做校验与重复识别，不写库。
 */
export async function importJournalRows(db: Database, params: {
  accountSetId: string
  accountCode: string
  rows: JournalImportRow[]
  maker: string | null
  /** 调用方声明的币种（须与科目一致） */
  currency?: unknown
  skipDuplicates?: boolean
  dryRun?: boolean
}): Promise<JournalImportResult | { error: string }> {
  const { accountSetId: asid, accountCode, rows } = params
  const base = getCashierBaseCurrency(db, asid)
  const currency = getCashierAccountCurrency(db, asid, accountCode)
  if (params.currency != null && String(params.currency).trim() !== '') {
    const c = String(params.currency).trim().toUpperCase()
    if ((c === 'CNY' ? 'RMB' : c) !== currency) return { error: `科目 ${accountCode} 的核算币种为 ${currency}，与导入币种不一致` }
  }
  const isForeign = currency !== base
  const rateCache = new Map<string, number>()
  const defaultRate = (date: string) => {
    const key = date.slice(0, 7)
    let r = rateCache.get(key)
    if (r === undefined) { r = resolveCashierRate(db, asid, currency, date); rateCache.set(key, r) }
    return r
  }
  // FIX-254（十万级压测 P1-5）：期间开闭校验按「原始日期串」记忆化
  const dateCache = new Map<string, { ok: true; date: string } | { ok: false; message: string }>()
  const resolveDate = (raw: unknown) => {
    const key = String(raw)
    let hit = dateCache.get(key)
    if (!hit) {
      try { hit = { ok: true, date: assertJournalDateWritable(db, asid, raw) } } catch (e: any) { hit = { ok: false, message: e.message } }
      dateCache.set(key, hit)
    }
    return hit
  }
  const isDup = params.skipDuplicates ? duplicateMatcher(db, asid, accountCode, currency) : null
  const stmt = db.prepare(
    `INSERT INTO cashier_journal
      (id, account_set_id, account_code, currency, biz_date, seq, summary,
       debit, credit, exchange_rate, base_debit, base_credit,
       settle_type, bill_no, counter_unit, counter_account,
       bank_name, bank_account, unit_code, counter_aux_item_id, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  // FIX-261：未指定序号时接在该科目（币种）现有最大序号之后
  let nextSeq = ((db.prepare(
    'SELECT COALESCE(MAX(seq), 0) AS m FROM cashier_journal WHERE account_set_id=? AND account_code=? AND currency=?'
  ).get(asid, accountCode, currency) as { m: number }).m || 0)

  const result: JournalImportResult = { inserted: 0, skipped: [], errors: [] }
  const chunk = (start: number, end: number) => {
    for (let i = start; i < end; i++) {
      const r = rows[i]
      const rowNo = r.row_no ?? i + 1
      if (r.biz_date === undefined || r.biz_date === null || r.biz_date === '') {
        result.errors.push({ row: rowNo, message: '日期为空' }); continue
      }
      const dateHit = resolveDate(r.biz_date)
      if (!dateHit.ok) { result.errors.push({ row: rowNo, message: dateHit.message }); continue }
      const debit = round2(Number(r.debit) || 0)
      const credit = round2(Number(r.credit) || 0)
      const amountErr = validateJournalAmounts(debit, credit)
      if (amountErr) { result.errors.push({ row: rowNo, message: amountErr }); continue }
      let rate = 1
      if (isForeign) {
        if (r.exchange_rate != null && r.exchange_rate !== '') {
          rate = Number(r.exchange_rate)
          if (!Number.isFinite(rate) || rate <= 0) { result.errors.push({ row: rowNo, message: '汇率必须是大于 0 的数字' }); continue }
        } else {
          rate = defaultRate(dateHit.date)
        }
      }
      if (isDup && isDup(dateHit.date, debit, credit, r.bill_no)) {
        result.skipped.push({ row: rowNo, biz_date: dateHit.date, debit, credit, summary: r.summary || null })
        continue
      }
      if (params.dryRun) { result.inserted++; continue }
      const baseAmt = computeBaseAmounts(debit, credit, rate)
      const seq = Number(r.seq) > 0 ? Math.floor(Number(r.seq)) : ++nextSeq
      stmt.run(
        uuidv4(), asid, accountCode, currency, dateHit.date, seq,
        r.summary || null, debit, credit, rate, baseAmt.base_debit, baseAmt.base_credit,
        r.settle_type || null, r.bill_no || null,
        r.counter_unit || null, r.counter_account || null, r.bank_name || null, r.bank_account || null, null, null,
        params.maker
      )
      result.inserted++
    }
  }
  const tx = db.transaction(chunk)
  for (let start = 0; start < rows.length; start += IMPORT_CHUNK_ROWS) {
    tx(start, Math.min(start + IMPORT_CHUNK_ROWS, rows.length))
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  if (!params.dryRun) { try { db.pragma('optimize') } catch { /* ignore */ } }
  return result
}
