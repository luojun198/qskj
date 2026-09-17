/**
 * 供应链多币种双轨（P2-14）：原币 + 本位币。
 *
 * 口径：
 *  - 单据行金额（amount / tax_amount / price）一律是**原币**；`scm_doc.currency` 为空、CNY、RMB 或等于账套本位币即视为本位币。
 *  - 记账汇率 `scm_doc.exchange_rate`：本位币恒为 1；外币取单据填写的汇率，缺省按单据期间从汇率表解析（审核时锁定回写）。
 *  - 库存成本、凭证金额、往来台账 amount、账龄/余额/信用占用 = 原币 × 汇率（本位币）；
 *    往来台账另存 amount_fc / verified_fc 供同币种核销与对账。
 *
 * 所有函数都用传入的 db（单元测试用内存库，表可能不存在，因此全部做 sqlite_master 探测）。
 */
import type Database from 'better-sqlite3'

const hasTable = (db: Database.Database, t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)

export function normalizeScmCurrency(raw: unknown): string {
  const code = String(raw ?? '').trim().toUpperCase()
  return code === 'CNY' ? 'RMB' : code
}

/** 账套本位币编码（currencies.is_base → system_params.base_currency → RMB） */
export function getScmBaseCurrency(db: Database.Database, aid: string): string {
  if (hasTable(db, 'currencies')) {
    const row = db.prepare('SELECT code FROM currencies WHERE account_set_id=? AND is_base=1 LIMIT 1').get(aid) as any
    const code = normalizeScmCurrency(row?.code)
    if (code) return code
  }
  if (hasTable(db, 'system_params')) {
    const row = db.prepare("SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='base_currency' LIMIT 1").get(aid) as any
    const code = normalizeScmCurrency(row?.param_value)
    if (code) return code
  }
  return 'RMB'
}

export function isScmBaseCurrency(db: Database.Database, aid: string, currency: unknown): boolean {
  const code = normalizeScmCurrency(currency)
  if (!code) return true
  return code === getScmBaseCurrency(db, aid)
}

/** 按期间解析汇率（同 currencyService.resolveExchangeRate 的顺序，但用传入 db，表缺失时退回 1） */
export function resolveScmExchangeRate(db: Database.Database, aid: string, currency: unknown, docDate?: string | null): number {
  const code = normalizeScmCurrency(currency)
  if (!code || isScmBaseCurrency(db, aid, code)) return 1
  const d = String(docDate || '').slice(0, 10)
  const year = Number(d.slice(0, 4)) || new Date().getFullYear()
  const period = Number(d.slice(5, 7)) || new Date().getMonth() + 1
  if (hasTable(db, 'exchange_rates')) {
    const exact = db.prepare('SELECT rate FROM exchange_rates WHERE account_set_id=? AND UPPER(currency_code)=? AND year=? AND period=?').get(aid, code, year, period) as any
    if (Number(exact?.rate) > 0) return Number(exact.rate)
  }
  let cur: any = null
  if (hasTable(db, 'currencies')) {
    cur = db.prepare('SELECT end_rate, default_rate FROM currencies WHERE account_set_id=? AND UPPER(code)=? LIMIT 1').get(aid, code)
    if (Number(cur?.end_rate) > 0) return Number(cur.end_rate)
  }
  if (hasTable(db, 'exchange_rates')) {
    const nearest = db.prepare(`SELECT rate FROM exchange_rates WHERE account_set_id=? AND UPPER(currency_code)=?
      AND (year < ? OR (year = ? AND period <= ?)) ORDER BY year DESC, period DESC LIMIT 1`).get(aid, code, year, year, period) as any
    if (Number(nearest?.rate) > 0) return Number(nearest.rate)
  }
  if (Number(cur?.default_rate) > 0) return Number(cur.default_rate)
  return 1
}

/**
 * 单据的记账汇率：本位币 → 1；外币 → 单据已填的正数汇率，否则按单据期间解析。
 * 审核时应把解析结果回写到 scm_doc.exchange_rate 锁定，反审核/凭证/往来均以此为准。
 */
export function docExchangeRate(db: Database.Database, aid: string, doc: { currency?: unknown; exchange_rate?: unknown; doc_date?: string | null }): number {
  if (isScmBaseCurrency(db, aid, doc?.currency)) return 1
  const given = Number(doc?.exchange_rate)
  if (Number.isFinite(given) && given > 0) return given
  return resolveScmExchangeRate(db, aid, doc?.currency, doc?.doc_date)
}

/** 原币 → 本位币（按分舍入） */
export function toBase(amountFc: number, rate: number): number {
  return Math.round((Number(amountFc) || 0) * (Number(rate) || 1) * 100) / 100
}
