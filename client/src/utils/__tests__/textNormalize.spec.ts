import { describe, it, expect } from 'vitest'
import {
  namesMatchForImport,
  normalizeDuplicateKey,
  normalizeImportCell,
  normalizeImportCode,
  normalizeImportCodeCell,
  normalizeImportText,
} from '../textNormalize'

describe('textNormalize', () => {
  it('normalizeImportText 全角括号与多空格', () => {
    expect(normalizeImportText('  （2021）渝8888  ')).toBe('(2021)渝8888')
    expect(normalizeImportText('办公室  财务')).toBe('办公室 财务')
  })

  it('normalizeImportCode 去全部空格与全角数字', () => {
    expect(normalizeImportCodeCell(' ０００ ００１ ')).toBe('000001')
    expect(normalizeImportCode('000 001')).toBe('000001')
  })

  it('namesMatchForImport 忽略空格差异', () => {
    expect(namesMatchForImport('办公室  财务', '办公室财务')).toBe(true)
    expect(namesMatchForImport('（2021）渝8888', '(2021)渝8888')).toBe(true)
  })

  it('normalizeDuplicateKey 与 normalizeImportCell 一致', () => {
    expect(normalizeDuplicateKey('A  B')).toBe(normalizeDuplicateKey('AB'))
    expect(normalizeImportCell('测试')).toBe('测试')
  })
})
