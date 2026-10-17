/**
 * 出纳独立账户（客户反馈：出纳应有自己的账户管理，自定义账户名称，再关联总账科目生成凭证）。
 *
 * 口径：
 *   - cashier_journal / cashier_init_balance 的 account_code 存「出纳账户编码」
 *   - 迁移生成的账户与原现金 / 银行科目同编码且已关联，历史数据口径不变
 *   - 新建的独立账户可以不关联科目：录单、日记账、余额表、对账照常；生成凭证时拦截「请先关联总账科目」
 *   - 凡是要拿出纳账户当总账科目用的地方（生成凭证、总账对账、出纳期初取总账余额、进销存收付款凭证），
 *     一律经 cashierGlCode() 换算；凭证回写出纳时经 cashierCodeForGl() 反查
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

export type CashierAccountKind = 'cash' | 'bank' | 'other'
export interface CashierAccountRow {
  id: string
  code: string
  name: string
  kind: CashierAccountKind
  is_cash: number
  is_bank: number
  is_foreign: number
  currency_code: string | null
  bank_name: string | null
  bank_account_no: string | null
  gl_account_code: string | null
  gl_account_name: string | null
  is_enabled: number
  remark: string | null
  journal_count?: number
}

export const CASHIER_KIND_LABEL: Record<CashierAccountKind, string> = { cash: '库存现金', bank: '银行存款', other: '其他货币资金' }

const schemaReady = new WeakMap<object, boolean>()
const accountColsCache = new WeakMap<object, Set<string>>()
function accountCols(db: Database.Database): Set<string> {
  let cols = accountColsCache.get(db)
  if (!cols) {
    try { cols = new Set((db.prepare('PRAGMA table_info(accounts)').all() as any[]).map(c => c.name)) } catch { cols = new Set() }
    accountColsCache.set(db, cols)
  }
  return cols
}

/**
 * 出纳账户表与视图兜底：正式库由迁移 159 建好；老库 / 精简测试库缺失时按科目表实际有的列补建，
 * 保证出纳查询统一读 v_cashier_account 不会因缺表报错。
 */
export function ensureCashierAccountSchema(db: Database.Database): boolean {
  if (schemaReady.get(db)) return true
  try {
    const cols = accountCols(db)
    if (!cols.has('code')) return false
    const col = (c: string, fallback: string) => (cols.has(c) ? `a.${c}` : fallback)
    db.exec(`
      CREATE TABLE IF NOT EXISTS cashier_account (
        id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'bank', currency_code TEXT, bank_name TEXT, bank_account_no TEXT, gl_account_code TEXT,
        is_enabled INTEGER NOT NULL DEFAULT 1, remark TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT,
        UNIQUE(account_set_id, code)
      )`)
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='view' AND name='v_cashier_account'").get()) {
      db.exec(`CREATE VIEW v_cashier_account AS
        SELECT ca.id, ca.account_set_id, ca.code, ca.name, ca.kind,
               CASE WHEN ca.kind = 'cash' THEN 1 ELSE 0 END AS is_cash,
               CASE WHEN ca.kind = 'cash' THEN 0 ELSE 1 END AS is_bank,
               CASE WHEN COALESCE(ca.currency_code, '') <> '' THEN 1 ELSE 0 END AS is_foreign,
               NULLIF(ca.currency_code, '') AS currency_code,
               ca.bank_name, ca.bank_account_no, ca.gl_account_code, ca.is_enabled, ca.remark,
               ${col('id', 'NULL')} AS gl_account_id, ${col('name', 'NULL')} AS gl_account_name, ${col('direction', "'debit'")} AS gl_direction
        FROM cashier_account ca
        LEFT JOIN accounts a ON a.account_set_id = ca.account_set_id AND a.code = ca.gl_account_code`)
    }
    schemaReady.set(db, true)
    return true
  } catch {
    return false
  }
}

function hasTable(db: Database.Database): boolean {
  return ensureCashierAccountSchema(db)
}

/**
 * 总账新增的现金 / 银行末级科目自动补成出纳账户（保持「总账建了银行科目，出纳就能用」的老习惯）；
 * 已被某个出纳账户关联的科目不再重复生成。
 */
