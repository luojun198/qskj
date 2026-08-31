import { describe, expect, it } from 'vitest'
import { normalizePrintTemplateElements } from '../utils/printTemplateNormalize.js'

describe('printTemplateNormalize', () => {
  it('旧版 elements 对象可转为数组', () => {
    const legacy = {
      title: { text: '记账凭证' },
      table: { columns: [{ field: 'summary', label: '摘要', width: '30%' }] },
    }
    const result = normalizePrintTemplateElements(legacy)
    expect(Array.isArray(result)).toBe(true)
    expect(result.some(el => el.type === 'table')).toBe(true)
  })
})
