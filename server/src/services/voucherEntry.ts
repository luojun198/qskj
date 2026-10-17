import { v4 as uuidv4 } from 'uuid'
import type { Database } from 'better-sqlite3'
import { buildBatchVoucherQuery } from './voucherQuery.js'
import type { AccountScopeContext } from './accountAuthorization.js'
import { getVoucherUndeletableReason } from './voucherDelete.js'
import { yuanToCents, centsToYuan, MONEY_EPSILON } from '../utils/amountUtils.js'
import {
  accountHasAuxAccounting,
  extractEntryAuxSelections,
  parseAccountAuxCategoryIds,
} from '../utils/auxItemId.js'
import { AUX_LEGACY_COLUMNS } from '../utils/auxLedgerQuery.js'
import {
  getAccountRealtimeBalance,
  getAccountRealtimeAuxBalance,
} from './accountRealtimeBalance.js'

export interface VoucherEntryInput {
  account_id: string
  account_code: string
  account_name: string
  direction: 'debit' | 'credit'
  amount: number
  summary?: string
  cash_flow_code?: string | null
  cash_flow_name?: string | null
  currency_code?: string | null
  exchange_rate?: number | null
  foreign_amount?: number | null
  quantity?: number | null
  unit_price?: number | null
  unit?: string | null
  dept_id?: string | null
  dept_name?: string | null
  project_id?: string | null
  project_name?: string | null
  supplier_id?: string | null
  supplier_name?: string | null
  person_id?: string | null
  person_name?: string | null
  func_class_id?: string | null
  func_class_name?: string | null
  [key: string]: unknown
}

/** 分录 INSERT 列数（须与 buildVoucherEntryPayloads 返回值长度一致） */
export const VOUCHER_ENTRY_INSERT_PARAM_COUNT = 30

