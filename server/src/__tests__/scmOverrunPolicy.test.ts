import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  SCM_OVERRUN_PARAM_KEYS,
  getScmMaxAllowedQty,
  getScmOverrunPolicy,
  resolvePlanOverrunScope,
  resolveSourceOverrunScope,
  validateScmOverrunParam,
} from '../services/scmOverrunPolicy.js'

describe('供应链超量策略', () => {
  it('缺少参数时关闭，且四类业务映射互相独立', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE system_params (account_set_id TEXT, param_key TEXT, param_value TEXT)')
    expect(getScmOverrunPolicy(db, 'A1', 'sales')).toEqual({ enabled: false, rate: 0 })
    expect(resolveSourceOverrunScope('SO', 'SOa')).toBe('sales')
    expect(resolveSourceOverrunScope('PI', 'PO')).toBe('purchase')
    expect(resolvePlanOverrunScope('PL')).toBe('production')
    expect(resolvePlanOverrunScope('PB')).toBe('production')
    expect(resolvePlanOverrunScope('PF')).toBe('production')
    expect(resolvePlanOverrunScope('WO')).toBe('outsource')
    expect(resolvePlanOverrunScope('WI')).toBe('outsource')
  })

  it('按六位小数计算允许上限', () => {
    expect(getScmMaxAllowedQty(100, { enabled: true, rate: 10 })).toBe(110)
    expect(getScmMaxAllowedQty(1.234567, { enabled: true, rate: 12.34 })).toBe(1.386913)
    expect(getScmMaxAllowedQty(100, { enabled: false, rate: 10 })).toBe(100)
  })

  it('八个参数只接受合法开关和 0 到 1000 的两位小数比例', () => {
    expect(SCM_OVERRUN_PARAM_KEYS).toHaveLength(8)
    for (const key of SCM_OVERRUN_PARAM_KEYS.filter(key => key.endsWith('_enabled'))) {
      expect(validateScmOverrunParam(key, '0')).toBeNull()
      expect(validateScmOverrunParam(key, '1')).toBeNull()
      expect(validateScmOverrunParam(key, 'true')).toContain('开关')
    }
    for (const key of SCM_OVERRUN_PARAM_KEYS.filter(key => key.endsWith('_rate'))) {
      for (const value of ['0', '10', '10.25', '1000']) expect(validateScmOverrunParam(key, value)).toBeNull()
      for (const value of ['-1', 'abc', '10.123', '1000.01', '']) expect(validateScmOverrunParam(key, value)).toContain('比例')
    }
  })
})
