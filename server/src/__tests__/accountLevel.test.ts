import { describe, expect, it } from 'vitest'
import {
  findDirectParentCodeByPrefix,
  getParentCodeByLevel,
  inferLevelByCodeLength,
} from '../utils/accountLevel.js'

describe('accountLevel utils', () => {
  const codeLengths = [4, 2, 2, 2, 2, 2]

  it('inferLevelByCodeLength 按 4-2-2-2 精确匹配', () => {
    expect(inferLevelByCodeLength('1301', codeLengths, 4)).toBe(1)
    expect(inferLevelByCodeLength('130101', codeLengths, 4)).toBe(2)
    expect(inferLevelByCodeLength('13010101', codeLengths, 4)).toBe(3)
    expect(inferLevelByCodeLength('1301010101', codeLengths, 4)).toBe(4)
    expect(inferLevelByCodeLength('130101001', codeLengths, 4)).toBeNull()
  })

  it('getParentCodeByLevel 返回直接上级编码', () => {
    expect(getParentCodeByLevel('13010101', 3, codeLengths)).toBe('130101')
  })

  it('findDirectParentCodeByPrefix 在 parent_id 缺失时按最长前缀匹配', () => {
    const parent = findDirectParentCodeByPrefix('13010101', ['1301', '130101', '130301'])
    expect(parent).toBe('130101')
  })
})
