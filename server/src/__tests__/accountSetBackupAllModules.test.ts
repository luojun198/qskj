/**
 * FIX-329：单账套备份 / 导入为新账套 / 合并恢复覆盖总账之外的全部模块（出纳、固定资产、进销存、标准报表……），
 * 且新账套里的关联全部指向新 id（不残留源账套 id）。
 *
 * 用临时新库（与服务启动同一套 initDatabase + 兼容升级 + 默认账套）跑，不碰开发库。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { rmSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'

const { TEMP_DB_PATH } = await vi.hoisted(async () => {
  const path = await import('path')
  const os = await import('os')
  const p = path.join(os.tmpdir(), `cw-backup-all-modules-${process.pid}-${Date.now()}.db`)
  process.env.DB_PATH = p
  process.env.SCHEMA_DIR = process.env.SCHEMA_DIR || 'src/db'
  return { TEMP_DB_PATH: p }
})

import { closeAndResetDb, getDb, initDatabase } from '../db/index.js'
import { upgradeDatabaseCompatibility } from '../db/databaseCompatibility.js'
import { initDefaultAccountSet } from '../scripts/seedAccounts.js'
import {
  extraTableRowsSql,
  importSingleAccountSetBackupAsNewAccountSet,
  importSingleAccountSetBackupAsNewAccountSetAsync,
  cleanupInterruptedAccountSetImports,
  listExtraBackupTables,
  restoreSingleAccountSetFromBackup,
} from '../services/accountSetBackupRestore.js'
import { doAccountSetBackup } from '../routes/backup.js'

let db: Database.Database
let A = ''
const backups: string[] = []
const ids = {
  acc: '', v1: uuidv4(), v2: uuidv4(), e1: uuidv4(), j1: uuidv4(), att: uuidv4(), fa: uuidv4(),
  rep: uuidv4(), cell: uuidv4(), item: uuidv4(), doc: uuidv4(), line: uuidv4(), batch: uuidv4(),
}

/** 只填测试关心的列，其余 NOT NULL 且无默认值的列按类型补占位值 */
function ins(table: string, values: Record<string, unknown>) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string; type: string; notnull: number; dflt_value: unknown; pk: number
  }>
  const row: Record<string, unknown> = { ...values }
  for (const c of cols) {
    if (c.name in row || !c.notnull || c.dflt_value != null || c.pk) continue
    row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : `x-${c.name}`
  }
  const keys = Object.keys(row)
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(
    ...keys.map(k => row[k])
  )
}

const count = (table: string, asId: string, t = listExtraBackupTables(db).find(x => x.table === table)) =>
  (db.prepare(extraTableRowsSql(t ?? { table }).replace(/^SELECT (c\.)?\*/, 'SELECT COUNT(*) n')).get(asId) as { n: number }).n

