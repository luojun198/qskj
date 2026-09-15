import type Database from 'better-sqlite3'
import { buildLedgerOpeningExpr, resolvePreBookRangeFlags } from './initBalanceScope.js'
import {
  appendAccountScopeCondition,
  type AccountScopeContext,
} from './accountAuthorization.js'
import {
  appendAuxItemMatchParams,
  buildAuxIdSelect,
  buildAuxItemMatchCondition,
  buildAuxMatchOptions,
  buildAuxNameSelect,
} from '../utils/auxLedgerQuery.js'

export const AUX_MULTI_COLUMN_PARAM_KEY = 'ledger:aux_multi_column_map'

type AccountDirection = 'debit' | 'credit'

/** counter=按对方科目分栏（参考图下半）；aux_item=按辅助项目分栏（参考图上半） */
export type AuxMultiColumnMode = 'counter' | 'aux_item'

export interface AuxMultiColumnSetting {
  accountId: string
  enabled: boolean
  printName: string
  sortOrder: number
}

export interface AuxMultiColumnAccount {
  key: string
  accountId: string
  label: string
  side: AccountDirection
  accountCode: string
  accountName: string
  accountPath: string
  printName: string
  enabled: boolean
  sortOrder: number
}

export type AuxMultiColumnRowType = 'init' | 'entry' | 'month_total' | 'year_total'

export interface AuxMultiColumnLedgerRow {
  row_type: AuxMultiColumnRowType
  voucher_date: string
  year: number | ''
  month: number | ''
  day: number | ''
  voucher_id: string
  voucher_no: string
  voucher_type_name: string
  voucher_status: string
  summary: string
  account_id: string
  account_code: string
  account_name: string
  counter_label: string
  aux_item_id: string
  aux_item_name: string
  amounts: Record<string, number>
  debit_total: number
  credit_total: number
  balance: number
  direction_label: '借' | '贷' | '平' | ''
}

export interface AuxMultiColumnQueryInput {
  accountSetId: string
  mode?: AuxMultiColumnMode
  categoryId: string
  auxItemIds: string[]
  /** mode=aux_item 时必填：以该科目（含子科目）为主科目 */
  accountId?: string
  year: number
  startMonth: number
  endMonth: number
  includeUnposted?: boolean
  /** mode=counter 时过滤对方科目编码前缀 */
  accountCode?: string
  accountScope?: AccountScopeContext
  /** FIX-150：账套启用日 / 是否具备 opening·pre_book 列，用于期初口径 */
  accountSetStartDate?: string
  preBookEnabled?: boolean
}

export interface AuxMultiColumnCategoryInfo {
  id: string
  code: string
  name: string
}

export interface AuxMultiColumnAccountInfo {
  id: string
  code: string
  name: string
  direction: AccountDirection
}

