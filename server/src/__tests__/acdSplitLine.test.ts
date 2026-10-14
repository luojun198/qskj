import { describe, expect, it } from 'vitest'
import { splitAcdLine } from '../scripts/importAcdToCurrentAccountSet.js'

describe('splitAcdLine 引号内含 Tab 的字段', () => {
  it('被双引号包裹且内含 Tab 的摘要合并为一列，后续列不错位', () => {
    const line = '1002002	RMB	2026-09-04	57	2026	9	4	"支付-德茶公司	-茶叶货款"	0	3600	0'
    const r = splitAcdLine(line)
    expect(r).toHaveLength(11)
    expect(r[7]).toBe('支付-德茶公司 -茶叶货款')
    expect(r[8]).toBe('0')
    expect(r[9]).toBe('3600')
  })

  it('普通字段与单个引号保持原样', () => {
    expect(splitAcdLine('a	5"管	"b"	c')).toEqual(['a', '5"管', '"b"', 'c'])
  })

  it('开引号找不到闭引号时不合并', () => {
    expect(splitAcdLine('a	"b	c')).toEqual(['a', '"b', 'c'])
  })
})