export const VOUCHER_ENTRY_INSERT_SQL = `
  INSERT INTO voucher_entries (
    id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
    direction, amount, amount_cents, summary,
    dept_id, dept_name, project_id, project_name,
    supplier_id, supplier_name, person_id, person_name,
    func_class_id, func_class_name, aux_data,
    cash_flow_code, cash_flow_name,
    currency_code, exchange_rate, foreign_amount,
    quantity, unit_price, unit
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

export interface AuxCategoryLike {
  id: string
  code: string
}

export interface AuxItemLike {
  id: string
  name?: string | null
}

export function validateVoucherEntryCount(entries: unknown) {
  if (!Array.isArray(entries) || entries.length < 2) {
    return '凭证日期和分录不能为空'
  }
  return null
}

/**
 * FIX-010 / P1-14：分录金额合法性校验
 *
 * 规则（自「凭证冲红」功能起放开负数）：
 *   1) 金额必须是有限数（拒绝 NaN / Infinity）
 *   2) 金额不得为 0（0 元分录没有业务含义）
 *   3) 金额**允许为负**——红字（冲红）凭证保持原方向、金额取负，
 *      借贷平衡由整数分域的 calculateVoucherTotalsCents 判定，负数天然可平
 *   4) 金额绝对值不得超过 MAX_ENTRY_AMOUNT（默认 1e12 元 = 1 万亿，防止误输入 1e15+ 的明显错误）
 *
 * ⚠️ 适用范围：**仅手工录入/修改凭证的 API**（routes/voucher.ts 里带 voucher:entry 权限的
 * 4 个端点）。数据导入（ACD 导入等）走的是「按原始数据落库」口径，仍**不得**调用本函数——
 * 源账套里可能存在 0 元分录，必须原样保留，否则发生额和余额会与原软件对不上。
 * 详见 FIX-072 / importAcdToCurrentAccountSet.ts 的 mapAcdEntryAmount。
 *
 * 返回错误消息字符串，无问题返回 null。
 */
export const MAX_ENTRY_AMOUNT = 1e12

export function validateVoucherEntryAmounts(entries: VoucherEntryInput[]): string | null {
  if (!Array.isArray(entries)) return null
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const amount = Number(entry?.amount)
    const seq = i + 1
    const accName = entry?.account_name || entry?.account_code || `第${seq}行`
    if (!Number.isFinite(amount)) {
      return `第${seq}行【${accName}】金额无效（非有限数）`
    }
    if (yuanToCents(amount) === 0) {
      return `第${seq}行【${accName}】金额不能为 0`
    }
    if (Math.abs(amount) > MAX_ENTRY_AMOUNT) {
      return `第${seq}行【${accName}】金额 ${amount} 超过单笔上限（±${MAX_ENTRY_AMOUNT}），请确认是否输入错误`
    }
  }
  return null
}

/**
 * 构造冲红（红字）分录：**方向保持不变**，金额与 amount_cents 取负，其余字段原样保留。
 *
 * 会计口径说明：红字冲销不是"反方向蓝字"，而是同方向负数金额。这样明细账上能直接
 * 看到一笔红字发生额与原分录对冲，科目发生额、辅助核算余额都能正确抵减。
 * 原凭证平衡 ⇒ 整体取负后必然平衡（整数分域取负是线性的）。
 */
export function buildReversedEntries<T extends VoucherEntryInput>(entries: T[]): T[] {
  return entries.map(e => {
    const cents = (e as any).amount_cents
    const foreignAmount = (e as any).foreign_amount
    const quantity = (e as any).quantity
    return {
      ...e,
      amount: -Number(e.amount || 0),
      amount_cents:
        typeof cents === 'number' && Number.isFinite(cents)
          ? -cents
          : -yuanToCents(Number(e.amount) || 0),
      foreign_amount:
        foreignAmount == null || foreignAmount === ''
          ? foreignAmount
          : -Number(foreignAmount || 0),
      // 数量与金额同向取负；单价是比率不是可加量，保持原值
      quantity:
        quantity == null || quantity === '' ? quantity : -Number(quantity || 0),
    }
  })
}

export function validateVoucherDate(params: {
  voucherDate: string
  accountSetId: string
  db: { prepare: (sql: string) => { get: (...args: any[]) => any } }
}) {
  const { voucherDate, accountSetId, db } = params
  if (!voucherDate) return '凭证日期不能为空'

  const dateObj = new Date(voucherDate)
  if (isNaN(dateObj.getTime())) return '凭证日期格式无效'

  // FIX-018 / P2-23：凭证日期上限对齐错误消息的"当月最后一天"语义。
  // 旧实现 `new Date(year, month+1, day)` 等价于"次月同一天"，与错误消息不一致，
  // 实际放行了大量未来跨月凭证。
  // 正确做法：取本月最后一天（new Date(year, month+1, 0) → 月末）作为时间上限。
  const now = new Date()
  const maxFutureDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  if (dateObj > maxFutureDate) {
    const maxStr = `${maxFutureDate.getFullYear()}-${String(maxFutureDate.getMonth() + 1).padStart(2, '0')}-${String(maxFutureDate.getDate()).padStart(2, '0')}`
    return `凭证日期不能超过当月最后一天（当前：${voucherDate}，允许最晚：${maxStr}）`
  }

  const accountSet = db
    .prepare('SELECT start_date FROM account_sets WHERE id = ?')
    .get(accountSetId) as { start_date?: string | null } | undefined
  const startDate = accountSet?.start_date
  if (startDate && voucherDate < startDate) {
    return `凭证日期（${voucherDate}）不能早于账套启用日期（${startDate}）`
  }

  return null
}

/**
 * 取分录金额的整数 cents：优先使用 amount_cents（若客户端/DB 已提供），
 * 否则用 yuanToCents 将 amount 转为整数 cents（中间四舍五入到分）。
 * 用于借贷平衡比较，避免浮点累加误差（修复 P0-6，见 debug/修复日志.md FIX-001）
 */
function getEntryAmountCents(entry: VoucherEntryInput): number {
  // FIX-131：amount 是落库与过账的真实依据，平衡校验必须按它重算；
  // 客户端可自行传入的 amount_cents 不再优先，否则「amount 不平 + amount_cents 相等」可绕过校验。
  // 仅当 amount 缺失（如从 DB 读出的旧行只带 cents）时才回退到 amount_cents。
  const amount = Number(entry.amount)
  if (entry.amount !== undefined && entry.amount !== null && Number.isFinite(amount)) {
    return yuanToCents(amount)
  }
  const ac = (entry as any).amount_cents
  if (typeof ac === 'number' && Number.isFinite(ac) && Number.isInteger(ac)) {
    return ac
  }
  return 0
}

/**
 * 整数 cents 版本的合计：所有累加都在整数域，0 误差。
 * 借贷平衡的唯一权威算法。
 */
export function calculateVoucherTotalsCents(entries: VoucherEntryInput[]) {
  let debitCents = 0
  let creditCents = 0
  for (const entry of entries) {
    const c = getEntryAmountCents(entry)
    if (entry.direction === 'debit') debitCents += c
    else creditCents += c
  }
  return { debitCents, creditCents }
}

export function getVoucherBalanceError(entries: VoucherEntryInput[]) {
  const { debitCents, creditCents } = calculateVoucherTotalsCents(entries)
  if (debitCents !== creditCents) {
    return `借贷不平衡: 借方${centsToYuan(debitCents).toFixed(2)} != 贷方${centsToYuan(creditCents).toFixed(2)}`
  }
  return null
}

export function getVoucherUpdateBalanceError(entries: VoucherEntryInput[]) {
  // FIX-130：修改路径同样要求至少两条分录，否则 entries: [] 借 0 = 贷 0 通过后会清空整张凭证
  const countError = validateVoucherEntryCount(entries)
  if (countError) {
    return countError
  }
  if (!isVoucherBalanced(entries)) {
    return '借贷不平衡'
  }
  return null
}

/**
 * 元单位合计：仅供前端展示 / 凭证主表 total_amount 写入使用。
 * 注意：**严禁**用于借贷平衡判断（多笔分录浮点累加可能产生 > 0.005 误差）。
 * 判平衡请使用 calculateVoucherTotalsCents / getVoucherBalanceError。
 */
export function calculateVoucherTotals(entries: VoucherEntryInput[]) {
  const { debitCents, creditCents } = calculateVoucherTotalsCents(entries)
  return {
    debitTotal: centsToYuan(debitCents),
    creditTotal: centsToYuan(creditCents),
  }
}

export function isVoucherBalanced(entries: VoucherEntryInput[]) {
  const { debitCents, creditCents } = calculateVoucherTotalsCents(entries)
  return debitCents === creditCents
}

export interface DuplicateEntryWarning {
  accountName: string
  direction: string
  auxDesc: string
  count: number
}

export function findDuplicateEntries(entries: VoucherEntryInput[]): DuplicateEntryWarning[] {
  const seen = new Map<
    string,
    { accountName: string; direction: string; auxDesc: string; count: number }
  >()
  const warnings: DuplicateEntryWarning[] = []

  for (const entry of entries) {
    const auxParts: string[] = []
    const deptId = (entry as any).dept_id
    const projectId = (entry as any).project_id
    const supplierId = (entry as any).supplier_id
    const personId = (entry as any).person_id
    const funcClassId = (entry as any).func_class_id
    // FIX-011 / P1-15：现金流量项目编码也作为判重维度
    // 同账户同辅助但不同现金流量项目的两笔分录是合法业务（如同一银行账户对应不同流向），不应误判
    const cashFlowCode = (entry as any).cash_flow_code
    if (deptId) auxParts.push(`d:${deptId}`)
    if (projectId) auxParts.push(`p:${projectId}`)
    if (supplierId) auxParts.push(`s:${supplierId}`)
    if (personId) auxParts.push(`r:${personId}`)
    if (funcClassId) auxParts.push(`f:${funcClassId}`)
    if (cashFlowCode) auxParts.push(`c:${cashFlowCode}`)

    const key = `${entry.account_id}|${entry.direction}|${auxParts.join('|')}`
    const existing = seen.get(key)
    if (existing) {
      if (existing.count === 1) {
        warnings.push(existing)
      }
      existing.count++
    } else {
      const auxDesc = auxParts.length > 0 ? `（${auxParts.join(', ')}）` : ''
      seen.set(key, {
        accountName: entry.account_name,
        direction: entry.direction === 'debit' ? '借方' : '贷方',
        auxDesc,
        count: 1,
      })
    }
  }

  return warnings
}

function resolveCashFlowFields(
  db: Database,
  accountSetId: string,
  entry: VoucherEntryInput
): { code: string | null; name: string | null } {
  const code = (entry.cash_flow_code || '').trim() || null
  if (!code) return { code: null, name: null }
  const nameFromClient = (entry.cash_flow_name || '').trim()
  if (nameFromClient) return { code, name: nameFromClient }
  const row = db
    .prepare(
      `SELECT name FROM cash_flow_items WHERE account_set_id = ? AND code = ? AND is_active = 1 LIMIT 1`
    )
    .get(accountSetId, code) as { name?: string } | undefined
  return { code, name: row?.name || code }
}

export function buildVoucherEntryPayloads(params: {
  db?: Database
  accountSetId: string
  voucherId: string
  entries: VoucherEntryInput[]
  categories: AuxCategoryLike[]
  itemMap: Record<string, AuxItemLike>
}) {
  // 提交里没带 account_code / account_name（只传了 account_id）时按科目补齐，避免 NOT NULL 约束报「有必填项未填写」
  const accountCache = new Map<string, { code: string; name: string } | null>()
  const lookupAccount = (id: unknown) => {
    if (!params.db || typeof id !== 'string' || !id) return null
    if (!accountCache.has(id)) {
      accountCache.set(
        id,
        (params.db
          .prepare('SELECT code, name FROM accounts WHERE id = ? AND account_set_id = ?')
          .get(id, params.accountSetId) as { code: string; name: string } | undefined) || null
      )
    }
    return accountCache.get(id) ?? null
  }
  return params.entries.map((entry, index) => {
    const acc = !entry.account_code || !entry.account_name ? lookupAccount(entry.account_id) : null
    const auxData: Record<
      string,
      { id: string; name: string; field_values?: Record<string, string> }
    > = {}
    for (const category of params.categories) {
      const dynamicFieldKey = `_${category.code}_id`
      const itemId = entry[dynamicFieldKey]
      if (typeof itemId === 'string' && itemId) {
        const item = params.itemMap[itemId]
        auxData[category.code] = { id: itemId, name: item?.name || '' }
        // 收集自定义字段值
        const fields = (category as any).fields || []
        const voucherFieldValues: Record<string, string> = {}
        for (const field of fields) {
          if (!field.show_in_voucher || field.is_enabled === 0) continue
          const fvKey = `_${category.code}_fv_${field.field_key}`
          const fvValue = entry[fvKey]
          if (fvValue !== undefined && fvValue !== null && fvValue !== '') {
            voucherFieldValues[field.field_key] = String(fvValue)
          }
        }
        if (Object.keys(voucherFieldValues).length > 0) {
          auxData[category.code].field_values = voucherFieldValues
        }
      }
    }

    const fixedFields: Record<string, string | null> = {}
    for (const category of params.categories) {
      const dynamicFieldKey = `_${category.code}_id`
      const fixedFieldKey = `${category.code}_id`
      const itemId = entry[dynamicFieldKey] || entry[fixedFieldKey]
      const legacy = AUX_LEGACY_COLUMNS[category.code]
      const storageIdKey = legacy?.id ?? fixedFieldKey
      const storageNameKey = legacy?.name ?? `${category.code}_name`
      if (typeof itemId === 'string' && itemId) {
        const item = params.itemMap[itemId]
        fixedFields[storageIdKey] = itemId
        fixedFields[storageNameKey] = item?.name || ''
      } else {
        fixedFields[storageIdKey] = null
        fixedFields[storageNameKey] = null
      }
    }

    const cashFlow =
      params.db != null
        ? resolveCashFlowFields(params.db, params.accountSetId, entry)
        : {
            code: (entry.cash_flow_code || '').trim() || null,
            name: (entry.cash_flow_name || '').trim() || null,
          }

    const fx = resolveForeignCurrencyFields(entry)
    const qty = resolveQuantityFields(entry)

    return [
      uuidv4(),
      params.accountSetId,
      params.voucherId,
      index + 1,
      entry.account_id,
      entry.account_code || acc?.code,
      entry.account_name || acc?.name,
      entry.direction,
      entry.amount,
      yuanToCents(entry.amount),
      entry.summary || null,
      fixedFields.dept_id || entry.dept_id || null,
      fixedFields.dept_name || entry.dept_name || null,
      fixedFields.project_id || entry.project_id || null,
      fixedFields.project_name || entry.project_name || null,
      fixedFields.supplier_id || entry.supplier_id || null,
      fixedFields.supplier_name || entry.supplier_name || null,
      fixedFields.person_id || entry.person_id || null,
      fixedFields.person_name || entry.person_name || null,
      fixedFields.func_class_id || entry.func_class_id || null,
      fixedFields.func_class_name || entry.func_class_name || null,
      Object.keys(auxData).length > 0 ? JSON.stringify(auxData) : null,
      cashFlow.code,
      cashFlow.name,
      fx.currencyCode,
      fx.exchangeRate,
      fx.foreignAmount,
      qty.quantity,
      qty.unitPrice,
      qty.unit,
    ]
  })
}

export function isCashFlowEnabledForAccountSet(db: Database, accountSetId: string): boolean {
  const row = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = 'enable_cash_flow' LIMIT 1`
    )
    .get(accountSetId) as { param_value?: string } | undefined
  return row?.param_value === 'true'
}