export interface AuxMultiColumnResolved {
  mode: AuxMultiColumnMode
  category: AuxMultiColumnCategoryInfo | null
  account: AuxMultiColumnAccountInfo | null
  columns: AuxMultiColumnAccount[]
  range: { year: number; startMonth: number; endMonth: number; startDate: string; endDate: string }
  initBalance: number
  rows: AuxMultiColumnLedgerRow[]
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100
const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const directionLabel = (balance: number): AuxMultiColumnLedgerRow['direction_label'] => {
  if (Math.abs(balance) < 0.005) return '平'
  return balance > 0 ? '借' : '贷'
}
const dayBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
const columnKey = (side: AccountDirection, sourceId: string) => `${side === 'debit' ? 'd' : 'c'}_${sourceId}`

// ===================== 基础资料 =====================

function findCategory(db: Database.Database, accountSetId: string, categoryId: string) {
  return db
    .prepare('SELECT id, code, name FROM aux_categories WHERE account_set_id=? AND id=? LIMIT 1')
    .get(accountSetId, categoryId) as AuxMultiColumnCategoryInfo | undefined
}

function findAuxItems(db: Database.Database, accountSetId: string, categoryId: string, auxItemIds: string[]) {
  if (auxItemIds.length === 0) {
    return db
      .prepare(
        `SELECT id, code, name FROM aux_items
         WHERE account_set_id=? AND type=? AND status='active'
         ORDER BY code`
      )
      .all(accountSetId, categoryId) as Array<{ id: string; code: string; name: string }>
  }
  const placeholders = auxItemIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT id, code, name FROM aux_items
       WHERE account_set_id=? AND type=? AND id IN (${placeholders}) AND status='active'
       ORDER BY code`
    )
    .all(accountSetId, categoryId, ...auxItemIds) as Array<{ id: string; code: string; name: string }>
}

function findAccount(db: Database.Database, accountSetId: string, accountId: string) {
  return db
    .prepare('SELECT id, code, name, direction FROM accounts WHERE account_set_id=? AND id=? LIMIT 1')
    .get(accountSetId, accountId) as AuxMultiColumnAccountInfo | undefined
}

type AccountRowWithParent = { id: string; code: string; name: string; parent_id: string | null }

function buildAccountPath(
  db: Database.Database,
  accountSetId: string,
  account: { id: string; code: string; name: string; parent_id?: string | null }
) {
  const byId = db.prepare('SELECT id, code, name, parent_id FROM accounts WHERE account_set_id=? AND id=? LIMIT 1')
  const byCode = db.prepare('SELECT id, code, name, parent_id FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
  const names = [account.name]
  let current: AccountRowWithParent | undefined = {
    id: account.id,
    code: account.code,
    name: account.name,
    parent_id: account.parent_id ?? null,
  }
  let guard = 0
  while (current && guard++ < 12) {
    let parent: AccountRowWithParent | undefined
    if (current.parent_id) parent = byId.get(accountSetId, current.parent_id) as AccountRowWithParent | undefined
    if (!parent) {
      for (let length = current.code.length - 1; length > 0 && !parent; length -= 1) {
        parent = byCode.get(accountSetId, current.code.slice(0, length)) as AccountRowWithParent | undefined
      }
    }
    if (!parent) break
    names.unshift(parent.name)
    current = parent
  }
  return names.join('\\')
}

// ===================== 栏目设置读写 =====================

function loadSettings(db: Database.Database, accountSetId: string, key: string): AuxMultiColumnSetting[] {
  const row = db
    .prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(accountSetId, AUX_MULTI_COLUMN_PARAM_KEY) as { param_value?: string } | undefined
  if (!row?.param_value) return []
  try {
    const parsed = JSON.parse(row.param_value)
    if (!parsed || typeof parsed !== 'object') return []
    const settings = (parsed as Record<string, AuxMultiColumnSetting[] | undefined>)[key]
    if (!Array.isArray(settings)) return []
    return settings
      .filter(item => item && typeof item.accountId === 'string')
      .map(item => ({
        accountId: String(item.accountId),
        enabled: item.enabled !== false,
        printName: String(item.printName ?? '').trim(),
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : 0,
      }))
  } catch {
    return []
  }
}

export function saveAuxMultiColumnSettings(
  db: Database.Database,
  accountSetId: string,
  key: string,
  settings: AuxMultiColumnSetting[],
  newId: () => string
) {
  const existing = db
    .prepare('SELECT id, param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(accountSetId, AUX_MULTI_COLUMN_PARAM_KEY) as { id: string; param_value?: string } | undefined
  let all: Record<string, AuxMultiColumnSetting[]> = {}
  if (existing?.param_value) {
    try {
      const parsed = JSON.parse(existing.param_value)
      if (parsed && typeof parsed === 'object') all = parsed as Record<string, AuxMultiColumnSetting[]>
    } catch {
      all = {}
    }
  }
  all[key] = settings.map((setting, index) => ({
    accountId: String(setting.accountId),
    enabled: setting.enabled !== false,
    printName: String(setting.printName ?? '').trim(),
    sortOrder: Number.isFinite(Number(setting.sortOrder)) ? Number(setting.sortOrder) : index,
  }))
  const value = JSON.stringify(all)
  if (existing) {
    db.prepare("UPDATE system_params SET param_value=?, updated_at=datetime('now') WHERE id=?").run(value, existing.id)
  } else {
    db.prepare('INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)').run(
      newId(),
      accountSetId,
      AUX_MULTI_COLUMN_PARAM_KEY,
      value
    )
  }
  return all[key]
}

/** 栏目设置的存储键：模式 + 类别 + 主科目 + 所选项目，四者任一不同即独立保存 */
export function buildAuxMultiColumnSettingsKey(input: {
  mode?: AuxMultiColumnMode
  categoryId: string
  accountId?: string
  auxItemIds: string[]
}) {
  const mode = input.mode === 'aux_item' ? 'aux_item' : 'counter'
  const items = input.auxItemIds.slice().sort().join(',') || '*'
  return `${mode}|${input.categoryId}|${input.accountId || '*'}|${items}`
}

/** 一个分栏来源（对方科目 / 辅助项目）会展开成借、贷两栏 */
export interface AuxMultiColumnColumnSource {
  sourceId: string
  code: string
  name: string
  /** 对方科目来源带科目路径；辅助项目来源为空 */
  accountPath?: string
}

export function resolveAuxMultiColumnColumns(
  db: Database.Database,
  accountSetId: string,
  key: string,
  sources: AuxMultiColumnColumnSource[]
): AuxMultiColumnAccount[] {
  const saved = new Map(loadSettings(db, accountSetId, key).map(item => [item.accountId, item]))
  const sides: AccountDirection[] = ['debit', 'credit']
  // 已手工排序的栏目排在前面并按保存的顺序；未配置过的栏目按来源顺序（编码）跟在后面
  const UNSORTED = Number.MAX_SAFE_INTEGER
  const columns: Array<AuxMultiColumnAccount & { sourceIndex: number }> = []
  sources.forEach((source, index) => {
    for (const side of sides) {
      const key2 = columnKey(side, source.sourceId)
      const setting = saved.get(key2)
      columns.push({
        key: key2,
        accountId: key2,
        label: source.name,
        side,
        accountCode: source.code,
        accountName: source.name,
        accountPath: source.accountPath || '',
        printName: setting?.printName || source.name,
        enabled: setting?.enabled !== false,
        sortOrder: setting?.sortOrder ?? UNSORTED,
        sourceIndex: index,
      })
    }
  })
  return columns
    .filter(column => column.enabled)
    .sort(
      (a, b) =>
        (a.side === b.side ? 0 : a.side === 'debit' ? -1 : 1) ||
        a.sortOrder - b.sortOrder ||
        a.sourceIndex - b.sourceIndex ||
        a.accountCode.localeCompare(b.accountCode)
    )
    .map(({ sourceIndex: _sourceIndex, ...column }, index) => ({ ...column, sortOrder: index }))
}

function emptyAmounts(columns: AuxMultiColumnAccount[]) {
  return Object.fromEntries(columns.map(column => [column.key, 0])) as Record<string, number>
}

function makeRow(columns: AuxMultiColumnAccount[], partial: Partial<AuxMultiColumnLedgerRow>): AuxMultiColumnLedgerRow {
  return {
    row_type: 'entry',
    voucher_date: '',
    year: '',
    month: '',
    day: '',
    voucher_id: '',
    voucher_no: '',
    voucher_type_name: '',
    voucher_status: '',
    summary: '',
    account_id: '',
    account_code: '',
    account_name: '',
    counter_label: '',
    aux_item_id: '',
    aux_item_name: '',
    amounts: emptyAmounts(columns),
    debit_total: 0,
    credit_total: 0,
    balance: 0,
    direction_label: '',
    ...partial,
  }
}

// ===================== 命中分录采集 =====================

interface HitEntry {
  entryId: string
  voucherId: string
  voucherNo: string
  voucherDate: string
  voucherStatus: string
  voucherTypeName: string
  summary: string
  /** 命中分录自身的科目 */
  accountId: string
  accountCode: string
  accountName: string
  direction: AccountDirection
  amount: number
  auxItemId: string
  auxItemCode: string
  auxItemName: string
  /** 展示用的对方科目（同凭证反方向分录） */
  counterLabel: string
  /** 分栏落格：sourceId -> 金额（正数，合计等于 amount） */
  allocation: Array<{ sourceId: string; code: string; name: string; accountPath?: string; amount: number }>
}

interface PeerEntry {
  entryId: string
  voucherId: string
  accountId: string
  accountCode: string
  accountName: string
  direction: AccountDirection
  amount: number
  parentId: string | null
}

interface CollectContext {
  accountSetId: string
  mode: AuxMultiColumnMode
  category: AuxMultiColumnCategoryInfo
  items: Array<{ id: string; code: string; name: string }>
  itemById: Map<string, { id: string; code: string; name: string }>
  itemByCode: Map<string, { id: string; code: string; name: string }>
  account?: AuxMultiColumnAccountInfo
  statusCondition: string
  accountCode?: string
  accountScope?: AccountScopeContext
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function loadPeers(db: Database.Database, accountSetId: string, voucherIds: string[]) {
  const byVoucher = new Map<string, PeerEntry[]>()
  for (const batch of chunk(voucherIds, 400)) {
    const placeholders = batch.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT ve.id as entry_id, ve.voucher_id, ve.account_id, ve.direction, ve.amount,
                a.code as account_code, a.name as account_name, a.parent_id
         FROM voucher_entries ve
         JOIN accounts a ON a.id = ve.account_id
         WHERE ve.account_set_id=? AND ve.voucher_id IN (${placeholders})
         ORDER BY ve.seq`
      )
      .all(accountSetId, ...batch) as Array<{
        entry_id: string
        voucher_id: string
        account_id: string
        direction: AccountDirection
        amount: number
        account_code: string
        account_name: string
        parent_id: string | null
      }>
    for (const row of rows) {
      if (!byVoucher.has(row.voucher_id)) byVoucher.set(row.voucher_id, [])
      byVoucher.get(row.voucher_id)!.push({
        entryId: row.entry_id,
        voucherId: row.voucher_id,
        accountId: row.account_id,
        accountCode: row.account_code,
        accountName: row.account_name,
        direction: row.direction,
        amount: Number(row.amount) || 0,
        parentId: row.parent_id,
      })
    }
  }
  return byVoucher
}

