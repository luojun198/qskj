/**
 * 第六份反馈：物料 / 往来单位档案的批量审核、停用、Excel 导入，以及单据引用校验。
 * 临时新库（initDatabase + 兼容升级 + 默认账套），不碰开发库。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { rmSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'

const { TEMP_DB_PATH } = await vi.hoisted(async () => {
  const path = await import('path')
  const os = await import('os')
  const p = path.join(os.tmpdir(), `cw-scm-master-${process.pid}-${Date.now()}.db`)
  process.env.DB_PATH = p
  process.env.SCHEMA_DIR = process.env.SCHEMA_DIR || 'src/db'
  return { TEMP_DB_PATH: p }
})

import { closeAndResetDb, getDb, initDatabase } from '../db/index.js'
import { upgradeDatabaseCompatibility } from '../db/databaseCompatibility.js'
import { initDefaultAccountSet } from '../scripts/seedAccounts.js'
import {
  importItems, importPartners, masterUsableError, setMasterAudit, setMasterEnabled, MASTER_AUDIT_REQUIRED_KEY,
} from '../services/scmMasterData.js'

let db: Database.Database
let A = ''

beforeAll(() => {
  initDatabase()
  upgradeDatabaseCompatibility()
  initDefaultAccountSet('企业会计准则账套')
  db = getDb()
  A = (db.prepare('SELECT id FROM account_sets LIMIT 1').get() as { id: string }).id
})

afterAll(() => {
  closeAndResetDb()
  for (const s of ['', '-wal', '-shm']) rmSync(`${TEMP_DB_PATH}${s}`, { force: true })
})

const setParam = (v: string) => {
  db.prepare('DELETE FROM system_params WHERE account_set_id=? AND param_key=?').run(A, MASTER_AUDIT_REQUIRED_KEY)
  db.prepare('INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?,?,?,?)').run(uuidv4(), A, MASTER_AUDIT_REQUIRED_KEY, v)
}
const item = (code: string) => db.prepare('SELECT * FROM scm_item WHERE account_set_id=? AND code=?').get(A, code) as any
const partner = (code: string) => db.prepare('SELECT * FROM scm_partner WHERE account_set_id=? AND code=?').get(A, code) as any

describe('档案 Excel 导入', () => {
  it('预检逐行报错、不落库；有错误行时正式导入也不落库', () => {
    const rows = [
      { 物料编码: 'M01', 物料名称: '铝箔', 计量单位: '公斤', 物料属性: '原辅材料', 进价: '3.5' },
      { 物料编码: 'M01', 物料名称: '重复' },
      { 物料编码: '', 物料名称: '没编码' },
      { 物料编码: 'M03', 物料名称: '坏价格', 进价: 'abc', 存货科目: '9999' },
    ]
    const r = importItems(db, A, rows, { conflict: 'skip', dryRun: true })
    expect(r.issues.map(i => i.row)).toEqual([3, 4, 5])
    expect(r.issues[0].message).toMatch(/与第 2 行重复/)
    expect(r.issues[2].message).toMatch(/进价不是数字/)
    expect(r.issues[2].message).toMatch(/9999/)
    expect(r.inserted).toBe(1)   // 预检：将新增 1 行
    expect(importItems(db, A, rows, { conflict: 'skip', dryRun: false }).inserted).toBe(0)
    expect(item('M01')).toBeUndefined()
  })

  it('正式导入：新增默认未审核，单位自动建，上级物料可在同一文件；编码已存在按跳过 / 覆盖', () => {
    const rows = [
      { 物料编码: 'P02', 物料名称: '电容', 上级物料编码: 'P01', 计量单位: '支', 物料属性: '成品', 售价: '1,200.5', 批次管理: '是' },
      { 物料编码: 'P01', 物料名称: '电容类' },
    ]
    const r = importItems(db, A, rows, { conflict: 'skip', dryRun: false })
    expect(r).toMatchObject({ inserted: 2, updated: 0, issues: [] })
    expect(item('P02')).toMatchObject({ audit_status: 'draft', unit: '支', item_type: '9', sale_price: 1200.5, batch_flag: 1, level: 2 })
    expect(item('P01').is_leaf).toBe(0)
    expect((db.prepare('SELECT COUNT(*) c FROM scm_unit WHERE account_set_id=? AND name=?').get(A, '支') as any).c).toBe(1)

    const again = [{ 物料编码: 'P02', 物料名称: '电容（改）', 上级物料编码: 'P01' }]
    expect(importItems(db, A, again, { conflict: 'skip', dryRun: false })).toMatchObject({ skipped: 1, updated: 0 })
    expect(importItems(db, A, again, { conflict: 'overwrite', dryRun: false })).toMatchObject({ updated: 1 })
    expect(item('P02').name).toBe('电容（改）')
  })

  it('往来单位导入：类型按文字识别，留空按入口默认', () => {
    const r = importPartners(db, A, [
      { 单位编码: 'K01', 单位名称: '客户甲', 类型: '客户', '账期(天)': '30' },
      { 单位编码: 'G01', 单位名称: '供应商乙' },
      { 单位编码: 'X01', 单位名称: '错类型', 类型: '代理' },
    ], { conflict: 'skip', dryRun: false, defaultType: 'supplier' })
    expect(r.issues).toHaveLength(1)
    expect(r.inserted).toBe(0)   // 有错误行整批不落库

    const ok = importPartners(db, A, [
      { 单位编码: 'K01', 单位名称: '客户甲', 类型: '客户', '账期(天)': '30' },
      { 单位编码: 'G01', 单位名称: '供应商乙' },
    ], { conflict: 'skip', dryRun: false, defaultType: 'supplier' })
    expect(ok).toMatchObject({ inserted: 2, issues: [] })
    expect(partner('K01')).toMatchObject({ partner_type: 'customer', credit_days: 30, audit_status: 'draft' })
    expect(partner('G01').partner_type).toBe('supplier')
  })
})

describe('批量审核 / 停用与单据引用校验', () => {
  it('批量审核、反审核只改状态不符的，记录审核人', () => {
    const ids = [item('P01').id, item('P02').id]
    expect(setMasterAudit(db, A, 'item', ids, true, '张三')).toEqual({ changed: 2, skipped: 0 })
    expect(setMasterAudit(db, A, 'item', ids, true, '张三')).toEqual({ changed: 0, skipped: 2 })
    expect(item('P02')).toMatchObject({ audit_status: 'audited', auditor: '张三' })
    setMasterAudit(db, A, 'item', [item('P02').id], false, '张三')
    expect(item('P02')).toMatchObject({ audit_status: 'draft', auditor: null })
  })

  it('参数关闭时未审核可用；开启后新引用未审核档案被拦，单据上原有的不拦', () => {
    setParam('0')
    expect(masterUsableError(db, A, { partner_code: 'K01', item_codes: ['P02'] })).toBeNull()
    setParam('1')
    expect(masterUsableError(db, A, { partner_code: 'K01', item_codes: [] })).toMatch(/往来单位「K01 客户甲」尚未审核/)
    expect(masterUsableError(db, A, { item_codes: ['P02'] })).toMatch(/物料 「P02/)
    expect(masterUsableError(db, A, { partner_code: 'K01', item_codes: ['P02'] }, { partner_code: 'K01', item_codes: ['P02'] })).toBeNull()
    setParam('0')
  })

  it('停用的档案不能新引用，启用后恢复', () => {
    const id = item('P01').id
    expect(setMasterEnabled(db, A, 'item', [id], false)).toEqual({ changed: 1, skipped: 0 })
    expect(masterUsableError(db, A, { item_codes: ['P01'] })).toMatch(/已停用/)
    setMasterEnabled(db, A, 'item', [id], true)
    expect(masterUsableError(db, A, { item_codes: ['P01'] })).toBeNull()
    const pid = partner('G01').id
    setMasterEnabled(db, A, 'partner', [pid], false)
    expect(masterUsableError(db, A, { partner_code: 'G01', item_codes: [] })).toMatch(/已停用/)
  })
})

describe('小数位参数校验', () => {
  it('数量 0–6、单价 0–8、金额 0–2 的整数', async () => {
    const { validateDecimalsParam } = await import('../routes/scmBase.js')
    expect(validateDecimalsParam(JSON.stringify({ default: { qty: 2, price: 6, amount: 2 }, types: { SOa: { qty: 0 } } }))).toBeNull()
    expect(validateDecimalsParam(JSON.stringify({ default: { amount: 3 } }))).toMatch(/金额小数位须为 0–2/)
    expect(validateDecimalsParam(JSON.stringify({ default: {}, types: { PI: { price: 9 } } }))).toMatch(/PI：单价/)
    expect(validateDecimalsParam('not json')).toMatch(/格式错误/)
  })
})
