/**
 * 固定资产凭证统一构建器（P0-1 / P0-2 / P0-5）
 *
 * 背景：折旧、购置、处置、盘点四处各自手写了简化版 INSERT INTO voucher_entries（仅 11 列），
 * 既不写辅助核算字段（dept_id / person_id / aux_data），也各自复制了一份凭证取号 SQL，
 * 处置还会在科目缺失时静默跳过分录、生成借贷不平的坏凭证。
 *
 * 本模块把这些统一收口，内部一律复用凭证模块的规范工具：
 *   - loadVoucherAuxiliaryData / buildVoucherEntryPayloads / VOUCHER_ENTRY_INSERT_SQL
 *   - getNextVoucherNo（含 getEffectiveVoucherTypeId + getMaxVoucherNoSeqInPeriod）
 *   - getVoucherBalanceError（借贷不平直接抛错，不再落库）
 *   - getPeriodClosingRecord / isPeriodClosed（已结账期间拒绝写入）
 */
import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  VOUCHER_ENTRY_INSERT_SQL,
  buildVoucherEntryPayloads,
  loadVoucherAuxiliaryData,
  getNextVoucherNo,
  getVoucherBalanceError,
  getPeriodClosingRecord,
  isPeriodClosed,
  type VoucherEntryInput,
  type AuxCategoryLike,
  type AuxItemLike,
} from './voucherEntry.js'
import { parseAccountAuxCategoryIds } from '../utils/auxItemId.js'
import { createAccountAuxRequirementLookup, describeMissingAux, findEntriesMissingAux, type AccountAuxRequirementLookup } from './auxRequirement.js'
import { assertNotBeforeGlStart } from './voucherMutationGuard.js'

/** 资产模块产生的凭证来源标记（voucher.ts 依据 asset_ 前缀拦截直接删除） */
export type AssetVoucherSource =
  | 'asset_purchase'
  | 'asset_depr'
  | 'asset_disposal'
  | 'asset_inventory'
  | 'asset_change'
  | 'asset_impairment'

/** 资产参数默认值：参数未配置时的回退值 */
export const ASSET_PARAM_DEFAULTS: Record<string, string> = {
  'asset:disposal_bank_account': '1001',
  'asset:disposal_gain_account': '6301',
  'asset:disposal_loss_account': '6711',
  'asset:impairment_loss_account': '6701',
  'asset:aux_dept_category_code': 'dept',
  'asset:aux_person_category_code': 'person',
}

/**
 * AS-P0-1：残值率统一为小数口径（0~1，如 0.05 表示 5%）。
 * 历史上卡片页/类别字典按百分数（5 表示 5%）录入并原样写库，
 * 而消费端（原值变动重算残值等）按小数乘——直接产生残值=原值×5 的坏数据。
 * 所有写入入口统一经此归一：>1 视为百分数 ÷100；非法输入返回 null。
 * P2-14：归一后 >= 1（100%）同样返回 null——残值等于原值时可折旧额为 0，
 * 资产会从折旧预览里整行消失且无任何提示；用户输入 100（本意 100%）÷100 后也落同一陷阱。
 */
export function normalizeSalvageRate(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (n < 0) return null
  const normalized = n > 1 ? Math.round((n / 100) * 1e6) / 1e6 : n
  return normalized >= 1 ? null : normalized
}

/** 读取单个资产参数；未配置时返回 ASSET_PARAM_DEFAULTS 中的默认值 */
export function getAssetParam(db: Database, accountSetId: string, key: string): string | null {
  const row = db
    .prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(accountSetId, key) as { param_value?: string } | undefined
  const value = (row?.param_value ?? '').trim()
  return value || ASSET_PARAM_DEFAULTS[key] || null
}

// ── 期间结账校验（P0-5）────────────────────────────────────────────────

