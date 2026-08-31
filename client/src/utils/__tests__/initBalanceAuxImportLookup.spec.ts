import { describe, it, expect } from 'vitest'
import {
  collectAuxImportLookupTokens,
  mergeAuxItemsByCategory,
  remapAuxImportHeadersIfNeeded,
} from '../initBalanceAuxImportLookup'

const categories = [{ id: 'cat1', code: 'proj', name: '案件号' }]

describe('initBalanceAuxImportLookup', () => {
  it('remapAuxImportHeadersIfNeeded 将案款列映射到当前类别', () => {
    const raw = [{ 案款编码: '100001', 案款名称: '测试A', 年初借方: 100 }]
    const remapped = remapAuxImportHeadersIfNeeded(raw, categories)
    expect(remapped[0]['案件号编码']).toBe('100001')
    expect(remapped[0]['案件号名称']).toBe('测试A')
  })

  it('已有正确表头时不改写', () => {
    const raw = [{ 案件号编码: '1', 案件号名称: 'A' }]
    expect(remapAuxImportHeadersIfNeeded(raw, categories)).toEqual(raw)
  })

  it('collectAuxImportLookupTokens 收集编码与仅名称行', () => {
    const raw = [
      { 案件号编码: '100001', 案件号名称: 'A' },
      { 案件号编码: '', 案件号名称: '仅名称' },
    ]
    const remapped = remapAuxImportHeadersIfNeeded(raw, categories)
    const tokens = collectAuxImportLookupTokens(remapped, categories)
    expect([...tokens.cat1.codes]).toEqual(['100001'])
    expect([...tokens.cat1.names]).toEqual(['仅名称'])
  })

  it('mergeAuxItemsByCategory 合并导入项而不截断原有列表', () => {
    const existing = {
      cat1: [{ id: 'a1', code: '001', name: '旧项' }],
    }
    const imported = {
      cat1: Array.from({ length: 250 }, (_, i) => ({
        id: `new-${i}`,
        code: String(i + 100),
        name: `项${i}`,
      })),
    }
    const merged = mergeAuxItemsByCategory(existing, imported)
    expect(merged.cat1).toHaveLength(251)
    expect(merged.cat1.some(i => i.id === 'a1')).toBe(true)
    expect(merged.cat1.some(i => i.id === 'new-249')).toBe(true)
  })
})