/** 按对方科目金额比例分摊本条分录金额，尾差补在最后一栏，保证行内合计不失衡 */
function allocateByWeight<T>(total: number, peers: T[], weightOf: (peer: T) => number) {
  if (peers.length === 0) return [] as Array<{ peer: T; amount: number }>
  const weights = peers.map(peer => Math.abs(weightOf(peer)))
  const sum = weights.reduce((acc, value) => acc + value, 0)
  if (sum <= 0) {
    const even = round2(total / peers.length)
    return peers.map((peer, index) => ({
      peer,
      amount: index === peers.length - 1 ? round2(total - even * (peers.length - 1)) : even,
    }))
  }
  let used = 0
  return peers.map((peer, index) => {
    const amount = index === peers.length - 1 ? round2(total - used) : round2((total * weights[index]) / sum)
    used = round2(used + amount)
    return { peer, amount }
  })
}

function collectHits(db: Database.Database, ctx: CollectContext, dateFrom: string, dateTo: string): HitEntry[] {
  if (dateFrom > dateTo) return []
  const itemIds = ctx.items.map(item => item.id)
  if (itemIds.length === 0) return []
  const placeholders = itemIds.map(() => '?').join(',')
  const categoryIdByCode = new Map<string, string>([[ctx.category.code, ctx.category.id]])
  const matchOptions = buildAuxMatchOptions(ctx.category.code, categoryIdByCode, ctx.items)
  const matchCondition = buildAuxItemMatchCondition(ctx.category.code, placeholders, matchOptions)
  const auxIdSelect = buildAuxIdSelect(ctx.category.code, ctx.category.id)
  const auxNameSelect = buildAuxNameSelect(ctx.category.code, ctx.category.id)

  const conditions = ['ve.account_set_id = ?', ctx.statusCondition, 'v.voucher_date >= ?', 'v.voucher_date <= ?']
  const params: any[] = [ctx.accountSetId, dateFrom, dateTo]
  conditions.push(matchCondition)
  appendAuxItemMatchParams(params, ctx.category.code, itemIds, matchOptions)
  if (ctx.mode === 'aux_item' && ctx.account) {
    conditions.push('(a.id = ? OR a.code LIKE ?)')
    params.push(ctx.account.id, `${ctx.account.code}%`)
  }
  appendAccountScopeCondition(ctx.accountScope, 'a.id', conditions, params)

  const rows = db
    .prepare(
      `SELECT ve.id as entry_id, ve.voucher_id, ve.account_id, ve.direction, ve.amount, ve.summary,
              a.code as account_code, a.name as account_name,
              (${auxIdSelect}) as aux_id, (${auxNameSelect}) as aux_name,
              v.voucher_no, v.voucher_date, v.status as voucher_status, vt.name as voucher_type_name
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
       JOIN accounts a ON a.id = ve.account_id
       LEFT JOIN voucher_types vt ON vt.id = v.voucher_type_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY v.voucher_date, v.voucher_no, ve.seq`
    )
    .all(...params) as Array<{
      entry_id: string
      voucher_id: string
      account_id: string
      direction: AccountDirection
      amount: number
      summary: string | null
      account_code: string
      account_name: string
      aux_id: string | null
      aux_name: string | null
      voucher_no: string
      voucher_date: string
      voucher_status: string
      voucher_type_name: string | null
    }>
  if (rows.length === 0) return []

  const peersByVoucher = loadPeers(db, ctx.accountSetId, Array.from(new Set(rows.map(row => row.voucher_id))))
  const hits: HitEntry[] = []

  for (const row of rows) {
    const rawAuxId = String(row.aux_id ?? '').replace(/^"|"$/g, '')
    const item = ctx.itemById.get(rawAuxId) || ctx.itemByCode.get(rawAuxId)
    if (!item) continue

    const peers = (peersByVoucher.get(row.voucher_id) || []).filter(
      peer => peer.entryId !== row.entry_id && peer.direction !== row.direction
    )
    const counterPeers = ctx.accountCode
      ? peers.filter(peer => peer.accountCode.startsWith(ctx.accountCode as string))
      : peers
    // 指定了对方科目编码前缀却没有命中的分录不进表（与明细账对方科目筛选语义一致）
    if (ctx.accountCode && counterPeers.length === 0) continue

    const amount = Number(row.amount) || 0
    const counterLabel = counterPeers.map(peer => `${peer.accountCode} ${peer.accountName}`).join('、')

    let allocation: HitEntry['allocation']
    if (ctx.mode === 'counter') {
      allocation = allocateByWeight(amount, counterPeers, peer => peer.amount).map(({ peer, amount: value }) => ({
        sourceId: peer.accountId,
        code: peer.accountCode,
        name: peer.accountName,
        accountPath: buildAccountPath(db, ctx.accountSetId, {
          id: peer.accountId,
          code: peer.accountCode,
          name: peer.accountName,
          parent_id: peer.parentId,
        }),
        amount: value,
      }))
    } else {
      allocation = [{ sourceId: item.id, code: item.code, name: item.name, amount: round2(amount) }]
    }
    if (allocation.length === 0) continue

    hits.push({
      entryId: row.entry_id,
      voucherId: row.voucher_id,
      voucherNo: row.voucher_no,
      voucherDate: row.voucher_date,
      voucherStatus: row.voucher_status,
      voucherTypeName: row.voucher_type_name || '',
      summary: row.summary || '',
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      direction: row.direction,
      amount,
      auxItemId: item.id,
      auxItemCode: item.code,
      auxItemName: item.name || String(row.aux_name ?? ''),
      counterLabel,
      allocation,
    })
  }
  return hits
}