/** 目标会计期间若已结账则抛错；供折旧、处置、变动等所有写账动作前置调用 */
export function assertPeriodOpen(
  db: Database,
  accountSetId: string,
  year: number,
  period: number
): void {
  const record = getPeriodClosingRecord({ db, accountSetId, year, period })
  if (isPeriodClosed(record)) {
    throw new Error(`${year}年${period}月已结账，请先在「期末结账」中取消结账后再操作`)
  }
}

/**
 * P1-20：变动 / 处置 / 盘点日期不得晚于当前自然月。
 * 此前只挡"已结账"与"早于最后一次折旧"，填成未来日期的变动会立刻改写卡片原值 / 净值，
 * 当月计提就按"未来才生效"的新基数摊余，处置填未来日期则当月漏提，期间归属与报表口径全错。
 * 与「不能对晚于当前月份计提折旧」（routes/fixedAsset.ts 计提执行）同口径。
 */
export function assertNotAfterCurrentPeriod(year: number, period: number, label = '业务日期'): void {
  const now = new Date()
  const nowKey = now.getFullYear() * 100 + (now.getMonth() + 1)
  if (year * 100 + period > nowKey) {
    throw new Error(`${label}不能晚于当前月份（${now.getFullYear()}年${now.getMonth() + 1}月）`)
  }
}

// ── 辅助核算上下文（P0-1）──────────────────────────────────────────────

export interface AssetAuxContext {
  categories: AuxCategoryLike[]
  itemMap: Record<string, AuxItemLike>
  /** 部门辅助核算类别，账套未启用时为 null */
  deptCategory: { id: string; code: string } | null
  /** 人员辅助核算类别，账套未启用时为 null */
  personCategory: { id: string; code: string } | null
}

/**
 * 载入本账套的辅助核算上下文。
 * 部门/人员类别由参数 asset:aux_dept_category_code / asset:aux_person_category_code 指定
 * （默认 dept / person），账套未建对应类别时为 null，调用方据此跳过辅助项填充。
 */
export function loadAssetAuxContext(db: Database, accountSetId: string): AssetAuxContext {
  const { categories, itemMap } = loadVoucherAuxiliaryData({ db, accountSetId })
  const deptCode = getAssetParam(db, accountSetId, 'asset:aux_dept_category_code')
  const personCode = getAssetParam(db, accountSetId, 'asset:aux_person_category_code')
  const pick = (code: string | null) => {
    if (!code) return null
    const hit = categories.find(c => c.code === code)
    return hit ? { id: hit.id, code: hit.code } : null
  }
  return { categories, itemMap, deptCategory: pick(deptCode), personCategory: pick(personCode) }
}

/**
 * 在指定辅助核算类别下按 code 精确匹配、再按 name 精确匹配，找到 aux_items.id。
 * 资产自己的部门字典（fixed_asset_dept）与系统辅助核算部门档案是两套数据，
 * 这里用「编码优先、名称兜底」把两者对上；对不上返回 null（不阻断凭证生成）。
 */
export function resolveAuxItemId(
  db: Database,
  accountSetId: string,
  categoryId: string,
  code: string | null | undefined,
  name: string | null | undefined
): string | null {
  const byCode = (code || '').trim()
  if (byCode) {
    const hit = db
      .prepare('SELECT id FROM aux_items WHERE account_set_id=? AND type=? AND code=? LIMIT 1')
      .get(accountSetId, categoryId, byCode) as { id?: string } | undefined
    if (hit?.id) return hit.id
  }
  const byName = (name || '').trim()
  if (byName) {
    const hit = db
      .prepare('SELECT id FROM aux_items WHERE account_set_id=? AND type=? AND name=? LIMIT 1')
      .get(accountSetId, categoryId, byName) as { id?: string } | undefined
    if (hit?.id) return hit.id
  }
  return null
}

