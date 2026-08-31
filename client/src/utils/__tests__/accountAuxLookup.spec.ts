import { describe, it, expect } from 'vitest'
import {
  collectReferencedAuxItemIds,
  collectImportAuxCategoryIds,
  chunkArray,
  findAuxItemByCategoryAndName,
} from '@/utils/accountAuxLookup'

describe('accountAuxLookup', () => {
  it('collectReferencedAuxItemIds 解析 aux_types', () => {
    const ids = collectReferencedAuxItemIds([
      { aux_types: { c1: 'i1', c2: null } },
      { aux_types: JSON.stringify({ c3: 'i3' }) },
      { aux_types: null },
    ])
    expect(ids.sort()).toEqual(['i1', 'i3'])
  })

  it('collectImportAuxCategoryIds 仅收集填写了默认项目名称的类别', () => {
    const ids = collectImportAuxCategoryIds(
      [
        { '辅助-部门': '是', '默认项目-部门': '财务部' },
        { '辅助-项目': '是', '默认项目-项目': '' },
      ],
      [
        { id: 'c1', name: '部门' },
        { id: 'c2', name: '项目' },
      ]
    )
    expect(ids).toEqual(['c1'])
  })

  it('chunkArray 分块', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('findAuxItemByCategoryAndName 忽略首尾空格', () => {
    const item = findAuxItemByCategoryAndName(
      [{ id: '1', name: ' 测试 ' }],
      '测试'
    )
    expect(item?.id).toBe('1')
  })
})
