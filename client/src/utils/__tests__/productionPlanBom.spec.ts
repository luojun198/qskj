import { describe, expect, it } from 'vitest'
import { hasSelectedMaterialLines, matchProductBoms, pickDefaultProductBom, shouldResetProductBom } from '@/utils/productionPlanBom'

const boms = [
  { id: 'B1', item_code: 'P1' },
  { id: 'B2', item_code: 'P1' },
  { id: 'B3', item_code: 'P2' },
]

describe('生产计划 BOM 匹配', () => {
  it('只返回当前成品对应的 BOM', () => {
    expect(matchProductBoms(boms, 'P1').map(row => row.id)).toEqual(['B1', 'B2'])
    expect(matchProductBoms(boms, 'P2').map(row => row.id)).toEqual(['B3'])
    expect(matchProductBoms(boms, '')).toEqual([])
  })

  it('只有产品实际变化时清理旧 BOM', () => {
    expect(shouldResetProductBom('P1', 'P2')).toBe(true)
    expect(shouldResetProductBom('P1', 'P1')).toBe(false)
    expect(shouldResetProductBom('', 'P1')).toBe(false)
  })

  it('空白占位用料行不阻止 BOM 自动带出', () => {
    expect(hasSelectedMaterialLines([{ item_code: '' }])).toBe(false)
    expect(hasSelectedMaterialLines([{ item_code: 'M1' }])).toBe(true)
  })
})

describe('pickDefaultProductBom', () => {
  it('优先启用状态，其次版本新、编码小', () => {
    const boms = [
      { id: 'B1', code: 'BOM0002', item_code: 'P1', version: '1', status: 'active' },
      { id: 'B2', code: 'BOM0001', item_code: 'P1', version: '2', status: 'inactive' },
      { id: 'B3', code: 'BOM0003', item_code: 'P1', version: '2', status: 'active' },
    ]
    expect(pickDefaultProductBom(boms)?.id).toBe('B3')
    expect(pickDefaultProductBom([])).toBeNull()
  })
})

describe('matchProductBoms 编码归一化', () => {
  it('忽略首尾空格与大小写差异', () => {
    const boms = [{ id: 'B1', item_code: ' a100 ' }, { id: 'B2', item_code: 'A100' }]
    expect(matchProductBoms(boms, 'a100').map(b => b.id)).toEqual(['B1', 'B2'])
  })
})
