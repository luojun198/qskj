import { getDb } from '../db/index.js'
import { assertLeafAccountCode } from './accountReferences.js'
import { v4 as uuidv4 } from 'uuid'
import { upsertAccountSetSystemParam } from './accountSetDefaults.js'

export interface Currency {
  id: string
  account_set_id: string
  code: string
  name: string
  is_base: number
  default_rate: number
  /** 年初汇率 */
  begin_rate: number
  /** 期末汇率（凭证录入默认汇率的兜底来源） */
  end_rate: number
  rate_decimals: number
  is_enabled: number
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ExchangeRate {
  id: string
  account_set_id: string
  currency_code: string
  year: number
  period: number
  rate: number
  closing_rate: number | null
  created_at: string
  updated_at: string
}

const CURRENCY_NAME_MAP: Record<string, string> = {
  RMB: '人民币',
  CNY: '人民币',
  USD: '美元',
  HKD: '港币',
  EUR: '欧元',
  JPY: '日元',
  GBP: '英镑',
}

function normalizeRate(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function normalizeCurrencyCode(code: string): string {
  return String(code || '')
    .trim()
    .toUpperCase()
}

export function getCurrencies(
  accountSetId: string,
  options: { includeDisabled?: boolean } = {}
): Currency[] {
  const db = getDb()
  const sql = options.includeDisabled
    ? `SELECT * FROM currencies WHERE account_set_id = ? ORDER BY is_base DESC, sort_order ASC, code ASC`
    : `SELECT * FROM currencies WHERE account_set_id = ? AND is_enabled = 1 ORDER BY is_base DESC, sort_order ASC, code ASC`
  return db.prepare(sql).all(accountSetId) as Currency[]
}

export function getCurrencyByCode(accountSetId: string, code: string): Currency | null {
  const db = getDb()
  return (
    (db
      .prepare(`SELECT * FROM currencies WHERE account_set_id = ? AND UPPER(code) = ?`)
      .get(accountSetId, normalizeCurrencyCode(code)) as Currency | undefined) || null
  )
}

export function getBaseCurrency(accountSetId: string): Currency | null {
  const db = getDb()
  const byFlag = db
    .prepare(`SELECT * FROM currencies WHERE account_set_id = ? AND is_base = 1 LIMIT 1`)
    .get(accountSetId) as Currency | undefined
  if (byFlag) return byFlag

  const param = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = 'base_currency' LIMIT 1`
    )
    .get(accountSetId) as { param_value?: string } | undefined
  const code = normalizeCurrencyCode(param?.param_value || 'RMB')
  return getCurrencyByCode(accountSetId, code)
}

export function isForeignCurrencyEnabled(accountSetId: string): boolean {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = 'enable_foreign_currency' LIMIT 1`
    )
    .get(accountSetId) as { param_value?: string } | undefined
  return row?.param_value === 'true'
}

export function createCurrency(data: {
  account_set_id: string
  code: string
  name?: string
  is_base?: boolean
  default_rate?: number
  begin_rate?: number
  end_rate?: number
  rate_decimals?: number
  is_enabled?: boolean
  sort_order?: number
}): Currency {
  const db = getDb()
  const code = normalizeCurrencyCode(data.code)
  if (!code) throw new Error('币种编码不能为空')
  if (getCurrencyByCode(data.account_set_id, code)) {
    throw new Error(`币种 ${code} 已存在`)
  }

  const isBase = data.is_base ? 1 : 0
  if (isBase) {
    db.prepare(`UPDATE currencies SET is_base = 0 WHERE account_set_id = ?`).run(data.account_set_id)
  }

  const id = uuidv4()
  const now = new Date().toISOString()
  const name = (data.name || '').trim() || CURRENCY_NAME_MAP[code] || code
  // 默认汇率：优先显式值，其次期末汇率；本位币恒为 1
  const endRate = isBase ? 1 : normalizeRate(data.end_rate ?? data.default_rate, 1)
  const beginRate = isBase ? 1 : normalizeRate(data.begin_rate ?? data.default_rate, endRate)
  const defaultRate = isBase ? 1 : normalizeRate(data.default_rate, endRate)
  const rateDecimals = Math.max(0, Math.min(8, Number(data.rate_decimals ?? 4)))

  db.prepare(
    `INSERT INTO currencies (
      id, account_set_id, code, name, is_base, default_rate, begin_rate, end_rate, rate_decimals, is_enabled, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.account_set_id,
    code,
    name,
    isBase,
    defaultRate,
    beginRate,
    endRate,
    rateDecimals,
    data.is_enabled === false ? 0 : 1,
    data.sort_order ?? 0,
    now,
    now
  )

  return getCurrencyByCode(data.account_set_id, code)!
}

export function updateCurrency(
  id: string,
  accountSetId: string,
  data: {
    name?: string
    is_base?: boolean
    default_rate?: number
    begin_rate?: number
    end_rate?: number
    rate_decimals?: number
    is_enabled?: boolean
    sort_order?: number
  }
): void {
  const db = getDb()
  const existing = db
    .prepare(`SELECT * FROM currencies WHERE id = ? AND account_set_id = ?`)
    .get(id, accountSetId) as Currency | undefined
  if (!existing) throw new Error('币种不存在')

  if (data.is_base) {
    db.prepare(`UPDATE currencies SET is_base = 0 WHERE account_set_id = ?`).run(accountSetId)
  }

  const willBeBase = data.is_base === undefined ? !!existing.is_base : !!data.is_base
  if (data.begin_rate !== undefined && !(Number(data.begin_rate) > 0)) throw new Error('年初汇率必须大于 0')
  if (data.end_rate !== undefined && !(Number(data.end_rate) > 0)) throw new Error('期末汇率必须大于 0')

  db.prepare(
    `UPDATE currencies SET
      name = COALESCE(?, name),
      is_base = COALESCE(?, is_base),
      default_rate = COALESCE(?, default_rate),
      begin_rate = COALESCE(?, begin_rate),
      end_rate = COALESCE(?, end_rate),
      rate_decimals = COALESCE(?, rate_decimals),
      is_enabled = COALESCE(?, is_enabled),
      sort_order = COALESCE(?, sort_order),
      updated_at = datetime('now')
    WHERE id = ? AND account_set_id = ?`
  ).run(
    data.name !== undefined ? String(data.name).trim() : null,
    data.is_base === undefined ? null : data.is_base ? 1 : 0,
    willBeBase ? 1 : data.default_rate !== undefined ? Number(data.default_rate) : null,
    willBeBase ? 1 : data.begin_rate !== undefined ? Number(data.begin_rate) : null,
    willBeBase ? 1 : data.end_rate !== undefined ? Number(data.end_rate) : null,
    data.rate_decimals !== undefined
      ? Math.max(0, Math.min(8, Number(data.rate_decimals)))
      : null,
    data.is_enabled === undefined ? null : data.is_enabled ? 1 : 0,
    data.sort_order !== undefined ? Number(data.sort_order) : null,
    id,
    accountSetId
  )
}

export function deleteCurrency(id: string, accountSetId: string): void {
  const db = getDb()
  const existing = db
    .prepare(`SELECT * FROM currencies WHERE id = ? AND account_set_id = ?`)
    .get(id, accountSetId) as Currency | undefined
  if (!existing) throw new Error('币种不存在')
  if (existing.is_base) throw new Error('本位币不能删除')

  const usedByAccount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM accounts WHERE account_set_id = ? AND UPPER(currency_code) = ?`
    )
    .get(accountSetId, normalizeCurrencyCode(existing.code)) as { c: number }
  if (usedByAccount.c > 0) {
    throw new Error(`币种 ${existing.code} 已被科目引用，不能删除`)
  }

  const usedByEntry = db
    .prepare(
      `SELECT COUNT(*) AS c FROM voucher_entries WHERE account_set_id = ? AND UPPER(currency_code) = ?`
    )
    .get(accountSetId, normalizeCurrencyCode(existing.code)) as { c: number }
  if (usedByEntry.c > 0) {
    throw new Error(`币种 ${existing.code} 已被凭证分录引用，不能删除`)
  }

  // FIX-260：出纳日记账 / 出纳期初也按币种分账，被引用的币种同样不能删
  const hasTable = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)
  for (const [table, label] of [['cashier_journal', '出纳日记账'], ['cashier_init_balance', '出纳期初余额']] as const) {
    if (!hasTable(table)) continue
    const used = db
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE account_set_id = ? AND UPPER(currency) = ?`)
      .get(accountSetId, normalizeCurrencyCode(existing.code)) as { c: number }
    if (used.c > 0) throw new Error(`币种 ${existing.code} 已被${label}引用，不能删除`)
  }

  db.prepare(`DELETE FROM exchange_rates WHERE account_set_id = ? AND UPPER(currency_code) = ?`).run(
    accountSetId,
    normalizeCurrencyCode(existing.code)
  )
  db.prepare(`DELETE FROM currencies WHERE id = ? AND account_set_id = ?`).run(id, accountSetId)
}

export function listExchangeRates(
  accountSetId: string,
  options: { currencyCode?: string; year?: number } = {}
): ExchangeRate[] {
  const db = getDb()
  const where: string[] = ['account_set_id = ?']
  const params: Array<string | number> = [accountSetId]
  if (options.currencyCode) {
    where.push('UPPER(currency_code) = ?')
    params.push(normalizeCurrencyCode(options.currencyCode))
  }
  if (options.year != null) {
    where.push('year = ?')
    params.push(Number(options.year))
  }
  return db
    .prepare(
      `SELECT * FROM exchange_rates WHERE ${where.join(' AND ')}
       ORDER BY currency_code ASC, year DESC, period DESC`
    )
    .all(...params) as ExchangeRate[]
}

export function upsertExchangeRate(data: {
  account_set_id: string
  currency_code: string
  year: number
  period: number
  rate: number
  closing_rate?: number | null
}): ExchangeRate {
  const db = getDb()
  const code = normalizeCurrencyCode(data.currency_code)
  const currency = getCurrencyByCode(data.account_set_id, code)
  if (!currency) throw new Error(`币种 ${code} 不存在`)
  if (currency.is_base) throw new Error('本位币无需维护汇率')

  const year = Number(data.year)
  const period = Number(data.period)
  if (!Number.isInteger(year) || year < 1900) throw new Error('会计年度无效')
  if (!Number.isInteger(period) || period < 1 || period > 12) throw new Error('会计期间无效')
  const rate = Number(data.rate)
  if (!(rate > 0)) throw new Error('汇率必须大于 0')

  const existing = db
    .prepare(
      `SELECT id FROM exchange_rates
       WHERE account_set_id = ? AND UPPER(currency_code) = ? AND year = ? AND period = ?`
    )
    .get(data.account_set_id, code, year, period) as { id?: string } | undefined

  const closing =
    data.closing_rate === undefined || data.closing_rate === null
      ? null
      : Number(data.closing_rate)

  if (existing?.id) {
    db.prepare(
      `UPDATE exchange_rates
       SET rate = ?, closing_rate = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(rate, closing, existing.id)
    return db.prepare(`SELECT * FROM exchange_rates WHERE id = ?`).get(existing.id) as ExchangeRate
  }

