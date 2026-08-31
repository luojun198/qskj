import { describe, expect, it } from 'vitest'
import { resolveDefaultWarehouse } from '../scmDefaultWarehouse'

describe('物料默认仓库', () => {
  it('无上游且默认仓库一致时自动带入', () => {
    expect(resolveDefaultWarehouse({
      sourceWarehouse: '',
      headerWarehouse: '',
      manuallySelected: false,
      itemWarehouses: ['WH-A', 'WH-A'],
    })).toBe('WH-A')
  })

  it('多个物料默认仓库不一致时留空', () => {
    expect(resolveDefaultWarehouse({
      sourceWarehouse: '',
      headerWarehouse: 'WH-A',
      manuallySelected: false,
      itemWarehouses: ['WH-A', 'WH-B'],
    })).toBe('')
  })

  it('上游仓库和手工选择均优先于物料默认仓库', () => {
    expect(resolveDefaultWarehouse({
      sourceWarehouse: 'WH-SOURCE',
      headerWarehouse: '',
      manuallySelected: false,
      itemWarehouses: ['WH-ITEM'],
    })).toBe('WH-SOURCE')
    expect(resolveDefaultWarehouse({
      sourceWarehouse: '',
      headerWarehouse: 'WH-MANUAL',
      manuallySelected: true,
      itemWarehouses: ['WH-ITEM'],
    })).toBe('WH-MANUAL')
  })
})
