/**
 * 凭证 Excel 转出 / 转入（凭证录入页工具栏「转出」「转入」）
 *
 * 文件格式：一行一条分录，固定列 + 每个辅助核算类别一列（表头 = 类别名称，值 = 项目名称）。
 * 分组键 = 凭证类型 + 凭证日期 + 凭证序号，同组多行合成一张凭证。
 *
 * 转入口径：全部行合法才写入，不做部分导入；凭证号按选项在写入事务内顺排。
 */
import { v4 as uuidv4 } from 'uuid'
import dayjs from 'dayjs'
import type Database from 'better-sqlite3'
import { yuanToCents } from '../utils/amountUtils.js'
import { parseAccountAuxCategoryIds } from '../utils/auxItemId.js'
import {
  assertVoucherEntriesInAccountScope,
  type AccountScopeContext,
} from './accountAuthorization.js'
import {
  buildVoucherEntryPayloads,
  buildVoucherNo,
  calculateVoucherTotals,
  findVoucherNoConflict,
  getEffectiveVoucherTypeId,
  getMaxVoucherNoSeqInPeriod,
  getVoucherBalanceError,
  loadVoucherAuxiliaryData,
  validateVoucherDate,
  validateVoucherEntriesCashFlow,
  validateVoucherEntriesForeignCurrency,
  validateVoucherEntriesQuantity,
  validateVoucherEntryAmounts,
  validateVoucherEntryCount,
  VOUCHER_ENTRY_INSERT_SQL,
  type VoucherEntryInput,
  getVoucherTimeControlMaxDate,
  validateNoNegativeBalanceRealtime,
} from './voucherEntry.js'
import { syncCashierFromVoucher } from './cashierQuery.js'

export interface VoucherExcelColumn {
  key: string
  label: string
  required: boolean
  /** 辅助核算动态列：类别 code */
  auxCategoryCode?: string
}

export interface VoucherExcelImportOptions {
  /** original：按 Excel 原日期；monthEnd：统一改为 targetYear/targetPeriod 的最后一天 */
  dateMode: 'original' | 'monthEnd'
  targetYear?: number
  targetPeriod?: number
  /** auto：按当期该类型最大号 +1 顺排；manual：从 startNo 起顺排 */
  numberMode: 'auto' | 'manual'
  startNo?: number
}

export interface VoucherExcelRowError {
  /** Excel 行号（表头为第 1 行，数据从第 2 行起） */
  row: number
  field?: string
  message: string
}

export interface ParsedVoucher {
  /** 分组键 */
  groupKey: string
  seqLabel: string
  voucherTypeId: string | null
  voucherTypeName: string
  voucherDate: string
  year: number
  period: number
  remark: string
  entries: VoucherEntryInput[]
  /** 该凭证涉及的 Excel 行号 */
  rows: number[]
  totalDebit: number
  totalCredit: number
}

/** 固定列（顺序即 Excel 列顺序） */
export const VOUCHER_EXCEL_FIXED_COLUMNS: VoucherExcelColumn[] = [
  { key: 'seq', label: '凭证序号', required: true },
  { key: 'voucher_type', label: '凭证类型', required: false },
  { key: 'voucher_date', label: '凭证日期', required: true },
  { key: 'summary', label: '摘要', required: false },
  { key: 'account_code', label: '科目编码', required: true },
  { key: 'account_name', label: '科目名称', required: false },
  { key: 'debit', label: '借方金额', required: false },
  { key: 'credit', label: '贷方金额', required: false },
  { key: 'currency_code', label: '币种', required: false },
  { key: 'exchange_rate', label: '汇率', required: false },
  { key: 'foreign_amount', label: '外币金额', required: false },
  { key: 'quantity', label: '数量', required: false },
  { key: 'unit', label: '单位', required: false },
  { key: 'unit_price', label: '单价', required: false },
  { key: 'cash_flow_code', label: '现金流量代码', required: false },
  { key: 'cash_flow_name', label: '现金流量名称', required: false },
  { key: 'remark', label: '备注', required: false },
]

export function getVoucherExcelColumns(db: Database.Database, accountSetId: string): VoucherExcelColumn[] {
  const categories = db
    .prepare('SELECT code, name FROM aux_categories WHERE account_set_id=? ORDER BY sort_order, code')
    .all(accountSetId) as Array<{ code: string; name: string }>
  return [
    ...VOUCHER_EXCEL_FIXED_COLUMNS,
    ...categories.map(c => ({
      key: `aux_${c.code}`,
      label: c.name,
      required: false,
      auxCategoryCode: c.code,
    })),
  ]
}

