/**
 * 第七份反馈（润衡云标准版测试说明(5).doc）第一批：
 * - FIX-417 资产业务 / 计提折旧的期间上限：自然月与已结账下一期取较晚者
 * - FIX-419 核算项目下一个可用编码：按纯数字最大值 + 1，跳过已存在
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextAuxItemCode } from '../services/auxItemCode.js'
import { assertNotAfterCurrentPeriod, latestWritablePeriodKey } from '../services/assetVoucherBuilder.js'

let db: Database.Database
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE aux_items (id TEXT PRIMARY KEY, account_set_id TEXT, type TEXT, code TEXT, name TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE period_closing (id TEXT PRIMARY KEY, account_set_id TEXT, year INTEGER, period INTEGER, status TEXT);
  `)
})
afterEach(() => { db.close(); vi.useRealTimers() })

describe('FIX-419 核算项目下一个可用编码', () => {
  const add = (code: string, type = 'cust', status = 'active') =>
    db.prepare('INSERT INTO aux_items (id, account_set_id, type, code, name, status) VALUES (?,?,?,?,?,?)').run(`${type}-${code}`, 'S', type, code, code, status)

  it('空类别从 000001 开始', () => {
    expect(nextAuxItemCode(db, 'S', 'cust')).toBe('000001')
  })

  it('999 / 6001 / 000001 混排时取纯数字最大值 + 1，不再按字符串倒序取到旧号', () => {
    for (const c of ['000001', '000002', '999', '6001', '6002', '6003']) add(c)
    expect(nextAuxItemCode(db, 'S', 'cust')).toBe('006004')
  })

  it('停用项目的编码同样占号；非数字编码不参与计算；只看本类别', () => {
    add('000005', 'cust', 'closed')
    add('KH001')
    add('000099', 'supp')
    expect(nextAuxItemCode(db, 'S', 'cust')).toBe('000006')
  })

  it('位数沿用现有最长纯数字编码', () => {
    add('20260001')
    expect(nextAuxItemCode(db, 'S', 'cust')).toBe('20260002')
  })
})

describe('FIX-417 可写入的最晚期间', () => {
  it('没有结账记录时按自然月', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 17))
    expect(latestWritablePeriodKey(db, 'S')).toBe(202610)
  })

  it('总账 10 月已结账、电脑日期仍在 10 月：允许 11 月', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 17))
    db.prepare("INSERT INTO period_closing VALUES ('1','S',2026,10,'closed')").run()
    expect(latestWritablePeriodKey(db, 'S')).toBe(202611)
    expect(() => assertNotAfterCurrentPeriod(2026, 11, '变动日期', db as any, 'S')).not.toThrow()
    expect(() => assertNotAfterCurrentPeriod(2026, 12, '变动日期', db as any, 'S')).toThrow(/不能晚于当前期间（2026年11月）/)
  })

  it('12 月结账后跨年到次年 1 月；取消结账（open）不算', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 17))
    db.prepare("INSERT INTO period_closing VALUES ('1','S',2026,12,'closed')").run()
    db.prepare("INSERT INTO period_closing VALUES ('2','S',2027,1,'open')").run()
    expect(latestWritablePeriodKey(db, 'S')).toBe(202701)
  })

  it('不传 db 时按自然月（兼容旧调用）', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 17))
    expect(() => assertNotAfterCurrentPeriod(2026, 11)).toThrow(/2026年10月/)
  })
})
