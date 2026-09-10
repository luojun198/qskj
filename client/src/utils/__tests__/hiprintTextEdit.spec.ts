import { describe, expect, it } from 'vitest'
import {
  applyEditedTextContent,
  fillEmptyHiddenTitleTestData,
  isHiddenBoundText,
  syncHiddenBoundText,
} from '@/utils/hiprintTextEdit'

describe('hiprintTextEdit', () => {
  it('识别隐藏标题的绑定文本', () => {
    expect(isHiddenBoundText({ field: 'doc_title', hideTitle: true })).toBe(true)
    expect(isHiddenBoundText({ field: 'doc_title', hideTitle: false })).toBe(false)
    expect(isHiddenBoundText({ hideTitle: true })).toBe(false)
  })

  it('双击编辑隐藏标题字段时，整段写入 testData，不再因等于标题而清空', () => {
    const next = applyEditedTextContent(
      { field: 'doc_title', hideTitle: true, title: '记 账 凭 证', testData: '记 账 凭 证' },
      '记 账 凭 证'
    )
    expect(next).toEqual({ title: '记 账 凭 证', testData: '记 账 凭 证' })
  })

  it('双击改成自定义标题后画布与标题同步', () => {
    const next = applyEditedTextContent(
      { field: 'doc_title', hideTitle: true, title: '记 账 凭 证', testData: '记 账 凭 证' },
      '123'
    )
    expect(next).toEqual({ title: '123', testData: '123' })
  })

  it('显示标题的字段仍按「标题：测试数据」拆', () => {
    const next = applyEditedTextContent(
      { field: 'date_text', hideTitle: false, title: '凭证日期', testData: '2026-09-07' },
      '凭证日期：2026-01-01'
    )
    expect(next).toEqual({ title: '凭证日期', testData: '2026-01-01' })
  })

  it('属性里补了标题、testData 被清空时能填回', () => {
    const { elements, changed } = fillEmptyHiddenTitleTestData([
      { options: { field: 'doc_title', hideTitle: true, title: '123', testData: '' } },
      { options: { field: 'date_text', hideTitle: true, title: '日期', testData: '2026-09-07' } },
    ])
    expect(changed).toBe(true)
    expect(elements[0].options?.testData).toBe('123')
    expect(elements[1].options?.testData).toBe('2026-09-07')
  })

  it('syncHiddenBoundText 用优先文本同时写标题和测试数据', () => {
    expect(syncHiddenBoundText({ field: 'doc_title', hideTitle: true, title: '旧' }, '123')).toEqual({
      title: '123',
      testData: '123',
    })
  })
})
