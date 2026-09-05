import { describe, expect, it } from 'vitest'
import { parseAccountSetName } from '../accountSetName'

describe('parseAccountSetName', () => {
  it('剥掉润衡 .acd 的 zwNN 前缀与结尾备份日期', () => {
    expect(parseAccountSetName('zw06广州东汇食品有限公司20260827.acd')).toBe('广州东汇食品有限公司')
  })

  it('处理重名副本后缀', () => {
    expect(parseAccountSetName('zw06广州东汇食品有限公司20260827(2).acd')).toBe(
      '广州东汇食品有限公司'
    )
  })

  it('文件名本来就干净时原样保留', () => {
    expect(parseAccountSetName('广州东汇食品有限公司.acd')).toBe('广州东汇食品有限公司')
  })

  it('不误伤本身就是名字一部分的字母数字开头', () => {
    expect(parseAccountSetName('A1B2C3.db')).toBe('A1B2C3')
  })

  it('剥完只剩数字时退回原文件名', () => {
    expect(parseAccountSetName('zw0620260827.acd')).toBe('zw0620260827')
  })

  it('仍支持带分隔符的日期后缀与常见前缀', () => {
    expect(parseAccountSetName('备份_测试账套_2025-01-01.db')).toBe('测试账套')
    expect(parseAccountSetName('backup_finance_20250101.db')).toBe('finance')
  })

  it('空输入返回空串', () => {
    expect(parseAccountSetName('')).toBe('')
  })

  it('超长名称截断到 50 字', () => {
    expect(parseAccountSetName('公'.repeat(80) + '.acd')).toHaveLength(50)
  })
})