/** 某科目是否启用了指定辅助核算类别（accounts.is_aux=1 且 aux_types 含该类别 id） */
export function accountAcceptsAuxCategory(
  db: Database,
  accountSetId: string,
  accountCode: string,
  categoryId: string
): boolean {
  const row = db
    .prepare('SELECT is_aux, aux_types FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
    .get(accountSetId, accountCode) as { is_aux?: number; aux_types?: string } | undefined
  if (!row || !row.is_aux) return false
  return parseAccountAuxCategoryIds(row.aux_types).includes(categoryId)
}

/**
 * 解析某张资产卡片对应的辅助核算项引用，返回可直接展开到分录对象上的键值：
 *   { _dept_id: 'xxx', _person_id: 'yyy' }（键名中的 dept/person 为实际类别编码）
 * buildVoucherEntryPayloads 会据此填 dept_id/dept_name、person_id/person_name 与 aux_data。
 */
export function resolveAssetAuxRefs(
  db: Database,
  accountSetId: string,
  asset: { dept_code?: string | null; user_name?: string | null },
  ctx: AssetAuxContext
): Record<string, string> {
  const refs: Record<string, string> = {}
  if (ctx.deptCategory && asset.dept_code) {
    const deptName = (
      db
        .prepare('SELECT name FROM fixed_asset_dept WHERE account_set_id=? AND code=? LIMIT 1')
        .get(accountSetId, asset.dept_code) as { name?: string } | undefined
    )?.name
    const id = resolveAuxItemId(db, accountSetId, ctx.deptCategory.id, asset.dept_code, deptName)
    if (id) refs[`_${ctx.deptCategory.code}_id`] = id
  }
  if (ctx.personCategory && asset.user_name) {
    const id = resolveAuxItemId(db, accountSetId, ctx.personCategory.id, null, asset.user_name)
    if (id) refs[`_${ctx.personCategory.code}_id`] = id
  }
  return refs
}

/**
 * 按科目实际启用的辅助核算类别过滤引用：科目没开部门核算就不要塞部门，
 * 避免污染辅助明细账。
 */
export function auxRefsForAccount(
  db: Database,
  accountSetId: string,
  accountCode: string,
  refs: Record<string, string>,
  ctx: AssetAuxContext
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(refs)) {
    // `_dept_id` → `dept`
    const code = key.slice(1, -3)
    const category = ctx.categories.find(c => c.code === code)
    if (!category) continue
    if (accountAcceptsAuxCategory(db, accountSetId, accountCode, category.id)) {
      out[key] = value
    }
  }
  return out
}

// ── 必填辅助核算检查 ───────────────────────────────────────────────────

export interface AssetAuxSubject {
  asset_no?: string | null
  asset_name?: string | null
  dept_code?: string | null
  user_name?: string | null
}

/**
 * 某张卡片在给定科目上缺哪些必填辅助核算，返回原因文字（空数组 = 齐全）。
 * 部门 / 使用人可由卡片自动带出，区分「卡片未填」与「总账辅助里找不到」；其余类别固定资产无法自动填写。
 */
export function assetAuxIssues(
  db: Database,
  accountSetId: string,
  ctx: AssetAuxContext,
  lookup: AccountAuxRequirementLookup,
  asset: AssetAuxSubject,
  accountCodes: string[],
): string[] {
  const issues: string[] = []
  const refs = resolveAssetAuxRefs(db, accountSetId, asset, ctx)
  for (const code of new Set(accountCodes.filter(Boolean))) {
    const req = lookup(code)
    if (!req) continue
    for (const cat of req.categories) {
      if (refs[`_${cat.code}_id`]) continue
      let why: string
      if (ctx.deptCategory?.id === cat.id) {
        why = asset.dept_code ? `使用部门「${asset.dept_code}」在总账「${cat.name}」辅助核算中找不到` : '未填使用部门'
      } else if (ctx.personCategory?.id === cat.id) {
        why = asset.user_name ? `使用人「${asset.user_name}」在总账「${cat.name}」辅助核算中找不到` : '未填使用人'
      } else {
        why = `科目要求「${cat.name}」辅助核算，固定资产凭证无法自动填写`
      }
      const text = `${why}（科目 ${req.code} ${req.name}）`
      if (!issues.includes(text)) issues.push(text)
    }
  }
  return issues
}

