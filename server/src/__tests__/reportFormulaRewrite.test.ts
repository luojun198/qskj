import { describe, expect, it } from 'vitest'

import { rewriteFormulaForRowCol, REF_ERROR } from '../services/reportFormulaRewrite.js'

describe('reportFormulaRewrite', () => {
  describe('插入行', () => {
    const insertRow = { type: 'insert', axis: 'row', index: 4, count: 1 } as const

    it('插入点及其下方的引用整体下移', () => {
      expect(rewriteFormulaForRowCol('=B5+B6', insertRow)).toBe('=B6+B7')
    })

    it('插入点上方的引用不动', () => {
      expect(rewriteFormulaForRowCol('=B1+B2', insertRow)).toBe('=B1+B2')
    })

    it('区域引用的两个端点分别平移', () => {
      expect(rewriteFormulaForRowCol('=SUM(A3:A8)', insertRow)).toBe('=SUM(A3:A9)')
    })

    it('保留 $ 绝对引用标记', () => {
      expect(rewriteFormulaForRowCol('=$B$5+B$6', insertRow)).toBe('=$B$6+B$7')
    })

    it('一次插入多行按数量平移', () => {
      expect(
        rewriteFormulaForRowCol('=B5', { type: 'insert', axis: 'row', index: 4, count: 3 })
      ).toBe('=B8')
    })
  })

  describe('删除行', () => {
    const deleteRow = { type: 'delete', axis: 'row', index: 4, count: 1 } as const

    it('被删除行上的引用变成 #REF!', () => {
      expect(rewriteFormulaForRowCol('=B5+B6', deleteRow)).toBe(`=${REF_ERROR}+B5`)
    })

    it('被删除行下方的引用上移', () => {
      expect(rewriteFormulaForRowCol('=B7', deleteRow)).toBe('=B6')
    })

    it('被删除行上方的引用不动', () => {
      expect(rewriteFormulaForRowCol('=B2', deleteRow)).toBe('=B2')
    })
  })

  describe('插删列', () => {
    it('插入列使右侧引用右移', () => {
      expect(
        rewriteFormulaForRowCol('=B5+D5', { type: 'insert', axis: 'col', index: 1, count: 1 })
      ).toBe('=C5+E5')
    })

    it('删除列使被删列引用变成 #REF!，右侧左移', () => {
      expect(
        rewriteFormulaForRowCol('=B5+D5', { type: 'delete', axis: 'col', index: 1, count: 1 })
      ).toBe(`=${REF_ERROR}+C5`)
    })

    it('跨越 Z 的列名进位正确', () => {
      expect(
        rewriteFormulaForRowCol('=Z5', { type: 'insert', axis: 'col', index: 0, count: 1 })
      ).toBe('=AA5')
    })
  })

  describe('取数函数的参数必须原样保留（最关键）', () => {
    const insertRow = { type: 'insert', axis: 'row', index: 0, count: 1 } as const

    it('@ye 的科目号与期间不得被当成单元格引用改写', () => {
      // 真实公式，来自「资产负债表」。若误改，取数科目会变错且结果看起来仍然正常。
      const formula = '@ye(1001,99)+ye(1002,99)+ye(1015,99)'
      expect(rewriteFormulaForRowCol(formula, insertRow)).toBe(formula)
    })

    it('@NC / @JQY 等其余取数函数同样受保护', () => {
      expect(rewriteFormulaForRowCol('@NC(1001)+NC(1002)', insertRow)).toBe('@NC(1001)+NC(1002)')
      expect(rewriteFormulaForRowCol('@JQY(6001,01,01)+JQY(6051,01,01)', insertRow)).toBe(
        '@JQY(6001,01,01)+JQY(6051,01,01)'
      )
    })

    it('取数函数与单元格引用混用时，只改引用那一半', () => {
      expect(rewriteFormulaForRowCol('=@ye(1001,99)+B5', insertRow)).toBe('=@ye(1001,99)+B6')
    })

    it('ROUND 不是取数函数，其参数里的引用照常平移', () => {
      // ROUND 的参数是单元格算式而不是科目号，不能进保护名单
      expect(rewriteFormulaForRowCol('=ROUND(A1*B1,2)', insertRow)).toBe('=ROUND(A2*B2,2)')
    })

    it('SUM 不是取数函数，其区域参数照常平移', () => {
      expect(rewriteFormulaForRowCol('=SUM(A1:A3)', insertRow)).toBe('=SUM(A2:A4)')
    })

    it('SUM 里混入取数函数时，取数参数仍受保护', () => {
      expect(rewriteFormulaForRowCol('=SUM(A1,@ye(1001,99))', insertRow)).toBe(
        '=SUM(A2,@ye(1001,99))'
      )
    })
  })

  describe('边界情形', () => {
    it('空值与非公式原样返回', () => {
      expect(rewriteFormulaForRowCol(null, { type: 'insert', axis: 'row', index: 0, count: 1 })).toBeNull()
      expect(rewriteFormulaForRowCol('', { type: 'insert', axis: 'row', index: 0, count: 1 })).toBe('')
      expect(
        rewriteFormulaForRowCol('流动资产：', { type: 'insert', axis: 'row', index: 0, count: 1 })
      ).toBe('流动资产：')
    })

    it('count 为 0 时不做任何改写', () => {
      expect(
        rewriteFormulaForRowCol('=B5', { type: 'insert', axis: 'row', index: 0, count: 0 })
      ).toBe('=B5')
    })

    it('纯数字与科目号不会被误认为引用', () => {
      expect(
        rewriteFormulaForRowCol('=1001+2002', { type: 'insert', axis: 'row', index: 0, count: 1 })
      ).toBe('=1001+2002')
    })
  })
})