function collectSources(hits: HitEntry[]): AuxMultiColumnColumnSource[] {
  const map = new Map<string, AuxMultiColumnColumnSource>()
  for (const hit of hits) {
    for (const part of hit.allocation) {
      if (map.has(part.sourceId)) continue
      map.set(part.sourceId, {
        sourceId: part.sourceId,
        code: part.code,
        name: part.name,
        accountPath: part.accountPath,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code))
}

// ===================== 上下文与期间 =====================

function prepareContext(db: Database.Database, input: AuxMultiColumnQueryInput) {
  const year = Number(input.year) || new Date().getFullYear()
  const startMonth = Math.min(12, Math.max(1, Number(input.startMonth) || 1))
  const endMonth = Math.min(12, Math.max(startMonth, Number(input.endMonth) || 12))
  const rangeStart = `${year}-${String(startMonth).padStart(2, '0')}-01`
  const rangeEnd = `${year}-${String(endMonth).padStart(2, '0')}-${String(monthEnd(year, endMonth)).padStart(2, '0')}`
  const yearStart = `${year}-01-01`
  const range = { year, startMonth, endMonth, rangeStart, rangeEnd, yearStart }

  const category = findCategory(db, input.accountSetId, input.categoryId)
  // 现金流量项目是凭证级标签而非辅助核算项目，不出现在辅助账簿中（兜底，防前端漏过滤）
  if (!category || category.code === 'cash_flow') return null

  const items = findAuxItems(db, input.accountSetId, input.categoryId, input.auxItemIds)
  if (items.length === 0) return null

  const mode: AuxMultiColumnMode = input.mode === 'aux_item' ? 'aux_item' : 'counter'
  const account =
    mode === 'aux_item' && input.accountId ? findAccount(db, input.accountSetId, input.accountId) : undefined
  if (mode === 'aux_item' && !account) return null

  const ctx: CollectContext = {
    accountSetId: input.accountSetId,
    mode,
    category,
    items,
    itemById: new Map(items.map(item => [item.id, item])),
    itemByCode: new Map(items.filter(item => item.code).map(item => [item.code, item])),
    account,
    statusCondition: input.includeUnposted
      ? "v.status IN ('draft', 'audited', 'posted')"
      : "v.status = 'posted'",
    accountCode: mode === 'counter' ? input.accountCode?.trim() || undefined : undefined,
    accountScope: input.accountScope,
  }
  return { ctx, range }
}

// ===================== 栏目发现（查询与设置共用） =====================

export function resolveAuxMultiColumnColumnSources(
  db: Database.Database,
  input: AuxMultiColumnQueryInput
): {
  mode: AuxMultiColumnMode
  category: AuxMultiColumnCategoryInfo | null
  account: AuxMultiColumnAccountInfo | null
  columns: AuxMultiColumnAccount[]
  settingsKey: string
} {
  const prepared = prepareContext(db, input)
  const settingsKey = buildAuxMultiColumnSettingsKey(input)
  if (!prepared) {
    return {
      mode: input.mode === 'aux_item' ? 'aux_item' : 'counter',
      category: findCategory(db, input.accountSetId, input.categoryId) || null,
      account: null,
      columns: [],
      settingsKey,
    }
  }
  const { ctx, range } = prepared
  const preHits =
    range.rangeStart > range.yearStart ? collectHits(db, ctx, range.yearStart, dayBefore(range.rangeStart)) : []
  const rangeHits = collectHits(db, ctx, range.rangeStart, range.rangeEnd)
  const columns = resolveAuxMultiColumnColumns(
    db,
    input.accountSetId,
    settingsKey,
    collectSources([...preHits, ...rangeHits])
  )
  return { mode: ctx.mode, category: ctx.category, account: ctx.account || null, columns, settingsKey }
}

// ===================== 期初余额 =====================

function queryInitBalance(
  db: Database.Database,
  ctx: CollectContext,
  year: number,
  opening: { preBookEnabled: boolean; initIncludesPreBook: boolean } = { preBookEnabled: false, initIncludesPreBook: true }
) {
  const itemIds = ctx.items.map(item => item.id)
  const itemCodes = ctx.items.map(item => item.code).filter(Boolean)
  const idPlaceholders = itemIds.map(() => '?').join(',')
  const conditions = ['ib.account_set_id = ?', 'ib.year = ?', "COALESCE(ib.aux_item_id, '') != ''"]
  const params: any[] = [ctx.accountSetId, year]
  // init_balances.aux_item_id 历史上既可能存项目 ID，也可能存项目编码
  if (itemCodes.length > 0) {
    const codePlaceholders = itemCodes.map(() => '?').join(',')
    conditions.push(`(ib.aux_item_id IN (${idPlaceholders}) OR ib.aux_item_id IN (${codePlaceholders}))`)
    params.push(...itemIds, ...itemCodes)
  } else {
    conditions.push(`ib.aux_item_id IN (${idPlaceholders})`)
    params.push(...itemIds)
  }
  if (ctx.mode === 'aux_item' && ctx.account) {
    conditions.push('(a.id = ? OR a.code LIKE ?)')
    params.push(ctx.account.id, `${ctx.account.code}%`)
  }
  appendAccountScopeCondition(ctx.accountScope, 'a.id', conditions, params)

  const rows = db
    .prepare(
      `SELECT ib.account_id, a.direction, ${buildLedgerOpeningExpr(opening)} as init_balance
       FROM init_balances ib
       JOIN accounts a ON a.id = ib.account_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY ib.account_id, a.direction`
    )
    .all(...params) as Array<{ account_id: string; direction: AccountDirection; init_balance: number }>

  // 统一折算成「借正贷负」，与逐行滚动的余额口径一致
  let total = 0
  for (const row of rows) {
    const amount = Number(row.init_balance) || 0
    total += row.direction === 'debit' ? amount : -amount
  }
  return round2(total)
}

// ===================== 主查询 =====================

export function queryAuxMultiColumnLedger(
  db: Database.Database,
  input: AuxMultiColumnQueryInput
): AuxMultiColumnResolved {
  const year = Number(input.year) || new Date().getFullYear()
  const startMonth = Math.min(12, Math.max(1, Number(input.startMonth) || 1))
  const endMonth = Math.min(12, Math.max(startMonth, Number(input.endMonth) || 12))
  const rangeStart = `${year}-${String(startMonth).padStart(2, '0')}-01`
  const rangeEnd = `${year}-${String(endMonth).padStart(2, '0')}-${String(monthEnd(year, endMonth)).padStart(2, '0')}`
  const yearStart = `${year}-01-01`

  const prepared = prepareContext(db, input)
  const base: AuxMultiColumnResolved = {
    mode: input.mode === 'aux_item' ? 'aux_item' : 'counter',
    category: prepared?.ctx.category || findCategory(db, input.accountSetId, input.categoryId) || null,
    account: prepared?.ctx.account || null,
    columns: [],
    range: { year, startMonth, endMonth, startDate: rangeStart, endDate: rangeEnd },
    initBalance: 0,
    rows: [],
  }
  if (!prepared) return base
  const { ctx } = prepared

  const preHits = rangeStart > yearStart ? collectHits(db, ctx, yearStart, dayBefore(rangeStart)) : []
  const rangeHits = collectHits(db, ctx, rangeStart, rangeEnd)

  const columns = resolveAuxMultiColumnColumns(
    db,
    input.accountSetId,
    buildAuxMultiColumnSettingsKey(input),
    collectSources([...preHits, ...rangeHits])
  )
  base.columns = columns
  if (columns.length === 0) return base

  const columnKeys = new Set(columns.map(column => column.key))

  // 期初 = 年初余额（+ 归属日早于区间起点的账前发生额）+ 区间前发生额（借正贷负）
  // FIX-150：与总账 / 余额表同口径；账前发生额无对方科目明细，落在区间内时无法分栏，仅计入期初判断
  const preBook = resolvePreBookRangeFlags({
    accountSetStartDate: input.accountSetStartDate,
    preBookEnabled: input.preBookEnabled,
    startDate: rangeStart,
    endDate: rangeEnd,
    yearStartDate: yearStart,
  })
  let initBalance = queryInitBalance(db, ctx, year, {
    preBookEnabled: preBook.preBookEnabled,
    initIncludesPreBook: preBook.initIncludesPreBook,
  })
  for (const hit of preHits) {
    initBalance += hit.direction === 'debit' ? hit.amount : -hit.amount
  }
  initBalance = round2(initBalance)

  // 本年累计起点：区间前发生额按栏目累进
  const yearAmounts = emptyAmounts(columns)
  for (const hit of preHits) {
    for (const part of hit.allocation) {
      const key = columnKey(hit.direction, part.sourceId)
      if (columnKeys.has(key)) yearAmounts[key] += part.amount
    }
  }

  const rows: AuxMultiColumnLedgerRow[] = []
  rows.push(
    makeRow(columns, {
      row_type: 'init',
      voucher_date: rangeStart,
      year,
      month: startMonth,
      summary: startMonth === 1 ? '上年结转' : '期初余额',
      balance: initBalance,
      direction_label: directionLabel(initBalance),
    })
  )

  let balance = initBalance
  let currentMonth = 0
  let monthAmounts = emptyAmounts(columns)
  const flushMonth = () => {
    if (!currentMonth) return
    let debitTotal = 0
    let creditTotal = 0
    for (const column of columns) {
      if (column.side === 'debit') debitTotal += monthAmounts[column.key]
      else creditTotal += monthAmounts[column.key]
      yearAmounts[column.key] += monthAmounts[column.key]
    }
    rows.push(
      makeRow(columns, {
        row_type: 'month_total',
        voucher_date: `${year}-${String(currentMonth).padStart(2, '0')}-${String(monthEnd(year, currentMonth)).padStart(2, '0')}`,
        year,
        month: currentMonth,
        summary: '本月合计',
        amounts: Object.fromEntries(Object.entries(monthAmounts).map(([key, value]) => [key, round2(value)])),
        debit_total: round2(debitTotal),
        credit_total: round2(creditTotal),
        balance: round2(balance),
        direction_label: directionLabel(balance),
      })
    )
    monthAmounts = emptyAmounts(columns)
  }

  for (const hit of rangeHits) {
    const date = new Date(`${hit.voucherDate}T00:00:00Z`)
    const month = date.getUTCMonth() + 1
    if (month !== currentMonth) {
      flushMonth()
      currentMonth = month
    }
    const amounts = emptyAmounts(columns)
    let landed = 0
    for (const part of hit.allocation) {
      const key = columnKey(hit.direction, part.sourceId)
      if (!columnKeys.has(key)) continue
      amounts[key] += part.amount
      monthAmounts[key] += part.amount
      landed += part.amount
    }
    // 栏目被禁用时该分录金额不再计入借贷合计与余额，避免表内失衡
    if (Math.abs(landed) < 0.005) continue
    const debitTotal = hit.direction === 'debit' ? round2(landed) : 0
    const creditTotal = hit.direction === 'credit' ? round2(landed) : 0
    balance = round2(balance + debitTotal - creditTotal)
    rows.push(
      makeRow(columns, {
        row_type: 'entry',
        voucher_date: hit.voucherDate,
        year: date.getUTCFullYear(),
        month,
        day: date.getUTCDate(),
        voucher_id: hit.voucherId,
        voucher_no: hit.voucherNo,
        voucher_type_name: hit.voucherTypeName,
        voucher_status: hit.voucherStatus,
        summary: hit.summary,
        account_id: hit.accountId,
        account_code: hit.accountCode,
        account_name: hit.accountName,
        counter_label: hit.counterLabel,
        aux_item_id: hit.auxItemId,
        aux_item_name: hit.auxItemName,
        amounts: Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, round2(value)])),
        debit_total: debitTotal,
        credit_total: creditTotal,
        balance,
        direction_label: directionLabel(balance),
      })
    )
  }
  flushMonth()

  let yearDebit = 0
  let yearCredit = 0
  for (const column of columns) {
    if (column.side === 'debit') yearDebit += yearAmounts[column.key]
    else yearCredit += yearAmounts[column.key]
  }
  rows.push(
    makeRow(columns, {
      row_type: 'year_total',
      voucher_date: rangeEnd,
      year,
      month: endMonth,
      summary: '本年累计',
      amounts: Object.fromEntries(Object.entries(yearAmounts).map(([key, value]) => [key, round2(value)])),
      debit_total: round2(yearDebit),
      credit_total: round2(yearCredit),
      balance: round2(balance),
      direction_label: directionLabel(balance),
    })
  )

  base.rows = rows
  base.initBalance = initBalance
  return base
}
