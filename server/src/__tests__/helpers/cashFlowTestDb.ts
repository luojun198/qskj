import Database from 'better-sqlite3'
import { clearStaticReportStandardCache } from '../../services/staticReportConfig.js'
import { clearCashFlowAutoCache } from '../../services/cashFlowAutoEngine.js'

/**
 * 现金流量自动取数测试用内存库：只建取数触及的表（字段与 schema.sql + 迁移 156 一致，省略无关列）。
 * 默认企业会计准则、启用现金流量；科目按 [编码, 名称, 方向, 现金, 银行] 传入，上级按编码前缀自动挂。
 */
export function createCashFlowTestDb(options: {
  accountSetId?: string
  standard?: 'enterprise' | 'small_business' | 'government'
  accounts?: Array<[string, string, 'debit' | 'credit', number?, number?]>
} = {}) {
  const setId = options.accountSetId || 'set1'
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, account_set_id TEXT, code TEXT, name TEXT, direction TEXT,
      level INTEGER DEFAULT 1, parent_id TEXT, is_cash INTEGER DEFAULT 0, is_bank INTEGER DEFAULT 0,
      require_cash_flow INTEGER DEFAULT 0, is_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE cash_flow_items (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      direction TEXT NOT NULL, parent_code TEXT, level INTEGER NOT NULL DEFAULT 1, is_leaf INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL DEFAULT 'main',
      created_at TEXT, updated_at TEXT, UNIQUE(account_set_id, code)
    );
    CREATE TABLE account_cash_flow_map (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, account_id TEXT NOT NULL,
      main_credit_code TEXT, main_debit_code TEXT, supp_credit_code TEXT, supp_debit_code TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(account_set_id, account_id)
    );
    CREATE TABLE voucher_types (id TEXT PRIMARY KEY, account_set_id TEXT, name TEXT, is_closing INTEGER DEFAULT 0);
    CREATE TABLE vouchers (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_no TEXT, voucher_date TEXT,
      year INTEGER, period INTEGER, status TEXT, voucher_type_id TEXT
    );
    CREATE TABLE voucher_entries (
      id TEXT PRIMARY KEY, account_set_id TEXT, voucher_id TEXT, seq INTEGER,
      account_id TEXT, account_code TEXT, direction TEXT, amount REAL,
      cash_flow_code TEXT, cash_flow_name TEXT
    );
  `)
  db.prepare(`INSERT INTO system_params VALUES ('p1', ?, 'enable_cash_flow', 'true')`).run(setId)
  db.prepare(`INSERT INTO system_params VALUES ('p2', ?, 'accounting_standard', ?)`).run(setId, options.standard || 'enterprise')
  db.prepare(`INSERT INTO voucher_types VALUES ('vt-ji', ?, '记', 0), ('vt-jz', ?, '结转', 1)`).run(setId, setId)

  const accounts = options.accounts || DEFAULT_ACCOUNTS
  const byCode = new Map<string, string>()
  const insert = db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, level, parent_id, is_cash, is_bank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const [code, name, direction, isCash = 0, isBank = 0] of [...accounts].sort((a, b) => a[0].length - b[0].length)) {
    let parentId: string | null = null
    for (let len = code.length - 2; len >= 4; len -= 2) {
      const p = byCode.get(code.slice(0, len))
      if (p) { parentId = p; break }
    }
    const level = parentId ? (code.length - 4) / 2 + 1 : 1
    const id = `acc-${code}`
    insert.run(id, setId, code, name, direction, level, parentId, isCash, isBank)
    byCode.set(code, id)
  }
  clearStaticReportStandardCache()
  clearCashFlowAutoCache()

  let seq = 0
  const voucher = (
    entries: Array<[string, 'debit' | 'credit', number]>,
    opts: { period?: number; status?: string; closing?: boolean; no?: string } = {}
  ) => {
    seq++
    const vid = `v${seq}`
    db.prepare(
      `INSERT INTO vouchers VALUES (?, ?, ?, ?, 2026, ?, ?, ?)`
    ).run(vid, setId, opts.no || `记-${seq}`, `2026-0${opts.period || 5}-01`, opts.period || 5, opts.status || 'posted', opts.closing ? 'vt-jz' : 'vt-ji')
    entries.forEach(([code, direction, amount], i) => {
      db.prepare(
        `INSERT INTO voucher_entries (id, account_set_id, voucher_id, seq, account_id, account_code, direction, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(`${vid}-e${i}`, setId, vid, i + 1, byCode.get(code) || code, code, direction, amount)
    })
    clearCashFlowAutoCache()
    return vid
  }

  return { db, setId, voucher, accountId: (code: string) => byCode.get(code)! }
}

/** 企业会计准则常用科目 */
export const DEFAULT_ACCOUNTS: Array<[string, string, 'debit' | 'credit', number?, number?]> = [
  ['1001', '库存现金', 'debit', 1, 0],
  ['1002', '银行存款', 'debit', 0, 1],
  ['100201', '招商银行', 'debit', 0, 1],
  ['1012', '其他货币资金', 'debit'],
  ['101201', '外埠存款', 'debit'],
  ['1122', '应收账款', 'debit'],
  ['1221', '其他应收款', 'debit'],
  ['1231', '坏账准备', 'credit'],
  ['1403', '原材料', 'debit'],
  ['1405', '库存商品', 'debit'],
  ['1601', '固定资产', 'debit'],
  ['1602', '累计折旧', 'credit'],
  ['2001', '短期借款', 'credit'],
  ['2202', '应付账款', 'credit'],
  ['2211', '应付职工薪酬', 'credit'],
  ['2221', '应交税费', 'credit'],
  ['222101', '应交增值税', 'credit'],
  ['222112', '应交个人所得税', 'credit'],
  ['4001', '实收资本', 'credit'],
  ['4103', '本年利润', 'credit'],
  ['5001', '生产成本', 'debit'],
  ['6001', '主营业务收入', 'credit'],
  ['6401', '主营业务成本', 'debit'],
  ['6602', '管理费用', 'debit'],
  ['6603', '财务费用', 'debit'],
  ['6702', '信用减值损失', 'debit'],
]