/** 多张卡片的问题汇总成一句错误提示 */
export function formatAssetAuxIssues(list: Array<{ asset: AssetAuxSubject; issues: string[] }>, limit = 5): string {
  const head = list.slice(0, limit)
    .map(x => `${[x.asset.asset_no, x.asset.asset_name].filter(Boolean).join(' ')}：${x.issues.join('、')}`)
    .join('；')
  return `以下资产卡片的辅助核算不全，未生成凭证：${head}${list.length > limit ? `；等共 ${list.length} 张` : ''}。请补全卡片使用部门 / 使用人，或在总账辅助核算中建立对应项目后重新生成。`
}

/**
 * 卡片保存时的提醒（不拦截）：按该卡片折旧要用的科目（用途折旧费用科目、类别累计折旧科目、类别原值科目）检查。
 */
export function assetCardAuxWarnings(db: Database, accountSetId: string, card: AssetAuxSubject & { purpose_code?: string | null; category_code?: string | null }): string[] {
  const purpose = card.purpose_code
    ? db.prepare('SELECT expense_account FROM fixed_asset_purpose WHERE account_set_id=? AND code=?').get(accountSetId, card.purpose_code) as { expense_account?: string } | undefined
    : undefined
  const category = card.category_code
    ? db.prepare('SELECT account_code, depr_account_code FROM fixed_asset_category WHERE account_set_id=? AND code=?').get(accountSetId, card.category_code) as { account_code?: string; depr_account_code?: string } | undefined
    : undefined
  const codes = [purpose?.expense_account || '', category?.depr_account_code || '', category?.account_code || ''].filter(Boolean)
  if (!codes.length) return []
  return assetAuxIssues(db, accountSetId, loadAssetAuxContext(db, accountSetId), createAccountAuxRequirementLookup(db, accountSetId), card, codes)
}

// ── 科目查找 ───────────────────────────────────────────────────────────

export interface ResolvedAccount {
  id: string
  code: string
  name: string
}

/**
 * 批量解析科目编码；任一不存在即抛出明确错误，杜绝「静默跳过分录」导致的借贷不平。
 * 与 fixedAssetDepreciation.generateDeprVoucher 的预检口径保持一致。
 */
export function resolveAccounts(
  db: Database,
  accountSetId: string,
  codes: Array<string | null | undefined>,
  scene: string
): Map<string, ResolvedAccount> {
  const hasParentCol = (db.prepare("SELECT 1 AS ok FROM pragma_table_info('accounts') WHERE name='parent_id'").get() as any)?.ok === 1
  const stmt = db.prepare(
    `SELECT id, code, name,
            ${hasParentCol ? 'EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = accounts.id)' : '0'} AS has_child
     FROM accounts WHERE account_set_id=? AND code=? LIMIT 1`
  )
  const map = new Map<string, ResolvedAccount>()
  const missing: string[] = []
  const nonLeaf: string[] = []
  for (const raw of codes) {
    const code = (raw || '').trim()
    if (!code || map.has(code)) continue
    const row = stmt.get(accountSetId, code) as (ResolvedAccount & { has_child: number }) | undefined
    if (!row) missing.push(code)
    else if (row.has_child) nonLeaf.push(`${row.code} ${row.name}`)
    else map.set(code, { id: row.id, code: row.code, name: row.name })
  }
  // 非末级科目不能直接记账：余额表按末级汇总父科目，直接记在父科目上的金额会被丢掉，导致试算不平
  if (nonLeaf.length > 0) {
    throw new Error(
      `以下科目有下级科目，不能直接记账，无法生成${scene}凭证：${[...new Set(nonLeaf)].join('、')}。请在「资产类别」中改用末级科目。`
    )
  }
  if (missing.length > 0) {
    throw new Error(
      `以下科目在账套中不存在，无法生成${scene}凭证：${[...new Set(missing)].join('、')}。请先在「会计科目」中建立对应科目。`
    )
  }
  return map
}

