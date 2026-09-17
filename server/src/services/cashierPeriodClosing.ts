import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

/**
 * 出纳月结（独立于总账 period_closing）。
 *
 * - 结账：该月及更早月份的出纳日记账不再允许增删改 / 导入 / 生成或删除凭证；
 *   须按月顺序结账（更早的有数据月份必须先结）。
 * - 反结账：只能从最近一个已结月份倒序撤销。
 * - 总账结账状态只作展示提示，不互相锁定（总账自身的闸口仍由 period_closing 保证）。
 */

export interface CashierPeriodRow {
  year: number
  month: number
  status: 'open' | 'closed'
  closed_by: string | null
  closed_by_name: string | null
  closed_at: string | null
}

export interface CashierPeriodMonthView extends CashierPeriodRow {
  /** 该月出纳日记账笔数 */
  journalCount: number
  /** 该月未生成凭证的日记账笔数 */
  unvoucheredCount: number
  /** 总账该期间是否已结账（仅展示） */
  glClosed: boolean
  /** 当前可执行的操作（前端按钮启用依据） */
  canClose: boolean
  canReopen: boolean
  /** 不可操作时的原因 */
  blockReason: string | null
}

function hasTable(db: Database, table: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

export function getCashierPeriodRecord(db: Database, accountSetId: string, year: number, month: number): CashierPeriodRow | null {
  if (!hasTable(db, 'cashier_period_closing')) return null
  return (db
    .prepare('SELECT year, month, status, closed_by, closed_by_name, closed_at FROM cashier_period_closing WHERE account_set_id=? AND year=? AND month=?')
    .get(accountSetId, year, month) as CashierPeriodRow | undefined) || null
}

export function isCashierPeriodClosed(db: Database, accountSetId: string, year: number, month: number): boolean {
  return getCashierPeriodRecord(db, accountSetId, year, month)?.status === 'closed'
}

/** 解析 YYYY-MM-DD 为年月；非法日期返回 null */
export function parseBizDate(bizDate: string | null | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(String(bizDate || ''))
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * 业务日期严格规范化为 YYYY-MM-DD（P1-7）。
 * 接受 `2026-01-05` / `2026/1/5` / `2026.1.5` / `20260105` / Excel 日期序列号（如 45876）/ Date 对象；
 * 非法或不存在的日期（如 2026-13-01、2026-02-30）抛错。此前写入口只判非空，
 * `2026/01/15` 这类原样入库后 parseBizDate 解析失败 → 结账闸静默放行、区间报表排序异常。
 */
export function normalizeBizDate(raw: unknown): string {
  let y = 0
  let m = 0
  let d = 0
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) throw new Error('日期不合法')
    y = raw.getFullYear()
    m = raw.getMonth() + 1
    d = raw.getDate()
  } else {
    const s = String(raw ?? '').trim()
    if (!s) throw new Error('日期不能为空')
    let mt: RegExpExecArray | null
    if ((mt = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T].*)?$/.exec(s))) {
      y = Number(mt[1]); m = Number(mt[2]); d = Number(mt[3])
    } else if ((mt = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
      y = Number(mt[1]); m = Number(mt[2]); d = Number(mt[3])
    } else if (/^\d{4,6}(\.\d+)?$/.test(s)) {
      // Excel 序列号：1900-01-00 起算（含 1900 闰年 bug，序列号 60 之后与 Unix 相差 25569 天）
      const serial = Number(s)
      if (serial < 61 || serial > 2958465) throw new Error(`日期不合法：${s}`)
      const dt = new Date(Math.round((serial - 25569) * 86400 * 1000))
      y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate()
    } else {
      throw new Error(`日期格式不合法：${s}，请使用 YYYY-MM-DD`)
    }
  }
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) throw new Error(`日期不合法：${String(raw)}`)
  const check = new Date(Date.UTC(y, m - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== m || check.getUTCDate() !== d) {
    throw new Error(`日期不存在：${y}-${pad2(m)}-${pad2(d)}`)
  }
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/**
 * 业务日期所在月已出纳结账则抛错；供日记账增删改、导入、生成/删除凭证前置调用。
 * 日期解析失败同样抛错（fail-closed，P1-7）——此前解析失败直接放行，异形日期可绕过闸口。
 */
export function assertCashierPeriodOpen(db: Database, accountSetId: string, bizDate: string | null | undefined): void {
  const ym = parseBizDate(bizDate)
  if (!ym) throw new Error(`日期格式不合法：${String(bizDate ?? '')}，请使用 YYYY-MM-DD`)
  if (isCashierPeriodClosed(db, accountSetId, ym.year, ym.month)) {
    throw new Error(`${ym.year}年${ym.month}月出纳已结账，请先在「出纳结账」中反结账后再操作`)
  }
}

/** 日期区间（含端点，缺省表示无界）内若有任一已结账月份则抛错 */
export function assertCashierRangeOpen(
  db: Database,
  accountSetId: string,
  startDate?: string | null,
  endDate?: string | null
): void {
  if (!hasTable(db, 'cashier_period_closing')) return
  const closed = db
    .prepare("SELECT year, month FROM cashier_period_closing WHERE account_set_id=? AND status='closed' ORDER BY year, month")
    .all(accountSetId) as Array<{ year: number; month: number }>
  const s = parseBizDate(startDate)
  const e = parseBizDate(endDate)
  for (const c of closed) {
    const key = c.year * 100 + c.month
    if (s && key < s.year * 100 + s.month) continue
    if (e && key > e.year * 100 + e.month) continue
    throw new Error(`${c.year}年${c.month}月出纳已结账，请先反结账后再操作`)
  }
}

/** 最近一个已结账月份（无则 null）；年份限定合法范围，防止脏行（如 2026.5）成为"最近已结月"锁死结账 */
export function getLatestClosedCashierPeriod(db: Database, accountSetId: string): { year: number; month: number } | null {
  if (!hasTable(db, 'cashier_period_closing')) return null
  return (db
    .prepare(
      `SELECT year, month FROM cashier_period_closing
        WHERE account_set_id=? AND status='closed'
          AND year BETWEEN 2000 AND 2100 AND month BETWEEN 1 AND 12
          AND CAST(year AS INTEGER) = year AND CAST(month AS INTEGER) = month
        ORDER BY year DESC, month DESC LIMIT 1`
    )
    .get(accountSetId) as { year: number; month: number } | undefined) || null
}

/**
 * 年月参数校验（P1-8）：必须是整数、年份 2000~2100、月份 1~12。
 * 此前只校验 month，`Number('2026.5')` 会原样写入 INTEGER 列，之后任何月份结账都被
 * "2026.5年9月已结账" 拦住，且前端无法选出该行来反结账。
 */
export function assertValidCashierYearMonth(year: unknown, month: unknown): { year: number; month: number } {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error(`年份不合法：${String(year)}`)
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error(`月份不合法：${String(month)}`)
  return { year: y, month: m }
}

/** 不允许结晚于当前自然月的月份（P1-9）；与固定资产「不能对晚于当前月份计提」同口径 */
function assertNotFutureMonth(year: number, month: number): void {
  const now = new Date()
  const nowKey = now.getFullYear() * 100 + (now.getMonth() + 1)
  if (year * 100 + month > nowKey) {
    throw new Error(`${year}年${month}月尚未到来，不能提前结账`)
  }
}

function closeBlockReason(db: Database, accountSetId: string, year: number, month: number): string | null {
  const key = year * 100 + month
  try {
    assertNotFutureMonth(year, month)
  } catch (e: any) {
    return e.message
  }
  // 更早的、有日记账数据却未结账的月份
  const earlier = db
    .prepare(
      `SELECT substr(biz_date,1,4) AS y, substr(biz_date,6,2) AS m, COUNT(*) AS c
       FROM cashier_journal WHERE account_set_id=? GROUP BY y, m ORDER BY y, m`
    )
    .all(accountSetId) as Array<{ y: string; m: string; c: number }>
  for (const r of earlier) {
    const k = Number(r.y) * 100 + Number(r.m)
    if (k >= key) break
    if (!isCashierPeriodClosed(db, accountSetId, Number(r.y), Number(r.m))) {
      return `${Number(r.y)}年${Number(r.m)}月尚未结账，请按顺序结账`
    }
  }
  // 不允许跳过已结月份之前的月份重复结（已结的月份不会到这里）；也不允许结到最近已结月之前
  const latest = getLatestClosedCashierPeriod(db, accountSetId)
  if (latest && latest.year * 100 + latest.month > key) {
    return `${latest.year}年${latest.month}月已结账，不能回头结更早的月份`
  }
  // 2026-09-17 综合评审产品决策：与总账「全部记账才可结账」口径一致，
  // 该月仍有未生成凭证的日记账时不允许结账（结账后这些流水只能反结账才能补生成凭证）
  const unvouchered = (db
    .prepare(
      `SELECT COUNT(*) c FROM cashier_journal
        WHERE account_set_id=? AND substr(biz_date,1,4)=? AND CAST(substr(biz_date,6,2) AS INTEGER)=?
          AND (voucher_no IS NULL OR voucher_no='')`
    )
    .get(accountSetId, String(year), month) as { c: number }).c
  if (unvouchered > 0) {
    return `该月还有 ${unvouchered} 笔日记账未生成凭证，请先生成凭证后再结账`
  }
  return null
}

function reopenBlockReason(db: Database, accountSetId: string, year: number, month: number): string | null {
  const latest = getLatestClosedCashierPeriod(db, accountSetId)
  if (latest && (latest.year !== year || latest.month !== month)) {
    return `请先反结账更晚的 ${latest.year}年${latest.month}月`
  }
  return null
}

/** 某年 12 个月的出纳结账视图 */
export function listCashierPeriodStatus(db: Database, accountSetId: string, year: number): CashierPeriodMonthView[] {
  const records = new Map<number, CashierPeriodRow>()
  if (hasTable(db, 'cashier_period_closing')) {
    for (const r of db
      .prepare('SELECT year, month, status, closed_by, closed_by_name, closed_at FROM cashier_period_closing WHERE account_set_id=? AND year=?')
      .all(accountSetId, year) as CashierPeriodRow[]) {
      records.set(r.month, r)
    }
  }
  const counts = new Map<number, { total: number; unvouchered: number }>()
  for (const r of db
    .prepare(
      `SELECT CAST(substr(biz_date,6,2) AS INTEGER) AS m, COUNT(*) AS total,
              SUM(CASE WHEN voucher_no IS NULL OR voucher_no='' THEN 1 ELSE 0 END) AS unvouchered
       FROM cashier_journal WHERE account_set_id=? AND substr(biz_date,1,4)=? GROUP BY m`
    )
    .all(accountSetId, String(year)) as Array<{ m: number; total: number; unvouchered: number }>) {
    counts.set(r.m, { total: r.total, unvouchered: r.unvouchered })
  }
  const glClosed = new Set<number>()
  if (hasTable(db, 'period_closing')) {
    for (const r of db
      .prepare("SELECT period FROM period_closing WHERE account_set_id=? AND year=? AND status='closed'")
      .all(accountSetId, year) as Array<{ period: number }>) {
      glClosed.add(r.period)
    }
  }

  const rows: CashierPeriodMonthView[] = []
  for (let month = 1; month <= 12; month++) {
    const rec = records.get(month)
    const status: 'open' | 'closed' = rec?.status === 'closed' ? 'closed' : 'open'
    const cnt = counts.get(month) || { total: 0, unvouchered: 0 }
    let blockReason: string | null = null
    let canClose = false
    let canReopen = false
    if (status === 'closed') {
      blockReason = reopenBlockReason(db, accountSetId, year, month)
      canReopen = !blockReason
    } else {
      blockReason = closeBlockReason(db, accountSetId, year, month)
      canClose = !blockReason
    }
    rows.push({
      year,
      month,
      status,
      closed_by: rec?.closed_by ?? null,
      closed_by_name: rec?.closed_by_name ?? null,
      closed_at: rec?.closed_at ?? null,
      journalCount: cnt.total,
      unvoucheredCount: cnt.unvouchered,
      glClosed: glClosed.has(month),
      canClose,
      canReopen,
      blockReason,
    })
  }
  return rows
}

export function closeCashierPeriod(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
  userId?: string | null
  userName?: string | null
}): CashierPeriodMonthView {
  const { db, accountSetId } = params
  const { year, month } = assertValidCashierYearMonth(params.year, params.month)
  assertNotFutureMonth(year, month)
  if (isCashierPeriodClosed(db, accountSetId, year, month)) throw new Error(`${year}年${month}月出纳已结账`)
  const reason = closeBlockReason(db, accountSetId, year, month)
  if (reason) throw new Error(reason)
  db.prepare(
    `INSERT INTO cashier_period_closing (id, account_set_id, year, month, status, closed_by, closed_by_name, closed_at)
     VALUES (?, ?, ?, ?, 'closed', ?, ?, datetime('now','localtime'))
     ON CONFLICT(account_set_id, year, month) DO UPDATE SET
       status='closed', closed_by=excluded.closed_by, closed_by_name=excluded.closed_by_name, closed_at=excluded.closed_at`
  ).run(uuidv4(), accountSetId, year, month, params.userId ?? null, params.userName ?? null)
  return listCashierPeriodStatus(db, accountSetId, year).find(r => r.month === month)!
}

export function reopenCashierPeriod(params: {
  db: Database
  accountSetId: string
  year: number
  month: number
}): CashierPeriodMonthView {
  const { db, accountSetId } = params
  const { year, month } = assertValidCashierYearMonth(params.year, params.month)
  if (!isCashierPeriodClosed(db, accountSetId, year, month)) throw new Error(`${year}年${month}月出纳未结账，无需反结账`)
  const reason = reopenBlockReason(db, accountSetId, year, month)
  if (reason) throw new Error(reason)
  db.prepare(
    `UPDATE cashier_period_closing SET status='open', closed_by=NULL, closed_by_name=NULL, closed_at=NULL
     WHERE account_set_id=? AND year=? AND month=?`
  ).run(accountSetId, year, month)
  return listCashierPeriodStatus(db, accountSetId, year).find(r => r.month === month)!
}