function str(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/** 把 Excel 单元格日期规范成 YYYY-MM-DD；无法识别返回 null */
export function normalizeExcelDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : dayjs(v).format('YYYY-MM-DD')
  }
  if (typeof v === 'number') {
    // Excel 序列号（1900 日期系统），按 UTC 换算避免时区偏移
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  const s = String(v).trim().replace(/[./年月]/g, '-').replace(/日$/, '')
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const da = Number(m[3])
  const d = new Date(y, mo - 1, da)
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`
}

export function monthEndDate(year: number, period: number): string {
  return dayjs(`${year}-${String(period).padStart(2, '0')}-01`).endOf('month').format('YYYY-MM-DD')
}

interface AccountRow {
  id: string
  code: string
  name: string
  is_enabled: number
  is_leaf: number
  aux_types: string | null
}

/**
 * 解析 + 校验前端按表头反查 key 后的行数据，返回按凭证分组的结果与错误列表。
 * rows[i] 对应 Excel 第 i+2 行。
 */
export function parseVoucherExcelRows(params: {
  db: Database.Database
  accountSetId: string
  rows: Array<Record<string, unknown>>
  options: VoucherExcelImportOptions
  accountScope?: AccountScopeContext
}): { vouchers: ParsedVoucher[]; errors: VoucherExcelRowError[] } {
  const { db, accountSetId, rows, options } = params
  const errors: VoucherExcelRowError[] = []
  const push = (row: number, message: string, field?: string) => errors.push({ row, field, message })

  // 选项校验
  if (options.dateMode === 'monthEnd') {
    const y = Number(options.targetYear)
    const p = Number(options.targetPeriod)
    if (!Number.isInteger(y) || !Number.isInteger(p) || p < 1 || p > 12) {
      push(0, '请指定要统一到的年份与月份')
    }
  }
  if (options.numberMode === 'manual') {
    const s = Number(options.startNo)
    if (!Number.isInteger(s) || s < 1) push(0, '手动起始号必须是 ≥ 1 的整数')
  }

  // 基础数据
  const accounts = db
    .prepare(
      `SELECT a.id, a.code, a.name, a.is_enabled, a.aux_types,
              CASE WHEN EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id) THEN 0 ELSE 1 END AS is_leaf
       FROM accounts a WHERE a.account_set_id=?`
    )
    .all(accountSetId) as AccountRow[]
  const accountByCode = new Map(accounts.map(a => [a.code, a]))

  const voucherTypes = db
    .prepare('SELECT id, name, code FROM voucher_types WHERE account_set_id=? ORDER BY sort_order')
    .all(accountSetId) as Array<{ id: string; name: string; code: string }>
  const resolveVoucherType = (raw: string) => {
    if (!raw) return undefined
    return (
      voucherTypes.find(t => t.name === raw) ||
      voucherTypes.find(t => t.code === raw) ||
      voucherTypes.find(t => t.name.charAt(0) === raw.charAt(0) && raw.length <= 2)
    )
  }

  const categories = db
    .prepare('SELECT id, code, name FROM aux_categories WHERE account_set_id=?')
    .all(accountSetId) as Array<{ id: string; code: string; name: string }>
  const categoryById = new Map(categories.map(c => [c.id, c]))
  const items = db
    .prepare("SELECT id, type, code, name FROM aux_items WHERE account_set_id=? AND status='active'")
    .all(accountSetId) as Array<{ id: string; type: string; code: string; name: string }>
  // 类别 id → (名称/编码 → item)
  const itemIndex = new Map<string, { byName: Map<string, string[]>; byCode: Map<string, string> }>()
  for (const it of items) {
    let idx = itemIndex.get(it.type)
    if (!idx) {
      idx = { byName: new Map(), byCode: new Map() }
      itemIndex.set(it.type, idx)
    }
    idx.byCode.set(it.code, it.id)
    const arr = idx.byName.get(it.name) || []
    arr.push(it.id)
    idx.byName.set(it.name, arr)
  }
  const resolveAuxItem = (categoryId: string, raw: string): { id?: string; error?: string } => {
    const idx = itemIndex.get(categoryId)
    if (!idx) return { error: '该类别下没有可用的核算项目' }
    const byName = idx.byName.get(raw)
    if (byName?.length === 1) return { id: byName[0] }
    if (byName && byName.length > 1) return { error: `名称「${raw}」在该类别下重复，请改用编码` }
    const byCode = idx.byCode.get(raw)
    if (byCode) return { id: byCode }
    // 支持「编码 名称」/「编码|名称」写法
    const m = raw.match(/^(\S+)[\s|]+(.+)$/)
    if (m && idx.byCode.get(m[1])) return { id: idx.byCode.get(m[1]) }
    return { error: `核算项目「${raw}」不存在或已停用` }
  }

  const monthEnd =
    options.dateMode === 'monthEnd' && errors.length === 0
      ? monthEndDate(Number(options.targetYear), Number(options.targetPeriod))
      : null

  // 逐行解析
  const groups = new Map<string, ParsedVoucher>()
  const order: string[] = []
  // 行级出错的凭证序号：其所在凭证不再做整张校验（避免「至少两条分录」之类的连带报错）
  const badSeqs = new Set<string>()
  rows.forEach((raw, i) => {
    const rowNo = i + 2
    const seq = str(raw.seq)
    const typeRaw = str(raw.voucher_type)
    const dateRaw = raw.voucher_date
    const summary = str(raw.summary)
    const code = str(raw.account_code)
    const debit = num(raw.debit)
    const credit = num(raw.credit)

    let rowOk = true
    if (!seq) {
      push(rowNo, '凭证序号不能为空', 'seq')
      rowOk = false
    }
    let date = normalizeExcelDate(dateRaw)
    if (!date) {
      push(rowNo, '凭证日期为空或格式无法识别（应为 YYYY-MM-DD）', 'voucher_date')
      rowOk = false
    }
    const account = code ? accountByCode.get(code) : undefined
    if (!code) {
      push(rowNo, '科目编码不能为空', 'account_code')
      rowOk = false
    } else if (!account) {
      push(rowNo, `科目编码「${code}」不存在`, 'account_code')
      rowOk = false
    } else if (Number(account.is_enabled) === 0) {
      push(rowNo, `科目「${code} ${account.name}」已停用`, 'account_code')
      rowOk = false
    } else if (Number(account.is_leaf) === 0) {
      push(rowNo, `科目「${code} ${account.name}」不是末级科目`, 'account_code')
      rowOk = false
    }
    const hasDebit = debit != null && yuanToCents(debit) !== 0
    const hasCredit = credit != null && yuanToCents(credit) !== 0
    if (hasDebit && hasCredit) {
      push(rowNo, '借方金额与贷方金额只能填一个', 'debit')
      rowOk = false
    } else if (!hasDebit && !hasCredit) {
      push(rowNo, '借方金额或贷方金额必须填写且不能为 0', 'debit')
      rowOk = false
    }
    let voucherType: { id: string; name: string } | undefined
    if (typeRaw) {
      voucherType = resolveVoucherType(typeRaw)
      if (!voucherType) {
        push(rowNo, `凭证类型「${typeRaw}」不存在`, 'voucher_type')
        rowOk = false
      }
    }
    if (!rowOk || !account || !date) {
      if (seq) badSeqs.add(seq)
      return
    }

    // 辅助核算：科目挂了哪些类别就必须填哪些；未挂的类别忽略
    const entry: VoucherEntryInput = {
      account_id: account.id,
      account_code: account.code,
      account_name: account.name,
      direction: hasDebit ? 'debit' : 'credit',
      amount: hasDebit ? (debit as number) : (credit as number),
      summary,
      currency_code: str(raw.currency_code) || null,
      exchange_rate: num(raw.exchange_rate),
      foreign_amount: num(raw.foreign_amount),
      quantity: num(raw.quantity),
      unit: str(raw.unit) || null,
      unit_price: num(raw.unit_price),
      cash_flow_code: str(raw.cash_flow_code) || null,
      cash_flow_name: str(raw.cash_flow_name) || null,
    }
    let auxOk = true
    for (const catId of parseAccountAuxCategoryIds(account.aux_types)) {
      const cat = categoryById.get(catId)
      if (!cat) continue
      const val = str(raw[`aux_${cat.code}`])
      if (!val) {
        push(rowNo, `科目「${account.name}」需要填写辅助核算【${cat.name}】`, `aux_${cat.code}`)
        auxOk = false
        continue
      }
      const r = resolveAuxItem(cat.id, val)
      if (!r.id) {
        push(rowNo, `【${cat.name}】${r.error}`, `aux_${cat.code}`)
        auxOk = false
        continue
      }
      entry[`_${cat.code}_id`] = r.id
    }
    if (!auxOk) {
      badSeqs.add(seq)
      return
    }

    const originalDate = date
    if (monthEnd) date = monthEnd
    const typeId = voucherType?.id ?? null
    const groupKey = `${typeId ?? ''}${originalDate}${seq}`
    let g = groups.get(groupKey)
    if (!g) {
      const d = dayjs(date)
      g = {
        groupKey,
        seqLabel: seq,
        voucherTypeId: typeId,
        voucherTypeName: voucherType?.name || '',
        voucherDate: date,
        year: d.year(),
        period: d.month() + 1,
        remark: str(raw.remark),
        entries: [],
        rows: [],
        totalDebit: 0,
        totalCredit: 0,
      }
      groups.set(groupKey, g)
      order.push(groupKey)
    }
    g.entries.push(entry)
    g.rows.push(rowNo)
  })

  // 逐张凭证校验（复用手工录入的那套规则）
  const closedCache = new Map<string, boolean>()
  const isClosed = (year: number, period: number) => {
    const k = `${year}-${period}`
    let v = closedCache.get(k)
    if (v === undefined) {
      v = !!db
        .prepare(
          `SELECT 1 FROM period_closing WHERE account_set_id=? AND year=? AND period=? AND status='closed'`
        )
        .get(accountSetId, year, period)
      closedCache.set(k, v)
    }
    return v
  }
  const vouchers: ParsedVoucher[] = []
  // 评审 P1-7：与手工录入同口径补「凭证时序控制」与「禁负余额」——
  // 整批按文件顺序累计：时序取「库内最大日期」与本批已通过凭证日期的较大者；负余额按本批已通过分录 + 本张累计校验
  let timeControlMax = getVoucherTimeControlMaxDate(db, accountSetId)
  const acceptedEntries: VoucherEntryInput[] = []
  for (const key of order) {
    const g = groups.get(key)!
    if (badSeqs.has(g.seqLabel)) continue
    const firstRow = g.rows[0]
    const label = `凭证「${g.seqLabel}」（第 ${g.rows.join('、')} 行）`
    // 补默认凭证类型
    if (!g.voucherTypeId) {
      g.voucherTypeId = getEffectiveVoucherTypeId({
        db,
        accountSetId,
        year: g.year,
        period: g.period,
      })
      g.voucherTypeName = g.voucherTypeId
        ? ((db.prepare('SELECT name FROM voucher_types WHERE id=?').get(g.voucherTypeId) as any)?.name ?? '')
        : ''
    }
    const checks: Array<() => string | null> = [
      () => validateVoucherEntryCount(g.entries) && `${label}至少需要两条分录`,
      () => validateVoucherEntryAmounts(g.entries),
      () => getVoucherBalanceError(g.entries),
      () => validateVoucherDate({ voucherDate: g.voucherDate, accountSetId, db }),
      () => (isClosed(g.year, g.period) ? `${g.year}年${g.period}期已结账，不能转入凭证` : null),
      () =>
        timeControlMax && g.voucherDate < timeControlMax
          ? `日期 ${g.voucherDate} 早于 ${timeControlMax}，凭证时序控制已开启，不允许录入早于已有凭证的日期`
          : null,
      () => validateVoucherEntriesCashFlow(db, accountSetId, g.entries),
      () => validateVoucherEntriesForeignCurrency(db, accountSetId, g.entries),
      () => validateVoucherEntriesQuantity(db, accountSetId, g.entries),
      () =>
        assertVoucherEntriesInAccountScope(
          params.accountScope || { bypass: true, restricted: false, allowedAccountIds: new Set() },
          g.entries.map(e => e.account_id)
        ),
      () => {
        const neg = validateNoNegativeBalanceRealtime(db, accountSetId, [...acceptedEntries, ...g.entries], g.year, g.period)
        return neg ? `${neg.message}${acceptedEntries.length ? '（含本批前面凭证的累计影响）' : ''}` : null
      },
    ]
    let bad = false
    for (const check of checks) {
      const msg = check()
      if (msg) {
        push(firstRow, `${label}${msg}`)
        bad = true
        break
      }
    }
    if (bad) continue
    const totals = calculateVoucherTotals(g.entries)
    g.totalDebit = totals.debitTotal
    g.totalCredit = totals.creditTotal
    vouchers.push(g)
    acceptedEntries.push(...g.entries)
    if (timeControlMax !== null && g.voucherDate > timeControlMax) timeControlMax = g.voucherDate
  }

  errors.sort((a, b) => a.row - b.row)
  return { vouchers, errors }
}

/**
 * 写入凭证：同一事务内按（类型, 年, 期）分组顺排编号；任一冲突整批回滚。
 */
export function importParsedVouchers(params: {
  db: Database.Database
  accountSetId: string
  userId?: string
  userName?: string
  vouchers: ParsedVoucher[]
  options: VoucherExcelImportOptions
}): { created: number; voucherIds: string[]; voucherNos: string[] } {
  const { db, accountSetId, vouchers, options } = params
  const { categories, itemMap } = loadVoucherAuxiliaryData({ db, accountSetId })
  const insertVoucher = db.prepare(`
    INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, total_amount, maker_id, maker_name, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertEntry = db.prepare(VOUCHER_ENTRY_INSERT_SQL)
  const typeNameStmt = db.prepare('SELECT name FROM voucher_types WHERE id=?')

  const created: Array<{ id: string; no: string; v: ParsedVoucher }> = []

  const tx = db.transaction(() => {
    // 每个（类型,年,期）的当前最大号
    const counters = new Map<string, number>()
    for (const v of vouchers) {
      const k = `${v.voucherTypeId ?? ''}|${v.year}|${v.period}`
      let maxNo = counters.get(k)
      if (maxNo === undefined) {
        maxNo =
          options.numberMode === 'manual'
            ? Number(options.startNo) - 1
            : getMaxVoucherNoSeqInPeriod({
                db,
                accountSetId,
                year: v.year,
                period: v.period,
                voucherTypeId: v.voucherTypeId,
              })
      }
      maxNo += 1
      counters.set(k, maxNo)
      const typeName = v.voucherTypeId ? ((typeNameStmt.get(v.voucherTypeId) as any)?.name as string | undefined) : undefined
      const voucherNo = buildVoucherNo({ maxNo: maxNo - 1, typeName })
      const conflict = findVoucherNoConflict({
        db,
        accountSetId,
        year: v.year,
        period: v.period,
        voucherTypeId: v.voucherTypeId,
        voucherNo,
      })
      if (conflict) {
        throw new Error(
          `${v.year}年${v.period}期凭证号 ${voucherNo} 已被占用（凭证「${v.seqLabel}」），请改用其他起始号或按最大号顺排`
        )
      }
      const voucherId = uuidv4()
      insertVoucher.run(
        voucherId,
        accountSetId,
        voucherNo,
        v.voucherTypeId,
        v.voucherDate,
        v.year,
        v.period,
        v.totalDebit,
        params.userId ?? null,
        params.userName ?? null,
        v.remark || null
      )
      const payloads = buildVoucherEntryPayloads({
        db,
        accountSetId,
        voucherId,
        entries: v.entries,
        categories,
        itemMap,
      })
      payloads.forEach(p => insertEntry.run(...p))
      created.push({ id: voucherId, no: voucherNo, v })
    }
  })
  tx.immediate()

  // 出纳日记账同步（与手工录入一致，失败不影响转入结果）
  for (const c of created) {
    try {
      syncCashierFromVoucher({
        db,
        accountSetId,
        voucherDate: c.v.voucherDate,
        voucherYear: c.v.year,
        voucherMonth: c.v.period,
        voucherType: c.v.voucherTypeId,
        voucherNo: c.no,
        voucherId: c.id,
        entries: c.v.entries.map(e => ({
          account_code: e.account_code,
          direction: e.direction,
          amount: e.amount,
          summary: c.v.remark || e.summary || undefined,
          // FIX-260：外币出纳科目按原币写日记账
          currency_code: (e as any).currency_code ?? null,
          exchange_rate: (e as any).exchange_rate ?? null,
          foreign_amount: (e as any).foreign_amount ?? null,
        })),
      })
    } catch (err) {
      console.error('Excel 转入凭证→出纳同步失败:', err)
    }
  }

  return { created: created.length, voucherIds: created.map(c => c.id), voucherNos: created.map(c => c.no) }
}