// ── 凭证写入 ───────────────────────────────────────────────────────────

export interface InsertAssetVoucherParams {
  db: Database
  accountSetId: string
  source: AssetVoucherSource
  voucherDate: string
  year: number
  period: number
  remark: string
  makerName: string
  voucherTypeId?: string | null
  entries: VoucherEntryInput[]
  /** 已加载的辅助核算上下文；不传则内部现取 */
  auxContext?: AssetAuxContext
  /** 跳过期间结账校验（外层已校验时使用） */
  skipPeriodCheck?: boolean
}

export interface InsertAssetVoucherResult {
  voucherId: string
  voucherNo: string
  entryCount: number
  totalAmount: number
}

/**
 * 统一写入一张资产凭证：期间校验 → 借贷平衡校验 → 取号 → 插 vouchers → 插 voucher_entries。
 * 分录一律经 buildVoucherEntryPayloads 落库，辅助核算字段随之写入。
 */
export function insertAssetVoucher(params: InsertAssetVoucherParams): InsertAssetVoucherResult {
  const { db, accountSetId, source, voucherDate, year, period, remark, makerName, entries } = params

  if (!entries || entries.length < 2) {
    throw new Error('凭证分录不足两条，无法生成凭证')
  }
  if (!params.skipPeriodCheck) {
    assertPeriodOpen(db, accountSetId, year, period)
  }
  // 不受 skipPeriodCheck 影响：开账日期前不允许生成任何资产凭证
  assertNotBeforeGlStart(db, accountSetId, voucherDate)

  const balanceError = getVoucherBalanceError(entries)
  if (balanceError) {
    throw new Error(`生成的凭证借贷不平（${balanceError}），已中止。请检查相关科目配置。`)
  }
  // 科目挂了辅助核算而分录未带（卡片缺使用部门 / 使用人等）：不生成过不了账的凭证
  const missingAux = findEntriesMissingAux(createAccountAuxRequirementLookup(db, accountSetId), entries)
  if (missingAux.length) {
    throw new Error(`辅助核算不全，未生成凭证：${describeMissingAux(missingAux)}。请补全资产卡片的使用部门 / 使用人，或在总账辅助核算中建立对应项目。`)
  }

  const { effectiveTypeId, voucherNo } = getNextVoucherNo({
    db,
    accountSetId,
    year,
    period,
    voucherTypeId: params.voucherTypeId ?? null,
  })

  const totalAmount =
    Math.round(
      entries
        .filter(e => e.direction === 'debit')
        .reduce((sum, e) => sum + Number(e.amount || 0), 0) * 100
    ) / 100

  const voucherId = uuidv4()
  db.prepare(
    `INSERT INTO vouchers
       (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period,
        total_amount, maker_name, remark, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    voucherId,
    accountSetId,
    voucherNo,
    effectiveTypeId ?? null,
    voucherDate,
    year,
    period,
    totalAmount,
    makerName,
    remark,
    source
  )

  const ctx = params.auxContext ?? loadAssetAuxContext(db, accountSetId)
  const payloads = buildVoucherEntryPayloads({
    db,
    accountSetId,
    voucherId,
    entries,
    categories: ctx.categories,
    itemMap: ctx.itemMap,
  })
  const insEntry = db.prepare(VOUCHER_ENTRY_INSERT_SQL)
  for (const payload of payloads) {
    insEntry.run(...payload)
  }

  return { voucherId, voucherNo, entryCount: entries.length, totalAmount }
}

/** 当月最后一天，作为期末类凭证（折旧等）的凭证日期 */
export function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
