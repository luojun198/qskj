/**
 * 凭证 Excel 转入：分组、辅助项目解析、月末改期、编号顺排 / 冲突、错误行号
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  getVoucherExcelColumns,
  importParsedVouchers,
  monthEndDate,
  normalizeExcelDate,
  parseVoucherExcelRows,
  type VoucherExcelImportOptions,
} from '../services/voucherExcelImport.js'

const SET = 'set-x'
const TODAY = new Date()
const Y = TODAY.getFullYear()
const P = TODAY.getMonth() + 1
const DATE = `${Y}-${String(P).padStart(2, '0')}-05`

function createDb() {
  const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '../db/schema.sql')
  const db = new Database(':memory:')
  db.exec(readFileSync(schemaPath, 'utf-8'))
  db.exec(`ALTER TABLE vouchers ADD COLUMN source TEXT DEFAULT NULL`)
  db.prepare(
    `INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status) VALUES (?, 'X', 'X', ?, ?, 'active')`
  ).run(SET, Y, `${Y}-01-01`)
  db.prepare(`INSERT INTO users (id, account_set_id, username, password) VALUES ('u1', ?, 'zs', 'x')`).run(SET)
  db.prepare(
    `INSERT INTO voucher_types (id, account_set_id, name, code, sort_order) VALUES ('vt-jz', ?, '记账凭证', '1', 1)`
  ).run(SET)
  db.prepare(
    `INSERT INTO aux_categories (id, account_set_id, code, name, sort_order) VALUES ('cat-dept', ?, 'dept', '部门', 1)`
  ).run(SET)
  db.prepare(
    `INSERT INTO aux_items (id, account_set_id, type, code, name) VALUES ('it-d1', ?, 'cat-dept', 'D01', '销售部')`
  ).run(SET)
  const insAcc = db.prepare(
    `INSERT INTO accounts (id, account_set_id, code, name, direction, level, parent_id, aux_types) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  insAcc.run('a-1001', SET, '1001', '库存现金', 'debit', 1, null, null)
  insAcc.run('a-6602', SET, '6602', '管理费用', 'debit', 1, null, null)
  insAcc.run('a-660201', SET, '660201', '管理费用-办公费', 'debit', 2, 'a-6602', '["cat-dept"]')
  return db
}

const baseOptions: VoucherExcelImportOptions = { dateMode: 'original', numberMode: 'auto' }

function rows2(overrides: Partial<Record<string, unknown>>[] = []) {
  const base = [
    { seq: '1', voucher_type: '记账凭证', voucher_date: DATE, summary: '办公费', account_code: '660201', debit: 100, aux_dept: '销售部' },
    { seq: '1', voucher_type: '记账凭证', voucher_date: DATE, summary: '办公费', account_code: '1001', credit: 100 },
  ]
  return base.map((r, i) => ({ ...r, ...(overrides[i] || {}) }))
}

describe('voucherExcelImport', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createDb()
  })

  it('列定义 = 固定列 + 辅助类别动态列', () => {
    const cols = getVoucherExcelColumns(db, SET)
    expect(cols[0].key).toBe('seq')
    expect(cols.at(-1)).toMatchObject({ key: 'aux_dept', label: '部门', auxCategoryCode: 'dept' })
  })

  it('日期规范化：字符串 / Excel 序列号 / 中文日期', () => {
    expect(normalizeExcelDate('2026/3/5')).toBe('2026-03-05')
    expect(normalizeExcelDate('2026年3月5日')).toBe('2026-03-05')
    expect(normalizeExcelDate(46086)).toBe('2026-03-05')
    expect(normalizeExcelDate('abc')).toBeNull()
    expect(normalizeExcelDate('2026-02-30')).toBeNull()
    expect(monthEndDate(2026, 2)).toBe('2026-02-28')
  })

  it('同序号多行合成一张凭证，辅助项目按名称解析', () => {
    const { vouchers, errors } = parseVoucherExcelRows({ db, accountSetId: SET, rows: rows2(), options: baseOptions })
    expect(errors).toEqual([])
    expect(vouchers).toHaveLength(1)
    expect(vouchers[0].entries).toHaveLength(2)
    expect(vouchers[0].entries[0]._dept_id).toBe('it-d1')
    expect(vouchers[0].totalDebit).toBe(100)
    expect(vouchers[0].rows).toEqual([2, 3])
  })

  it('辅助项目支持按编码解析，缺失或不存在报行级错误', () => {
    const ok = parseVoucherExcelRows({ db, accountSetId: SET, rows: rows2([{ aux_dept: 'D01' }]), options: baseOptions })
    expect(ok.errors).toEqual([])

    const missing = parseVoucherExcelRows({ db, accountSetId: SET, rows: rows2([{ aux_dept: '' }]), options: baseOptions })
    expect(missing.errors[0]).toMatchObject({ row: 2, field: 'aux_dept' })

    const bad = parseVoucherExcelRows({ db, accountSetId: SET, rows: rows2([{ aux_dept: '不存在' }]), options: baseOptions })
    expect(bad.errors[0].message).toContain('不存在')
  })

  it('非末级科目 / 不存在科目 / 借贷不平 报错并带行号', () => {
    const r1 = parseVoucherExcelRows({ db, accountSetId: SET, rows: rows2([{ account_code: '6602', aux_dept: '' }]), options: baseOptions })
    expect(r1.errors[0]).toMatchObject({ row: 2, field: 'account_code' })
    expect(r1.errors[0].message).toContain('末级')

    const r2 = parseVoucherExcelRows({ db, accountSetId: SET, rows: rows2([{}, { account_code: '9999' }]), options: baseOptions })
    expect(r2.errors[0]).toMatchObject({ row: 3, field: 'account_code' })

    const r3 = parseVoucherExcelRows({ db, accountSetId: SET, rows: rows2([{}, { credit: 90 }]), options: baseOptions })
    expect(r3.vouchers).toHaveLength(0)
    expect(r3.errors[0].row).toBe(2)
    expect(r3.errors[0].message).toContain('借贷不平衡')
  })

  it('monthEnd 模式把日期统一改为指定月末；凭证类型为空时取默认类型', () => {
    const rows = rows2([{ voucher_type: '' }, { voucher_type: '' }])
    const { vouchers, errors } = parseVoucherExcelRows({
      db,
      accountSetId: SET,
      rows,
      options: { dateMode: 'monthEnd', targetYear: Y, targetPeriod: P, numberMode: 'auto' },
    })
    expect(errors).toEqual([])
    expect(vouchers[0].voucherDate).toBe(monthEndDate(Y, P))
    expect(vouchers[0].voucherTypeId).toBe('vt-jz')
  })

  it('auto 编号接在当期最大号之后，manual 从起始号顺排且冲突时整批回滚', () => {
    db.prepare(
      `INSERT INTO vouchers (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period, total_amount)
       VALUES ('v-old', ?, '记-003', 'vt-jz', ?, ?, ?, 1)`
    ).run(SET, DATE, Y, P)

    const rows = [
      ...rows2(),
      ...rows2([{ seq: '2' }, { seq: '2' }]),
    ]
    const parsed = parseVoucherExcelRows({ db, accountSetId: SET, rows, options: baseOptions })
    expect(parsed.vouchers).toHaveLength(2)

    const auto = importParsedVouchers({ db, accountSetId: SET, userId: 'u1', userName: 'zs', vouchers: parsed.vouchers, options: baseOptions })
    expect(auto.voucherNos).toEqual(['记-004', '记-005'])
    expect(db.prepare('SELECT COUNT(*) c FROM voucher_entries').get()).toMatchObject({ c: 4 })

    const manualOpt: VoucherExcelImportOptions = { dateMode: 'original', numberMode: 'manual', startNo: 5 }
    expect(() =>
      importParsedVouchers({ db, accountSetId: SET, vouchers: parsed.vouchers, options: manualOpt })
    ).toThrow(/记-005/)
    // 冲突整批回滚：仍是 3 张
    expect(db.prepare('SELECT COUNT(*) c FROM vouchers').get()).toMatchObject({ c: 3 })

    const manual = importParsedVouchers({
      db,
      accountSetId: SET,
      vouchers: parsed.vouchers,
      options: { dateMode: 'original', numberMode: 'manual', startNo: 10 },
    })
    expect(manual.voucherNos).toEqual(['记-010', '记-011'])
  })

  it('评审 P1-7：科目禁负余额——整批累计校验，单张可过但累计为负时拒绝', () => {
    // 先落一张：借 1001 100（现金余额 100）
    const seed = parseVoucherExcelRows({
      db, accountSetId: SET, options: baseOptions,
      rows: [
        { seq: '1', voucher_type: '记账凭证', voucher_date: DATE, summary: '提现', account_code: '1001', debit: 100 },
        { seq: '1', voucher_type: '记账凭证', voucher_date: DATE, summary: '提现', account_code: '660201', credit: 100, aux_dept: '销售部' },
      ],
    })
    importParsedVouchers({ db, accountSetId: SET, vouchers: seed.vouchers, options: baseOptions })
    db.prepare("UPDATE accounts SET no_negative=1 WHERE code='1001'").run()

    const pay = (seq: string) => [
      { seq, voucher_type: '记账凭证', voucher_date: DATE, summary: '付款', account_code: '660201', debit: 80, aux_dept: '销售部' },
      { seq, voucher_type: '记账凭证', voucher_date: DATE, summary: '付款', account_code: '1001', credit: 80 },
    ]
    const r = parseVoucherExcelRows({ db, accountSetId: SET, options: baseOptions, rows: [...pay('1'), ...pay('2')] })
    expect(r.vouchers.map(v => v.seqLabel)).toEqual(['1'])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toContain('本批前面凭证的累计影响')
  })

  it('评审 P1-7：凭证时序控制开启时，早于已有凭证 / 本批前一张日期的凭证被拒', () => {
    const seed = parseVoucherExcelRows({ db, accountSetId: SET, rows: rows2(), options: baseOptions })
    importParsedVouchers({ db, accountSetId: SET, vouchers: seed.vouchers, options: baseOptions })
    db.prepare("INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES ('tc', ?, 'voucher_time_control', 'true')").run(SET)

    const earlier = `${Y}-${String(P).padStart(2, '0')}-03`
    const later = `${Y}-${String(P).padStart(2, '0')}-06`
    const rows = [
      ...rows2().map(r => ({ ...r, seq: '1', voucher_date: later })),
      ...rows2().map(r => ({ ...r, seq: '2', voucher_date: DATE })),
      ...rows2().map(r => ({ ...r, seq: '3', voucher_date: earlier })),
    ]
    const r = parseVoucherExcelRows({ db, accountSetId: SET, rows, options: baseOptions })
    expect(r.vouchers.map(v => v.seqLabel)).toEqual(['1'])
    expect(r.errors).toHaveLength(2)
    expect(r.errors.every(e => e.message.includes('凭证时序控制已开启'))).toBe(true)
  })
})