  const id = uuidv4()
  db.prepare(
    `INSERT INTO exchange_rates (
      id, account_set_id, currency_code, year, period, rate, closing_rate, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(id, data.account_set_id, code, year, period, rate, closing)
  return db.prepare(`SELECT * FROM exchange_rates WHERE id = ?`).get(id) as ExchangeRate
}

export function deleteExchangeRate(id: string, accountSetId: string): void {
  const db = getDb()
  const result = db
    .prepare(`DELETE FROM exchange_rates WHERE id = ? AND account_set_id = ?`)
    .run(id, accountSetId)
  if (result.changes === 0) throw new Error('汇率记录不存在')
}

/**
 * 解析指定期间汇率：
 * 本期 exchange_rates.rate → currencies.end_rate（外币类型页维护的期末汇率）→ 同币种最近一期 → default_rate → 1
 * 期末汇率排在「最近一期」之前：外币类型页上看到的期末汇率就是凭证默认汇率，不会被历史期间的旧汇率盖住。
 */
export function resolveExchangeRate(
  accountSetId: string,
  currencyCode: string,
  year: number,
  period: number
): number {
  const db = getDb()
  const code = normalizeCurrencyCode(currencyCode)
  if (!code) return 1

  const currency = getCurrencyByCode(accountSetId, code)
  if (currency?.is_base) return 1

  const exact = db
    .prepare(
      `SELECT rate FROM exchange_rates
       WHERE account_set_id = ? AND UPPER(currency_code) = ? AND year = ? AND period = ?`
    )
    .get(accountSetId, code, year, period) as { rate?: number } | undefined
  if (exact?.rate != null && Number(exact.rate) > 0) return Number(exact.rate)

  if (currency?.end_rate != null && Number(currency.end_rate) > 0) {
    return Number(currency.end_rate)
  }

  const nearest = db
    .prepare(
      `SELECT rate FROM exchange_rates
       WHERE account_set_id = ? AND UPPER(currency_code) = ?
         AND (year < ? OR (year = ? AND period <= ?))
       ORDER BY year DESC, period DESC
       LIMIT 1`
    )
    .get(accountSetId, code, year, year, period) as { rate?: number } | undefined
  if (nearest?.rate != null && Number(nearest.rate) > 0) return Number(nearest.rate)

  if (currency?.default_rate != null && Number(currency.default_rate) > 0) {
    return Number(currency.default_rate)
  }
  return 1
}

export interface CurrencySettings {
  /** 汇兑损益科目编码（期末调汇用，暂只保存配置） */
  exchange_gain_account_code: string | null
  exchange_gain_account_name: string | null
}

const EXCHANGE_GAIN_PARAM_KEY = 'exchange_gain_account_code'

export function getCurrencySettings(accountSetId: string): CurrencySettings {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = ? LIMIT 1`
    )
    .get(accountSetId, EXCHANGE_GAIN_PARAM_KEY) as { param_value?: string } | undefined
  const code = String(row?.param_value || '').trim() || null
  let name: string | null = null
  if (code) {
    const acc = db
      .prepare(`SELECT name FROM accounts WHERE account_set_id = ? AND code = ? LIMIT 1`)
      .get(accountSetId, code) as { name?: string } | undefined
    name = acc?.name || null
  }
  return { exchange_gain_account_code: code, exchange_gain_account_name: name }
}