beforeAll(async () => {
  initDatabase()
  upgradeDatabaseCompatibility()
  initDefaultAccountSet('行政事业单位财务账套')
  db = getDb()
  A = (db.prepare('SELECT id FROM account_sets LIMIT 1').get() as { id: string }).id
  const acc = db.prepare("SELECT id, code, name FROM accounts WHERE account_set_id=? AND code LIKE '1001%' LIMIT 1").get(A) as {
    id: string; code: string; name: string
  }
  ids.acc = acc.id

  ins('vouchers', { id: ids.v1, account_set_id: A, voucher_no: '1', voucher_date: '2026-09-01', year: 2026, period: 9, status: 'posted', reversed_by_voucher_id: ids.v2 })
  ins('vouchers', { id: ids.v2, account_set_id: A, voucher_no: '2', voucher_date: '2026-09-02', year: 2026, period: 9, status: 'posted', reversal_of_voucher_id: ids.v1 })
  ins('voucher_entries', { id: ids.e1, account_set_id: A, voucher_id: ids.v1, seq: 1, account_id: acc.id, account_code: acc.code, account_name: acc.name, direction: 'debit', amount: 100 })
  ins('cashier_journal', { id: ids.j1, account_set_id: A, account_code: acc.code, biz_date: '2026-09-01', debit: 100, credit: 0, voucher_id: ids.v1, reconciled: 1 })
  ins('cashier_gl_match', { id: uuidv4(), account_set_id: A, account_code: acc.code, currency: 'RMB', batch_id: ids.batch, side: 'cashier', ref_id: ids.j1, amount: 100, match_type: 'link' })
  ins('cashier_gl_match', { id: uuidv4(), account_set_id: A, account_code: acc.code, currency: 'RMB', batch_id: ids.batch, side: 'gl', ref_id: ids.e1, amount: 100, match_type: 'link' })
  ins('cashier_attachments', { id: ids.att, account_set_id: A, journal_id: ids.j1, filename: 'a.pdf', original_name: 'a.pdf', file_path: '/uploads/attachments/a.pdf', file_size: 1, mime_type: 'application/pdf' })
  ins('fixed_asset', { id: ids.fa, account_set_id: A, asset_no: 'FA-001', asset_name: '电脑', purchase_voucher_id: ids.v1 })
  ins('fixed_asset_depr', { id: uuidv4(), account_set_id: A, asset_no: 'FA-001', year: 2026, month: 9 })
  ins('rh_standard_reports', { id: ids.rep, account_set_id: A, code: 'R1', name: '资产负债表' })
  ins('rh_standard_report_cells', { id: ids.cell, report_id: ids.rep, row_index: 1, col_index: 1, formula_text: 'QM("1001")' })
  ins('scm_item', { id: ids.item, account_set_id: A, code: 'IT-1', name: '物料' })
  ins('scm_doc', { id: ids.doc, account_set_id: A, doc_type: 'PO', doc_no: 'PO-1', voucher_id: ids.v1 })
  ins('scm_doc_line', { id: ids.line, account_set_id: A, doc_id: ids.doc, item_code: 'IT-1' })
})

afterAll(() => {
  closeAndResetDb()
  for (const f of backups) rmSync(f, { force: true })
  for (const s of ['', '-wal', '-shm']) rmSync(`${TEMP_DB_PATH}${s}`, { force: true })
})

