import { describe, expect, it } from 'vitest'

import {
  borderCss,
  buildStyleKey,
  formatNumberByType,
  mergeStyleKey,
  parseStyleKey,
  styleToCssText,
} from '../useReportCellStyle'

describe('useReportCellStyle', () => {
  describe('解析', () => {
    it('解析既有约定的全部 token', () => {
      const style = parseStyleKey(
        'align-center valign-bottom font-size-18 font-bold font-underline font-family-SimHei border-all border-color-FF0000 border-width-2'
      )
      expect(style).toMatchObject({
        textAlign: 'center',
        verticalAlign: 'bottom',
        fontSize: 18,
        bold: true,
        underline: true,
        fontFamily: 'SimHei',
        borderStyle: 'all',
        borderColor: 'FF0000',
        borderWidth: 2,
      })
    })

    it('解析新增的文字色与底色', () => {
      const style = parseStyleKey('text-color-C00000 bg-color-FFFF00')
      expect(style.textColor).toBe('C00000')
      expect(style.bgColor).toBe('FFFF00')
    })

    it('border-color 不能被当成 borderStyle 吃掉', () => {
      // border-color-XXX 与 border-XXX 前缀重叠，解析顺序错了就会把颜色当样式
      const style = parseStyleKey('border-color-123456')
      expect(style.borderColor).toBe('123456')
      expect(style.borderStyle).toBe('')
    })

    it('非法颜色值被忽略', () => {
      expect(parseStyleKey('text-color-xyz').textColor).toBe('')
      expect(parseStyleKey('bg-color-12345').bgColor).toBe('')
    })

    it('空值返回全默认', () => {
      const style = parseStyleKey(null)
      expect(style.fontSize).toBe(0)
      expect(style.bold).toBe(false)
      expect(style.textAlign).toBe('')
    })
  })

  describe('生成与合并', () => {
    it('只输出设置过的项', () => {
      expect(buildStyleKey({ bold: true, fontSize: 14 })).toBe('font-size-14 font-bold')
      expect(buildStyleKey({})).toBe('')
    })

    it('颜色归一成不带 # 的大写六位', () => {
      expect(buildStyleKey({ textColor: '#ff0000' })).toBe('text-color-FF0000')
      expect(buildStyleKey({ bgColor: 'ffff00' })).toBe('bg-color-FFFF00')
    })

    it('合并时保留未涉及的项', () => {
      const next = mergeStyleKey('align-center font-size-18 font-bold', { textColor: '#C00000' })
      const style = parseStyleKey(next)
      expect(style.textAlign).toBe('center')
      expect(style.fontSize).toBe(18)
      expect(style.bold).toBe(true)
      expect(style.textColor).toBe('C00000')
    })

    it('合并可以清除某一项', () => {
      const next = mergeStyleKey('font-bold text-color-FF0000', { textColor: '' })
      expect(parseStyleKey(next).textColor).toBe('')
      expect(parseStyleKey(next).bold).toBe(true)
    })

    it('迁移固化的标题样式能原样往返', () => {
      const key = 'align-center font-size-18 font-bold'
      expect(buildStyleKey(parseStyleKey(key))).toBe(key)
    })
  })

  describe('边框 CSS', () => {
    it('按样式生成对应的边', () => {
      expect(borderCss(parseStyleKey('border-bottom border-width-2 border-color-000000'))).toEqual({
        borderBottom: '2px solid #000000',
      })
      expect(borderCss(parseStyleKey('border-header'))).toEqual({
        borderTop: '1px solid #000',
        borderBottom: '1px solid #000',
      })
      expect(borderCss(parseStyleKey('border-none'))).toEqual({ border: 'none' })
    })
  })

  describe('数字格式', () => {
    it('千分位串不会被 parseFloat 截断', () => {
      // 服务端会输出 "1,234.00"，直接 parseFloat 会得到 1
      expect(formatNumberByType('1,234.00', '2decimal')).toBe('1234.00')
      expect(formatNumberByType('1,234.56', 'integer')).toBe('1235')
    })

    it('各格式输出正确', () => {
      expect(formatNumberByType('1234.5678', '4decimal')).toBe('1234.5678')
      expect(formatNumberByType('0.125', 'percent')).toBe('12.50%')
      expect(formatNumberByType('1234.5', 'thousands')).toBe('1,234.50')
    })

    it('无格式或非数值时原样返回', () => {
      expect(formatNumberByType('1234', '')).toBe('1234')
      expect(formatNumberByType('合计', '2decimal')).toBe('合计')
    })
  })

  describe('打印 CSS（与屏幕同源）', () => {
    it('没设过边框时不输出任何边框——Excel 模式下网格线不打印', () => {
      expect(styleToCssText(parseStyleKey(''))).toBe('')
      expect(styleToCssText(parseStyleKey('font-bold'))).toBe('font-weight:700;')
    })

    it('设过的边框会输出，且与屏幕用的是同一份解析', () => {
      const key = 'border-all border-color-FF0000 border-width-2'
      const css = styleToCssText(parseStyleKey(key))
      expect(css).toContain('border:2px solid #FF0000;')
      // 屏幕侧 borderCss 得到的是等价结果
      expect(borderCss(parseStyleKey(key))).toEqual({ border: '2px solid #FF0000' })
    })

    it('单边框线转成连字符属性名', () => {
      expect(styleToCssText(parseStyleKey('border-bottom'))).toContain('border-bottom:1px solid #000;')
      const header = styleToCssText(parseStyleKey('border-header'))
      expect(header).toContain('border-top:1px solid #000;')
      expect(header).toContain('border-bottom:1px solid #000;')
    })

    it('文字色、底色、字体族都会带上（早先打印侧全漏了）', () => {
      const css = styleToCssText(parseStyleKey('text-color-C00000 bg-color-FFFF00 font-family-SimHei'))
      expect(css).toContain('color:#C00000;')
      expect(css).toContain('background-color:#FFFF00;')
      expect(css).toContain('SimHei')
      // 底色要能打印出来，需要显式开启颜色保留
      expect(css).toContain('print-color-adjust:exact;')
    })

    it('标题行的固化样式打印时完整还原', () => {
      const css = styleToCssText(parseStyleKey('align-center font-size-18 font-bold'))
      expect(css).toBe('text-align:center;font-size:18px;font-weight:700;')
    })
  })
})