export function syncCashierAccountsFromGl(db: Database.Database, accountSetId: string): number {
  if (!hasTable(db)) return 0
  const cols = accountCols(db)
  if (!cols.has('is_cash') || !cols.has('is_bank')) return 0
  const has = (c: string) => cols.has(c)
  const parentOther = has('parent_id') && has('id')
    ? "WHEN EXISTS (SELECT 1 FROM accounts p WHERE p.id = a.parent_id AND p.name LIKE '%其他货币资金%') THEN 'other'" : ''
  const currency = has('is_foreign') && has('currency_code')
    ? "CASE WHEN COALESCE(a.is_foreign, 0) = 1 AND COALESCE(a.currency_code, '') <> '' THEN a.currency_code ELSE NULL END" : 'NULL'
  const enabled = has('is_enabled') ? 'AND COALESCE(a.is_enabled, 1) = 1' : ''
  const leaf = has('parent_id') && has('id') ? 'AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id)' : ''
  try {
    return db.prepare(`
      INSERT OR IGNORE INTO cashier_account (id, account_set_id, code, name, kind, currency_code, gl_account_code, is_enabled)
      SELECT lower(hex(randomblob(16))), a.account_set_id, a.code, a.name,
             CASE WHEN a.is_cash = 1 THEN 'cash' ${parentOther} ELSE 'bank' END,
             ${currency}, a.code, 1
      FROM accounts a
      WHERE a.account_set_id = ? ${enabled} AND (a.is_cash = 1 OR a.is_bank = 1) ${leaf}
        AND NOT EXISTS (SELECT 1 FROM cashier_account x WHERE x.account_set_id = a.account_set_id AND (x.gl_account_code = a.code OR x.code = a.code))
    `).run(accountSetId).changes
  } catch {
    return 0
  }
}

/** 出纳账户 → 关联的总账科目编码；未关联返回 null。老库（无出纳账户表）按编码即科目处理 */
export function cashierGlCode(db: Database.Database, accountSetId: string, cashierCode: string): string | null {
  if (!cashierCode) return null
  if (!hasTable(db)) return cashierCode
  const row = db.prepare('SELECT gl_account_code FROM cashier_account WHERE account_set_id=? AND code=?').get(accountSetId, cashierCode) as any
  if (row) return row.gl_account_code || null
  // 尚未同步的现金 / 银行科目（或精简库没有现金 / 银行标记列）：编码即科目
  const cols = accountCols(db)
  const flag = cols.has('is_cash') && cols.has('is_bank') ? ' AND (is_cash=1 OR is_bank=1)' : ''
  try {
    const acc = db.prepare(`SELECT 1 FROM accounts WHERE account_set_id=? AND code=?${flag}`).get(accountSetId, cashierCode)
    return acc ? cashierCode : null
  } catch {
    return cashierCode
  }
}

/** 总账科目 → 出纳账户编码（凭证回写出纳流水用）：优先同编码，其次按编码最小的关联账户；无则 null */
export function cashierCodeForGl(db: Database.Database, accountSetId: string, glCode: string): string | null {
  if (!glCode) return null
  if (!hasTable(db)) return glCode
  const same = db.prepare('SELECT code FROM cashier_account WHERE account_set_id=? AND code=? AND gl_account_code=?').get(accountSetId, glCode, glCode) as any
  if (same) return same.code
  const any = db.prepare('SELECT code FROM cashier_account WHERE account_set_id=? AND gl_account_code=? ORDER BY is_enabled DESC, code LIMIT 1').get(accountSetId, glCode) as any
  return any?.code ?? null
}

/** 关联到出纳账户的全部总账科目编码（判断凭证分录是否涉及现金 / 银行） */
export function cashierLinkedGlCodes(db: Database.Database, accountSetId: string): Set<string> {
  if (!hasTable(db)) {
    return new Set((db.prepare('SELECT code FROM accounts WHERE account_set_id=? AND (is_cash=1 OR is_bank=1)').all(accountSetId) as any[]).map(r => r.code))
  }
  syncCashierAccountsFromGl(db, accountSetId)
  return new Set((db.prepare('SELECT DISTINCT gl_account_code AS code FROM cashier_account WHERE account_set_id=? AND gl_account_code IS NOT NULL').all(accountSetId) as any[]).map(r => r.code))
}

