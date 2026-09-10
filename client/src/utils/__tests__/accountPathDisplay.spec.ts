import { describe, it, expect } from 'vitest'
import { buildAccountPathIndex, formatAccountFullPath } from '../accountPathDisplay'

const accounts = [
  { id: 'a1', code: '1002', name: '银行存款', parent_id: null },
  { id: 'a2', code: '100201', name: '建行', parent_id: 'a1' },
  { id: 'a3', code: '100202', name: '工行', parent_id: 'a1' },
  // parent_id 缺失，靠编码前缀兜底
  { id: 'a4', code: '10020101', name: '基本户', parent_id: null },
  { id: 'a5', code: '1001', name: '库存现金', parent_id: null },
]

describe('accountPathDisplay', () => {
  it('按 parent_id 串出各级名称', () => {
    expect(buildAccountPathIndex(accounts).get('a2')).toBe('银行存款/建行')
  })

  it('parent_id 缺失时按编码最长前缀兜底', () => {
    expect(buildAccountPathIndex(accounts).get('a4')).toBe('银行存款/建行/基本户')
  })

  it('一级科目路径即自身名称', () => {
    expect(formatAccountFullPath('1001', 'a5', accounts)).toBe('1001 库存现金')
  })

  it('全路径展示为「编码 + 各级名称」', () => {
    expect(formatAccountFullPath('100201', 'a2', accounts)).toBe('100201 银行存款/建行')
  })

  it('科目查不到时回落到编码 + 快照名称', () => {
    expect(formatAccountFullPath('660101', 'gone', accounts, '差旅费')).toBe('660101 差旅费')
  })

  it('脏数据成环时不死循环', () => {
    const looped = [
      { id: 'x', code: '2001', name: 'X', parent_id: 'y' },
      { id: 'y', code: '2002', name: 'Y', parent_id: 'x' },
    ]
    expect(buildAccountPathIndex(looped).get('x')).toBe('Y/X')
  })
})
