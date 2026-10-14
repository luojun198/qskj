import { describe, it, expect } from 'vitest'
import { parseTpl, serializeTpl, renderPreview, resetHint, validateSegs } from '../noRule'

describe('noRule 模板 ⇄ 分段', () => {
  it('往返不变', () => {
    for (const tpl of ['{YYYY}{MM}-{CODE}-{SEQ:3}', 'PO-{F:partner_code:3}-{YY}{MM}{DD}-{SEQ:4}', 'KH{SEQ:4}', '{F:category_code}_{SEQ:2}']) {
      expect(serializeTpl(parseTpl(tpl))).toBe(tpl)
    }
  })
  it('预览', () => {
    const segs = parseTpl('PO-{F:partner_code:3}-{YYYY}{MM}-{SEQ:3}')
    const out = renderPreview(segs, { fieldSamples: { partner_code: 'GYS0001' }, date: new Date(2026, 2, 5) })
    expect(out).toBe('PO-GYS-202603-001')
  })
  it('流水号重置口径', () => {
    expect(resetHint(parseTpl('{YYYY}{MM}{DD}{SEQ:3}'))).toMatch(/每天/)
    expect(resetHint(parseTpl('{YYYY}{MM}{SEQ:3}'))).toMatch(/每月/)
    expect(resetHint(parseTpl('{YYYY}{SEQ:3}'))).toMatch(/每年/)
    expect(resetHint(parseTpl('KH{SEQ:4}'))).toMatch(/连续/)
  })
  it('校验', () => {
    expect(validateSegs(parseTpl('KH'))).toMatch(/流水号/)
    expect(validateSegs(parseTpl('{SEQ:3}{SEQ:3}'))).toMatch(/只能有一段/)
    expect(validateSegs(parseTpl('KH{SEQ:4}'))).toBe('')
  })
})