export function listCashierAccountRows(db: Database.Database, accountSetId: string, opts: { includeDisabled?: boolean; kind?: string } = {}): CashierAccountRow[] {
  syncCashierAccountsFromGl(db, accountSetId)
  const conds = ['v.account_set_id=?']; const ps: any[] = [accountSetId]
  if (!opts.includeDisabled) conds.push('v.is_enabled=1')
  if (opts.kind) { conds.push('v.kind=?'); ps.push(opts.kind) }
  return db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM cashier_journal j WHERE j.account_set_id=v.account_set_id AND j.account_code=v.code) AS journal_count
    FROM v_cashier_account v WHERE ${conds.join(' AND ')} ORDER BY v.code`).all(...ps) as CashierAccountRow[]
}

export interface CashierAccountInput {
  code?: string; name?: string; kind?: string; currency_code?: string | null; bank_name?: string | null; bank_account_no?: string | null
  gl_account_code?: string | null; is_enabled?: number | boolean; remark?: string | null
}

function validateInput(db: Database.Database, accountSetId: string, b: CashierAccountInput, selfId?: string): string | null {
  const code = String(b.code || '').trim(); const name = String(b.name || '').trim()
  if (!code) return '请填写账户编码'
  if (!/^[A-Za-z0-9_.-]{1,30}$/.test(code)) return '账户编码只能是字母、数字、下划线、点、横线，最长 30 位'
  if (!name) return '请填写账户名称'
  if (!['cash', 'bank', 'other'].includes(String(b.kind || ''))) return '请选择账户类型'
  const dup = db.prepare(`SELECT id FROM cashier_account WHERE account_set_id=? AND code=? ${selfId ? 'AND id<>?' : ''}`).get(...(selfId ? [accountSetId, code, selfId] : [accountSetId, code])) as any
  if (dup) return `账户编码 ${code} 已存在`
  const gl = String(b.gl_account_code || '').trim()
  if (gl) {
    const acc = db.prepare('SELECT * FROM accounts WHERE account_set_id=? AND code=?').get(accountSetId, gl) as any
    if (!acc) return `关联科目 ${gl} 不存在`
    if (db.prepare('SELECT 1 FROM accounts WHERE parent_id=? LIMIT 1').get(acc.id)) return `关联科目 ${gl} ${acc.name} 不是末级科目，请选择末级科目`
    // CASH-3：现金 / 银行账户只能关联打了现金或银行标记的科目（如误关联到应收，出纳凭证的现金行锁定会失效）；
    // 「其他」类账户（其他货币资金等）不限
    const kind = String(b.kind || '')
    if ((kind === 'cash' || kind === 'bank') && 'is_cash' in acc && 'is_bank' in acc
      && Number(acc.is_cash) !== 1 && Number(acc.is_bank) !== 1) {
      return `关联科目 ${gl} ${acc.name} 不是现金或银行科目，请先在科目里勾选「现金科目 / 银行科目」，或把账户类型改为「其他」`
    }
  }
  return null
}

export function createCashierAccount(db: Database.Database, accountSetId: string, b: CashierAccountInput): { id: string } {
  const err = validateInput(db, accountSetId, b)
  if (err) throw new Error(err)
  const id = uuidv4()
  db.prepare(`INSERT INTO cashier_account (id,account_set_id,code,name,kind,currency_code,bank_name,bank_account_no,gl_account_code,is_enabled,remark)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, accountSetId, String(b.code).trim(), String(b.name).trim(), b.kind,
    b.currency_code || null, b.bank_name || null, b.bank_account_no || null, String(b.gl_account_code || '').trim() || null,
    b.is_enabled === false || b.is_enabled === 0 ? 0 : 1, b.remark || null)
  return { id }
}

export function updateCashierAccount(db: Database.Database, accountSetId: string, id: string, b: CashierAccountInput): void {
  const ex = db.prepare('SELECT * FROM cashier_account WHERE id=? AND account_set_id=?').get(id, accountSetId) as any
  if (!ex) throw new Error('出纳账户不存在')
  const err = validateInput(db, accountSetId, b, id)
  if (err) throw new Error(err)
  const used = (db.prepare('SELECT COUNT(*) c FROM cashier_journal WHERE account_set_id=? AND account_code=?').get(accountSetId, ex.code) as any).c
    + (db.prepare('SELECT COUNT(*) c FROM cashier_init_balance WHERE account_set_id=? AND account_code=?').get(accountSetId, ex.code) as any).c
  if (used && String(b.code).trim() !== ex.code) throw new Error('账户已有流水或期初，不能修改编码')
  if (used && (b.currency_code || null) !== (ex.currency_code || null)) throw new Error('账户已有流水或期初，不能修改币别')
  db.prepare(`UPDATE cashier_account SET code=?, name=?, kind=?, currency_code=?, bank_name=?, bank_account_no=?, gl_account_code=?, is_enabled=?, remark=?, updated_at=datetime('now')
    WHERE id=? AND account_set_id=?`).run(String(b.code).trim(), String(b.name).trim(), b.kind, b.currency_code || null, b.bank_name || null,
    b.bank_account_no || null, String(b.gl_account_code || '').trim() || null, b.is_enabled === false || b.is_enabled === 0 ? 0 : 1, b.remark || null, id, accountSetId)
}

export function deleteCashierAccount(db: Database.Database, accountSetId: string, id: string): void {
  const ex = db.prepare('SELECT * FROM cashier_account WHERE id=? AND account_set_id=?').get(id, accountSetId) as any
  if (!ex) throw new Error('出纳账户不存在')
  const j = (db.prepare('SELECT COUNT(*) c FROM cashier_journal WHERE account_set_id=? AND account_code=?').get(accountSetId, ex.code) as any).c
  const ib = (db.prepare('SELECT COUNT(*) c FROM cashier_init_balance WHERE account_set_id=? AND account_code=?').get(accountSetId, ex.code) as any).c
  if (j || ib) throw new Error(`账户 ${ex.code} ${ex.name} 已有${j ? ` ${j} 条流水` : ''}${ib ? '期初余额' : ''}，不能删除，可停用`)
  // 与总账科目同编码且关联的账户删除后，同步逻辑会立即按科目重新生成，提示用户改为停用
  if (ex.gl_account_code === ex.code) throw new Error('该账户由总账现金 / 银行科目自动生成，删除后会按科目重新生成；不再使用请停用')
  db.prepare('DELETE FROM cashier_account WHERE id=? AND account_set_id=?').run(id, accountSetId)
}
