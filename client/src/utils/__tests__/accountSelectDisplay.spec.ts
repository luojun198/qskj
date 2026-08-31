import { describe, expect, it } from 'vitest'
import { formatAccountSelectLabel, withAccountTreeSelectLabel } from '../accountSelectDisplay'

describe('accountSelectDisplay', () => {
  it('formatAccountSelectLabel 拼接编码与名称', () => {
    expect(formatAccountSelectLabel('1001', '库存现金')).toBe('1001 库存现金')
    expect(formatAccountSelectLabel('', '库存现金')).toBe('库存现金')
    expect(formatAccountSelectLabel('1001', '')).toBe('1001')
  })

  it('withAccountTreeSelectLabel 附加 displayLabel', () => {
    expect(withAccountTreeSelectLabel({ code: '1001', name: '现金', id: '1' })).toMatchObject({
      code: '1001',
      name: '现金',
      displayLabel: '1001 现金',
    })
  })
})
