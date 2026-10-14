import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import {
  builtinIoCategoryRole,
  listIoCategories,
  loadIoCategoryAccounts,
  normalizeIoCategoryAccounts,
  resolveIoCategoryAccount,
} from '../services/scmIoCategoryAccount.js'

// 第五份反馈：没启用生产模块时，其他出库做「生产领用」、其他入库做「成品入库」，对方科目应为生产成本
const FALLBACK = { production: '5001', other: '1901' }

describe('其他出入库按收发类别取对方科目', () => {
  it('内置规则：生产领用 / 成品入库 → 生产成本，其余 → 其他出入库对方科目', () => {
    expect(resolveIoCategoryAccount({}, '生产领用', FALLBACK)).toBe('5001')
    expect(resolveIoCategoryAccount({}, '成品入库', FALLBACK)).toBe('5001')
    expect(resolveIoCategoryAccount({}, '领料', FALLBACK)).toBe('5001')
    expect(resolveIoCategoryAccount({}, '盘盈', FALLBACK)).toBe('1901')
    expect(resolveIoCategoryAccount({}, '', FALLBACK)).toBe('1901')
    expect(resolveIoCategoryAccount({}, null, FALLBACK)).toBe('1901')
    expect(builtinIoCategoryRole('完工入库')).toBe('production')
  })

  it('设置里指定的科目优先', () => {
    const mapping = { 报废: '6711', 生产领用: '500101' }
    expect(resolveIoCategoryAccount(mapping, '报废', FALLBACK)).toBe('6711')
    expect(resolveIoCategoryAccount(mapping, '生产领用', FALLBACK)).toBe('500101')
  })

  it('参数读写：去空值，非法 JSON 视为未设置；类别列表 = 内置 + 字典', () => {
    expect(normalizeIoCategoryAccounts({ 报废: ' 6711 ', 盘亏: '', '': '1' })).toEqual({ 报废: '6711' })
    const db = new Database(':memory:')
    db.exec('CREATE TABLE system_params (account_set_id TEXT, param_key TEXT, param_value TEXT)')
    db.prepare("INSERT INTO system_params VALUES ('a', 'scm:io_category_accounts', 'not json')").run()
    expect(loadIoCategoryAccounts(db, 'a')).toEqual({})
    db.prepare("UPDATE system_params SET param_value=? WHERE param_key='scm:io_category_accounts'").run(JSON.stringify({ 样品: '6601' }))
    db.prepare("INSERT INTO system_params VALUES ('a', 'scm:io_categories', '领用,报废，样品赠送')").run()
    const cats = listIoCategories(db, 'a').map(c => c.category)
    expect(cats.slice(0, 7)).toEqual(['成品入库', '盘盈', '其他入库', '生产领用', '盘亏', '报废', '其他出库'])
    expect(cats).toContain('领用')
    expect(cats).toContain('样品赠送')
    expect(cats).toContain('样品')
    expect(cats.filter(c => c === '报废')).toHaveLength(1)
  })
})