export function isForeignCurrencyEnabledForAccountSet(db: Database, accountSetId: string): boolean {
  const row = db
    .prepare(
      `SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = 'enable_foreign_currency' LIMIT 1`
    )
    .get(accountSetId) as { param_value?: string } | undefined
  return row?.param_value === 'true'
}

/** 规范化分录外币三字段；无原币时全部置空 */
export function resolveForeignCurrencyFields(entry: VoucherEntryInput): {
  currencyCode: string | null
  exchangeRate: number | null
  foreignAmount: number | null
} {
  const currencyCode = String(entry.currency_code || '')
    .trim()
    .toUpperCase() || null
  const exchangeRateRaw = entry.exchange_rate
  const foreignAmountRaw = entry.foreign_amount
  const exchangeRate =
    exchangeRateRaw == null || exchangeRateRaw === ('' as any)
      ? null
      : Number(exchangeRateRaw)
  const foreignAmount =
    foreignAmountRaw == null || foreignAmountRaw === ('' as any)
      ? null
      : Number(foreignAmountRaw)

  if (
    !currencyCode ||
    foreignAmount == null ||
    !Number.isFinite(foreignAmount) ||
    Math.abs(foreignAmount) < 1e-9
  ) {
    return { currencyCode: null, exchangeRate: null, foreignAmount: null }
  }

  return {
    currencyCode,
    exchangeRate:
      exchangeRate != null && Number.isFinite(exchangeRate) && exchangeRate > 0
        ? exchangeRate
        : null,
    foreignAmount,
  }
}

// 现金流量项目不再由凭证录入指定、也不再必填：现金流量表按「基础资料 → 科目现金流量项目」
// 自动推算（services/cashFlowAutoEngine.ts）。分录上的 cash_flow_code 仅作历史数据保留。