describe('单账套备份覆盖全部模块（FIX-329）', { timeout: 60000 }, () => {
  it('备份文件包含出纳 / 固定资产 / 进销存 / 标准报表（含子表），不含运行时表', async () => {
    const r = await doAccountSetBackup(A)
    expect(r?.error).toBeFalsy()
    backups.push(r!.filepath)
    expect(r!.stats?.extraRows).toBeGreaterThanOrEqual(12)
    const b = new Database(r!.filepath, { readonly: true })
    const n = (sql: string) => (b.prepare(sql).get() as { n: number }).n
    expect(n('SELECT COUNT(*) n FROM cashier_journal')).toBe(1)
    expect(n('SELECT COUNT(*) n FROM cashier_gl_match')).toBe(2)
    expect(n('SELECT COUNT(*) n FROM fixed_asset')).toBe(1)
    expect(n('SELECT COUNT(*) n FROM rh_standard_report_cells')).toBe(1)
    expect(n('SELECT COUNT(*) n FROM scm_doc_line')).toBe(1)
    expect(n("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('backups','license_activation','async_tasks') OR name LIKE '%_fts%'")).toBe(0)
    b.close()
  })

  it('导入为新账套：各表行数一致，关联全部指向新账套的新 id，不残留源账套 id', () => {
    const { accountSetId: B, stats } = importSingleAccountSetBackupAsNewAccountSet({ sourcePath: backups[0], name: '导入副本' })
    expect(stats.extraRows).toBeGreaterThanOrEqual(12)

    for (const t of listExtraBackupTables(db)) expect([t.table, count(t.table, B)]).toEqual([t.table, count(t.table, A)])

    // 源账套全部行 id（各表）
    const oldIds = new Set<string>([A])
    const allTables = [
      ...(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(r => r.name),
    ].filter(t => (db.prepare(`PRAGMA table_info("${t}")`).all() as Array<{ name: string }>).some(c => c.name === 'account_set_id'))
    for (const t of allTables) {
      for (const r of db.prepare(`SELECT id FROM "${t}" WHERE account_set_id = ?`).all(A) as Array<{ id: unknown }>) {
        if (typeof r.id === 'string') oldIds.add(r.id)
      }
    }
    // 新账套的额外表 + 凭证冲销列：任何值都不应再是源账套的 id
    const leftovers: string[] = []
    for (const t of listExtraBackupTables(db)) {
      for (const row of db.prepare(extraTableRowsSql(t)).all(B) as Array<Record<string, unknown>>) {
        for (const [k, v] of Object.entries(row)) if (typeof v === 'string' && oldIds.has(v)) leftovers.push(`${t.table}.${k}`)
      }
    }
    for (const row of db.prepare('SELECT reversal_of_voucher_id a, reversed_by_voucher_id b FROM vouchers WHERE account_set_id = ?').all(B) as Array<Record<string, unknown>>) {
      for (const [k, v] of Object.entries(row)) if (typeof v === 'string' && oldIds.has(v)) leftovers.push(`vouchers.${k}`)
    }
    expect(leftovers).toEqual([])

    // 关键关联落在新账套内
    const one = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T
    const j = one<{ id: string; voucher_id: string }>('SELECT id, voucher_id FROM cashier_journal WHERE account_set_id = ?', B)
    expect(one<{ a: string }>('SELECT account_set_id a FROM vouchers WHERE id = ?', j.voucher_id).a).toBe(B)
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM cashier_gl_match m JOIN voucher_entries e ON e.id = m.ref_id WHERE m.account_set_id = ? AND m.side = 'gl' AND e.account_set_id = ?", B, B).n).toBe(1)
    expect(one<{ journal_id: string }>('SELECT journal_id FROM cashier_attachments WHERE account_set_id = ?', B).journal_id).toBe(j.id)
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM scm_doc_line l JOIN scm_doc d ON d.id = l.doc_id JOIN vouchers v ON v.id = d.voucher_id WHERE l.account_set_id = ? AND d.account_set_id = ? AND v.account_set_id = ?', B, B, B).n).toBe(1)
    expect(one<{ a: string }>('SELECT v.account_set_id a FROM fixed_asset f JOIN vouchers v ON v.id = f.purchase_voucher_id WHERE f.account_set_id = ?', B).a).toBe(B)
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM rh_standard_report_cells c JOIN rh_standard_reports r ON r.id = c.report_id WHERE r.account_set_id = ?', B).n).toBe(1)
    const v2 = one<{ id: string; reversal_of_voucher_id: string }>("SELECT id, reversal_of_voucher_id FROM vouchers WHERE account_set_id = ? AND voucher_no = '2'", B)
    const v1 = one<{ id: string; reversed_by_voucher_id: string }>("SELECT id, reversed_by_voucher_id FROM vouchers WHERE account_set_id = ? AND voucher_no = '1'", B)
    expect(v2.reversal_of_voucher_id).toBe(v1.id)
    expect(v1.reversed_by_voucher_id).toBe(v2.id)

    // 源账套不受影响
    expect(count('cashier_journal', A)).toBe(1)
    expect(one<{ id: string }>('SELECT id FROM cashier_journal WHERE account_set_id = ?', A).id).toBe(ids.j1)
  })

  it('分块异步导入（FIX-333）：结果与同步导入一致，导入期间账套不可见且事件循环持续运转', async () => {
    // 造足够多的出纳流水，确保跨越多个提交块
    const ins2 = db.prepare('INSERT INTO cashier_journal (id, account_set_id, account_code, biz_date, debit, credit) VALUES (?, ?, ?, ?, ?, ?)')
    db.transaction(() => { for (let i = 0; i < 20000; i++) ins2.run(uuidv4(), A, '1001', '2026-09-03', i, 0) })()
    const r = await doAccountSetBackup(A)
    backups.push(r!.filepath)

    let ticks = 0
    let sawImporting = false
    const timer = setInterval(() => {
      ticks++
      const row = db.prepare("SELECT status FROM account_sets WHERE name = '分块导入'").get() as { status: string } | undefined
      if (row?.status === 'inactive') sawImporting = true
    }, 0)
    const { accountSetId: D, stats } = await importSingleAccountSetBackupAsNewAccountSetAsync({ sourcePath: r!.filepath, name: '分块导入' }, { chunkMs: 0 })
    clearInterval(timer)

    expect(ticks).toBeGreaterThanOrEqual(3)
    expect(sawImporting).toBe(true)
    expect((db.prepare('SELECT status FROM account_sets WHERE id = ?').get(D) as { status: string }).status).toBe('active')
    expect(stats.extraRows).toBeGreaterThanOrEqual(20012)
    for (const t of listExtraBackupTables(db)) expect([t.table, count(t.table, D)]).toEqual([t.table, count(t.table, A)])
    const n = (sql: string, id: string) => (db.prepare(sql).get(id) as { n: number }).n
    expect(n('SELECT COUNT(*) n FROM vouchers WHERE account_set_id = ?', D)).toBe(n('SELECT COUNT(*) n FROM vouchers WHERE account_set_id = ?', A))
    expect(n('SELECT COUNT(*) n FROM voucher_entries WHERE account_set_id = ?', D)).toBe(n('SELECT COUNT(*) n FROM voucher_entries WHERE account_set_id = ?', A))
    expect(db.inTransaction).toBe(false)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect((db.prepare("SELECT COUNT(*) n FROM system_params WHERE param_key = 'backup:import_in_progress'").get() as { n: number }).n).toBe(0)
  })

  it('启动时清理上次中断的分块导入', () => {
    const { accountSetId: E } = importSingleAccountSetBackupAsNewAccountSet({ sourcePath: backups[0], name: '中断导入' })
    db.prepare("UPDATE account_sets SET status = 'inactive' WHERE id = ?").run(E)
    db.prepare("INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, 'backup:import_in_progress', '')").run(uuidv4(), E)
    expect(cleanupInterruptedAccountSetImports(db)).toBe(1)
    expect(db.prepare('SELECT id FROM account_sets WHERE id = ?').get(E)).toBeUndefined()
    expect(count('cashier_journal', E)).toBe(0)
  })

  it('分块异步导入失败时整体清理，不留下半个账套', async () => {
    const before = (db.prepare('SELECT COUNT(*) n FROM account_sets').get() as { n: number }).n
    await expect(importSingleAccountSetBackupAsNewAccountSetAsync({ sourcePath: TEMP_DB_PATH, name: '坏备份' })).rejects.toThrow()
    expect((db.prepare('SELECT COUNT(*) n FROM account_sets').get() as { n: number }).n).toBe(before)
  })

  it('旧版备份（不含出纳等表）合并恢复时，不清空目标账套现有的出纳 / 固资数据', async () => {
    const r = await doAccountSetBackup(A)
    backups.push(r!.filepath)
    const b = new Database(r!.filepath)
    for (const t of listExtraBackupTables(b).reverse()) b.exec(`DROP TABLE "${t.table}"`)
    b.close()
    const C = (db.prepare("SELECT id FROM account_sets WHERE name = '导入副本'").get() as { id: string }).id
    const before = listExtraBackupTables(db).map(t => count(t.table, C))
    const stats = restoreSingleAccountSetFromBackup({ targetAccountSetId: C, sourcePath: r!.filepath })
    expect(stats.extraRows ?? 0).toBe(0)
    expect(listExtraBackupTables(db).map(t => count(t.table, C))).toEqual(before)
  })
})