export function saveCurrencySettings(
  accountSetId: string,
  data: { exchange_gain_account_code?: string | null }
): CurrencySettings {
  const db = getDb()
  const code = String(data.exchange_gain_account_code || '').trim()
  if (code) {
    const acc = db
      .prepare(`SELECT id FROM accounts WHERE account_set_id = ? AND code = ? LIMIT 1`)
      .get(accountSetId, code) as { id?: string } | undefined
    if (!acc?.id) throw new Error(`汇兑损益科目 ${code} 不存在`)
    assertLeafAccountCode(db, accountSetId, code, '汇兑损益科目')
  }
  upsertAccountSetSystemParam(db, accountSetId, EXCHANGE_GAIN_PARAM_KEY, code, '汇兑损益科目')
  return getCurrencySettings(accountSetId)
}

/** 幂等写入币种（ACD 导入 / 建账用） */
export function upsertCurrencyRow(data: {
  account_set_id: string
  code: string
  name?: string
  is_base?: boolean
  default_rate?: number
  begin_rate?: number
  end_rate?: number
  rate_decimals?: number
  sort_order?: number
}): Currency {
  const existing = getCurrencyByCode(data.account_set_id, data.code)
  if (existing) {
    updateCurrency(existing.id, data.account_set_id, {
      name: data.name,
      is_base: data.is_base,
      default_rate: data.default_rate,
      begin_rate: data.begin_rate,
      end_rate: data.end_rate,
      rate_decimals: data.rate_decimals,
      sort_order: data.sort_order,
      is_enabled: true,
    })
    return getCurrencyByCode(data.account_set_id, data.code)!
  }
  return createCurrency(data)
}