/** 账套已启用的外币编码（不含本位币）。表不存在时返回 null，跳过「必须在外币类型中」的校验。 */
function listEnabledForeignCurrencyCodes(db: Database, accountSetId: string): Set<string> | null {
  try {
    const has = db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='currencies'`)
      .get() as { ok?: number } | undefined
    if (!has) return null
    const rows = db
      .prepare(
        `SELECT code FROM currencies
         WHERE account_set_id = ? AND COALESCE(is_base, 0) = 0 AND COALESCE(is_enabled, 1) = 1`
      )
      .all(accountSetId) as Array<{ code: string }>
    return new Set(
      rows.map(r => String(r.code || '').trim().toUpperCase()).filter(Boolean)
    )
  } catch {
    return null
  }
}

/** 启用外币核算时，校验外币科目分录的原币/汇率。科目上的币种只作缺省，凭证可选账套内任一外币。 */
export function validateVoucherEntriesForeignCurrency(
  db: Database,
  accountSetId: string,
  entries: VoucherEntryInput[]
): string | null {
  if (!isForeignCurrencyEnabledForAccountSet(db, accountSetId)) return null

  const accountStmt = db.prepare(
    `SELECT name, is_foreign, currency_code FROM accounts WHERE id = ? AND account_set_id = ?`
  )
  const allowed = listEnabledForeignCurrencyCodes(db, accountSetId)

  for (const entry of entries) {
    if (!entry.account_id || !entry.amount) continue
    const account = accountStmt.get(entry.account_id, accountSetId) as
      | { name: string; is_foreign: number; currency_code: string | null }
      | undefined
    if (!account) continue

    if (Number(account.is_foreign) === 1) {
      const defaultCode = String(account.currency_code || '').trim().toUpperCase()
      const chosen = String(entry.currency_code || defaultCode || '')
        .trim()
        .toUpperCase()
      if (!chosen) {
        return `外币科目【${account.name}】请选择币种`
      }
      const fx = resolveForeignCurrencyFields({ ...entry, currency_code: chosen })
      if (!fx.foreignAmount) {
        return `外币科目【${account.name}】须填写原币金额`
      }
      if (!fx.exchangeRate || !(fx.exchangeRate > 0)) {
        return `外币科目【${account.name}】须填写大于 0 的汇率`
      }
      if (allowed && allowed.size > 0 && !allowed.has(chosen)) {
        return `外币科目【${account.name}】币种「${chosen}」不在本账套外币类型中，请到「外币类型」中维护`
      }
      if (!entry.currency_code) entry.currency_code = chosen
    } else {
      const fx = resolveForeignCurrencyFields(entry)
      if (fx.foreignAmount || fx.currencyCode || fx.exchangeRate) {
        // 非外币科目不允许带外币字段（写入时也会清空，这里仅提示）
        return `科目【${account.name}】未启用外币核算，不能填写原币金额`
      }
    }
  }
  return null
}

/** 数量核算金额与数量的允许误差（元） */
const QUANTITY_AMOUNT_TOLERANCE = 0.01

/**
 * 规范化分录数量三字段；无数量时全部置空。
 *
 * 与 resolveForeignCurrencyFields 对称：数量是「是否走数量核算」的开关字段，
 * 数量为空或 0 时单价、单位一并清空，避免非数量科目残留脏值。
 */
export function resolveQuantityFields(entry: VoucherEntryInput): {
  quantity: number | null
  unitPrice: number | null
  unit: string | null
} {
  const quantityRaw = entry.quantity
  const unitPriceRaw = entry.unit_price
  const quantity =
    quantityRaw == null || quantityRaw === ('' as any) ? null : Number(quantityRaw)
  const unitPrice =
    unitPriceRaw == null || unitPriceRaw === ('' as any) ? null : Number(unitPriceRaw)
  const unit = String(entry.unit || '').trim() || null

  if (quantity == null || !Number.isFinite(quantity) || Math.abs(quantity) < 1e-9) {
    return { quantity: null, unitPrice: null, unit: null }
  }

  return {
    quantity,
    unitPrice: unitPrice != null && Number.isFinite(unitPrice) ? unitPrice : null,
    unit,
  }
}

/**
 * 分录科目必须是末级科目（有下级科目的父科目不能直接记账）。
 *
 * 前端选择器已过滤父科目，但后端是最终防线：资产、进销存、出纳等自动生成路径不经前端，
 * 余额表按末级汇总父科目，直接记在父科目上的金额不会出现在任何报表里，造成试算不平。
 */
export function validateVoucherEntriesLeafAccount(
  db: Database,
  accountSetId: string,
  entries: Array<{ account_id?: string | null; account_code?: string | null }>
): string | null {
  const stmt = db.prepare(
    `SELECT code, name FROM accounts a WHERE a.id = ? AND a.account_set_id = ?
       AND EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id)`
  )
  for (const entry of entries) {
    if (!entry.account_id) continue
    const parent = stmt.get(entry.account_id, accountSetId) as { code: string; name: string } | undefined
    if (parent) return `科目【${parent.code} ${parent.name}】有下级科目，不能直接记账，请选择末级科目`
  }
  return null
}

/**
 * 数量核算科目分录校验。
 *
 * 规则（对应需求「必须输入数量，金额单价 2 选 1 输入」）：
 *   1) 数量核算科目必须填数量；
 *   2) 单价与金额至少填一个（前端会用另一个反算，这里兜底）；
 *   3) 两者都有时，数量 × 单价 必须与金额相符（容差 1 分）；
 *   4) 非数量核算科目不得携带数量/单价。
 *
 * 与外币不同：数量核算没有账套级总开关，始终生效。
 */
export function validateVoucherEntriesQuantity(
  db: Database,
  accountSetId: string,
  entries: VoucherEntryInput[]
): string | null {
  const accountStmt = db.prepare(
    `SELECT name, is_quantity, quantity_unit FROM accounts WHERE id = ? AND account_set_id = ?`
  )

  for (const entry of entries) {
    if (!entry.account_id || !entry.amount) continue
    const account = accountStmt.get(entry.account_id, accountSetId) as
      | { name: string; is_quantity: number; quantity_unit: string | null }
      | undefined
    if (!account) continue

    const qty = resolveQuantityFields(entry)
    const amount = Number(entry.amount) || 0

    if (Number(account.is_quantity) === 1) {
      if (qty.quantity == null) {
        return `数量核算科目【${account.name}】须填写数量`
      }
      if (qty.unitPrice == null && !amount) {
        return `数量核算科目【${account.name}】须填写单价或金额`
      }
      if (qty.unitPrice != null && amount) {
        if (Math.abs(qty.quantity * qty.unitPrice - amount) > QUANTITY_AMOUNT_TOLERANCE) {
          return `数量核算科目【${account.name}】数量×单价与金额不符`
        }
      }
    } else if (qty.quantity != null || qty.unitPrice != null) {
      // 非数量核算科目不允许带数量字段（写入时也会清空，这里仅提示）
      return `科目【${account.name}】未启用数量核算，不能填写数量`
    }
  }
  return null
}

export interface AiConfigLike {
  enabled?: number | boolean | null
  api_key?: string | null
  api_url?: string | null
  model?: string | null
}

export interface AiSummaryEntryLike {
  account_name?: string | null
  direction?: string | null
  amount?: number | null
}

export function isAiSummaryEnabled(aiConfig: AiConfigLike | null | undefined) {
  return Boolean(aiConfig?.enabled && aiConfig?.api_key)
}

export function buildAiSummaryEntryText(entries: AiSummaryEntryLike[]) {
  return entries
    .map(
      entry =>
        `${entry.account_name || ''}: ${entry.direction === 'debit' ? '借' : '贷'} ${entry.amount ?? ''}`
    )
    .join('\n')
}

export function buildAiSummaryRequestBody(params: { model?: string | null; entryText: string }) {
  return {
    model: params.model || 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: '你是一个财务助手，根据凭证分录生成简洁的中文业务摘要（10个字以内）。',
      },
      { role: 'user', content: `根据以下凭证分录生成摘要：\n${params.entryText}` },
    ],
    max_tokens: 50,
    temperature: 0.3,
  }
}

export function getAiSummaryApiUrl(aiConfig: AiConfigLike | null | undefined) {
  return aiConfig?.api_url || 'https://api.openai.com/v1/chat/completions'
}

export function extractAiSummary(data: any) {
  return data?.choices?.[0]?.message?.content?.trim() || '业务发生'
}

export function getEffectiveVoucherTypeId(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any }
  }
  accountSetId: string
  year: number
  period: number
  voucherTypeId?: string | null
}) {
  if (params.voucherTypeId) {
    return params.voucherTypeId
  }

  const lastVoucher = params.db
    .prepare(
      `SELECT voucher_type_id
       FROM vouchers
       WHERE account_set_id=? AND year=? AND period=? AND voucher_type_id IS NOT NULL
       ORDER BY datetime(created_at) DESC, datetime(updated_at) DESC, voucher_date DESC, voucher_no DESC
       LIMIT 1`
    )
    .get(params.accountSetId, params.year, params.period) as any
  if (lastVoucher?.voucher_type_id) {
    return lastVoucher.voucher_type_id
  }

  const firstType = params.db
    .prepare(
      `SELECT id
       FROM voucher_types
       WHERE account_set_id=? OR account_set_id IS NULL
       ORDER BY
         CASE WHEN account_set_id=? THEN 0 ELSE 1 END,
         CASE WHEN code IS NOT NULL AND code != '' AND code NOT GLOB '*[^0-9]*' THEN 0 ELSE 1 END,
         CASE WHEN code IS NOT NULL AND code != '' AND code NOT GLOB '*[^0-9]*' THEN CAST(code AS INTEGER) END,
         code COLLATE NOCASE ASC,
         sort_order ASC
       LIMIT 1`
    )
    .get(params.accountSetId, params.accountSetId) as any
  return firstType?.id || null
}

/**
 * 业务凭证「本次指定的凭证类型」：空值返回 null（交给模块默认参数 / 自动规则）；
 * 非空必须是本账套或公共的凭证类型，否则抛错（调用方转 400）。
 */
export function normalizeRequestedVoucherTypeId(
  db: { prepare: (sql: string) => { get: (...args: any[]) => any } },
  accountSetId: string,
  raw: unknown,
): string | null {
  const id = raw == null ? '' : String(raw).trim()
  if (!id) return null
  const hit = db.prepare('SELECT id FROM voucher_types WHERE id=? AND (account_set_id=? OR account_set_id IS NULL)').get(id, accountSetId)
  if (!hit) throw new Error('凭证类型不存在，请重新选择')
  return id
}

/** SQL 表达式：从 voucher_no 提取序号（兼容「记-001」与纯数字） */
export const VOUCHER_NO_SEQ_SQL = `CAST(
  CASE
    WHEN INSTR(voucher_no, '-') > 0
    THEN SUBSTR(voucher_no, INSTR(voucher_no, '-') + 1)
    ELSE voucher_no
  END
  AS INTEGER
)`

export function parseVoucherNoSeq(voucherNo: string): number | null {
  const dashIndex = voucherNo.indexOf('-')
  const seqStr = dashIndex >= 0 ? voucherNo.substring(dashIndex + 1) : voucherNo
  const seq = parseInt(seqStr, 10)
  return Number.isNaN(seq) ? null : seq
}

export function buildVoucherNo(params: { maxNo?: number | null; typeName?: string }) {
  const nextSeq = (params.maxNo || 0) + 1
  if (params.typeName) {
    // 取类型名称的第一个字作为简称，如"记账凭证"→"记"
    const shortName = params.typeName.charAt(0)
    return `${shortName}-${String(nextSeq).padStart(3, '0')}`
  }
  // 无类型时使用纯序号，年月隔离由数据库唯一约束保证
  return String(nextSeq)
}

/** 查询指定账套·年度·期间·凭证类型下的最大序号 */
export function getMaxVoucherNoSeqInPeriod(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any }
  }
  accountSetId: string
  year: number
  period: number
  voucherTypeId?: string | null
}): number {
  const row = params.db
    .prepare(
      `SELECT MAX(${VOUCHER_NO_SEQ_SQL}) as max_no
       FROM vouchers
       WHERE account_set_id=? AND year=? AND period=?
         AND (voucher_type_id=? OR (voucher_type_id IS NULL AND ? IS NULL))`
    )
    .get(
      params.accountSetId,
      params.year,
      params.period,
      params.voucherTypeId ?? null,
      params.voucherTypeId ?? null
    ) as { max_no: number | null } | undefined

  return row?.max_no ?? 0
}

/** 检测同账套·同年·同月·同类型下凭证号是否已被占用 */
export function findVoucherNoConflict(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any }
  }
  accountSetId: string
  year: number
  period: number
  voucherTypeId?: string | null
  voucherNo: string
  excludeId?: string
}) {
  const sql = params.excludeId
    ? `SELECT id, voucher_no FROM vouchers
       WHERE account_set_id=? AND year=? AND period=? AND voucher_no=?
         AND (voucher_type_id=? OR (voucher_type_id IS NULL AND ? IS NULL))
         AND id<>?
       LIMIT 1`
    : `SELECT id, voucher_no FROM vouchers
       WHERE account_set_id=? AND year=? AND period=? AND voucher_no=?
         AND (voucher_type_id=? OR (voucher_type_id IS NULL AND ? IS NULL))
       LIMIT 1`

  const args = [
    params.accountSetId,
    params.year,
    params.period,
    params.voucherNo,
    params.voucherTypeId ?? null,
    params.voucherTypeId ?? null,
  ]
  if (params.excludeId) args.push(params.excludeId)

  return params.db.prepare(sql).get(...args) as { id: string; voucher_no: string } | undefined
}

export function getNextVoucherNo(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any }
  }
  accountSetId: string
  year: number
  period: number
  voucherTypeId?: string | null
}) {
  const effectiveTypeId = getEffectiveVoucherTypeId({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
    voucherTypeId: params.voucherTypeId,
  })

  // 获取凭证类型名称
  let typeName: string | null = null
  if (effectiveTypeId) {
    const type = params.db
      .prepare('SELECT name FROM voucher_types WHERE id=?')
      .get(effectiveTypeId) as any
    typeName = type?.name || null
  }

  // 按账套 + 年度 + 期间 + 凭证类型隔离编号，新期间从 1 重新开始
  const maxNo = getMaxVoucherNoSeqInPeriod({
    db: params.db,
    accountSetId: params.accountSetId,
    year: params.year,
    period: params.period,
    voucherTypeId: effectiveTypeId,
  })

  return {
    effectiveTypeId,
    typeName,
    voucherNo: buildVoucherNo({
      maxNo,
      typeName: typeName || undefined,
    }),
  }
}

export function getVoucherWithTypeById(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any }
  }
  voucherId: string
}) {
  return params.db
    .prepare(
      'SELECT v.*, vt.name as voucher_type_name FROM vouchers v LEFT JOIN voucher_types vt ON v.voucher_type_id=vt.id WHERE v.id=?'
    )
    .get(params.voucherId) as any
}

export function getVoucherEntries(params: {
  db: {
    prepare: (sql: string) => { all: (...args: any[]) => any[] }
  }
  voucherId: string
}) {
  return params.db
    .prepare('SELECT * FROM voucher_entries WHERE voucher_id=? ORDER BY seq')
    .all(params.voucherId) as any[]
}

export function getVoucherDetail(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any; all: (...args: any[]) => any[] }
  }
  voucherId: string
  /** FIX-136：传入时校验凭证归属账套，跨账套凭证视为不存在 */
  accountSetId?: string
}) {
  const voucher = getVoucherWithTypeById({
    db: params.db,
    voucherId: params.voucherId,
  })
  if (!voucher) {
    return null
  }
  if (params.accountSetId !== undefined && voucher.account_set_id !== params.accountSetId) {
    return null
  }

  return {
    ...(voucher as any),
    entries: getVoucherEntries({
      db: params.db,
      voucherId: params.voucherId,
    }),
  }
}

export function getVoucherById(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any }
  }
  voucherId: string
  // 传入则按账套过滤，跨账套的凭证一律视为不存在（多账套隔离）
  accountSetId?: string
}) {
  if (params.accountSetId != null) {
    return params.db
      .prepare('SELECT * FROM vouchers WHERE id=? AND account_set_id=?')
      .get(params.voucherId, params.accountSetId) as any
  }
  return params.db.prepare('SELECT * FROM vouchers WHERE id=?').get(params.voucherId) as any
}

export function isPostedVoucher(voucher: { status?: string } | null | undefined) {
  return voucher?.status === 'posted'
}

export function replaceVoucherEntries(params: {
  db: Database
  accountSetId: string
  voucherId: string
  entries: VoucherEntryInput[]
  categories: AuxCategoryLike[]
  itemMap: Record<string, AuxItemLike>
}) {
  params.db.prepare('DELETE FROM voucher_entries WHERE voucher_id=?').run(params.voucherId)
  const insertEntry = params.db.prepare(VOUCHER_ENTRY_INSERT_SQL)
  const entryPayloads = buildVoucherEntryPayloads({
    db: params.db,
    accountSetId: params.accountSetId,
    voucherId: params.voucherId,
    entries: params.entries,
    categories: params.categories,
    itemMap: params.itemMap,
  })

  entryPayloads.forEach(payload => {
    insertEntry.run(...payload)
  })
}

export function buildVoucherEntriesMap(
  entries: Array<{ voucher_id: string } & Record<string, any>>
) {
  const entriesMap: Record<string, any[]> = {}
  for (const entry of entries) {
    if (!entriesMap[entry.voucher_id]) entriesMap[entry.voucher_id] = []
    entriesMap[entry.voucher_id].push(entry)
  }
  return entriesMap
}

export function attachVoucherEntries<T extends { id: string }>(
  vouchers: T[],
  entriesMap: Record<string, any[]>
) {
  return vouchers.map(voucher => ({
    ...voucher,
    entries: entriesMap[voucher.id] || [],
  }))
}

export function calculateNewBalance(params: {
  currentBalance: number
  amount: number
  entryDirection: 'debit' | 'credit'
  accountDirection?: string | null
}) {
  const isSameDirection = params.accountDirection === params.entryDirection
  return params.currentBalance + (isSameDirection ? params.amount : -params.amount)
}

export interface NoNegativeAccountLike {
  id?: string
  no_negative?: number
  direction?: string | null
  parent_id?: string | null
  name?: string | null
}

export interface NoNegativeAuxCategoryLike {
  id: string
  code: string
  name?: string
}

export interface NoNegativeBalanceViolation {
  accountName: string
  auxCategoryName?: string
  auxItemName?: string
  projectedBalance: number
  /** 受上级科目约束时，上级科目名称 */
  constraintAccountName?: string
}

export interface NoNegativeBalanceCheckResult {
  message: string
  violations: NoNegativeBalanceViolation[]
}

export function buildNoNegativeBalanceSummaryMessage(
  violations: NoNegativeBalanceViolation[]
): string {
  if (violations.length === 0) return ''
  if (violations.length === 1) {
    const v = violations[0]
    const auxPart =
      v.auxCategoryName && v.auxItemName ? `核算项目【${v.auxCategoryName}：${v.auxItemName}】` : ''
    const hint = v.constraintAccountName ? `（受上级科目【${v.constraintAccountName}】约束）` : ''
    return `科目【${v.accountName}】${auxPart}${hint}余额不允许为负数，保存后余额将为 ${v.projectedBalance.toFixed(2)}`
  }
  return `共 ${violations.length} 项核算余额保存后将变为负数，无法保存凭证`
}

export function createRealtimeNoNegativeBalanceGetters(
  db: Database,
  params: {
    accountSetId: string
    year: number
    period: number
    categories: NoNegativeAuxCategoryLike[]
    excludeVoucherId?: string
  }
) {
  const categoryCodeById = new Map(params.categories.map(c => [c.id, c.code]))
  const categoryNameByCode = new Map(params.categories.map(c => [c.code, c.name?.trim() || c.code]))
  const itemNameStmt = db.prepare('SELECT name FROM aux_items WHERE id=? AND account_set_id=?')

  return {
    getBalanceByAccountId(accountId: string) {
      const row = getAccountRealtimeBalance(db, {
        accountId,
        accountSetId: params.accountSetId,
        year: params.year,
        period: params.period,
        excludeVoucherId: params.excludeVoucherId,
      })
      return row?.end_balance ?? 0
    },
    getAuxBalanceByCategory(accountId: string, categoryCode: string, itemId: string) {
      const acc = db.prepare('SELECT direction FROM accounts WHERE id=?').get(accountId) as
        | { direction: 'debit' | 'credit' }
        | undefined
      if (!acc) return 0
      const row = getAccountRealtimeAuxBalance(db, {
        accountId,
        accountSetId: params.accountSetId,
        year: params.year,
        period: params.period,
        categoryCode,
        itemId,
        accountDirection: acc.direction,
        excludeVoucherId: params.excludeVoucherId,
      })
      return row.end_balance
    },
    getAuxCategoryName(categoryCode: string) {
      return categoryNameByCode.get(categoryCode) || categoryCode
    },
    getAuxItemName(_categoryCode: string, itemId: string) {
      const row = itemNameStmt.get(itemId, params.accountSetId) as { name: string } | undefined
      return row?.name?.trim() || itemId
    },
    getEnabledCategoryCodesForAccount(account: { aux_types?: unknown }) {
      const enabledIds = parseAccountAuxCategoryIds(account.aux_types)
      return enabledIds
        .map(id => categoryCodeById.get(id))
        .filter((code): code is string => Boolean(code))
    },
  }
}

export function validateVoucherEntriesNoNegativeBalance(params: {
  entries: VoucherEntryInput[]
  getAccountById: (accountId: string) => NoNegativeAccountLike | null | undefined
  getBalanceByAccountId: (accountId: string) => number
  /** 按辅助类目 + 项目取实时余额（期初 + 全部凭证，与录入页展示一致） */
  getAuxBalanceByCategory?: (accountId: string, categoryCode: string, itemId: string) => number
  getAuxCategoryName?: (categoryCode: string) => string
  getAuxItemName?: (categoryCode: string, itemId: string) => string
  getEnabledCategoryCodesForAccount?: (
    account: NoNegativeAccountLike & { aux_types?: unknown }
  ) => string[]
}): NoNegativeBalanceCheckResult | null {
  // 缓存"约束源"：科目自身或最近的祖先中 no_negative=1 的科目；找不到返回 null
  const constraintCache = new Map<string, NoNegativeAccountLike | null>()
  function findConstraintSource(accountId: string): NoNegativeAccountLike | null {
    if (constraintCache.has(accountId)) return constraintCache.get(accountId) || null
    const visitedIds: string[] = []
    let cur: NoNegativeAccountLike | null | undefined = params.getAccountById(accountId)
    let found: NoNegativeAccountLike | null = null
    const seen = new Set<string>()
    while (cur) {
      const cid = cur.id || ''
      if (cid) {
        if (seen.has(cid)) break // 防环
        seen.add(cid)
        visitedIds.push(cid)
      }
      if (cur.no_negative === 1) {
        found = cur
        break
      }
      if (!cur.parent_id) break
      cur = params.getAccountById(cur.parent_id)
    }
    for (const vid of visitedIds) {
      if (!constraintCache.has(vid)) constraintCache.set(vid, found)
    }
    return found
  }

  type AccBucket = {
    account: NoNegativeAccountLike
    entryName: string
    balance: number
    constraint: NoNegativeAccountLike
  }
  type AuxBucket = AccBucket & { auxCategoryName: string; auxItemName: string }

  const balanceByAccount = new Map<string, AccBucket>()
  const balanceByAux = new Map<string, AuxBucket>()

  for (const entry of params.entries) {
    const account = params.getAccountById(entry.account_id)
    if (!account) continue
    const constraint = findConstraintSource(entry.account_id)
    if (!constraint) continue

    const useAuxDimension =
      accountHasAuxAccounting(account as any) &&
      params.getAuxBalanceByCategory &&
      params.getEnabledCategoryCodesForAccount

    if (useAuxDimension) {
      const categoryCodes = params.getEnabledCategoryCodesForAccount!(account as any)
      const selections = extractEntryAuxSelections(entry, categoryCodes)
      for (const sel of selections) {
        const auxKey = `${entry.account_id}|${sel.categoryCode}|${sel.itemId}`
        const auxCategoryName = params.getAuxCategoryName?.(sel.categoryCode) || sel.categoryCode
        const auxItemName = params.getAuxItemName?.(sel.categoryCode, sel.itemId) || sel.itemId
        if (!balanceByAux.has(auxKey)) {
          balanceByAux.set(auxKey, {
            account,
            entryName: entry.account_name,
            auxCategoryName,
            auxItemName,
            constraint,
            balance: params.getAuxBalanceByCategory!(
              entry.account_id,
              sel.categoryCode,
              sel.itemId
            ),
          })
        }
        const auxBucket = balanceByAux.get(auxKey)!
        auxBucket.balance = calculateNewBalance({
          currentBalance: auxBucket.balance,
          amount: entry.amount,
          entryDirection: entry.direction,
          accountDirection: account.direction,
        })
      }
      continue
    }

    // 未启用辅助核算：按科目总余额校验
    if (!balanceByAccount.has(entry.account_id)) {
      balanceByAccount.set(entry.account_id, {
        account,
        entryName: entry.account_name,
        constraint,
        balance: params.getBalanceByAccountId(entry.account_id),
      })
    }
    const acctBucket = balanceByAccount.get(entry.account_id)!
    acctBucket.balance = calculateNewBalance({
      currentBalance: acctBucket.balance,
      amount: entry.amount,
      entryDirection: entry.direction,
      accountDirection: account.direction,
    })
  }

  function getConstraintAccountName(
    constraint: NoNegativeAccountLike,
    accountId?: string
  ): string | undefined {
    if (constraint?.id && accountId && constraint.id !== accountId) {
      return constraint.name || undefined
    }
    return undefined
  }

  const violations: NoNegativeBalanceViolation[] = []

  for (const { entryName, balance, constraint, account } of balanceByAccount.values()) {
    if (balance < -0.005) {
      violations.push({
        accountName: entryName,
        projectedBalance: balance,
        constraintAccountName: getConstraintAccountName(constraint, account.id),
      })
    }
  }

  for (const {
    entryName,
    auxCategoryName,
    auxItemName,
    balance,
    constraint,
    account,
  } of balanceByAux.values()) {
    if (balance < -0.005) {
      violations.push({
        accountName: entryName,
        auxCategoryName,
        auxItemName,
        projectedBalance: balance,
        constraintAccountName: getConstraintAccountName(constraint, account.id),
      })
    }
  }

  if (violations.length === 0) return null

  violations.sort((a, b) => {
    const accountCmp = a.accountName.localeCompare(b.accountName, 'zh-CN')
    if (accountCmp !== 0) return accountCmp
    const catCmp = (a.auxCategoryName || '').localeCompare(b.auxCategoryName || '', 'zh-CN')
    if (catCmp !== 0) return catCmp
    return (a.auxItemName || '').localeCompare(b.auxItemName || '', 'zh-CN')
  })

  return {
    message: buildNoNegativeBalanceSummaryMessage(violations),
    violations,
  }
}

export function buildAuxItemMap(items: AuxItemLike[]) {
  const itemMap: Record<string, AuxItemLike> = {}
  for (const item of items) {
    itemMap[item.id] = item
  }
  return itemMap
}

export function loadVoucherAuxiliaryData(params: {
  db: {
    prepare: (sql: string) => { all: (...args: any[]) => any[] }
  }
  accountSetId: string
}) {
  const categories = params.db
    .prepare('SELECT id, code, name FROM aux_categories WHERE account_set_id=?')
    .all(params.accountSetId) as AuxCategoryLike[]
  // 为每个类别加载字段配置
  const fieldsStmt = params.db.prepare(
    'SELECT * FROM aux_category_fields WHERE category_id=? AND is_enabled=1 ORDER BY sort_order'
  )
  for (const cat of categories) {
    ;(cat as any).fields = fieldsStmt.all(cat.id)
  }
  const items = params.db
    .prepare('SELECT id, type, name FROM aux_items WHERE account_set_id=?')
    .all(params.accountSetId) as AuxItemLike[]

  return {
    categories,
    itemMap: buildAuxItemMap(items),
  }
}

export function getPeriodClosingRecord(params: {
  db: {
    prepare: (sql: string) => { get: (...args: any[]) => any }
  }
  accountSetId: string
  year: string | number
  period: string | number
}) {
  return params.db
    .prepare(`SELECT * FROM period_closing WHERE account_set_id=? AND year=? AND period=?`)
    .get(params.accountSetId, params.year, params.period) as any
}

export function isPeriodClosed(record: { status?: string } | null | undefined) {
  return record?.status === 'closed'
}

export function closePeriod(params: {
  db: {
    prepare: (sql: string) => { run: (...args: any[]) => void }
  }
  id: string
  accountSetId: string
  year: string | number
  period: string | number
  userId?: string | null
}) {
  params.db
    .prepare(
      `INSERT OR REPLACE INTO period_closing (id, account_set_id, year, period, status, closed_by, closed_at) VALUES (?, ?, ?, ?, 'closed', ?, datetime('now'))`
    )
    .run(params.id, params.accountSetId, params.year, params.period, params.userId)
}

export function openPeriod(params: {
  db: {
    prepare: (sql: string) => { run: (...args: any[]) => void }
  }
  accountSetId: string
  year: string | number
  period: string | number
}) {
  params.db
    .prepare(
      `UPDATE period_closing SET status='open' WHERE account_set_id=? AND year=? AND period=?`
    )
    .run(params.accountSetId, params.year, params.period)
}

export function listPeriodClosingStatus(params: {
  db: {
    prepare: (sql: string) => { all: (...args: any[]) => any[] }
  }
  accountSetId: string
  year: string | number
}) {
  return params.db
    .prepare(`SELECT * FROM period_closing WHERE account_set_id=? AND year=? ORDER BY period`)
    .all(params.accountSetId, params.year) as any[]
}

export function validateVoucherForAudit(
  voucher: { status?: string; maker_id?: string | null } | null | undefined,
  userId?: string | null
) {
  if (!voucher) {
    return '凭证不存在'
  }
  if (voucher.status !== 'draft') {
    return '只能审核草稿状态的凭证'
  }
  if (voucher.maker_id === userId) {
    return '制单人和审核人不能为同一人'
  }
  return null
}

export function applyVoucherAudit(params: {
  db: {
    prepare: (sql: string) => { run: (...args: any[]) => void }
  }
  voucherId: string
  userId?: string | null
  userName?: string | null
}) {
  params.db
    .prepare(
      "UPDATE vouchers SET status=?, auditor_id=?, auditor_name=?, updated_at=datetime('now') WHERE id=?"
    )
    .run('audited', params.userId, params.userName, params.voucherId)
}

export function validateVoucherForUnAudit(voucher: { status?: string } | null | undefined) {
  if (!voucher) {
    return '凭证不存在'
  }
  if (voucher.status === 'posted') {
    return '已记账凭证无法反审核'
  }
  if (voucher.status !== 'audited') {
    return '只能反审核已审核状态的凭证'
  }
  return null
}

export function applyVoucherUnAudit(params: {
  db: {
    prepare: (sql: string) => { run: (...args: any[]) => void }
  }
  voucherId: string
}) {
  params.db
    .prepare(
      "UPDATE vouchers SET status=?, auditor_id=NULL, auditor_name=NULL, updated_at=datetime('now') WHERE id=?"
    )
    .run('draft', params.voucherId)
}

export function getBatchVoucherQuery(params: {
  accountSetId: string
  voucherTypeIds: string[]
  startDate?: string
  endDate?: string
  startNo?: string
  endNo?: string
  accountScope?: AccountScopeContext
}) {
  return buildBatchVoucherQuery(
    {
      voucherTypeIds: params.voucherTypeIds,
      accountSetId: params.accountSetId,
      startDate: params.startDate || '',
      endDate: params.endDate || '',
      startNo: params.startNo,
      endNo: params.endNo,
    },
    params.accountScope
  )
}

export function loadBatchDraftVouchers(params: {
  db: {
    prepare: (sql: string) => { all: (...args: any[]) => any[] }
  }
  accountSetId: string
  accountScope?: AccountScopeContext
  filters: {
    voucherTypeIds: string[]
    startDate?: string
    endDate?: string
    startNo?: string
    endNo?: string
  }
}) {
  const query = getBatchVoucherQuery({
    accountSetId: params.accountSetId,
    voucherTypeIds: params.filters.voucherTypeIds,
    startDate: params.filters.startDate,
    endDate: params.filters.endDate,
    startNo: params.filters.startNo,
    endNo: params.filters.endNo,
    accountScope: params.accountScope,
  })
  return getBatchDraftVouchers({
    db: params.db,
    sql: query.sql,
    params: query.params,
  })
}

export function loadBatchFilteredVouchers(params: {
  db: {
    prepare: (sql: string) => { all: (...args: any[]) => any[] }
  }
  accountSetId: string
  accountScope?: AccountScopeContext
  filters: {
    voucherTypeIds: string[]
    startDate?: string
    endDate?: string
    startNo?: string
    endNo?: string
  }
}) {
  const query = getBatchVoucherQuery({
    accountSetId: params.accountSetId,
    voucherTypeIds: params.filters.voucherTypeIds,
    startDate: params.filters.startDate,
    endDate: params.filters.endDate,
    startNo: params.filters.startNo,
    endNo: params.filters.endNo,
    accountScope: params.accountScope,
  })
  return loadBatchVouchers({
    db: params.db,
    query,
  })
}

export function getBatchVoucherFilters(body: {
  voucher_type_ids?: string[]
  start_date?: string
  end_date?: string
  start_no?: string
  end_no?: string
}) {
  return {
    voucherTypeIds: Array.isArray(body.voucher_type_ids) ? body.voucher_type_ids : [],
    startDate: body.start_date,
    endDate: body.end_date,
    startNo: body.start_no,
    endNo: body.end_no,
  }
}

export function validateBatchVoucherFilters(filters: {
  voucherTypeIds: string[]
  startDate?: string
  endDate?: string
}) {
  return Boolean(filters.startDate && filters.endDate && filters.voucherTypeIds.length > 0)
}

export function loadBatchVouchers(params: {
  db: {
    prepare: (sql: string) => { all: (...args: any[]) => any[] }
  }
  query: {
    sql: string
    params: any[]
  }
}) {
  return params.db.prepare(params.query.sql).all(...params.query.params) as any[]
}

export function getBatchDraftVouchers(params: {
  db: {
    prepare: (sql: string) => { all: (...args: any[]) => any[] }
  }
  sql: string
  params: any[]
}) {
  return (params.db.prepare(params.sql).all(...params.params) as any[]).filter(
    voucher => voucher.status === 'draft'
  )
}

export function findSelfMadeVoucher(
  vouchers: Array<{ maker_id?: string | null; voucher_no?: string | null }>,
  userId?: string | null
) {
  return vouchers.find(v => v.maker_id === userId)
}

export function buildBatchAuditPreviewData(
  vouchers: Array<{ maker_id?: string | null; voucher_no?: string | null }>,
  userId?: string | null
) {
  const selfMadeVoucher = findSelfMadeVoucher(vouchers, userId)
  return {
    count: vouchers.length,
    blocked: Boolean(selfMadeVoucher),
    blockedVoucherNo: selfMadeVoucher?.voucher_no || null,
    firstVoucherNo: vouchers[0]?.voucher_no || null,
    lastVoucherNo: vouchers[vouchers.length - 1]?.voucher_no || null,
  }
}

export function auditBatchVouchers(params: {
  db: Database
  vouchers: Array<{ id: string }>
  userId?: string | null
  userName?: string | null
}) {
  const auditBatch = params.db.transaction(() => {
    for (const voucher of params.vouchers) {
      params.db
        .prepare(
          "UPDATE vouchers SET status=?, auditor_id=?, auditor_name=?, updated_at=datetime('now') WHERE id=?"
        )
        .run('audited', params.userId, params.userName, voucher.id)
    }
  })
  auditBatch()
}

export function findPostedVoucher(
  vouchers: Array<{ status?: string; voucher_no?: string | null }>
) {
  return vouchers.find(v => v.status === 'posted')
}

export function buildBatchDeletePreviewData(
  vouchers: Array<{ id?: string; status?: string; voucher_no?: string | null; source?: string | null }>
) {
  // FIX-132：预览与执行同一守卫（posted / cashier / asset_*）
  const blockedVoucher = vouchers.find(v => getVoucherUndeletableReason({ id: v.id || '', ...v }))
  return {
    count: vouchers.length,
    blocked: Boolean(blockedVoucher),
    blockedVoucherNo: blockedVoucher?.voucher_no || null,
    blockedReason: blockedVoucher ? getVoucherUndeletableReason({ id: blockedVoucher.id || '', ...blockedVoucher }) : null,
    firstVoucherNo: vouchers[0]?.voucher_no || null,
    lastVoucherNo: vouchers[vouchers.length - 1]?.voucher_no || null,
  }
}

export function deleteBatchVouchers(params: { db: Database; vouchers: Array<{ id: string }> }) {
  const removeBatch = params.db.transaction(() => {
    for (const voucher of params.vouchers) {
      deleteVoucherRecords(params.db, voucher.id)
    }
  })
  removeBatch()
}

export function deleteVoucherRecords(db: Database, voucherId: string) {
  // 获取凭证信息
  const voucher = db.prepare('SELECT * FROM vouchers WHERE id=?').get(voucherId) as any
  if (!voucher) {
    return // 凭证不存在，直接返回
  }

  // 如果是已记账凭证，不允许直接删除
  if (voucher.status === 'posted') {
    throw new Error('已记账凭证不能删除，请先反记账')
  }

  const transaction = db.transaction(() => {
    // 删除凭证附件
    db.prepare('DELETE FROM voucher_attachments WHERE voucher_id=?').run(voucherId)
    // 删除关联的自动结转运行记录
    db.prepare('DELETE FROM auto_transfer_runs WHERE voucher_id=?').run(voucherId)
    // 删除凭证分录
    db.prepare('DELETE FROM voucher_entries WHERE voucher_id=?').run(voucherId)
    // 删除凭证主表
    db.prepare('DELETE FROM vouchers WHERE id=?').run(voucherId)
  })

  transaction()
}

export interface BatchVoucherOperationResult {
  id: string
  voucher_no: string
  success: boolean
  error?: string
}

/** 批量凭证操作统一响应：支持部分成功，全部失败时返回 400 */
export function sendBatchVoucherOperationResponse(
  res: {
    status: (code: number) => { json: (body: unknown) => unknown }
    json: (body: unknown) => unknown
  },
  operationLabel: string,
  voucherIds: string[],
  results: BatchVoucherOperationResult[]
) {
  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length
  const data = {
    total: voucherIds.length,
    success: successCount,
    fail: failCount,
    details: results,
  }

  if (successCount === 0 && failCount > 0) {
    const firstError = results.find(r => !r.success)?.error || `${operationLabel}失败`
    return res.status(400).json({
      code: 400,
      message: `批量${operationLabel}失败：${firstError}（共 ${failCount} 张全部失败）`,
      data,
    })
  }

  return res.json({
    code: 0,
    message: `批量${operationLabel}完成：成功 ${successCount} 张，失败 ${failCount} 张`,
    data,
  })
}

/**
 * 禁止负数余额（实时口径）：期初 + 全部凭证实时汇总；启用辅助核算时按各辅助项目分项校验。
 * 手工录入 / 修改（routes/voucher.ts）与 Excel 转入（评审 P1-7）共用。
 */
export function validateNoNegativeBalanceRealtime(
  db: any,
  accountSetId: string,
  entries: VoucherEntryInput[],
  year: number,
  period: number,
  excludeVoucherId?: string
): NoNegativeBalanceCheckResult | null {
  const { categories } = loadVoucherAuxiliaryData({ db, accountSetId })
  const realtimeGetters = createRealtimeNoNegativeBalanceGetters(db, {
    accountSetId,
    year,
    period,
    categories,
    excludeVoucherId,
  })
  return validateVoucherEntriesNoNegativeBalance({
    entries,
    getAccountById: accountId => db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId) as any,
    ...realtimeGetters,
  })
}

/** 凭证时序控制（system_params.voucher_time_control）开启时，返回账套现有凭证的最大日期；未开启返回 null */
export function getVoucherTimeControlMaxDate(db: any, accountSetId: string, excludeVoucherId?: string): string | null {
  const param = db
    .prepare('SELECT param_value FROM system_params WHERE account_set_id = ? AND param_key = ?')
    .get(accountSetId, 'voucher_time_control') as { param_value: string } | undefined
  if (param?.param_value !== 'true') return null
  const row = db
    .prepare(
      `SELECT MAX(voucher_date) AS max_date FROM vouchers
       WHERE account_set_id = ? AND status IN ('draft', 'audited', 'posted') ${excludeVoucherId ? 'AND id <> ?' : ''}`
    )
    .get(...(excludeVoucherId ? [accountSetId, excludeVoucherId] : [accountSetId])) as { max_date: string | null } | undefined
  return row?.max_date ?? ''
}
